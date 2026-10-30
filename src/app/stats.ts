import { randomBytes } from '../game/commit';

/**
 * Game records, kept on this device only (localStorage 'bs:stats'). When storage
 * is blocked (private mode, sandboxed frames) they live in memory until the page
 * closes. Only the log is stored; the Stats screen sums it up (app/summary.ts),
 * so this part, which every game loads, stays small.
 */
/** Who won, as in Match.winner. */
export type Outcome = 'me' | 'them' | 'draw';
/** One finished game: [time (ms), winner, their id and their name then (null if unknown), my hits, my shots, 1 if they forfeited]. */
export type Game = [number, Outcome, string | null, string | null, number, number, number];
export interface Stats {
  /** This device's player id: 6 random bytes, base64 (8 characters). */
  id: string;
  name: string;
  /** Oldest first. */
  log: Game[];
}
export interface Peer {
  id: string;
  name: string;
}

export const KEY = 'bs:stats';

// localStorage is looked up inside the try: reading it throws when storage is blocked.
export function save(p: Stats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* none, blocked or full: keep it in memory */
  }
}

/**
 * The saved stats, or `mem` (the copy in memory) when nothing could be read.
 * A first visit gets a new id.
 */
export function load(mem?: Partial<Stats>): Stats {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(KEY)!);
  } catch {
    /* none, blocked or corrupt */
  }
  const p = { name: '', log: [], ...(s || mem) } as Stats;
  if (!p.id) save(((p.id = btoa(String.fromCharCode(...randomBytes(6)))), p));
  return p;
}
