import type { Cell, ItemId } from './types';

export interface ItemDef {
  id: ItemId;
  name: string;
  cost: number;
  desc: string;
}

export const ITEMS: readonly ItemDef[] = [
  { id: 0, name: 'Sonar', cost: 2, desc: 'Counts ship cells in a 3×3 area' },
  { id: 1, name: 'Torpedo', cost: 3, desc: 'Runs along a line, hits the first ship' },
  { id: 2, name: 'Cross bomb', cost: 4, desc: 'Hits a plus of 5 cells' },
  { id: 3, name: 'Line strike', cost: 5, desc: 'Hits 5 cells in a row' },
];

export const ENERGY_CAP = 6;
export const SONAR = 0;
export const TORPEDO = 1;
export const CROSS = 2;
export const LINE = 3;

/** Are (a, b) structurally valid inputs for this item? */
export function itemParamsValid(item: number, a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  const r = Math.floor(a / 10);
  const c = a % 10;
  switch (item) {
    case SONAR:
      return a >= 0 && a < 100 && b === 0 && r >= 1 && r <= 8 && c >= 1 && c <= 8;
    case TORPEDO:
      return a >= 0 && a <= 9 && b >= 0 && b <= 3;
    case CROSS:
      return a >= 0 && a < 100 && b === 0;
    case LINE:
      return a >= 0 && a < 100 && (b === 0 ? c <= 5 : b === 1 ? r <= 5 : false);
    default:
      return false;
  }
}

/** Torpedo travel order: b 0 from left / 1 from right along row a; 2 from top / 3 from bottom along column a. */
export function torpedoLine(a: number, b: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < 10; i++) {
    const j = b === 1 || b === 3 ? 9 - i : i;
    out.push(b <= 1 ? a * 10 + j : j * 10 + a);
  }
  return out;
}

/** Footprint cells in canonical order. Assumes itemParamsValid. */
export function footprint(item: ItemId, a: number, b: number): Cell[] {
  const r = Math.floor(a / 10);
  const c = a % 10;
  switch (item) {
    case SONAR: {
      const out: Cell[] = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push((r + dr) * 10 + c + dc);
      return out;
    }
    case TORPEDO:
      return torpedoLine(a, b);
    case CROSS: {
      const out: Cell[] = [a];
      if (r > 0) out.push(a - 10);
      if (c < 9) out.push(a + 1);
      if (r < 9) out.push(a + 10);
      if (c > 0) out.push(a - 1);
      return out;
    }
    case LINE:
      return Array.from({ length: 5 }, (_, i) => a + (b ? i * 10 : i));
  }
}

/** Clamp a hovered cell to a valid sonar centre. */
export function clampSonar(cell: Cell): Cell {
  const r = Math.min(8, Math.max(1, Math.floor(cell / 10)));
  const c = Math.min(8, Math.max(1, cell % 10));
  return r * 10 + c;
}

/** Clamp a hovered cell to a valid line-strike start. */
export function clampLine(cell: Cell, vertical: boolean): Cell {
  const r = Math.floor(cell / 10);
  const c = cell % 10;
  return vertical ? Math.min(r, 5) * 10 + c : r * 10 + Math.min(c, 5);
}
