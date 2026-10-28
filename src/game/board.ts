import type { Cell, Fleet, Ship } from './types';

const COLS = 'ABCDEFGHIJ';

export const encodeShip = (s: Ship): number => s.anchor | (s.vertical ? 128 : 0);

export function decodeShip(b: number): Ship | null {
  const anchor = b & 127;
  if (anchor > 99) return null;
  return { anchor, vertical: b >= 128 };
}

export const encodeFleet = (f: Fleet): Uint8Array => Uint8Array.from(f.map(encodeShip));

export function decodeFleet(bytes: ArrayLike<number>): Fleet | null {
  if (bytes.length !== 5) return null;
  const out: Fleet = [];
  for (let i = 0; i < 5; i++) {
    const s = decodeShip(bytes[i]!);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/** 62 -> "C7" */
export const cellName = (c: Cell): string => COLS[c % 10]! + (Math.floor(c / 10) + 1);

/** "C7" -> 62, or -1 */
export function parseCell(s: string): Cell {
  const m = /^([A-J])(10|[1-9])$/i.exec(s.trim());
  if (!m) return -1;
  return (+m[2]! - 1) * 10 + COLS.indexOf(m[1]!.toUpperCase());
}

export const rowOf = (c: Cell): number => Math.floor(c / 10);
export const colOf = (c: Cell): number => c % 10;
