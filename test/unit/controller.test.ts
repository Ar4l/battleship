import { describe, expect, it, vi } from 'vitest';
import { Controller } from '../../src/app/controller';
import { lie } from '../../src/app/debug';
import { decode, encode, type Msg } from '../../src/proto/codec';
import { memoryPair } from '../../src/net/transport';
import { shipCells } from '../../src/game/rules';
import { shotsAllowed, untargeted } from '../../src/game/engine';
import type { Config, Fleet } from '../../src/game/types';
import { FLEET_A, FLEET_B, G as G10, cfgOf } from './helpers';

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
    ['Classic', { mode: 0 } as const],
    ['Classic with extra shot', { mode: 0, extraShot: true } as const],
    ['Salvo', { mode: 1 } as const],
  ])('plays a full %s game to a verified verdict, then rematches with the other starter', async (_, cfg) => {
    const { H, G } = await connect(cfg);
    expect(G.config.mode).toBe(cfg.mode);
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
    ['Russian', { mode: 3 } as const],
    ['Large Items with islands and extra shot', { mode: 2, size: 2, extraShot: true } as const],
    ['Huge Salvo', { mode: 1, size: 3 } as const],
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
    const { H, G } = await connect({ mode: 2 });
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    them.prefire(50); // not their phase: ignored
    expect(them.queue).toEqual([]);
    me.prefire(55);
    me.prefire(44); // one shot without extra shot: a new pick swaps
    expect(me.queue).toEqual([44]);
    me.prefire(44);
    expect(me.queue).toEqual([]);
    me.prefire(66);
    them.attack({ k: 'fire', cells: [98] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.queue).toEqual([66]); // "Firing F7" for 300 ms
    await until(() => me.match!.phase === 'theirTurn' && them.match!.phase === 'myTurn');
    expect(me.match!.target.shot.has(66)).toBe(true);
    expect(me.queue).toEqual([]);
  });

  it('prefire with extra shot: up to 3, later ones fire only after hits, a move of my own cancels', async () => {
    const { H, G } = await connect({ mode: 0, extraShot: true });
    await placeAndStart(H, G);
    const [me, them] = H.match!.phase === 'theirTurn' ? [H, G] : [G, H];
    const ships = shipCellsOf(me === H ? FLEET_B : FLEET_A);
    const water = untargeted(me.match!).filter((c) => !ships.includes(c));
    // Their shots land on my water, so their turn always passes.
    const mine = shipCellsOf(me === H ? FLEET_A : FLEET_B);
    const sea = untargeted(them.match!).filter((c) => !mine.includes(c));
    for (const c of [ships[0]!, ships[1]!, water[0]!, water[1]!]) me.prefire(c);
    expect(me.queue).toEqual([ships[0], ships[1], water[0]]);
    them.attack({ k: 'fire', cells: [sea[0]!] });
    // hit, hit, miss: all three fire, then the turn passes.
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn', 5000);
    expect([ships[0]!, ships[1]!, water[0]!].every((c) => me.match!.target.shot.has(c))).toBe(true);
    // Queue water first: the miss passes the turn and the rest is dropped.
    me.prefire(water[2]!);
    me.prefire(ships[2]!);
    them.attack({ k: 'fire', cells: [sea[1]!] });
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn', 5000);
    expect(me.match!.target.shot.has(ships[2]!)).toBe(false);
    expect(me.queue).toEqual([]);
    // A manual shot inside the 300 ms cancels the queue.
    me.prefire(ships[3]!);
    them.attack({ k: 'fire', cells: [sea[2]!] });
    await until(() => me.match!.phase === 'myTurn');
    expect(me.attack({ k: 'fire', cells: [water[3]!] })).toBe(true);
    expect(me.queue).toEqual([]);
    await until(() => them.match!.phase === 'myTurn' && me.match!.phase === 'theirTurn');
    await new Promise((r) => setTimeout(r, 350));
    expect(me.match!.target.shot.has(ships[3]!)).toBe(false);
  });

  it('prefire in Salvo: up to my shots; too few become the selection; fired cells are dropped', async () => {
    const { H, G } = await connect({ mode: 1 });
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

  it('plays an Items game using every item', async () => {
    const { H, G } = await connect({ mode: 2 });
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
    const { H, G } = await connect({ mode: 0 });
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
      const { H, G } = await connect({ mode, timer: 15 });
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

  it('salvo results name the shooter', async () => {
    const { H, G } = await connect({ mode: 1 });
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
    const { H, G } = await connect({ mode: 0 });
    await placeAndStart(H, G);
    raw(H, { t: 'reveal', salt: new Uint8Array(16), fleet: FLEET_A });
    await until(() => G.state.s === 'end');
    expect(G.match!.winner).toBe('me');
    raw(H, { t: 'config', config: cfgOf({ mode: 2, noTouch: true }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(G.state.s).toBe('end');
    expect(G.config.mode).toBe(0);
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

  it('rematch: the host changes the mode after the guest already asked', async () => {
    const { H, G } = await connect({ mode: 0 });
    await placeAndStart(H, G);
    await playOut(H, G);
    G.rematch();
    await until(() => H.state.s === 'end' && H.state.rematch.them);
    H.toggleEditing();
    H.setConfig({ mode: 1 });
    H.rematch();
    await until(() => H.state.s === 'placement' && G.state.s === 'placement');
    expect(G.config.mode).toBe(1);
    await placeAndStart(H, G);
    expect(H.match!.config.mode).toBe(1);
    expect(G.match!.config.mode).toBe(1);
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
