import { cellName as name } from '../game/board';
import { bytesEqual, commitBoard, commitCoin, hostStarts, randomBytes } from '../game/commit';
import { applyAnswer, createMatch, localAttack, remoteAttack, shotsAllowed, untargeted, type Match } from '../game/engine';
import { cryptoRng, randomFleet } from '../game/random';
import { DEFAULT_CONFIG, fleetLegal, geoOf, normConfig } from '../game/rules';
import type { Answer, Attack, Config, Fleet, Geo, Rng } from '../game/types';
import { verifyOpponent } from '../game/verify';
import { PROTO_VERSION, decode, encode, type Msg } from '../proto/codec';
import type { RoomEvents } from '../net/room';
import type { Transport } from '../net/transport';
import type { AppState, NoticeKind } from './state';

export type Sfx = 'miss' | 'hit' | 'sunk' | 'turn';

/** Network entry points, injected so tests can run without WebRTC. */
export interface NetDeps {
  openRoom?: typeof import('../net/room').openRoom;
  randomCode?: () => number;
  /** The direct-link fallback, loaded on demand. */
  direct?: () => Promise<typeof import('../net/direct')>;
}

type Battle = Extract<AppState, { s: 'battle' }>;
const UNVERIFIED = 'Opponent left before revealing their fleet — result not verified.';
const NO_REVEAL = "Opponent didn't reveal their fleet — result not verified.";
const doc = typeof document !== 'undefined' ? document : null;

export class Controller {
  state: AppState = { s: 'home' };
  config: Config = { ...DEFAULT_CONFIG };
  role: 'host' | 'guest' = 'host';
  fleet: Fleet;
  /** Salvo selection on the target board. */
  sel: number[] = [];
  /** Prefire: shots queued during their turn, in order, fired as my turn starts (see prefire). */
  queue: number[] = [];
  /** Most recent result, for the status strip. */
  lastResult = '';
  /** Cells to animate on next render. */
  fx: { target: number[]; own: number[] } = { target: [], own: [] };
  deadline = 0;
  rng: Rng = cryptoRng;
  onSfx: (s: Sfx) => void = () => {};
  onAnnounce: (text: string) => void = () => {};

  /** Room, direct connection and tab listener cleanups (used by net/direct too). */
  closers: (() => void)[] = [];
  /** Direct host: apply a pasted reply. */
  accept: ((a: string) => void) | null = null;
  private ls = new Set<() => void>();
  private t: Transport | null = null;
  private timers: Record<string, number> = {};
  private gameNo = 0;
  private hostStartedLast = false;
  private salt: Uint8Array = new Uint8Array(16);
  private nonce: Uint8Array = new Uint8Array(16);
  private theirBoard: Uint8Array | null = null;
  private theirCoin: Uint8Array | null = null;
  private theirNonce: Uint8Array | null = null;
  private sentCoin = false;
  private revealed = false;
  private gotHello = false;
  private gotFrame = false;
  lastCode = 0;
  private readying = false;
  private timedOut = false;
  /** The link to the opponent dropped and may come back. */
  lost = false;
  /** When the page was last hidden, when it last came back, and when a frame last arrived (ms). */
  private hiddenAt = 0;
  private shownAt = 0;
  private heard = 0;

  constructor(private net: NetDeps = {}) {
    this.fleet = randomFleet(this.geo, this.rng);
  }

  /** Board size, fleet and islands of the current config (placement uses this; a match has its own m.geo). */
  get geo(): Geo {
    return geoOf(this.config);
  }

  subscribe(f: () => void): void {
    this.ls.add(f);
  }
  emit(): void {
    this.ls.forEach((f) => f());
  }
  set(s: AppState): void {
    this.state = s;
    this.emit();
  }
  /** Patch the current state if it is still of kind `s`. */
  patch(s: AppState['s'], p: object): void {
    if (this.state.s === s) this.set({ ...this.state, ...p } as AppState);
  }
  /** Start (or with no `f`, cancel) a named timer. */
  private timer(name: string, ms = 0, f?: () => void): void {
    clearTimeout(this.timers[name]);
    if (f) this.timers[name] = setTimeout(f, ms) as unknown as number;
  }
  private send(m: Msg): void {
    this.t?.send(encode(m));
  }
  get match(): Match | null {
    const s = this.state;
    return s.s === 'battle' || s.s === 'end' ? s.match : null;
  }

  // ---------- connection ----------

  /** Close every network resource and timer. */
  teardown(role = this.role): void {
    Object.values(this.timers).forEach(clearTimeout);
    this.timers = {};
    this.t?.close();
    this.t = null;
    this.closers.forEach((f) => f());
    this.closers = [];
    this.accept = null;
    this.deadline = 0;
    this.role = role;
    this.lost = false;
  }

  private room(role: 'host' | 'guest', code: number): void {
    const ev: RoomEvents = {
      transport: (t) => this.attach(t, role),
      full: () => this.notice('room-full'),
      failed: () => this.notice('failed'),
      relaysDown: (relaysDown) => this.patch('lobby-host', { relaysDown }),
      slow: () => this.patch('lobby-guest', { slow: true }),
      code: (c) => this.patch('lobby-host', { code: (this.lastCode = c) }),
    };
    this.closers.push(this.net.openRoom!(role, code, ev).leave);
  }

  /** Drop the current connection and start over as `role`. */
  private go(role: 'host' | 'guest', s: AppState, code = 0): void {
    this.teardown(role);
    this.lastCode = code;
    this.set(s);
  }

  createGame(): void {
    if (!this.net.openRoom) return;
    const code = this.net.randomCode!();
    this.go('host', { s: 'lobby-host', code, relaysDown: false }, code);
    this.room('host', code);
  }

  joinCode(code: number): void {
    if (!this.net.openRoom) return;
    this.go('guest', { s: 'lobby-guest', code, slow: false }, code);
    this.room('guest', code);
  }

  /** Attach when the link opens; fail if it never does. */
  link(p: Promise<Transport>): void {
    const s = this.state.s;
    p.then(
      (t) => this.attach(t, this.role),
      () => this.state.s === s && this.notice('failed'),
    );
  }

  /** Direct-link fallback: the flows live in the lazy net/direct chunk. */
  async startDirectHost(): Promise<void> {
    this.go('host', { s: 'direct-host' });
    (await this.net.direct?.())?.host(this);
  }

  pasteAnswer(text: string): void {
    this.accept?.(text);
  }

  async openOffer(blob: string): Promise<void> {
    this.go('guest', { s: 'direct-guest' });
    (await this.net.direct?.())?.guest(this, blob);
  }

  async openAnswer(blob: string): Promise<void> {
    (await this.net.direct?.())?.forward(this, blob);
  }

  private hello(): void {
    this.send({ t: 'hello', ver: PROTO_VERSION, role: this.role === 'host' ? 0 : 1 });
  }

  /** Channel to the opponent is open. */
  attach(t: Transport, role: 'host' | 'guest'): void {
    this.t = t;
    this.role = role;
    this.gameNo = 0;
    this.gotHello = this.gotFrame = false;
    t.onmessage = (u8) => this.onFrame(u8);
    t.onclose = () => this.peerGone();
    t.onstate = (up) => {
      this.lost = !up;
      this.emit();
    };
    // Each side creates channel 512 on its own schedule, and a message sent
    // before the other side has created it is dropped. Repeat HELLO until
    // anything arrives; give up if the game never starts.
    const hello = () => {
      if (this.gotFrame || this.t !== t) return;
      this.hello();
      this.timer('hello', 250, hello);
    };
    hello();
    this.timer('watchdog', 6000, () => this.gameNo || this.notice('failed'));
  }

  notice(kind: NoticeKind, detail?: string): void {
    this.teardown();
    this.set({ s: 'notice', kind, code: this.lastCode || undefined, detail });
  }

  leave(): void {
    this.send({ t: 'bye' });
    this.teardown();
    this.lastCode = 0;
    this.set({ s: 'home' });
  }

  /** Back home; a guest gets their code pre-filled. */
  retry(): void {
    const code = this.role === 'guest' && this.lastCode;
    this.teardown();
    this.set({ s: 'home', code: code ? String(code) : undefined });
  }

  /** Stop waiting for a stalled opponent: forfeit win, unverified. */
  leaveStalled(): void {
    if (this.state.s !== 'battle') return this.leave();
    this.send({ t: 'bye' });
    this.teardown();
    this.set({ s: 'notice', kind: 'left', detail: 'stalled' });
  }

  /**
   * The page was hidden or shown (main.ts). A phone that locks or switches apps
   * suspends the page and the link can die meanwhile: after 10 s away mid-game,
   * check it with a ping.
   */
  visibility(hidden: boolean): void {
    const now = Date.now();
    if (hidden) return void (this.hiddenAt = now);
    if (this.hiddenAt <= this.shownAt) return;
    this.shownAt = now;
    const s = this.state.s;
    if (now - this.hiddenAt < 10000 || (s !== 'placement' && s !== 'battle')) return;
    this.send({ t: 'ping' });
    // No answer: the link died while we were away. Tell the opponent in case it is only slow.
    // ICE can take a few seconds to recover on cellular.
    this.timer('ping', 6000, () => this.heard < now && (this.send({ t: 'bye' }), this.notice('away')));
  }

  /** `bye`: they left on purpose. */
  private peerGone(bye = false): void {
    this.t = null;
    const s = this.state;
    // The link died while this page was in the background or had just come back from it:
    // most likely we were the ones who dropped out, so don't claim a forfeit win.
    const away = !bye && (this.hiddenAt > this.shownAt || Date.now() - this.shownAt < 30000);
    if (s.s !== 'end') return this.notice(away ? 'away' : 'left', s.s === 'battle' ? 'battle' : undefined);
    this.teardown();
    this.set({ ...s, peerLeft: true, ...(s.verdict === 'pending' && { verdict: 'unverified', reason: UNVERIFIED }) });
  }

  // ---------- settings / placement ----------

  setConfig(c: Partial<Config>): void {
    this.config = normConfig({ ...this.config, ...c });
    this.emit();
  }

  /** Host: new islands for every game. */
  private hostConfig(): Config {
    return (this.config = { ...this.config, seed: this.rng(65536) });
  }

  setFleet(f: Fleet): void {
    // Not while ready() is hashing: the committed fleet must be the one played.
    if (this.state.s !== 'placement' || this.state.ready.me || this.readying) return;
    this.fleet = f;
    this.emit();
  }

  randomize(): void {
    this.setFleet(randomFleet(this.geo, this.rng));
  }

  private toPlacement(): void {
    this.timer('reveal');
    this.fleet = randomFleet(this.geo, this.rng);
    this.queue = [];
    this.theirBoard = this.theirCoin = this.theirNonce = null;
    this.sentCoin = this.revealed = false;
    this.sel = [];
    this.lastResult = '';
    this.gameNo++;
    this.set({ s: 'placement', ready: { me: false, them: false } });
  }

  async ready(): Promise<void> {
    const s = this.state;
    if (s.s !== 'placement' || s.ready.me || this.readying || !fleetLegal(this.geo, this.fleet)) return;
    this.readying = true;
    const salt = randomBytes(16);
    const nonce = randomBytes(16);
    const board = await commitBoard(salt, this.fleet, this.config);
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
    const host = this.role === 'host';
    // Game 1: commit-reveal coin toss. Rematches: the other player starts.
    let hostFirst = !this.hostStartedLast;
    if (this.gameNo === 1) {
      if (!this.sentCoin) this.send({ t: 'coin', nonce: this.nonce });
      this.sentCoin = true;
      // A peer that sends READY but never reveals its coin would stall us here.
      if (!this.theirNonce) return this.timer('coin', 10000, () => this.state.s === 'placement' && this.notice('invalid-move'));
      this.timer('coin');
      hostFirst = host ? hostStarts(this.nonce, this.theirNonce) : hostStarts(this.theirNonce, this.nonce);
    }
    this.hostStartedLast = hostFirst;
    const iStart = hostFirst === host;
    const banner = iStart ? 'You go first' : 'They go first';
    this.fx = { target: [], own: [] };
    this.set({ s: 'battle', match: createMatch(this.config, this.fleet, iStart), banner });
    this.onAnnounce(this.gameNo === 1 ? `Coin toss: ${banner.toLowerCase()}.` : `${banner}.`);
    this.timer('banner', 1200, () => this.patch('battle', { banner: undefined }));
    this.turnStarted();
  }

  // ---------- battle ----------

  /** Salvo: toggle a cell in the selection. */
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

  /** How many shots prefire may queue: Salvo, the shots I'll have; with extra shot, 3 (later ones fire only after hits); else 1. */
  prefireMax(m: Match): number {
    return m.config.mode === 1 ? shotsAllowed(m, 'me') : m.config.extraShot ? 3 : 1;
  }

  /**
   * Prefire, during their turn: toggle a queued shot (normal shots only). When
   * the queue is full a new pick is ignored, except that a 1-shot queue swaps.
   * Purely local: nothing is sent until my turn starts.
   */
  prefire(cell: number): void {
    const m = this.match;
    if (!m || m.phase !== 'theirTurn' || !(cell >= 0 && cell < m.geo.n ** 2) || m.target.shot.has(cell)) return;
    const q = this.queue;
    const i = q.indexOf(cell);
    const max = this.prefireMax(m);
    if (i >= 0) q.splice(i, 1);
    else if (q.length < max) q.push(cell);
    else if (max === 1) this.queue = [cell];
    this.emit();
  }

  /** My turn started with a queue: after 300 ms (the UI says "Firing E4"), fire it. */
  private firePrefire(m: Match): void {
    const salvo = m.config.mode === 1;
    const n = shotsAllowed(m, 'me');
    // Drop cells fired at meanwhile and shots I no longer have.
    this.queue = this.queue.filter((c) => !m.target.shot.has(c)).slice(0, salvo ? n : 3);
    if (salvo && this.queue.length < n) {
      // Not enough for the salvo: they become the selection.
      this.sel = this.queue;
      this.queue = [];
      return;
    }
    if (!this.queue.length) return;
    this.timer('prefire', 300, () => {
      if (this.match !== m || m.phase !== 'myTurn') return;
      const cells = salvo ? this.queue.splice(0) : this.queue.splice(0, 1);
      this.attack({ k: 'fire', cells }, true);
    });
  }
  clearPrefire(): void {
    this.queue = [];
    this.emit();
  }

  /** Take my turn. A move of my own (not `queued`) cancels the rest of the prefire queue. */
  attack(a: Attack, queued = false): boolean {
    const s = this.state;
    if (s.s !== 'battle' || s.match.phase !== 'myTurn') return false;
    try {
      localAttack(s.match, a);
    } catch {
      return false;
    }
    if (!queued) this.queue = [];
    this.timer('prefire');
    this.sel = [];
    this.timer('turn');
    this.deadline = 0;
    this.send(a.k === 'fire' ? { t: 'fire', cells: a.cells } : { t: 'use', item: a.item, a: a.a, b: a.b });
    this.timer('stall', 30000, () => this.stalled('awaitingAnswer'));
    this.emit();
    return true;
  }

  fireSalvo(): boolean {
    const m = this.match;
    return !!m && this.sel.length === shotsAllowed(m, 'me') && this.attack({ k: 'fire', cells: this.sel.slice() });
  }

  private stalled(phase: Match['phase']): void {
    if (this.match?.phase === phase) this.patch('battle', { stalled: true });
  }

  private turnStarted(): void {
    const m = this.match;
    if (!m) return;
    const secs = this.config.timer * 1000;
    const mine = m.phase === 'myTurn';
    this.timer('turn');
    this.timer('stall');
    if (doc) doc.title = mine ? 'Your turn · Battleship' : 'Battleship';
    if (mine) this.onSfx('turn');
    if (mine) this.firePrefire(m);
    if (!secs) return;
    this.deadline = Date.now() + secs;
    if (mine) this.timer('turn', secs, () => this.autoAct());
    else this.timer('stall', secs + 15000, () => this.stalled('theirTurn'));
  }

  /** Turn timer ran out: fire randomly (Salvo fills the remaining selection). */
  autoAct(): void {
    const m = this.match;
    if (!m || m.phase !== 'myTurn') return;
    const cells = m.config.mode === 1 ? this.sel.slice() : [];
    const free = untargeted(m).filter((c) => !cells.includes(c));
    while (cells.length < shotsAllowed(m, 'me') && free.length) cells.push(free.splice(this.rng(free.length), 1)[0]!);
    this.timedOut = this.attack({ k: 'fire', cells });
  }

  private describe(a: Answer, mine: boolean): string {
    const who = mine ? 'You' : 'They';
    const g = this.match!.geo;
    const cellName = (c: number) => name(c, g.n);
    if (a.k === 'sonar') return mine ? `Sonar: ${a.count} ship cell${a.count === 1 ? '' : 's'}` : 'They used sonar';
    const e = a.entries;
    const sunk = e.filter((x) => x.code > 1).map((x) => g.names[x.code - 2]);
    if (sunk.length) return `${who} sank ${mine ? 'their' : 'your'} ${sunk.join(' and ')}`;
    if (!e.length) return `${mine ? 'Your' : 'Their'} torpedo ran clean`;
    const hits = e.filter((x) => x.code).map((x) => cellName(x.cell));
    if (e.length === 1) return `${who} fired at ${cellName(e[0]!.cell)}: ${hits.length ? 'hit' : 'miss'}`;
    return hits.length ? `${who} hit ${hits.join(', ')}` : `${who} missed all ${e.length}`;
  }

  private onFrame(u8: Uint8Array): void {
    const m = decode(u8);
    const s = this.state;
    if (!m) return s.s === 'battle' ? this.cheat('they sent an invalid message') : undefined;
    this.gotFrame = true;
    this.heard = Date.now();
    switch (m.t) {
      case 'ping':
        return this.send({ t: 'pong' });
      case 'hello':
        if (m.ver !== PROTO_VERSION) return this.notice('version');
        // The guest answers every HELLO, so the host hears one even if the guest's own were dropped.
        if (this.role === 'guest') return this.hello();
        if (this.gotHello) return;
        this.gotHello = true;
        this.send({ t: 'config', config: this.hostConfig() });
        return this.toPlacement();
      case 'config':
        if (this.role === 'guest' && !this.gameNo) {
          this.config = m.config;
          this.toPlacement();
        }
        return;
      case 'ready':
        if (s.s !== 'placement' || s.ready.them) return;
        this.theirBoard = m.board;
        this.theirCoin = m.coin;
        s.ready.them = true;
        this.emit();
        return this.maybeStart();
      case 'coin':
        if (s.s !== 'placement' || !this.theirCoin || this.theirNonce) return;
        void commitCoin(m.nonce).then((c) => {
          if (!this.theirCoin || !bytesEqual(c, this.theirCoin)) return this.notice('invalid-move');
          this.theirNonce = m.nonce;
          this.maybeStart();
        });
        return;
      case 'fire':
        return this.onAttack({ k: 'fire', cells: m.cells });
      case 'use':
        return this.onAttack({ k: 'item', item: m.item, a: m.a, b: m.b });
      case 'answer':
        return this.onAnswer({ k: 'cells', entries: m.entries });
      case 'sonar':
        return this.onAnswer({ k: 'sonar', count: m.count });
      case 'reveal':
        return void this.onReveal(m.salt, m.fleet);
      case 'verdict':
        return this.patch('end', { theirVerdict: m.ok });
      case 'rematch':
        if (s.s !== 'end') return;
        if (m.config && this.role === 'guest') this.config = m.config;
        s.rematch.them = true;
        return s.rematch.me ? this.toPlacement() : this.emit();
      case 'bye':
        this.t?.close();
        return this.peerGone(true);
    }
  }

  private result(s: Battle, text: string, a: Answer): void {
    const p = s.match.phase;
    this.lastResult = text;
    this.onSfx(a.k === 'sonar' ? 'miss' : a.entries.some((e) => e.code > 1) ? 'sunk' : a.entries.some((e) => e.code) ? 'hit' : 'miss');
    if (p === 'over') return this.gameOver(text);
    this.set({ ...s, stalled: false, banner: undefined });
    this.onAnnounce(text + (p === 'myTurn' ? '. Your turn.' : '.'));
    this.turnStarted();
  }

  private onAttack(a: Attack): void {
    const s = this.state;
    if (s.s !== 'battle') return;
    const r = remoteAttack(s.match, a);
    if ('cheat' in r) return this.cheat(r.cheat);
    const w = r.answer;
    this.send(w.k === 'sonar' ? { t: 'sonar', count: w.count } : { t: 'answer', entries: w.entries });
    this.fx = { target: [], own: s.match.own.last.slice() };
    this.result(s, this.describe(w, false), w);
  }

  private onAnswer(a: Answer): void {
    const s = this.state;
    if (s.s !== 'battle') return;
    if (s.match.phase !== 'awaitingAnswer') return this.cheat('they answered out of turn');
    const r = applyAnswer(s.match, a);
    if ('cheat' in r) return this.cheat(r.cheat);
    // Prefire: what is left when my turn passes was waiting for hits that didn't come.
    if ((s.match.phase as Match['phase']) !== 'myTurn') this.queue = [];
    this.fx = { target: s.match.target.last.slice(), own: [] };
    const text = (this.timedOut ? "Time's up. " : '') + this.describe(a, true);
    this.timedOut = false;
    this.result(s, text, a);
  }

  // ---------- end of game ----------

  private toEnd(match: Match, verdict: 'pending' | 'cheat', reason?: string): void {
    for (const n of ['turn', 'stall', 'banner', 'prefire']) this.timer(n);
    this.deadline = 0;
    this.queue = [];
    match.phase = 'over';
    if (doc) doc.title = 'Battleship';
    this.set({ s: 'end', match, verdict, reason, theirVerdict: null, rematch: { me: false, them: false }, peerLeft: false });
    if (!this.revealed) this.send({ t: 'reveal', salt: this.salt, fleet: this.fleet });
    this.revealed = true;
    this.timer('reveal', 10000, () => {
      const e = this.state;
      if (e.s === 'end' && e.verdict === 'pending') this.set({ ...e, verdict: 'unverified', reason: NO_REVEAL });
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
    const full = `Cheating detected: ${reason}.`;
    s.match.winner ??= 'me';
    this.toEnd(s.match, 'cheat', full);
    this.onAnnounce(full);
  }

  private async onReveal(salt: Uint8Array, fleet: Fleet): Promise<void> {
    let s = this.state;
    if (s.s === 'battle') {
      // They ended the game early (they flagged us, or they quit by revealing): counts as their forfeit.
      s.match.winner ??= 'me';
      this.toEnd(s.match, 'pending');
      s = this.state;
    }
    if (s.s !== 'end' || !this.theirBoard) return;
    this.timer('reveal');
    // The rules this game was played under, not the ones the host may be editing now.
    const v = await verifyOpponent(s.match.config, this.theirBoard, salt, fleet, s.match.transcript);
    this.send({ t: 'verdict', ok: v.ok });
    const e = this.state;
    if (e.s !== 'end') return;
    this.set({ ...e, theirFleet: fleet, ...(v.ok ? e.verdict !== 'cheat' && { verdict: 'verified' } : { verdict: 'cheat', reason: v.reason }) });
    this.onAnnounce(v.ok ? 'Fleet verified.' : v.reason);
  }

  rematch(): void {
    const s = this.state;
    if (s.s !== 'end' || s.rematch.me || s.peerLeft) return;
    s.rematch.me = true;
    s.editing = false;
    this.send(this.role === 'host' ? { t: 'rematch', config: this.hostConfig() } : { t: 'rematch' });
    if (s.rematch.them) this.toPlacement();
    else this.emit();
  }

  toggleEditing(): void {
    const s = this.state;
    if (s.s === 'end' && this.role === 'host') this.set({ ...s, editing: !s.editing });
  }
}
