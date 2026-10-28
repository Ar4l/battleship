import { cellName } from '../game/board';
import { bytesEqual, commitBoard, commitCoin, hostStarts, randomBytes } from '../game/commit';
import { applyAnswer, createMatch, localAttack, remoteAttack, shotsAllowed, untargeted, type Match } from '../game/engine';
import { ITEMS } from '../game/items';
import { cryptoRng, randomFleet } from '../game/random';
import { DEFAULT_CONFIG, SHIP_NAMES, configFlags, fleetLegal } from '../game/rules';
import type { Answer, Attack, Config, Fleet, Rng } from '../game/types';
import { verifyOpponent } from '../game/verify';
import { PROTO_VERSION, answerMsg, attackMsg, decode, encode, msgAnswer, msgAttack, type Msg } from '../proto/codec';
import type { Transport } from '../net/transport';
import type { AppState, NoticeKind } from './state';

export type Sfx = 'miss' | 'hit' | 'sunk' | 'turn';

/** Network entry points, injected so tests can run without WebRTC. */
export interface NetDeps {
  openRoom?: typeof import('../net/room').openRoom;
  randomCode?: () => number;
  createDirectHost?: typeof import('../net/direct').createDirectHost;
  createDirectGuest?: typeof import('../net/direct').createDirectGuest;
  listenForAnswers?: typeof import('../net/forward').listenForAnswers;
  forwardAnswer?: typeof import('../net/forward').forwardAnswer;
}

export interface Lie {
  kind: 'miss-on-hit';
  cell: number;
}

const REVEAL_WAIT_MS = 10000;
const BANNER_MS = 1200;

export class Controller {
  state: AppState = { s: 'home' };
  config: Config = { ...DEFAULT_CONFIG };
  role: 'host' | 'guest' = 'host';
  fleet: Fleet;
  /** Salvo selection on the target board. */
  sel: number[] = [];
  /** Most recent result, for the status strip. */
  lastResult = '';
  /** Cells to animate on next render. */
  fx: { target: number[]; own: number[] } = { target: [], own: [] };
  deadline = 0;
  lie: Lie | null = null;
  rng: Rng = cryptoRng;
  onSfx: (s: Sfx) => void = () => {};
  onAnnounce: (text: string) => void = () => {};

  private listeners = new Set<() => void>();
  private t: Transport | null = null;
  private room: { leave(): void } | null = null;
  private directClose: (() => void) | null = null;
  private stopForward: (() => void) | null = null;
  private gameNo = 0;
  private hostStartedLast = false;
  private salt: Uint8Array = new Uint8Array(16);
  private nonce: Uint8Array = new Uint8Array(16);
  private theirBoardCommit: Uint8Array | null = null;
  private theirCoinCommit: Uint8Array | null = null;
  private theirNonce: Uint8Array | null = null;
  private sentCoin = false;
  private revealed = false;
  private timers = new Map<string, number>();
  private gotHello = false;
  private lastCode = 0;
  private readying = false;

  constructor(private net: NetDeps = {}) {
    this.fleet = randomFleet(false, this.rng);
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private set(s: AppState): void {
    this.state = s;
    this.emit();
  }
  emit(): void {
    for (const f of this.listeners) f();
  }
  private timer(name: string, ms: number, f: () => void): void {
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => (this.timers.delete(name), f()), ms) as unknown as number);
  }
  private untimer(name: string): void {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
  }
  private send(m: Msg): void {
    this.t?.send(encode(m));
  }
  get match(): Match | null {
    const s = this.state;
    return s.s === 'battle' || s.s === 'end' ? s.match : null;
  }

  // ---------- connection ----------

  createGame(): void {
    if (!this.net.openRoom) return;
    this.teardown();
    this.role = 'host';
    const code = this.net.randomCode!();
    this.lastCode = code;
    this.set({ s: 'lobby-host', code, relaysDown: false });
    this.room = this.net.openRoom('host', code, {
      transport: (t) => this.attach(t, 'host'),
      full: () => {},
      failed: () => this.notice('failed'),
      relaysDown: () => this.state.s === 'lobby-host' && this.set({ ...this.state, relaysDown: true }),
      slow: () => {},
      code: (c) => {
        this.lastCode = c;
        if (this.state.s === 'lobby-host') this.set({ ...this.state, code: c });
      },
    });
  }

  joinCode(code: number): void {
    if (!this.net.openRoom) return;
    this.teardown();
    this.role = 'guest';
    this.lastCode = code;
    this.set({ s: 'lobby-guest', code, slow: false });
    this.room = this.net.openRoom('guest', code, {
      transport: (t) => this.attach(t, 'guest'),
      full: () => this.notice('room-full'),
      failed: () => this.notice('failed'),
      relaysDown: () => {},
      slow: () => this.state.s === 'lobby-guest' && this.set({ ...this.state, slow: true }),
      code: () => {},
    });
  }

  async startDirectHost(): Promise<void> {
    if (!this.net.createDirectHost) return;
    this.teardown();
    this.role = 'host';
    this.set({ s: 'direct-host', step: 'gathering' });
    try {
      const h = await this.net.createDirectHost();
      if (this.state.s !== 'direct-host') return h.close();
      this.directClose = h.close;
      this.directAccept = async (a: string) => {
        try {
          await h.accept(a);
          if (this.state.s === 'direct-host') this.set({ ...this.state, step: 'connecting', error: undefined });
        } catch {
          if (this.state.s === 'direct-host') this.set({ ...this.state, error: 'That link looks incomplete. Ask for it again.' });
        }
      };
      this.stopForward = this.net.listenForAnswers?.((b) => void this.directAccept?.(b)) ?? null;
      this.set({ s: 'direct-host', step: 'share', blob: h.blob });
      h.transport.then(
        (t) => this.attach(t, 'host'),
        () => this.state.s === 'direct-host' && this.notice('failed'),
      );
    } catch {
      this.notice('failed');
    }
  }
  private directAccept: ((a: string) => Promise<void>) | null = null;
  pasteAnswer(text: string): void {
    void this.directAccept?.(text);
  }

  async openOffer(blob: string): Promise<void> {
    if (!this.net.createDirectGuest) return;
    this.teardown();
    this.role = 'guest';
    this.set({ s: 'direct-guest', step: 'gathering' });
    try {
      const g = await this.net.createDirectGuest(blob);
      if (!g) return this.notice('bad-link');
      this.directClose = g.close;
      this.set({ s: 'direct-guest', step: 'share', blob: g.blob });
      g.transport.then(
        (t) => this.attach(t, 'guest'),
        () => this.state.s === 'direct-guest' && this.notice('failed'),
      );
    } catch {
      this.notice('failed');
    }
  }

  async openAnswer(blob: string): Promise<void> {
    const ok = (await this.net.forwardAnswer?.(blob)) ?? false;
    this.set({ s: 'forwarded', ok, blob });
  }

  /** Channel to the opponent is open. */
  attach(t: Transport, role: 'host' | 'guest'): void {
    this.stopForward?.();
    this.stopForward = null;
    this.t = t;
    this.role = role;
    this.gameNo = 0;
    this.gotHello = false;
    t.onmessage = (u8) => this.onFrame(u8);
    t.onclose = () => this.peerGone();
    this.send({ t: 'hello', ver: PROTO_VERSION, role: role === 'host' ? 0 : 1 });
  }

  private notice(kind: NoticeKind, detail?: string): void {
    this.teardown();
    this.set({ s: 'notice', kind, code: this.lastCode || undefined, detail });
  }

  /** Close every network resource and timer. */
  private teardown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.t?.close();
    this.t = null;
    this.room?.leave();
    this.room = null;
    this.directClose?.();
    this.directClose = null;
    this.directAccept = null;
    this.stopForward?.();
    this.stopForward = null;
    this.deadline = 0;
  }

  leave(): void {
    this.send({ t: 'bye' });
    const code = this.lastCode;
    this.teardown();
    this.lastCode = 0;
    this.set({ s: 'home', code: undefined });
    void code;
  }

  retry(): void {
    const code = this.lastCode;
    this.teardown();
    this.set({ s: 'home', code: code ? String(code) : undefined });
  }

  /** Stop waiting for a stalled opponent: forfeit win, unverified. */
  leaveStalled(): void {
    const s = this.state;
    if (s.s !== 'battle') return this.leave();
    this.send({ t: 'bye' });
    this.teardown();
    s.match.winner = 'me';
    s.match.phase = 'over';
    this.set({ s: 'notice', kind: 'left', detail: 'stalled' });
  }

  private peerGone(): void {
    this.t = null;
    const s = this.state;
    if (s.s === 'end') {
      if (s.verdict === 'pending') {
        s.verdict = 'unverified';
        s.reason = 'Opponent left before revealing their fleet — result not verified.';
      }
      this.teardown();
      this.set({ ...s, peerLeft: true });
      return;
    }
    this.notice('left', s.s === 'battle' ? 'battle' : undefined);
  }

  // ---------- settings / placement ----------

  setConfig(c: Partial<Config>): void {
    this.config = { ...this.config, ...c };
    if (this.config.mode !== 0) this.config.extraShot = false;
    this.emit();
  }

  setFleet(f: Fleet): void {
    if (this.state.s !== 'placement' || this.state.ready.me) return;
    this.fleet = f;
    this.emit();
  }

  randomize(): void {
    this.setFleet(randomFleet(this.config.noTouch, this.rng));
  }

  private toPlacement(): void {
    this.untimer('reveal');
    this.fleet = randomFleet(this.config.noTouch, this.rng);
    this.theirBoardCommit = this.theirCoinCommit = this.theirNonce = null;
    this.sentCoin = false;
    this.revealed = false;
    this.sel = [];
    this.lastResult = '';
    this.gameNo++;
    this.set({ s: 'placement', ready: { me: false, them: false } });
  }

  async ready(): Promise<void> {
    const s = this.state;
    if (s.s !== 'placement' || s.ready.me || this.readying || !fleetLegal(this.fleet, this.config.noTouch)) return;
    this.readying = true;
    const salt = randomBytes(16);
    const nonce = randomBytes(16);
    const board = await commitBoard(salt, this.fleet, configFlags(this.config));
    const coin = await commitCoin(nonce);
    this.readying = false;
    if (this.state !== s) return;
    this.salt = salt;
    this.nonce = nonce;
    s.ready.me = true;
    this.send({ t: 'ready', board, coin });
    this.emit();
    this.maybeStart();
  }

  private maybeStart(): void {
    const s = this.state;
    if (s.s !== 'placement' || !s.ready.me || !s.ready.them) return;
    if (this.gameNo === 1) {
      if (!this.sentCoin) {
        this.sentCoin = true;
        this.send({ t: 'coin', nonce: this.nonce });
      }
      if (!this.theirNonce) return;
      const [h, g] = this.role === 'host' ? [this.nonce, this.theirNonce] : [this.theirNonce, this.nonce];
      this.startBattle(hostStarts(h, g) === (this.role === 'host'), true);
    } else {
      const hostStarts = !this.hostStartedLast;
      this.startBattle(hostStarts === (this.role === 'host'), false);
    }
  }

  private startBattle(iStart: boolean, coin: boolean): void {
    this.hostStartedLast = iStart === (this.role === 'host');
    const match = createMatch(this.config, this.fleet, iStart);
    const banner = iStart ? 'You go first' : 'They go first';
    this.fx = { target: [], own: [] };
    this.set({ s: 'battle', match, banner });
    this.onAnnounce(coin ? `Coin toss: ${banner.toLowerCase()}.` : `${banner}.`);
    this.timer('banner', BANNER_MS, () => {
      if (this.state.s === 'battle') this.set({ ...this.state, banner: undefined });
    });
    this.turnStarted();
  }

  // ---------- battle ----------

  /** Salvo: toggle a cell in the selection. Fires when full and `fireWhenFull`. */
  toggleSel(cell: number): void {
    const m = this.match;
    if (!m || m.phase !== 'myTurn' || m.target.shot.has(cell)) return;
    const i = this.sel.indexOf(cell);
    if (i >= 0) this.sel.splice(i, 1);
    else if (this.sel.length < shotsAllowed(m, 'me')) this.sel.push(cell);
    this.emit();
  }
  clearSel(): void {
    this.sel = [];
    this.emit();
  }

  attack(a: Attack): boolean {
    const s = this.state;
    if (s.s !== 'battle' || s.match.phase !== 'myTurn') return false;
    try {
      localAttack(s.match, a);
    } catch {
      return false;
    }
    this.sel = [];
    this.untimer('turn');
    this.deadline = 0;
    this.send(attackMsg(a));
    this.emit();
    return true;
  }

  fireSalvo(): boolean {
    const m = this.match;
    if (!m || this.sel.length !== shotsAllowed(m, 'me')) return false;
    return this.attack({ k: 'fire', cells: this.sel.slice() });
  }

  private turnStarted(): void {
    const s = this.state;
    if (s.s !== 'battle') return;
    const m = s.match;
    this.untimer('turn');
    this.untimer('stall');
    const secs = this.config.timer;
    if (m.phase === 'myTurn') {
      this.onSfx('turn');
      if (typeof document !== 'undefined') document.title = 'Your turn · Battleship';
      if (secs) {
        this.deadline = Date.now() + secs * 1000;
        this.timer('turn', secs * 1000, () => this.autoAct());
      }
    } else {
      if (typeof document !== 'undefined') document.title = 'Battleship';
      if (secs) {
        this.deadline = Date.now() + secs * 1000;
        this.timer('stall', (secs + 15) * 1000, () => {
          if (this.state.s === 'battle' && this.state.match.phase === 'theirTurn') this.set({ ...this.state, stalled: true });
        });
      }
    }
  }

  /** Turn timer ran out: fire randomly (Salvo fills the remaining selection). */
  autoAct(): void {
    const m = this.match;
    if (!m || m.phase !== 'myTurn') return;
    const free = untargeted(m.target).filter((c) => !this.sel.includes(c));
    const need = shotsAllowed(m, 'me') - (m.config.mode === 1 ? this.sel.length : 0);
    const cells = m.config.mode === 1 ? this.sel.slice() : [];
    for (let i = 0; i < need && free.length; i++) cells.push(free.splice(this.rng(free.length), 1)[0]!);
    this.attack({ k: 'fire', cells });
  }

  private describe(entries: Answer, mine: boolean): string {
    if (entries.k === 'sonar') return mine ? `Sonar: ${entries.count} ship cell${entries.count === 1 ? '' : 's'}` : 'They used sonar';
    const parts: string[] = [];
    for (const e of entries.entries) {
      if (e.code >= 2) parts.push(mine ? `You sank their ${SHIP_NAMES[e.code - 2]}` : `They sank your ${SHIP_NAMES[e.code - 2]}`);
    }
    if (parts.length) return parts.join('. ');
    if (!entries.entries.length) return mine ? 'Torpedo ran clean' : 'Their torpedo ran clean';
    const hits = entries.entries.filter((e) => e.code).map((e) => cellName(e.cell));
    if (entries.entries.length === 1) return `${mine ? '' : 'They fired at '}${cellName(entries.entries[0]!.cell)} ${hits.length ? 'hit' : 'miss'}`.replace(/^./, (c) => c.toUpperCase());
    return hits.length ? `${hits.length} hit${hits.length > 1 ? 's' : ''}: ${hits.join(' ')}` : 'All miss';
  }

  private sfxFor(a: Answer): void {
    if (a.k === 'sonar') return this.onSfx('miss');
    this.onSfx(a.entries.some((e) => e.code >= 2) ? 'sunk' : a.entries.some((e) => e.code) ? 'hit' : 'miss');
  }

  private onFrame(u8: Uint8Array): void {
    const m = decode(u8);
    const s = this.state;
    if (!m) {
      if (s.s === 'battle') this.cheat('they sent an invalid message');
      return;
    }
    switch (m.t) {
      case 'hello':
        if (m.ver !== PROTO_VERSION) return this.notice('version');
        if (this.gotHello) return;
        this.gotHello = true;
        if (this.role === 'host') {
          this.send({ t: 'config', config: this.config });
          this.toPlacement();
        }
        return;
      case 'config':
        if (this.role !== 'guest' || s.s === 'placement' || s.s === 'battle') return;
        this.config = m.config;
        this.toPlacement();
        return;
      case 'ready':
        if (s.s !== 'placement' || s.ready.them) return;
        this.theirBoardCommit = m.board;
        this.theirCoinCommit = m.coin;
        s.ready.them = true;
        this.emit();
        this.maybeStart();
        return;
      case 'coin':
        if (s.s !== 'placement' || !this.theirCoinCommit || this.theirNonce) return;
        void commitCoin(m.nonce).then((c) => {
          if (!this.theirCoinCommit || !bytesEqual(c, this.theirCoinCommit)) return this.notice('invalid-move');
          this.theirNonce = m.nonce;
          this.maybeStart();
        });
        return;
      case 'fire':
      case 'use':
        return this.onAttack(msgAttack(m)!);
      case 'answer':
      case 'sonar':
        return this.onAnswer(msgAnswer(m)!);
      case 'reveal':
        return void this.onReveal(m.salt, m.fleet);
      case 'verdict':
        if (s.s === 'end') this.set({ ...s, theirVerdict: m.ok });
        return;
      case 'rematch':
        if (s.s !== 'end') return;
        if (m.config && this.role === 'guest') this.config = m.config;
        s.rematch.them = true;
        if (s.rematch.me) this.toPlacement();
        else this.emit();
        return;
      case 'bye':
        this.t?.close();
        return this.peerGone();
    }
  }

  private onAttack(a: Attack): void {
    const s = this.state;
    if (s.s !== 'battle') return;
    const r = remoteAttack(s.match, a);
    if ('cheat' in r) return this.cheat(r.cheat);
    let wire = r.answer;
    const lie = this.lie;
    if (lie && wire.k === 'cells' && wire.entries.some((e) => e.cell === lie.cell && e.code)) {
      wire = { k: 'cells', entries: wire.entries.map((e) => (e.cell === lie.cell ? { cell: e.cell, code: 0 } : e)) };
    }
    this.send(answerMsg(wire));
    this.fx = { target: [], own: s.match.own.last.slice() };
    const text = this.describe(r.answer, false);
    this.lastResult = text;
    this.sfxFor(r.answer);
    if (s.match.phase === 'over') return this.gameOver(text);
    this.set({ ...s, stalled: false, banner: undefined });
    this.onAnnounce(text + (s.match.phase === 'myTurn' ? '. Your turn.' : '.'));
    this.turnStarted();
  }

  private onAnswer(a: Answer): void {
    const s = this.state;
    if (s.s !== 'battle' || s.match.phase !== 'awaitingAnswer') {
      if (s.s === 'battle') this.cheat('they answered out of turn');
      return;
    }
    const r = applyAnswer(s.match, a);
    if ('cheat' in r) return this.cheat(r.cheat);
    this.fx = { target: s.match.target.last.slice(), own: [] };
    const text = this.describe(a, true);
    this.lastResult = text;
    this.sfxFor(a);
    if ((s.match.phase as string) === 'over') return this.gameOver(text);
    this.set({ ...s, banner: undefined });
    this.onAnnounce(text + '.');
    this.turnStarted();
  }

  // ---------- end of game ----------

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.send({ t: 'reveal', salt: this.salt, fleet: this.fleet });
  }

  private toEnd(match: Match, verdict: 'pending' | 'cheat', reason?: string): void {
    this.untimer('turn');
    this.untimer('stall');
    this.untimer('banner');
    this.deadline = 0;
    match.phase = 'over';
    if (typeof document !== 'undefined') document.title = 'Battleship';
    this.set({ s: 'end', match, verdict, reason, theirVerdict: null, rematch: { me: false, them: false }, peerLeft: false });
    this.reveal();
    this.timer('reveal', REVEAL_WAIT_MS, () => {
      const e = this.state;
      if (e.s === 'end' && e.verdict === 'pending')
        this.set({ ...e, verdict: 'unverified', reason: 'Opponent left before revealing their fleet — result not verified.' });
    });
  }

  private gameOver(text: string): void {
    const m = this.match!;
    this.toEnd(m, 'pending');
    this.onAnnounce(`${text}. ${m.winner === 'me' ? 'You won' : 'You lost'}.`);
  }

  private cheat(reason: string): void {
    const s = this.state;
    if (s.s !== 'battle') return;
    const full = 'Cheating detected: ' + reason + '.';
    if (s.match.winner === null) s.match.winner = 'me';
    this.toEnd(s.match, 'cheat', full);
    this.onAnnounce(full);
  }

  private async onReveal(salt: Uint8Array, fleet: Fleet): Promise<void> {
    let s = this.state;
    if (s.s === 'battle') {
      // They ended the game (game over, or they flagged us); reveal back.
      this.toEnd(s.match, 'pending');
      s = this.state;
    }
    if (s.s !== 'end' || !this.theirBoardCommit) return;
    this.untimer('reveal');
    const v = await verifyOpponent(this.config, this.theirBoardCommit, salt, fleet, s.match.transcript);
    this.send({ t: 'verdict', ok: v.ok });
    const e = this.state;
    if (e.s !== 'end') return;
    if (v.ok) this.set({ ...e, theirFleet: fleet, verdict: e.verdict === 'cheat' ? 'cheat' : 'verified' });
    else this.set({ ...e, theirFleet: fleet, verdict: 'cheat', reason: v.reason });
    this.onAnnounce(v.ok ? 'Fleet verified.' : v.reason);
  }

  rematch(): void {
    const s = this.state;
    if (s.s !== 'end' || s.rematch.me || s.peerLeft) return;
    s.rematch.me = true;
    s.editing = false;
    this.send(this.role === 'host' ? { t: 'rematch', config: this.config } : { t: 'rematch' });
    if (s.rematch.them) this.toPlacement();
    else this.emit();
  }

  toggleEditing(): void {
    const s = this.state;
    if (s.s === 'end' && this.role === 'host') this.set({ ...s, editing: !s.editing });
  }

  /** Item cost check helper for the UI. */
  canAfford(item: number): boolean {
    const m = this.match;
    return !!m && m.phase === 'myTurn' && m.energy.me >= ITEMS[item]!.cost;
  }
}
