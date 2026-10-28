import type { Cell, Config, Fleet, Mode, Ship, Timer } from './types';

export const FLEET = [5, 4, 3, 3, 2] as const;
export const SHIP_NAMES = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'] as const;
export const TOTAL_SHIP_CELLS = 17;
export const MODE_NAMES = ['Classic', 'Salvo', 'Items'] as const;
export const TIMERS: readonly Timer[] = [0, 15, 30, 60];
export const DEFAULT_CONFIG: Config = { mode: 0, extraShot: false, noTouch: false, timer: 0 };

/** Row of a cell (0..9). */
export const row = (c: Cell): number => (c - (c % 10)) / 10;

/** Cells covered by a ship of length `len`, or null if it leaves the board. */
export function shipCells({ anchor: a, vertical: v }: Ship, len: number): Cell[] | null {
  return Number.isInteger(a) && a >= 0 && a < 100 && (v ? row(a) : a % 10) + len <= 10 ? Array.from({ length: len }, (_, i) => a + (v ? 10 * i : i)) : null;
}

/** 8-neighbourhood of a cell (on board, excluding the cell). */
export const neighbours8 = (c: Cell): Cell[] => [-11, -10, -9, -1, 1, 9, 10, 11].map((d) => c + d).filter((n) => n >= 0 && n < 100 && Math.abs((n % 10) - (c % 10)) < 2);

/**
 * Occupancy grid: ship index per cell or -1. Null if any ship is off the board,
 * ships overlap, or (noTouch) ships touch, diagonals included. Works for the
 * first n ships of a fleet too.
 */
export function occupancy(fleet: Fleet, noTouch: boolean): Int8Array | null {
  const occ = new Int8Array(100).fill(-1);
  for (let i = 0; i < fleet.length; i++) {
    const cells = shipCells(fleet[i]!, FLEET[i]!);
    if (!cells) return null;
    for (const c of cells) {
      if (occ[c]! >= 0) return null;
      occ[c] = i;
    }
  }
  return noTouch && occ.some((s, c) => s >= 0 && neighbours8(c).some((n) => occ[n]! >= 0 && occ[n] !== s)) ? null : occ;
}

export const fleetLegal = (fleet: Fleet, noTouch: boolean): boolean => fleet.length === 5 && !!occupancy(fleet, noTouch);

/** Can ship i be placed at `ship` given the rest of the fleet? */
export const canPlace = (fleet: Fleet, i: number, ship: Ship, noTouch: boolean): boolean => fleetLegal(fleet.map((s, k) => (k === i ? ship : s)), noTouch);

export const configFlags = (c: Config): number => +c.extraShot | (+c.noTouch << 1);
export const encodeConfig = (c: Config): [number, number, number] => [c.mode, configFlags(c), c.timer];

export const decodeConfig = (mode: number, flags: number, timer: number): Config | null =>
  mode > 2 || flags > 3 || !TIMERS.includes(timer as Timer)
    ? null
    : // Extra shot only exists in Classic.
      { mode: mode as Mode, extraShot: !mode && !!(flags & 1), noTouch: !!(flags & 2), timer: timer as Timer };

export const rulesLine = (c: Config): string =>
  [MODE_NAMES[c.mode], !c.mode && c.extraShot && 'Extra shot after a hit', c.noTouch && "Ships can't touch", c.timer ? c.timer + ' s turns' : 'No timer'].filter(Boolean).join(' · ');
