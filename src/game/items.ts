import { row } from './rules';
import type { Cell, ItemId } from './types';

export interface ItemDef {
  id: ItemId;
  name: string;
  cost: number;
  desc: string;
}

export const ITEMS: readonly ItemDef[] = [
  ['Sonar', 'Counts ship cells in a 3×3 area'],
  ['Torpedo', 'Runs along a line, hits the first ship'],
  ['Cross bomb', 'Hits a plus of 5 cells'],
  ['Line strike', 'Hits 5 cells in a row'],
].map(([name, desc], id) => ({ id: id as ItemId, name: name!, cost: id + 2, desc: desc! }));

export const ENERGY_CAP = 6;
export const SONAR = 0;
export const TORPEDO = 1;
const CROSS = 2;
const LINE = 3;

const inner = (n: number) => n >= 1 && n <= 8;

/** Are (a, b) structurally valid inputs for this item? */
export function itemParamsValid(item: number, a: number, b: number): boolean {
  const r = row(a);
  const c = a % 10;
  return (
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    a >= 0 &&
    (item === TORPEDO ? a < 10 && b >= 0 && b < 4 : a < 100 && (item === LINE ? (b ? b === 1 && r < 6 : c < 6) : !b && (item === CROSS || (item === SONAR && inner(r) && inner(c)))))
  );
}

/** Torpedo travel order: b 0 from left / 1 from right along row a; 2 from top / 3 from bottom along column a. */
export const torpedoLine = (a: number, b: number): Cell[] =>
  Array.from({ length: 10 }, (_, i) => {
    const j = b & 1 ? 9 - i : i;
    return b < 2 ? a * 10 + j : j * 10 + a;
  });

/** Footprint cells in canonical order. Assumes itemParamsValid. */
export function footprint(item: ItemId, a: number, b: number): Cell[] {
  const c = a % 10;
  if (item === SONAR) return [-11, -10, -9, -1, 0, 1, 9, 10, 11].map((d) => a + d);
  if (item === TORPEDO) return torpedoLine(a, b);
  if (item === LINE) return [0, 1, 2, 3, 4].map((i) => a + (b ? i * 10 : i));
  return [a, a > 9 && a - 10, c < 9 && a + 1, a < 90 && a + 10, c > 0 && a - 1].filter((x) => x !== false) as Cell[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Clamp a hovered cell to a valid sonar centre. */
export const clampSonar = (cell: Cell): Cell => clamp(row(cell), 1, 8) * 10 + clamp(cell % 10, 1, 8);
/** Clamp a hovered cell to a valid line-strike start. */
export const clampLine = (cell: Cell, vertical: boolean): Cell => (vertical ? Math.min(row(cell), 5) * 10 + (cell % 10) : cell - (cell % 10) + Math.min(cell % 10, 5));
