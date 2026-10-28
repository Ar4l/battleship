import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/app/controller';
import { memoryPair } from '../../src/net/transport';
import { shipCells, FLEET } from '../../src/game/rules';
import { shotsAllowed, untargeted } from '../../src/game/engine';
import type { Config, Fleet } from '../../src/game/types';
import { FLEET_A, FLEET_B } from './helpers';

const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 2));
  }
};
const shipCellsOf = (f: Fleet) => f.flatMap((s, i) => shipCells(s, FLEET[i]!)!);

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

async function placeAndStart(H: Controller, G: Controller) {
  H.setFleet(FLEET_A);
  G.setFleet(FLEET_B);
  await H.ready();
  await G.ready();
  await until(() => H.state.s === 'battle' && G.state.s === 'battle');
}

/** The player on turn sinks the other, the other always misses. */
async function playOut(H: Controller, G: Controller) {
  const fleets = new Map([[H, FLEET_A], [G, FLEET_B]]);
  for (let guard = 0; guard < 400; guard++) {
    if (H.state.s === 'end' && G.state.s === 'end') break;
    const me = H.match?.phase === 'myTurn' ? H : G.match?.phase === 'myTurn' ? G : null;
    if (!me) {
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }
    const m = me.match!;
    const winner = me === H;
    const theirs = shipCellsOf(fleets.get(me === H ? G : H)!).filter((c) => !m.target.shot.has(c));
    const free = untargeted(m.target).filter((c) => !theirs.includes(c));
    const n = shotsAllowed(m, 'me');
    const pool = winner ? [...theirs, ...free] : [...free, ...theirs];
    expect(me.attack({ k: 'fire', cells: pool.slice(0, n) })).toBe(true);
    await until(() => me.match?.phase !== 'awaitingAnswer');
  }
  await until(() => H.state.s === 'end' && G.state.s === 'end');
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
    G.lie = { kind: 'miss-on-hit', cell: 9 }; // J1, part of FLEET_B's carrier
    await playOut(H, G);
    await until(() => H.state.s === 'end' && !!H.state.theirFleet);
    const hs = H.state;
    if (hs.s !== 'end') throw 0;
    expect(hs.verdict).toBe('cheat');
    expect(hs.reason).toBe('Cheating detected: they reported a miss at J1 but a ship was there');
  });

  it('BYE takes the opponent to "left"', async () => {
    const { H, G } = await connect({});
    await placeAndStart(H, G);
    G.leave();
    await until(() => H.state.s === 'notice');
    expect(H.state).toMatchObject({ s: 'notice', kind: 'left', detail: 'battle' });
    expect(G.state.s).toBe('home');
  });
});
