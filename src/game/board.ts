import type { Cell, Fleet, Ship } from './types';

const COLS = 'ABCDEFGHIJ';

export const encodeShip = (s: Ship): number => s.anchor | (s.vertical ? 128 : 0);
export const decodeShip = (b: number): Ship | null => ((b & 127) > 99 ? null : { anchor: b & 127, vertical: b > 127 });
export const encodeFleet = (f: Fleet): Uint8Array => Uint8Array.from(f.map(encodeShip));

export function decodeFleet(bytes: ArrayLike<number>): Fleet | null {
  const f = Array.from(bytes, decodeShip);
  return f.length === 5 && f.every(Boolean) ? (f as Fleet) : null;
}

/** 62 -> "C7" */
export const cellName = (c: Cell): string => COLS[c % 10]! + (Math.floor(c / 10) + 1);

/** "C7" -> 62, or -1 */
export function parseCell(s: string): Cell {
  const m = /^([A-J])(10|[1-9])$/i.exec(s.trim());
  return m ? (+m[2]! - 1) * 10 + COLS.indexOf(m[1]!.toUpperCase()) : -1;
}
