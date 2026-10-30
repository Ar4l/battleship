import { describe, expect, it, vi } from 'vitest';
import { Controller } from '../../src/app/controller';
import { lie } from '../../src/app/debug';
import { decode, encode, type Msg } from '../../src/proto/codec';
import { memoryPair } from '../../src/net/transport';
import { shipCells } from '../../src/game/rules';
import { shotsAllowed, untargeted } from '../../src/game/engine';
import type { Config, Fleet } from '../../src/game/types';
import { FLEET_A, FLEET_B, G as G10, cfgOf } from './helpers';

// No storage, as in a private window: each controller keeps its stats in memory (and Node 26 stays quiet).
vi.stubGlobal('localStorage', undefined);

const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 2));
  }
};
const shipCellsOf = (f: Fleet, g = G10) => f.flatMap((s, i) => shipCells(g, s, i)!);

/** Send a raw message from `c` to its opponent. */
const raw = (c: Controller, m: Msg) => (c as unknown as { t: { send(u: Uint8Array): void } }).t.send(encode(m));

async function connect(config: Partial<Config>) {
  const H = new Controller();
  const G = new Controller();
  H.setConfig(config);
  const [a, b] = memoryPair();
  H.attach(a, 'host');
  G.attach(b, 'guest');
  await until(() => H.state.s === 'placement' && G.state.s === 'placement');
  return { H, G };
}

async function placeAndStart(H: Controller, G: Controller, fixed = true) {
  if (fixed) {
    H.setFleet(FLEET_A);
    G.setFleet(FLEET_B);
  }
  await H.ready();
  await G.ready();
  await until(() => H.state.s === 'battle' && G.state.s === 'battle');
}

/** The player on turn sinks the other, the other always misses. */
async function playOut(H: Controller, G: Controller, settle = true) {
  const fleets = new Map([[H, H.fleet], [G, G.fleet]]);
  for (let guard = 0; guard < 400; guard++) {
    if (H.state.s === 'end' && G.state.s === 'end') break;
    const me = H.match?.phase === 'myTurn' ? H : G.match?.phase === 'myTurn' ? G : null;
    if (!me) {
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }
    const m = me.match!;
    const winner = me === H;
    const theirs = shipCellsOf(fleets.get(me === H ? G : H)!, m.geo).filter((c) => !m.target.shot.has(c));
    const free = untargeted(m).filter((c) => !theirs.includes(c));
    const n = shotsAllowed(m, 'me');
    const pool = winner ? [...theirs, ...free] : [...free, ...theirs];
    expect(me.attack({ k: 'fire', cells: pool.slice(0, n) })).toBe(true);
    await until(() => me.match?.phase !== 'awaitingAnswer');
  }
  await until(() => H.state.s === 'end' && G.state.s === 'end');
  if (!settle) return;
  await until(() => H.state.s === 'end' && H.state.verdict !== 'pending' && G.state.s === 'end' && G.state.verdict !== 'pending');
}

describe('controller over an in-memory transport', () => {
  it.each([
    ['Classic', {} as const],
    ['Classic with extra shot', { extraShot: true } as const],
    ['Salvo', { turns: 1 } as const],
  ])('plays a full %s game to a verified verdict, then rematches with the other starter', async (_, cfg) => {
    const { H, G } = await connect(cfg);
    expect(G.config).toEqual(H.config);
    await placeAndStart(H, G);
    const hostStarted = H.match!.iStarted;
    expect(G.match!.iStarted).toBe(!hostStarted);
    await playOut(H, G);
    const hs = H.state, gs = G.state;
    if (hs.s !== 'end' || gs.s !== 'end') throw 0;
    expect(hs.verdict).toBe('verified');
    expect(gs.verdict).toBe('verified');
    expect(hs.match.winner).toBe('me');
    expect(gs.match.winner).toBe('them');
    await until(() => (H.state as { theirVerdict: unknown }).theirVerdict === true);
    H.rematch();
    G.rematch();
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
    await placeAndStart(H, G);
    expect(H.match!.iStarted).toBe(!hostStarted);
  });

  it.each([
    ['Russian', { russian: true } as const],
    ['Large Items with islands and extra shot', { items: true, size: 2, extraShot: true } as const],
    ['Huge Salvo', { turns: 1, size: 3 } as const],
    ['Small Classic', { size: 0 } as const],
  ])('plays a %s game to a verified verdict; both sides agree on the board', async (_, cfg) => {
    const { H, G } = await connect(cfg);
    expect(G.config).toEqual(H.config);
    await placeAndStart(H, G, false);
    const g = H.match!.geo;
    expect(G.match!.geo).toBe(g);
    if ((cfg as Partial<Config>).size === 2) expect(g.islands.size).toBeGreaterThan(0);
    await playOut(H, G);
    expect([(H.state as { verdict: string }).verdict, (G.state as { verdict: string }).verdict]).toEqual(['verified', 'verified']);
    // The host rolls new islands for the rematch and the guest follows.
    const seed = H.config.seed;
    H.rematch();
    G.rematch();
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
    expect(G.config.seed).toBe(H.config.seed);
    expect(H.config.seed === seed && H.config.seed === 0).toBe(false);
  });

  it('prefire: a shot queued during their turn fires 300 ms into my turn', async () => {
    const { H, G } = await connect({ items: true });
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    them.prefire(50); // not their phase: ignored
    expect(them.queue).toEqual([]);
    for (const c of [55, 44, 33, 22, 11, 0]) me.prefire(c);
    expect(me.queue).toEqual([55, 44, 33, 22, 11]); // up to 5
    me.prefire(44); // tap again: removed
    expect(me.queue).toEqual([55, 33, 22, 11]);
    me.clearPrefire();
    me.prefire(66);
    them.attack({ k: 'fire', cells: [98] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.queue).toEqual([66]); // "Firing F7" for 300 ms
    await until(() => me.match!.phase === 'theirTurn' && them.match!.phase === 'myTurn');
    expect(me.match!.target.shot.has(66)).toBe(true);
    expect(me.queue).toEqual([]);
  });

  it('prefire without extra shot: one queued shot per turn, the rest carry over', async () => {
    const { H, G } = await connect({});
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    const ships = shipCellsOf(me === H ? FLEET_B : FLEET_A);
    const water = untargeted(me.match!).filter((c) => !ships.includes(c));
    const mine = shipCellsOf(me === H ? FLEET_A : FLEET_B);
    const sea = untargeted(them.match!).filter((c) => !mine.includes(c));
    for (const c of water.slice(0, 3)) me.prefire(c);
    for (let t = 0; t < 3; t++) {
      them.attack({ k: 'fire', cells: [sea[t]!] });
      await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn', 5000);
      expect(me.match!.target.shot.has(water[t]!)).toBe(true);
      expect(me.queue).toEqual(water.slice(t + 1, 3));
    }
  });

  it('prefire with extra shot: hits fire the next one, a miss leaves the rest for next turn, my own shot only removes its cell', async () => {
    const { H, G } = await connect({ extraShot: true });
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    const ships = shipCellsOf(me === H ? FLEET_B : FLEET_A);
    const water = untargeted(me.match!).filter((c) => !ships.includes(c));
    // Their shots land on my water, so their turn always passes.
    const mine = shipCellsOf(me === H ? FLEET_A : FLEET_B);
    const sea = untargeted(them.match!).filter((c) => !mine.includes(c));
    for (const c of [ships[0]!, ships[1]!, water[0]!, water[1]!]) me.prefire(c);
    expect(me.queue).toEqual([ships[0], ships[1], water[0], water[1]]);
    them.attack({ k: 'fire', cells: [sea[0]!] });
    // hit, hit, miss: three fire, then the turn passes with one left over.
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn', 5000);
    expect([ships[0]!, ships[1]!, water[0]!].every((c) => me.match!.target.shot.has(c))).toBe(true);
    expect(me.queue).toEqual([water[1]]);
    // The leftover fires next turn.
    them.attack({ k: 'fire', cells: [sea[1]!] });
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn', 5000);
    expect(me.match!.target.shot.has(water[1]!)).toBe(true);
    expect(me.queue).toEqual([]);
    // A manual shot inside the 300 ms takes its own cell out; the rest stays queued.
    me.prefire(ships[3]!);
    me.prefire(water[2]!);
    them.attack({ k: 'fire', cells: [sea[2]!] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.attack({ k: 'fire', cells: [ships[3]!] })).toBe(true);
    expect(me.queue).toEqual([water[2]]);
  });

  it('prefire in Salvo: up to my shots; too few become the selection; fired cells are dropped', async () => {
    const { H, G } = await connect({ turns: 1 });
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    for (const c of [90, 91, 92, 93, 94, 95]) me.prefire(c);
    expect(me.queue).toEqual([90, 91, 92, 93, 94]);
    them.attack({ k: 'fire', cells: [97, 96, 95, 94, 93] });
    await until(() => me.match!.phase === 'theirTurn' && them.match!.phase === 'myTurn');
    expect([90, 91, 92, 93, 94].every((c) => me.match!.target.shot.has(c))).toBe(true);
    // Next their turn: queue 2, one of them already fired at (dropped), the other is preselected.
    me.prefire(90);
    me.prefire(80);
    expect(me.queue).toEqual([80]);
    them.attack({ k: 'fire', cells: [87, 86, 85, 84, 83] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.sel).toEqual([80]);
    expect(me.queue).toEqual([]);
  });

  it('prefire an item: it fires first as my turn starts, queued shots follow; skipped when I cannot pay', async () => {
    const { H, G } = await connect({ items: true });
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    const mine = shipCellsOf(me === H ? FLEET_A : FLEET_B);
    const sea = untargeted(them.match!).filter((c) => !mine.includes(c));
    const cross = { k: 'item', item: 2, a: 55, b: 0 } as const;
    them.prefireItem(cross); // not their phase: ignored
    expect(them.qItem).toBeNull();
    me.match!.energy.me = them.match!.energy.them = 3; // 4 when my turn starts
    me.prefireItem(cross);
    me.prefire(0);
    them.attack({ k: 'fire', cells: [sea[0]!] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.qItem).toEqual(cross); // "Firing Cross" for 300 ms
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn');
    expect(me.match!.stats.me.items).toBe(1);
    expect(me.match!.target.shot.has(55)).toBe(true);
    expect(me.queue).toEqual([0]);
    // Energy 0 now, 1 at my next turn: the cross is skipped, the queued shot fires.
    me.prefireItem(cross);
    them.attack({ k: 'fire', cells: [sea[1]!] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.lastResult).toBe('Skipped Cross bomb');
    expect(me.qItem).toBeNull();
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn');
    expect(me.match!.target.shot.has(0)).toBe(true);
    expect(me.match!.stats.me.items).toBe(1);
  });

  it('plays an Items game using every item', async () => {
    const { H, G } = await connect({ items: true });
    await placeAndStart(H, G);
    // Force the host to have the first turn by passing if needed.
    if (G.match!.phase === 'myTurn') {
      G.attack({ k: 'fire', cells: [99] });
      await until(() => H.match!.phase === 'myTurn');
    }
    const items = [
      { k: 'item', item: 0, a: 11, b: 0 },
      { k: 'item', item: 1, a: 9, b: 3 },
      { k: 'item', item: 2, a: 27, b: 0 },
      { k: 'item', item: 3, a: 5, b: 1 },
    ] as const;
    let gFree = 98;
    for (const it of items) {
      H.match!.energy.me = 6;
      G.match!.energy.them = 6;
      expect(H.attack({ ...it })).toBe(true);
      await until(() => G.match!.phase === 'myTurn');
      G.attack({ k: 'fire', cells: [gFree--] });
      await until(() => H.match!.phase === 'myTurn');
    }
    expect(H.match!.target.sonar).toEqual([{ a: 11, count: 2 }]);
    expect(H.match!.stats.me.items).toBe(4);
    await playOut(H, G);
    expect((H.state as { verdict: string }).verdict).toBe('verified');
  });

  it('detects a lying defender and names the cell', async () => {
    const { H, G } = await connect({});
    await placeAndStart(H, G);
    lie(G, 9); // J1, part of FLEET_B's carrier
    await playOut(H, G);
    await until(() => H.state.s === 'end' && !!H.state.theirFleet);
    const hs = H.state;
    if (hs.s !== 'end') throw 0;
    expect(hs.verdict).toBe('cheat');
    expect(hs.reason).toBe('Cheating detected: they reported a miss at J1 but a ship was there');
  });

  it('turn timer: auto-acts with a random shot (Salvo fills the selection)', async () => {
    for (const mode of [0, 1] as const) {
      const { H, G } = await connect({ turns: mode, timer: 15 });
      await placeAndStart(H, G);
      const me = H.match!.phase === 'myTurn' ? H : G;
      expect(me.deadline).toBeGreaterThan(Date.now());
      if (mode === 1) me.toggleSel(0);
      me.autoAct();
      const m = me.match!;
      expect(m.phase).toBe('awaitingAnswer');
      await until(() => m.phase !== 'awaitingAnswer');
      expect(me.lastResult).toMatch(/^Time's up\. You /);
      expect(m.target.shot.size).toBe(mode === 1 ? 5 : 1);
      if (mode === 1) expect(m.target.shot.has(0)).toBe(true);
      H.leave();
    }
  });

  it('BYE takes the opponent to "left"', async () => {
    const { H, G } = await connect({});
    await placeAndStart(H, G);
    G.leave();
    await until(() => H.state.s === 'notice');
    expect(H.state).toMatchObject({ s: 'notice', kind: 'left', detail: 'battle' });
    expect(G.state.s).toBe('home');
  });

  it('simultaneous salvo: rounds settle on both sides; both fleets sunk in one round is a verified draw', async () => {
    const { H, G } = await connect({ turns: 2 });
    await placeAndStart(H, G);
    const both = (f: (c: Controller) => boolean) => f(H) && f(G);
    expect(both((c) => c.match!.phase === 'myTurn')).toBe(true);
    const ships = new Map([[H, shipCellsOf(FLEET_B)], [G, shipCellsOf(FLEET_A)]]);
    for (let round = 0; !both((c) => c.state.s === 'end'); round++) {
      for (const c of [H, G]) {
        const m = c.match!;
        expect(c.attack({ k: 'fire', cells: ships.get(c)!.filter((x) => !m.target.shot.has(x)).slice(0, shotsAllowed(m, 'me')) })).toBe(true);
      }
      await until(() => both((c) => c.state.s === 'end' || c.match!.phase === 'myTurn'));
      if (!round) expect(H.lastResult).toMatch(/^You (hit|sank) .* · They (hit|sank) /);
    }
    await until(() => both((c) => (c.state as { verdict: string }).verdict !== 'pending'));
    expect([H.match!.winner, G.match!.winner]).toEqual(['draw', 'draw']);
    expect([(H.state as { verdict: string }).verdict, (G.state as { verdict: string }).verdict]).toEqual(['verified', 'verified']);
  });

  it('simultaneous salvo: the turn timer sends the current pick; their salvo is held until mine is in', async () => {
    const { H, G } = await connect({ turns: 2, timer: 15 });
    await placeAndStart(H, G);
    H.toggleSel(0);
    H.autoAct();
    expect(H.match!.phase).toBe('awaitingAnswer');
    await until(() => !!G.match!.round.them);
    expect([G.match!.phase, G.match!.own.shot.size]).toEqual(['myTurn', 0]);
    G.autoAct();
    await until(() => H.match!.phase === 'myTurn' && G.match!.phase === 'myTurn');
    expect([H.match!.target.shot.size, H.match!.target.shot.has(0), G.match!.own.shot.size]).toEqual([5, true, 5]);
    expect(H.lastResult).toMatch(/^Time's up\. You .* · They /);
  });

  it('pickups: shooting an item square with the hold full says it was lost', async () => {
    const { H, G } = await connect({ items: true, pickups: true });
    await placeAndStart(H, G);
    const me = H.match!.phase === 'myTurn' ? H : G;
    const m = me.match!;
    const ships = (me === H ? FLEET_B : FLEET_A).flatMap((s, i) => shipCells(G10, s, i)!);
    const c = untargeted(m).find((x) => !ships.includes(x) && !m.target.pick.has(x))!;
    m.inv.me.push(0, 0, 0);
    m.target.pick.set(c, 1);
    expect(me.attack({ k: 'fire', cells: [c] })).toBe(true);
    await until(() => m.phase !== 'awaitingAnswer');
    expect(me.lastResult).toMatch(/ · Hold full, Torpedo lost$/);
    expect(m.inv.me).toEqual([0, 0, 0]);
  });

  it('salvo results name the shooter', async () => {
    const { H, G } = await connect({ turns: 1 });
    await placeAndStart(H, G);
    const me = H.match!.phase === 'myTurn' ? H : G;
    const them = me === H ? G : H;
    const ships = (me === H ? FLEET_B : FLEET_A).flatMap((s, i) => shipCells(G10, s, i)!);
    expect(me.attack({ k: 'fire', cells: [ships[0]!, ...untargeted(me.match!).filter((c) => !ships.includes(c)).slice(0, 4)] })).toBe(true);
    await until(() => me.match!.phase !== 'awaitingAnswer');
    expect(me.lastResult).toBe(`You hit ${'ABCDEFGHIJ'[ships[0]! % 10]}${Math.floor(ships[0]! / 10) + 1}`);
    expect(them.lastResult).toBe(me.lastResult.replace('You', 'They'));
  });

  it('a REVEAL mid-battle ends the game as their forfeit; a late CONFIG is ignored', async () => {
    const { H, G } = await connect({});
    await placeAndStart(H, G);
    raw(H, { t: 'reveal', salt: new Uint8Array(16), fleet: FLEET_A });
    await until(() => G.state.s === 'end');
    expect(G.match!.winner).toBe('me');
    raw(H, { t: 'config', config: cfgOf({ items: true, noTouch: true }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(G.state.s).toBe('end');
    expect(G.config.items).toBe(false);
  });

  it('keeps saying HELLO until the other side hears it', async () => {
    const [a, b] = memoryPair();
    const H = new Controller();
    const G = new Controller();
    // The guest's first HELLOs are lost, as if the host had not created the channel yet.
    let drop = 3;
    const send = b.send;
    b.send = (u) => (drop-- > 0 ? undefined : send(u));
    G.attach(b, 'guest');
    await new Promise((r) => setTimeout(r, 300));
    H.attach(a, 'host');
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
  });

  it('the fleet committed by ready() is the one played: no edits while hashing', async () => {
    const { H, G } = await connect({});
    H.setFleet(FLEET_A);
    const p = H.ready();
    H.setFleet(FLEET_B);
    await p;
    expect(H.fleet).toEqual(FLEET_A);
    await G.ready();
    await until(() => H.state.s === 'battle');
  });

  it("a REVEAL that misses the 10 s window reads as withheld, then still verifies when it arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { H, G } = await connect({});
      await placeAndStart(H, G);
      // Hold the host's REVEAL.
      const t = (H as unknown as { t: { send(u: Uint8Array): void } }).t;
      const send = t.send;
      let held: Uint8Array | null = null;
      t.send = (u) => (decode(u)?.t === 'reveal' ? void (held = u) : send(u));
      await playOut(H, G, false);
      expect(G.state).toMatchObject({ s: 'end', verdict: 'pending' });
      vi.advanceTimersByTime(10_000);
      expect(G.state).toMatchObject({ verdict: 'unverified', reason: "Opponent didn't reveal their fleet — result not verified." });
      send(held!);
      await until(() => (G.state as { verdict: string }).verdict === 'verified');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a peer that sends READY but never its COIN is stopped after 10 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { H, G } = await connect({});
      const t = (G as unknown as { t: { send(u: Uint8Array): void } }).t;
      const send = t.send;
      t.send = (u) => decode(u)?.t === 'coin' || send(u);
      H.setFleet(FLEET_A);
      G.setFleet(FLEET_B);
      await H.ready();
      await G.ready();
      await until(() => H.state.s === 'placement' && H.state.ready.them);
      vi.advanceTimersByTime(9_000);
      expect(H.state.s).toBe('placement');
      vi.advanceTimersByTime(1_000);
      expect(H.state).toMatchObject({ s: 'notice', kind: 'invalid-move' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('implied rules do not stick once the implying setting is off', () => {
    const c = new Controller();
    c.setConfig({ items: true, size: 2 });
    c.setConfig({ russian: true });
    expect(c.config).toMatchObject({ noTouch: true, extraShot: true, size: 1 });
    c.setConfig({ russian: false });
    expect(c.config).toMatchObject({ noTouch: false, extraShot: false, size: 2, items: true });
    c.setConfig({ turns: 1 });
    expect(c.config.items).toBe(false);
    c.setConfig({ turns: 0 });
    expect(c.config.items).toBe(true);
  });

  it('rematch: the host changes the rules after the guest already asked', async () => {
    const { H, G } = await connect({});
    await placeAndStart(H, G);
    await playOut(H, G);
    G.rematch();
    await until(() => H.state.s === 'end' && H.state.rematch.them);
    H.toggleEditing();
    H.setConfig({ turns: 1 });
    H.rematch();
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
    expect(G.config.turns).toBe(1);
    await placeAndStart(H, G);
    expect(H.match!.config.turns).toBe(1);
    expect(G.match!.config.turns).toBe(1);
  });

  describe('a phone that locks or switches apps', () => {
    type Raw = { t: { send(u: Uint8Array): void; end(r: string): void; onstate?: ((up: boolean) => void) | null } };
    const tr = (c: Controller) => (c as unknown as Raw).t;
    const away = async (c: Controller, ms: number) => {
      c.visibility(true);
      vi.advanceTimersByTime(ms);
      c.visibility(false);
      await new Promise((r) => setTimeout(r, 5));
    };

    it('back after 10 s: a live link answers the ping and the game goes on', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { H, G } = await connect({});
        await placeAndStart(H, G);
        const sent: string[] = [];
        const send = tr(G).send;
        tr(G).send = (u) => (sent.push(decode(u)!.t), send(u));
        await away(G, 12_000);
        expect(sent).toEqual(['ping']);
        vi.advanceTimersByTime(6_500);
        expect(G.state.s).toBe('battle');
        expect(H.state.s).toBe('battle');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a short switch sends no ping', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { H, G } = await connect({});
        const sent: string[] = [];
        const send = tr(G).send;
        tr(G).send = (u) => (sent.push(decode(u)!.t), send(u));
        await away(G, 4_000);
        expect(sent).toEqual([]);
        expect(H.state.s).toBe('placement');
      } finally {
        vi.useRealTimers();
      }
    });

    it('back after 10 s with a dead link: "lost while in the background", no forfeit claim; the opponent hears BYE', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { H, G } = await connect({});
        await placeAndStart(H, G);
        tr(H).send = () => {};
        await away(G, 15_000);
        // ICE may take a few seconds to recover (cellular): the ping gets 6 s.
        vi.advanceTimersByTime(5_500);
        expect(G.state.s).toBe('battle');
        vi.advanceTimersByTime(600);
        expect(G.state).toMatchObject({ s: 'notice', kind: 'away' });
        await until(() => H.state.s === 'notice');
        expect(H.state).toMatchObject({ s: 'notice', kind: 'left', detail: 'battle' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('the link closing while the page is hidden reads as "away" here and "left" there', async () => {
      const { H, G } = await connect({});
      await placeAndStart(H, G);
      G.visibility(true);
      tr(G).end('failed');
      expect(G.state).toMatchObject({ s: 'notice', kind: 'away' });
      await until(() => H.state.s === 'notice');
      expect(H.state).toMatchObject({ s: 'notice', kind: 'left', detail: 'battle' });
    });

    it('a BYE while hidden is still "left": they quit on purpose', async () => {
      const { H, G } = await connect({});
      G.visibility(true);
      H.leave();
      await until(() => G.state.s === 'notice');
      expect(G.state).toMatchObject({ s: 'notice', kind: 'left' });
    });

    it('a dropped link shows as lost until it comes back', async () => {
      const { H } = await connect({});
      const seen: boolean[] = [];
      H.subscribe(() => seen.push(H.lost));
      tr(H).onstate!(false);
      tr(H).onstate!(true);
      expect(seen).toEqual([true, false]);
    });
  });
});

describe('stats: series score and the game log', () => {
  const named = async (a: string, b: string) => {
    const H = new Controller();
    const G = new Controller();
    H.me.name = a;
    G.me.name = b;
    const [x, y] = memoryPair();
    H.attach(x, 'host');
    G.attach(y, 'guest');
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
    return { H, G };
  };

  it('exchanges ids and names in HELLO; counts each game once, rematches included', async () => {
    const { H, G } = await named('Ann', 'Bob');
    expect(H.peer).toMatchObject({ id: G.me.id, name: 'Bob' });
    expect(G.peer).toMatchObject({ id: H.me.id, name: 'Ann' });
    expect(H.score).toBe('');
    await placeAndStart(H, G);
    await playOut(H, G);
    expect(H.score).toBe('You 1 – 0 Bob');
    expect(G.score).toBe('You 0 – 1 Ann');
    expect(H.me.log).toEqual([[expect.any(Number), 'me', G.me.id, 'Bob', 17, expect.any(Number), 0]]);
    expect(G.me.log).toEqual([[expect.any(Number), 'them', H.me.id, 'Ann', 0, expect.any(Number), 0]]);
    H.rematch();
    G.rematch();
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
    await placeAndStart(H, G);
    await playOut(H, G);
    expect(H.score).toBe('You 2 – 0 Bob');
    // Leaving the end screen adds nothing.
    G.leave();
    await until(() => H.state.s === 'end' && H.state.peerLeft);
    expect(H.me.log.map((g) => g[1])).toEqual(['me', 'me']);
    expect(G.me.log.map((g) => g[1])).toEqual(['them', 'them']);
  });

  it('an opponent leaving mid-battle is a forfeit win here and a loss there', async () => {
    const { H, G } = await named('', '');
    await placeAndStart(H, G);
    G.leave();
    await until(() => H.state.s === 'notice');
    expect(H.me.log).toEqual([[expect.any(Number), 'me', G.me.id, '', 0, 0, 1]]);
    expect(G.me.log.map((g) => g[1])).toEqual(['them']);
  });

  it('a fleet that fails verification turns my loss into a win', async () => {
    const { H, G } = await named('', '');
    await placeAndStart(H, G);
    // H wins, then reveals a fleet other than the one it committed to.
    const c = H as unknown as { send(m: Msg): void };
    const send = c.send.bind(H);
    c.send = (m) => send(m.t === 'reveal' ? { ...m, fleet: FLEET_B } : m);
    await playOut(H, G, false);
    await until(() => G.state.s === 'end' && G.state.verdict === 'cheat');
    expect(G.me.log.map((g) => g[1])).toEqual(['me']);
    expect(G.score).toBe('You 1 – 0 Friend');
    expect(H.me.log.map((g) => g[1])).toEqual(['me']);
  });
});
