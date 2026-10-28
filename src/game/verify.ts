import { cellName } from './board';
import { bytesEqual, commitBoard } from './commit';
import { footprint, SONAR, TORPEDO } from './items';
import { resolveAttack, resolvedCells } from './resolve';
import { SHIP_NAMES, configFlags, fleetLegal } from './rules';
import type { Answer, Attack, Cell, Config, Entry, Fleet } from './types';

export type Verdict = { ok: true } | { ok: false; reason: string };

const CHEAT = 'Cheating detected: ';
const word = (code: number): string => (code === 0 ? 'a miss' : code === 1 ? 'a hit' : `their ${SHIP_NAMES[code - 2]} sunk`);

function sameEntries(a: Entry[], b: Entry[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => {
      const f = b[i]!;
      return e.cell === f.cell && e.code === f.code && (e.code < 2 || (e.ship!.anchor === f.ship!.anchor && e.ship!.vertical === f.ship!.vertical));
    })
  );
}

function explain(attack: Attack, got: Answer, want: Answer): string {
  if (got.k === 'sonar' && want.k === 'sonar') {
    const fp = footprint(SONAR, (attack as { a: number }).a, 0);
    const n = want.count;
    return `${CHEAT}they reported ${got.count} ship cell${got.count === 1 ? '' : 's'} in the sonar at ${cellName(fp[0]!)}–${cellName(fp[8]!)}, there ${n === 1 ? 'was' : 'were'} ${n}`;
  }
  if (got.k !== 'cells' || want.k !== 'cells') return `${CHEAT}they sent the wrong kind of answer`;
  if (attack.k === 'item' && attack.item === TORPEDO) {
    const w = want.entries[0];
    const g = got.entries[0];
    if (w && (!g || g.cell !== w.cell)) return `${CHEAT}their torpedo passed through a ship at ${cellName(w.cell)}`;
    if (g && !w) return `${CHEAT}they reported a torpedo hit at ${cellName(g.cell)} but it was water`;
  }
  for (let i = 0; i < Math.max(got.entries.length, want.entries.length); i++) {
    const g = got.entries[i];
    const w = want.entries[i];
    if (!g || !w || g.cell !== w.cell) return `${CHEAT}they answered for the wrong cells`;
    if (g.code === w.code && (g.code < 2 || (g.ship!.anchor === w.ship!.anchor && g.ship!.vertical === w.ship!.vertical))) continue;
    const at = cellName(g.cell);
    if (g.code === 0) return `${CHEAT}they reported a miss at ${at} but a ship was there`;
    if (w.code === 0) return `${CHEAT}they reported a hit at ${at} but it was water`;
    return `${CHEAT}they reported ${word(g.code)} at ${at}, it was ${word(w.code)}`;
  }
  return `${CHEAT}their answers don't match their fleet`;
}

/**
 * Check a revealed fleet against the commit, the rules, and every answer the
 * opponent gave to my attacks.
 */
export async function verifyOpponent(
  config: Config,
  commit: Uint8Array,
  salt: Uint8Array,
  fleet: Fleet,
  transcript: { attack: Attack; answer: Answer }[],
): Promise<Verdict> {
  const hash = await commitBoard(salt, fleet, configFlags(config));
  if (!bytesEqual(hash, commit)) return { ok: false, reason: "Their fleet doesn't match what they committed to at the start." };
  if (!fleetLegal(fleet, config.noTouch)) return { ok: false, reason: 'Their fleet layout was illegal.' };
  const shot = new Set<Cell>();
  for (const { attack, answer } of transcript) {
    const want = resolveAttack(fleet, shot, attack);
    const same =
      want.k === answer.k &&
      (want.k === 'sonar' ? want.count === (answer as { count: number }).count : sameEntries(want.entries, (answer as { entries: Entry[] }).entries));
    if (!same) return { ok: false, reason: explain(attack, answer, want) };
    for (const c of resolvedCells(attack, want, shot)) shot.add(c);
  }
  return { ok: true };
}
