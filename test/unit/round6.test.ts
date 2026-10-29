import { describe, expect, it } from 'vitest';
import { commitBoard, randomBytes } from '../../src/game/commit';
import { applyAnswer, createMatch, legalAttack, localAttack, remoteAttack, type Match } from '../../src/game/engine';
import { HOLD_CAP, ITEMS } from '../../src/game/items';
import { decodeConfig, encodeConfig, rulesLine } from '../../src/game/rules';
import type { Attack, Config, Fleet } from '../../src/game/types';
import { verifyOpponent } from '../../src/game/verify';
import { FLEET_A, FLEET_B, cfgOf } from './helpers';

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
const fire = (c: number): Attack => ({ k: 'fire', cells: [c] });
const air = (a: number): Attack => ({ k: 'item', item: 4, a, b: 0 });

describe('item costs', () => {
  it('table', () => expect(ITEMS.map((d) => [d.name, d.cost])).toEqual([['Sonar', 3], ['Torpedo', 4], ['Cross bomb', 4], ['Line strike', 4], ['Airstrike', 5]]));
});

describe('airstrike scatter and the end-of-game check', () => {
  it('replays to a verified verdict; a lie about a scattered cell is caught', async () => {
    const c = cfgOf({ items: true, seed: 999 });
    const { A, B, play } = pair(c);
    for (const a of [33, 15, 66]) {
      A.energy.me = B.energy.them = 6;
      play(A, B, air(a));
      play(B, A, fire(99 - a));
    }
    const salt = randomBytes(16);
    const commit = await commitBoard(salt, FLEET_B, c);
    expect(await verifyOpponent(c, commit, salt, FLEET_B, A.transcript)).toEqual({ ok: true });
    const t = structuredClone(A.transcript);
    const e = (t[1]!.answer as { entries: { code: number }[] }).entries.find((x) => x.code === 0)!;
    e.code = 1;
    const v = await verifyOpponent(c, commit, salt, FLEET_B, t);
    expect(v.ok).toBe(false);
  });
  it('a defender answering for other cells is flagged live', () => {
    const { A, B } = pair(cfgOf({ items: true, seed: 5 }));
    A.energy.me = B.energy.them = 6;
    localAttack(A, air(44));
    const r = remoteAttack(B, air(44));
    if ('cheat' in r || r.answer.k !== 'cells') throw new Error();
    r.answer.entries[0]!.cell = r.answer.entries[0]!.cell === 0 ? 1 : 0;
    expect(applyAnswer(A, r.answer)).toEqual({ cheat: 'they answered for the wrong cells' });
  });
});

describe('pickups', () => {
  const pc = (seed = 7) => cfgOf({ items: true, pickups: true, seed });
  it('config: needs Items, round-trips, reads in the rules line', () => {
    expect(createMatch(cfgOf({ pickups: true }), FLEET_A, true).config.pickups).toBe(false);
    expect(decodeConfig(encodeConfig(pc()))).toEqual(pc());
    expect(rulesLine(pc())).toMatch(/Item pickups/);
  });
  it('item squares come from seed and turn only: both sides agree, whatever the fleets', () => {
    const { A, B, play } = pair(pc());
    const C = createMatch(pc(), FLEET_B, true);
    expect(A.target.pick.size).toBe(1);
    expect([...A.target.pick]).toEqual([...B.own.pick]);
    expect([...C.target.pick]).toEqual([...A.target.pick]);
    expect(A.energy.me).toBe(0);
    // The turns go by with misses on cells without pickups: one more every 3 turns, at most 2.
    const water = (m: Match, b: 'target' | 'own') => {
      for (let c = 99; ; c--) if (!m[b].shot.has(c) && !m[b].pick.has(c) && ![...FLEET_A, ...FLEET_B].some((s) => s.anchor % 10 === c % 10)) return c;
    };
    for (let t = 0; t < 9; t++) {
      play(A, B, fire(water(A, 'target')));
      play(B, A, fire(water(B, 'target')));
      expect([...A.target.pick]).toEqual([...B.own.pick]);
      expect([...A.own.pick]).toEqual([...B.target.pick]);
      expect(A.target.pick.size).toBe(Math.min(2, 1 + Math.floor((t + 1) / 3)));
    }
    expect([...A.target.pick.keys()].every((c) => !A.target.shot.has(c))).toBe(true);
  });
  it('shooting an item square collects it, hit or miss; at most 3 are held; using one spends it', () => {
    const { A, B, play } = pair(pc());
    expect(legalAttack(A, air(55), 'me')).toMatch(/without holding it/);
    for (let k = 0; k < HOLD_CAP + 1; k++) {
      // Drop a pickup on a known cell for each side to take.
      const c = 90 + k;
      A.target.pick.set(c, 4);
      B.own.pick.set(c, 4);
      play(A, B, fire(c));
      expect(A.inv.me).toEqual(B.inv.them);
      play(B, A, fire(80 + k));
    }
    expect(A.inv.me).toEqual([4, 4, 4]);
    expect(A.target.pick.has(93)).toBe(false);
    play(A, B, air(55));
    expect(A.inv.me).toEqual([4, 4]);
    expect(B.inv.them).toEqual([4, 4]);
    expect(A.energy.me).toBe(0);
  });
  it('the defender rejects an item they do not hold', () => {
    const { A, B } = pair(pc());
    A.inv.me.push(2);
    localAttack(A, { k: 'item', item: 2, a: 55, b: 0 });
    expect(remoteAttack(B, { k: 'item', item: 2, a: 55, b: 0 })).toEqual({ cheat: 'they used Cross bomb without holding it' });
  });
});
