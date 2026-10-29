import { cellName } from './board';
import { bytesEqual, commitBoard } from './commit';
import { footprint, SONAR, TORPEDO } from './items';
import { resolveAttack, resolvedCells } from './resolve';
import { fleetLegal, geoOf } from './rules';
import type { Answer, Attack, Cell, Config, Entry, Fleet, Geo } from './types';

type Verdict = { ok: true } | { ok: false; reason: string };

const same = (g: Entry, w: Entry) => g.cell === w.cell && g.code === w.code && (g.code < 2 || (g.ship!.anchor === w.ship!.anchor && g.ship!.vertical === w.ship!.vertical));

/** How `got` differs from the honest answer `want`, or null when equal. */
function diff(geo: Geo, attack: Attack, got: Answer, want: Answer): string | null {
  const name = (c: Cell) => cellName(c, geo.n);
  const word = (code: number): string => (code ? (code > 1 ? `their ${geo.names[code - 2]} sunk` : 'a hit') : 'a miss');
  if (got.k !== want.k) return 'they sent the wrong kind of answer';
  if (want.k === 'sonar') {
    const fp = footprint(geo, SONAR, (attack as { a: number }).a, 0);
    const [g, n] = [(got as { count: number }).count, want.count];
    return g === n ? null : `they reported ${g} ship cell${g === 1 ? '' : 's'} in the sonar at ${name(fp[0]!)}–${name(fp[8]!)}, there ${n === 1 ? 'was' : 'were'} ${n}`;
  }
  const gs = (got as { entries: Entry[] }).entries;
  const ws = want.entries;
  const w0 = ws[0];
  const g0 = gs[0];
  if (attack.k === 'item' && attack.item === TORPEDO) {
    // Compare where along the line each answer stops (99: no hit).
    const line = footprint(geo, TORPEDO, attack.a, attack.b);
    const [gi, wi] = [g0, w0].map((e) => (e ? line.indexOf(e.cell) : 99));
    if (gi! < wi!) return `they reported a torpedo hit at ${name(g0!.cell)} but it was water`;
    if (wi! < gi!) return `their torpedo passed through a ship at ${name(w0!.cell)}`;
  }
  for (let i = 0; i < Math.max(gs.length, ws.length); i++) {
    const g = gs[i];
    const w = ws[i];
    if (g?.cell !== w?.cell) return 'they answered for the wrong cells';
    if (same(g!, w!)) continue;
    const at = name(g!.cell);
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
  const g = geoOf(config);
  if (!bytesEqual(await commitBoard(salt, fleet, config), commit)) return { ok: false, reason: "Their fleet doesn't match what they committed to at the start." };
  if (!fleetLegal(g, fleet)) return { ok: false, reason: 'Their fleet layout was illegal.' };
  const shot = new Set<Cell>(g.islands);
  for (const { attack, answer } of transcript) {
    const want = resolveAttack(g, fleet, shot, attack);
    const why = diff(g, attack, answer, want);
    if (why) return { ok: false, reason: 'Cheating detected: ' + why };
    resolvedCells(g, attack, want, shot).forEach((c) => shot.add(c));
  }
  return { ok: true };
}
