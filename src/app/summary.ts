import type { Game, Outcome } from './stats';

/** Head-to-head record against one opponent: their latest name, and when we last played (ms). */
export interface Rec extends Record<Outcome, number> {
  name: string;
  last: number;
}
export interface Summary extends Record<Outcome, number> {
  games: number;
  /** Wins because the opponent left mid-battle. */
  forfeits: number;
  /** Wins in a row now, and the most ever. */
  streak: number;
  best: number;
  /** Mean of each game's hit rate (0..1) over games with shots; null if none. */
  accuracy: number | null;
  /** Most recent first. */
  opponents: Rec[];
}

/** Sum up the game log (oldest first). Used by the Stats screen only, so it loads with it. */
export function summarize(log: Game[]): Summary {
  const s: Summary = { games: log.length, me: 0, them: 0, draw: 0, forfeits: 0, streak: 0, best: 0, accuracy: null, opponents: [] };
  const opp = new Map<string, Rec>();
  let acc = 0;
  let shot = 0;
  for (const [t, o, id, name, hits, shots, forfeit] of log) {
    s[o]++;
    s.forfeits += forfeit;
    s.streak = o === 'me' ? s.streak + 1 : 0;
    s.best = Math.max(s.best, s.streak);
    if (shots) {
      acc += hits / shots;
      shot++;
    }
    if (!id) continue;
    const r = opp.get(id) ?? { name: '', last: t, me: 0, them: 0, draw: 0 };
    r[o]++;
    r.name = name ?? '';
    r.last = t;
    opp.set(id, r);
  }
  if (shot) s.accuracy = acc / shot;
  s.opponents = [...opp.values()].sort((a, b) => b.last - a.last);
  return s;
}
