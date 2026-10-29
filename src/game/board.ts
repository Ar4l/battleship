import type { Cell, Fleet, Ship } from './types';

const COLS = 'ABCDEFGHIJKLMN';

/** Two bytes per ship: anchor, vertical. */
export const encodeShip = (s: Ship): number[] => [s.anchor, +s.vertical];
export const decodeShip = (a: number, v: number): Ship | null => (v < 2 ? { anchor: a, vertical: v === 1 } : null);
export const encodeFleet = (f: Fleet): Uint8Array => Uint8Array.from(f.flatMap(encodeShip));

/** Shape only (1–10 ships); the rules check the count and placement. */
export function decodeFleet(bytes: ArrayLike<number>): Fleet | null {
  const b = Array.from(bytes);
  const f = b.flatMap((a, i) => (i & 1 ? [] : [decodeShip(a, b[i + 1] ?? 9)]));
  return b.length && b.length <= 20 && f.every(Boolean) ? (f as Fleet) : null;
}

/** 62 -> "C7" on a 10-wide board. */
export const cellName = (c: Cell, n = 10): string => COLS[c % n]! + (Math.floor(c / n) + 1);

/** "C7" -> 62, or -1 */
export function parseCell(s: string, n = 10): Cell {
  const m = /^([A-N])(\d\d?)$/i.exec(s.trim());
  const col = m ? COLS.indexOf(m[1]!.toUpperCase()) : n;
  const r = m ? +m[2]! - 1 : n;
  return col < n && r >= 0 && r < n ? r * n + col : -1;
}
