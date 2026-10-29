import { describe, expect, it } from 'vitest';
import { applyAnswer, createMatch, legalAttack, localAttack, remoteAttack, shotsAllowed, untargeted, type Match } from '../../src/game/engine';
import { randomFleet } from '../../src/game/random';
import { fleetLegal, geoOf } from '../../src/game/rules';
import { seededRng } from '../../src/game/seeded';
import { resolveAttack } from '../../src/game/resolve';
import type { Attack, Config, Fleet } from '../../src/game/types';
import { FLEET_A, FLEET_B, G, cfgOf as cfg } from './helpers';

/** Two engines in lockstep: A (fleet a) starts. */
function pair(c: Config, a: Fleet = FLEET_A, b: Fleet = FLEET_B) {
  const A = createMatch(c, a, true);
  const B = createMatch(c, b, false);
  const play = (attacker: Match, defender: Match, attack: Attack) => {
    localAttack(attacker, attack);
    const r = remoteAttack(defender, attack);
    if ('cheat' in r) throw new Error(r.cheat);
    const res = applyAnswer(attacker, r.answer);
    if ('cheat' in res) throw new Error(res.cheat);
    return r.answer;
  };
  return { A, B, play };
}
const fire = (...cells: number[]): Attack => ({ k: 'fire', cells });

describe('engine: classic', () => {
  it('passes the turn every shot without extra shot', () => {
    const { A, B, play } = pair(cfg());
    expect(A.phase).toBe('myTurn');
    expect(B.phase).toBe('theirTurn');
    play(A, B, fire(9)); // hit
    expect(A.phase).toBe('theirTurn');
    expect(B.phase).toBe('myTurn');
    play(B, A, fire(50)); // miss
    expect(A.phase).toBe('myTurn');
  });
  it('extra shot after a hit keeps the turn; a miss passes', () => {
    const { A, B, play } = pair(cfg({ extraShot: true }));
    play(A, B, fire(9));
    expect(A.phase).toBe('myTurn');
    play(A, B, fire(0));
    expect(A.phase).toBe('theirTurn');
    expect(B.phase).toBe('myTurn');
  });
  it('rejects out-of-turn and repeated shots', () => {
    const { A, B, play } = pair(cfg());
    expect(legalAttack(B, fire(0), 'me')).toBe('not their turn');
    play(A, B, fire(9));
    play(B, A, fire(99));
    expect(legalAttack(A, fire(9), 'me')).toMatch(/twice/);
    expect(remoteAttack(B, fire(9))).toEqual({ cheat: 'they fired at the same cell twice' });
  });
  it('detects game over and the winner on both sides', () => {
    const { A, B, play } = pair(cfg({ extraShot: true }));
    const cells = [9, 19, 29, 39, 49, 7, 17, 27, 37, 5, 15, 25, 3, 13, 23, 1, 11];
    for (const c of cells) play(A, B, fire(c));
    expect(A.phase).toBe('over');
    expect(B.phase).toBe('over');
    expect(A.winner).toBe('me');
    expect(B.winner).toBe('them');
    expect(A.target.sunk.every(Boolean)).toBe(true);
    expect(A.stats.me).toMatchObject({ shots: 17, hits: 17, turns: 1 });
  });
  it('a rematch with the other player starting flips the first turn', () => {
    const A2 = createMatch(cfg(), FLEET_A, false);
    expect(A2.phase).toBe('theirTurn');
  });
});

describe('engine: salvo', () => {
  it('shots = ships afloat; 5 -> 4 after a sink', () => {
    const { A, B, play } = pair(cfg({ mode: 1 }));
    expect(shotsAllowed(A, 'me')).toBe(5);
    expect(legalAttack(A, fire(1, 2), 'me')).toMatch(/expected 5/);
    play(A, B, fire(90, 91, 92, 93, 94));
    // B sinks A's destroyer (80, 81) and misses
    const ans = play(B, A, fire(80, 81, 99, 98, 97));
    expect(ans.k === 'cells' && ans.entries[1]!.code).toBe(6);
    expect(A.phase).toBe('myTurn');
    expect(shotsAllowed(A, 'me')).toBe(4);
    expect(shotsAllowed(B, 'them')).toBe(4);
    expect(legalAttack(A, fire(95, 96, 70, 71, 72), 'me')).toMatch(/expected 4/);
    play(A, B, fire(95, 96, 70, 71));
    expect(A.phase).toBe('theirTurn'); // salvo always passes
  });
  it('is capped by untargeted cells', () => {
    const { A } = pair(cfg({ mode: 1 }));
    for (let c = 0; c < 97; c++) A.target.shot.add(c);
    expect(shotsAllowed(A, 'me')).toBe(3);
  });
});

describe('engine: items', () => {
  const sonar = (a: number): Attack => ({ k: 'item', item: 0, a, b: 0 });
  it('energy +1 at the start of each own turn, capped at 6', () => {
    const { A, B, play } = pair(cfg({ mode: 2 }));
    expect(A.energy).toEqual({ me: 1, them: 0 });
    expect(B.energy).toEqual({ me: 0, them: 1 });
    let cell = 50;
    for (let i = 0; i < 8; i++) {
      play(A, B, fire(cell++));
      play(B, A, fire(cell + 40));
    }
    expect(A.energy.me).toBe(6);
    expect(B.energy.them).toBe(6);
    expect(B.energy.me).toBe(6);
  });
  it('items need enough energy and replace the shot', () => {
    const { A, B, play } = pair(cfg({ mode: 2 }));
    expect(legalAttack(A, sonar(11), 'me')).toMatch(/enough energy/);
    play(A, B, fire(50));
    play(B, A, fire(50));
    expect(A.energy.me).toBe(2);
    const ans = play(A, B, sonar(11));
    expect(ans).toEqual({ k: 'sonar', count: 2 }); // FLEET_B destroyer cells 1, 11
    expect(A.energy.me).toBe(0);
    expect(B.energy.them).toBe(0);
    expect(A.phase).toBe('theirTurn');
    expect(A.stats.me.items).toBe(1);
  });
  it('items are illegal outside Items mode and with bad inputs', () => {
    const { A } = pair(cfg());
    expect(legalAttack(A, sonar(11), 'me')).toMatch(/outside Items/);
    const p = pair(cfg({ mode: 2 }));
    p.A.energy.me = 6;
    expect(legalAttack(p.A, sonar(0), 'me')).toMatch(/invalid/);
    expect(legalAttack(p.A, { k: 'item', item: 3, a: 7, b: 0 }, 'me')).toMatch(/invalid/);
  });
  it('rejects an item whose footprint is all fired at', () => {
    const { A } = pair(cfg({ mode: 2 }));
    A.energy.me = 6;
    for (const c of [0, 1, 10]) A.target.shot.add(c);
    expect(legalAttack(A, { k: 'item', item: 2, a: 0, b: 0 }, 'me')).toMatch(/already/);
  });
  it('torpedo, cross and line resolve through the engine', () => {
    const { A, B, play } = pair(cfg({ mode: 2 }));
    A.energy.me = 6;
    B.energy.them = 6;
    const t = play(A, B, { k: 'item', item: 1, a: 9, b: 3 });
    expect(t).toEqual({ k: 'cells', entries: [{ cell: 49, code: 1 }] });
    expect([...A.target.shot].sort((x, y) => x - y)).toEqual([49, 59, 69, 79, 89, 99]);
    expect(B.own.shot.size).toBe(6);
    play(B, A, fire(99));
    A.energy.me = 6;
    B.energy.them = 6;
    const x = play(A, B, { k: 'item', item: 2, a: 27, b: 0 });
    expect(x.k === 'cells' && x.entries.map((e) => [e.cell, e.code])).toEqual([[27, 1], [17, 1], [28, 0], [37, 1], [26, 0]]);
    play(B, A, fire(98));
    A.energy.me = 6;
    B.energy.them = 6;
    const l = play(A, B, { k: 'item', item: 3, a: 5, b: 1 });
    expect(l.k === 'cells' && l.entries.map((e) => e.code)).toEqual([1, 1, 4, 0, 0]); // cruiser col 5 sunk
  });
});

describe('engine: live answer checks', () => {
  it('flags wrong cells, double sinks and impossible sunk ships', () => {
    const { A } = pair(cfg());
    localAttack(A, fire(9));
    expect(applyAnswer(A, { k: 'cells', entries: [{ cell: 8, code: 0 }] })).toEqual({ cheat: 'they answered for the wrong cells' });
    expect(applyAnswer(A, { k: 'cells', entries: [{ cell: 9, code: 6, ship: { anchor: 9, vertical: true } }] })).toMatchObject({ cheat: /sunk ship/ });
    expect(applyAnswer(A, { k: 'sonar', count: 1 })).toMatchObject({ cheat: /wrong kind/ });
    expect(applyAnswer(A, resolveAttack(G, FLEET_B, new Set(), fire(9)))).toEqual({ ok: true });
  });
  it('flags a defender that never reports all ships sunk', () => {
    const { A } = pair(cfg({ extraShot: true }));
    for (let c = 0; c < 100; c++) {
      A.phase = 'myTurn';
      localAttack(A, fire(c));
      const r = applyAnswer(A, { k: 'cells', entries: [{ cell: c, code: 0 }] });
      if (c < 99) expect(r).toEqual({ ok: true });
      else expect(r).toMatchObject({ cheat: /every cell/ });
    }
  });
});

describe('engine: area items on revealed cells', () => {
  it('a cross bomb centred on an already-hit cell strikes only the unrevealed arms', () => {
    const { A, B, play } = pair(cfg({ mode: 2 }));
    play(A, B, fire(17)); // FLEET_B battleship, column 7
    play(B, A, fire(99));
    A.energy.me = B.energy.them = 6;
    const x = play(A, B, { k: 'item', item: 2, a: 17, b: 0 });
    expect(x.k === 'cells' && x.entries.map((e) => e.cell)).toEqual([7, 18, 27, 16]);
    expect(A.target.hit.has(7) && A.target.hit.has(27)).toBe(true);
  });
  it('airstrike resolves through the engine and costs 4', () => {
    const { A, B, play } = pair(cfg({ mode: 2 }));
    A.energy.me = B.energy.them = 4;
    const x = play(A, B, { k: 'item', item: 4, a: 33, b: 1 }); // 15 24 33 42 51
    expect(x.k === 'cells' && x.entries.map((e) => [e.cell, e.code])).toEqual([[15, 1], [24, 0], [33, 0], [42, 0], [51, 0]]);
    expect(A.energy.me).toBe(0);
  });
});

describe('engine: extra shot in Items mode', () => {
  it('a hit by a shot or an item keeps the turn without new energy; sonar and misses pass', () => {
    const { A, B, play } = pair(cfg({ mode: 2, extraShot: true }));
    expect(A.config.extraShot).toBe(true);
    play(A, B, fire(9)); // hit
    expect(A.phase).toBe('myTurn');
    expect(A.energy.me).toBe(1);
    A.energy.me = 6;
    B.energy.them = 6;
    play(A, B, { k: 'item', item: 1, a: 7, b: 2 }); // torpedo down column 7: hits 7
    expect(A.phase).toBe('myTurn');
    play(A, B, { k: 'item', item: 0, a: 55, b: 0 }); // sonar never grants another turn
    expect(A.phase).toBe('theirTurn');
    play(B, A, fire(99));
    A.energy.me = 6;
    B.energy.them = 6;
    play(A, B, { k: 'item', item: 2, a: 66, b: 0 }); // all water
    expect(A.phase).toBe('theirTurn');
    expect(B.phase).toBe('myTurn');
  });
  it('Salvo never has it', () => expect(createMatch(cfg({ mode: 1, extraShot: true }), FLEET_A, true).config.extraShot).toBe(false));
});

describe('engine: Russian', () => {
  // 1×4, 2×3, 3×2, 4×1 on rows 0, 2, 4, ... with gaps (no touching).
  const RU: Fleet = [0, 5, 20, 24, 28, 40, 43, 60, 62, 64].map((anchor) => ({ anchor, vertical: false }));
  it('hit shoots again; sunk ships and hit diagonals are marked as water', () => {
    const { A, B, play } = pair(cfg({ mode: 3 }), RU, RU);
    expect([A.geo.fleet.length, A.geo.total, A.config.noTouch, A.config.extraShot]).toEqual([10, 20, true, true]);
    play(A, B, fire(60)); // 1-cell boat at A7: sunk
    expect(A.phase).toBe('myTurn');
    expect([...A.target.known].sort((a, b) => a - b)).toEqual([50, 51, 61, 70, 71]);
    play(A, B, fire(1)); // battleship B1: hit, diagonals A2 and C2 known
    expect(A.phase).toBe('myTurn');
    expect(A.target.known.has(10) && A.target.known.has(12)).toBe(true);
    expect(A.target.known.has(0)).toBe(false);
    play(A, B, fire(99)); // miss passes
    expect(A.phase).toBe('theirTurn');
  });
  it('the whole fleet must be sunk to win', () => {
    const { A, B, play } = pair(cfg({ mode: 3 }), RU, RU);
    const cells = RU.flatMap((s, i) => Array.from({ length: A.geo.fleet[i]! }, (_, k) => s.anchor + k));
    for (const c of cells) play(A, B, fire(c));
    expect(A.winner).toBe('me');
    expect(A.stats.me.turns).toBe(1);
  });
});

describe('engine: Large board with islands', () => {
  const c = cfg({ size: 2, seed: 4 }); // islands 13 25 | 56 57 | 106 118 130
  const L = geoOf(c);
  const LF: Fleet = [0, 26, 60, 84, 96, 120, 132].map((anchor) => ({ anchor, vertical: false }));
  it('islands start as resolved, cannot be fired at, and torpedoes stop there', () => {
    expect(fleetLegal(L, LF)).toBe(true);
    const { A, B, play } = pair(c, LF, LF);
    expect(untargeted(A)).toHaveLength(144 - 7);
    expect(legalAttack(A, fire(13), 'me')).toBe('fired at an island');
    expect(legalAttack(A, fire(144), 'me')).toBe('shot off the board');
    expect(remoteAttack(B, fire(56))).toEqual({ cheat: 'they fired at an island' });
    play(A, B, fire(143));
    expect(A.target.shot.has(143)).toBe(true);
  });
  it('Items: a torpedo from the right along row 4 stops at the island; a cross on an island hits the rest', () => {
    const { A, B, play } = pair(cfg({ mode: 2, size: 2, seed: 4 }), LF, LF);
    A.energy.me = 6;
    B.energy.them = 6;
    expect(play(A, B, { k: 'item', item: 1, a: 4, b: 1 })).toEqual({ k: 'cells', entries: [] });
    expect([...A.target.known].filter((x) => x > 47 && x < 60).sort()).toEqual([58, 59]);
    play(B, A, fire(143));
    A.energy.me = B.energy.them = 6;
    const x = play(A, B, { k: 'item', item: 2, a: 13, b: 0 });
    expect(x.k === 'cells' && x.entries.map((e) => [e.cell, e.code])).toEqual([[1, 1], [14, 0], [12, 0]]);
  });
  it('Salvo shots follow the bigger fleet', () => {
    const { A } = pair(cfg({ mode: 1, size: 3 }), randomFleet(geoOf(cfg({ size: 3 })), seededRng(1)), randomFleet(geoOf(cfg({ size: 3 })), seededRng(2)));
    expect(shotsAllowed(A, 'me')).toBe(8);
  });
});
