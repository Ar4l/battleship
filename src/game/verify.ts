import { cellName, encodeShip } from './board';
import { bytesEqual, commitBoard } from './commit';
import { footprint, SONAR, TORPEDO } from './items';
import { resolveAttack, resolvedCells } from './resolve';
import { SHIP_NAMES, configFlags, fleetLegal } from './rules';
import type { Answer, Attack, Cell, Config, Entry, Fleet } from './types';

type Verdict = { ok: true } | { ok: false; reason: string };

const word = (code: number): string => (code ? (code > 1 ? `their ${SHIP_NAMES[code - 2]} sunk` : 'a hit') : 'a miss');
const same = (g: Entry, w: Entry) => g.cell === w.cell && g.code === w.code && (g.code < 2 || encodeShip(g.ship!) === encodeShip(w.ship!));

/** How `got` differs from the honest answer `want`, or null when equal. */
function diff(attack: Attack, got: Answer, want: Answer): string | null {
  if (got.k !== want.k) return 'they sent the wrong kind of answer';
  if (want.k === 'sonar') {
    const fp = footprint(SONAR, (attack as { a: number }).a, 0);
    const [g, n] = [(got as { count: number }).count, want.count];
    return g === n ? null : `they reported ${g} ship cell${g === 1 ? '' : 's'} in the sonar at ${cellName(fp[0]!)}–${cellName(fp[8]!)}, there ${n === 1 ? 'was' : 'were'} ${n}`;
  }
  const gs = (got as { entries: Entry[] }).entries;
  const ws = want.entries;
  const w0 = ws[0];
  const g0 = gs[0];
  if (attack.k === 'item' && attack.item === TORPEDO) {
    // Compare where along the line each answer stops (99: no hit).
    const line = footprint(TORPEDO, attack.a, attack.b);
    const [gi, wi] = [g0, w0].map((e) => (e ? line.indexOf(e.cell) : 99));
    if (gi! < wi!) return `they reported a torpedo hit at ${cellName(g0!.cell)} but it was water`;
    if (wi! < gi!) return `their torpedo passed through a ship at ${cellName(w0!.cell)}`;
  }
  for (let i = 0; i < Math.max(gs.length, ws.length); i++) {
    const g = gs[i];
    const w = ws[i];
    if (g?.cell !== w?.cell) return 'they answered for the wrong cells';
    if (same(g!, w!)) continue;
    const at = cellName(g!.cell);
    return !g!.code
      ? `they reported a miss at ${at} but a ship was there`
      : !w!.code
        ? `they reported a hit at ${at} but it was water`
        : `they reported ${word(g!.code)} at ${at}, it was ${word(w!.code)}`;
  }
  return null;
}

/**
 * Check a revealed fleet against the commit, the rules, and every answer the
 * opponent gave to my attacks.
 */
export async function verifyOpponent(config: Config, commit: Uint8Array, salt: Uint8Array, fleet: Fleet, transcript: { attack: Attack; answer: Answer }[]): Promise<Verdict> {
  if (!bytesEqual(await commitBoard(salt, fleet, configFlags(config)), commit)) return { ok: false, reason: "Their fleet doesn't match what they committed to at the start." };
  if (!fleetLegal(fleet, config.noTouch)) return { ok: false, reason: 'Their fleet layout was illegal.' };
  const shot = new Set<Cell>();
  for (const { attack, answer } of transcript) {
    const want = resolveAttack(fleet, shot, attack);
    const why = diff(attack, answer, want);
    if (why) return { ok: false, reason: 'Cheating detected: ' + why };
    resolvedCells(attack, want, shot).forEach((c) => shot.add(c));
  }
  return { ok: true };
}
