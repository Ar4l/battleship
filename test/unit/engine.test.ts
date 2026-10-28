import { describe, expect, it } from 'vitest';
import { applyAnswer, createMatch, legalAttack, localAttack, remoteAttack, shotsAllowed, type Match } from '../../src/game/engine';
import { resolveAttack } from '../../src/game/resolve';
import type { Attack, Config, Fleet } from '../../src/game/types';
import { FLEET_A, FLEET_B } from './helpers';

const cfg = (c: Partial<Config> = {}): Config => ({ mode: 0, extraShot: false, noTouch: false, timer: 0, ...c });

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
    expect(applyAnswer(A, resolveAttack(FLEET_B, new Set(), fire(9)))).toEqual({ ok: true });
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
