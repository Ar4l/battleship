import { describe, expect, it } from 'vitest';
import { commitBoard, commitCoin, hostStarts, randomBytes, bytesEqual } from '../../src/game/commit';
import { verifyOpponent } from '../../src/game/verify';
import { createMatch, localAttack, applyAnswer, remoteAttack } from '../../src/game/engine';
import { resolveAttack } from '../../src/game/resolve';
import { configFlags } from '../../src/game/rules';
import type { Answer, Attack, Config, Fleet } from '../../src/game/types';
import { FLEET_A, FLEET_B } from './helpers';

const cfg = (c: Partial<Config> = {}): Config => ({ mode: 2, extraShot: false, noTouch: false, timer: 0, ...c });

/** Build an honest transcript of attacks against `fleet`. */
function transcript(fleet: Fleet, attacks: Attack[]): { attack: Attack; answer: Answer }[] {
  const shot = new Set<number>();
  const out = [];
  const m = createMatch(cfg(), fleet, false);
  for (const attack of attacks) {
    m.phase = 'theirTurn';
    m.energy.them = 6;
    const r = remoteAttack(m, attack);
    if ('cheat' in r) throw new Error(r.cheat);
    out.push({ attack, answer: r.answer });
  }
  void shot;
  return out;
}

const ATTACKS: Attack[] = [
  { k: 'fire', cells: [9] },
  { k: 'item', item: 0, a: 11, b: 0 },
  { k: 'item', item: 1, a: 9, b: 3 },
  { k: 'item', item: 2, a: 27, b: 0 },
  { k: 'item', item: 3, a: 5, b: 1 },
  { k: 'fire', cells: [44] },
];

describe('commit-reveal', () => {
  it('commit is deterministic and binds salt, fleet and flags', async () => {
    const salt = randomBytes(16);
    const c = await commitBoard(salt, FLEET_A, 0);
    expect(c.length).toBe(32);
    expect(bytesEqual(c, await commitBoard(salt, FLEET_A, 0))).toBe(true);
    expect(bytesEqual(c, await commitBoard(salt, FLEET_A, 2))).toBe(false);
    expect(bytesEqual(c, await commitBoard(salt, FLEET_B, 0))).toBe(false);
    expect(bytesEqual(c, await commitBoard(randomBytes(16), FLEET_A, 0))).toBe(false);
  });
  it('coin: commit checks and XOR rule', async () => {
    const n = randomBytes(16);
    expect(bytesEqual(await commitCoin(n), await commitCoin(n))).toBe(true);
    expect(hostStarts(Uint8Array.of(0), Uint8Array.of(2))).toBe(true);
    expect(hostStarts(Uint8Array.of(1), Uint8Array.of(2))).toBe(false);
    expect(hostStarts(Uint8Array.of(3), Uint8Array.of(1))).toBe(true);
  });
});

describe('verifyOpponent', () => {
  const setup = async (c = cfg()) => {
    const salt = randomBytes(16);
    return { salt, commit: await commitBoard(salt, FLEET_B, configFlags(c)), t: transcript(FLEET_B, ATTACKS), c };
  };
  it('an honest game verifies', async () => {
    const { salt, commit, t, c } = await setup();
    expect(await verifyOpponent(c, commit, salt, FLEET_B, t)).toEqual({ ok: true });
  });
  it('detects a flipped hit -> miss', async () => {
    const { salt, commit, t, c } = await setup();
    t[0]!.answer = { k: 'cells', entries: [{ cell: 9, code: 0 }] };
    expect(await verifyOpponent(c, commit, salt, FLEET_B, t)).toEqual({ ok: false, reason: 'Cheating detected: they reported a miss at J1 but a ship was there' });
  });
  it('detects a wrong sunk ship', async () => {
    const { salt, commit, t, c } = await setup();
    const line = t[4]!.answer;
    if (line.k !== 'cells') throw 0;
    line.entries[2] = { cell: 25, code: 5, ship: { anchor: 5, vertical: true } };
    const v = await verifyOpponent(c, commit, salt, FLEET_B, t);
    expect(v).toEqual({ ok: false, reason: 'Cheating detected: they reported their Submarine sunk at F3, it was their Cruiser sunk' });
  });
  it('detects a wrong sonar count', async () => {
    const { salt, commit, t, c } = await setup();
    t[1]!.answer = { k: 'sonar', count: 1 };
    expect(await verifyOpponent(c, commit, salt, FLEET_B, t)).toEqual({ ok: false, reason: 'Cheating detected: they reported 1 ship cell in the sonar at A1–C3, there were 2' });
  });
  it('detects a torpedo that passed through a ship', async () => {
    const { salt, commit, t, c } = await setup();
    t[2]!.answer = { k: 'cells', entries: [] };
    expect(await verifyOpponent(c, commit, salt, FLEET_B, t)).toEqual({ ok: false, reason: 'Cheating detected: their torpedo passed through a ship at J5' });
  });
  it('detects a board changed after the commit and a wrong salt', async () => {
    const { salt, commit, t, c } = await setup();
    const moved = FLEET_B.slice();
    moved[4] = { anchor: 90, vertical: false };
    expect(await verifyOpponent(c, commit, salt, moved, t)).toEqual({ ok: false, reason: "Their fleet doesn't match what they committed to at the start." });
    expect(await verifyOpponent(c, commit, randomBytes(16), FLEET_B, t)).toMatchObject({ ok: false, reason: /committed/ });
  });
  it('detects an illegal layout under no-touch', async () => {
    const c = cfg({ noTouch: true });
    const salt = randomBytes(16);
    const touching: Fleet = FLEET_A.slice();
    touching[1] = { anchor: 10, vertical: false };
    const commit = await commitBoard(salt, touching, configFlags(c));
    expect(await verifyOpponent(c, commit, salt, touching, [])).toEqual({ ok: false, reason: 'Their fleet layout was illegal.' });
  });
  it('the attacker-side transcript from the engine verifies', async () => {
    const c = cfg({ mode: 0 });
    const salt = randomBytes(16);
    const commit = await commitBoard(salt, FLEET_B, configFlags(c));
    const A = createMatch(c, FLEET_A, true);
    const shot = new Set<number>();
    for (const cell of [9, 19, 50, 1]) {
      A.phase = 'myTurn';
      const atk: Attack = { k: 'fire', cells: [cell] };
      localAttack(A, atk);
      expect(applyAnswer(A, resolveAttack(FLEET_B, shot, atk))).toEqual({ ok: true });
      shot.add(cell);
    }
    expect(await verifyOpponent(c, commit, salt, FLEET_B, A.transcript)).toEqual({ ok: true });
  });
});
