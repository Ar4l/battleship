import { row } from './rules';
import type { Cell, Geo, ItemId } from './types';

export interface ItemDef {
  id: ItemId;
  name: string;
  cost: number;
  desc: string;
}

export const ITEMS: readonly ItemDef[] = (
  [
    ['Sonar', 2, 'Counts ship cells in a 3×3 area'],
    ['Torpedo', 3, 'Runs along a line, hits the first ship'],
    ['Cross bomb', 4, 'Hits a plus of 5 cells'],
    ['Line strike', 5, 'Hits 5 cells in a row'],
    ['Airstrike', 4, 'Hits 5 cells on a diagonal'],
  ] as const
).map(([name, cost, desc], id) => ({ id: id as ItemId, name, cost, desc }));

export const ENERGY_CAP = 6;
export const SONAR = 0;
export const TORPEDO = 1;
export const CROSS = 2;
export const LINE = 3;
export const AIRSTRIKE = 4;

const within = (x: number, lo: number, hi: number) => x >= lo && x <= hi;

/**
 * Are (a, b) structurally valid inputs for this item on board g?
 * Sonar: a centre, 1 cell from every edge. Torpedo: a line 0..n-1, b edge 0–3.
 * Cross: a centre anywhere. Line: a left/top end, b 0 across / 1 down, must fit.
 * Airstrike: a centre, b 0 "\" / 1 "/", 2 cells from every edge.
 */
export function itemParamsValid(g: Geo, item: number, a: number, b: number): boolean {
  const n = g.n;
  const r = row(a, n);
  const c = a % n;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  if (item === TORPEDO) return a < n && b < 4;
  if (a >= n * n) return false;
  if (item === LINE) return b ? b === 1 && r <= n - 5 : c <= n - 5;
  if (item === AIRSTRIKE) return b < 2 && within(r, 2, n - 3) && within(c, 2, n - 3);
  return !b && (item === CROSS || (item === SONAR && within(r, 1, n - 2) && within(c, 1, n - 2)));
}

/** Torpedo travel order: b 0 from left / 1 from right along row a; 2 from top / 3 from bottom along column a. Stops short of the first island. */
export function torpedoLine(g: Geo, a: number, b: number): Cell[] {
  const n = g.n;
  const line = Array.from({ length: n }, (_, i) => {
    const j = b & 1 ? n - 1 - i : i;
    return b < 2 ? a * n + j : j * n + a;
  });
  const stop = line.findIndex((c) => g.islands.has(c));
  return stop < 0 ? line : line.slice(0, stop);
}

/**
 * Footprint cells in canonical order. Assumes itemParamsValid. Area items skip
 * islands; the sonar keeps its full 3×3 (centre at index 4).
 */
export function footprint(g: Geo, item: ItemId, a: number, b: number): Cell[] {
  const n = g.n;
  const c = a % n;
  if (item === SONAR) return [-n - 1, -n, -n + 1, -1, 0, 1, n - 1, n, n + 1].map((d) => a + d);
  if (item === TORPEDO) return torpedoLine(g, a, b);
  const d = item === LINE ? (b ? n : 1) : b ? n - 1 : n + 1;
  const cells =
    item === CROSS
      ? ([a, a >= n && a - n, c < n - 1 && a + 1, a < n * (n - 1) && a + n, c > 0 && a - 1].filter((x) => x !== false) as Cell[])
      : [0, 1, 2, 3, 4].map((i) => a + (item === LINE ? i : i - 2) * d);
  return cells.filter((x) => !g.islands.has(x));
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampAt = (g: Geo, cell: Cell, lo: number, hiR: number, hiC = hiR) => clamp(row(cell, g.n), lo, hiR) * g.n + clamp(cell % g.n, lo, hiC);
/** Clamp a hovered cell to a valid sonar centre. */
export const clampSonar = (g: Geo, cell: Cell): Cell => clampAt(g, cell, 1, g.n - 2);
/** Clamp a hovered cell to a valid line-strike start. */
export const clampLine = (g: Geo, cell: Cell, vertical: boolean): Cell => (vertical ? clampAt(g, cell, 0, g.n - 5, g.n - 1) : clampAt(g, cell, 0, g.n - 1, g.n - 5));
/** Clamp a hovered cell to a valid airstrike centre. */
export const clampAirstrike = (g: Geo, cell: Cell): Cell => clampAt(g, cell, 2, g.n - 3);
