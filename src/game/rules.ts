import type { Cell, Config, Fleet, Mode, Ship, Timer } from './types';

export const FLEET = [5, 4, 3, 3, 2] as const;
export const SHIP_NAMES = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'] as const;
export const TOTAL_SHIP_CELLS = 17;
export const MODE_NAMES = ['Classic', 'Salvo', 'Items'] as const;
export const TIMERS: readonly Timer[] = [0, 15, 30, 60];

export const DEFAULT_CONFIG: Config = { mode: 0, extraShot: false, noTouch: false, timer: 0 };

/** Cells covered by a ship of length `len`, or null if it leaves the board. */
export function shipCells(ship: Ship, len: number): Cell[] | null {
  const { anchor, vertical } = ship;
  if (!Number.isInteger(anchor) || anchor < 0 || anchor > 99) return null;
  const r = Math.floor(anchor / 10);
  const c = anchor % 10;
  if (vertical ? r + len > 10 : c + len > 10) return null;
  const out: Cell[] = [];
  for (let i = 0; i < len; i++) out.push(anchor + (vertical ? i * 10 : i));
  return out;
}

/** 8-neighbourhood of a cell (on board, excluding the cell). */
export function neighbours8(cell: Cell): Cell[] {
  const r = Math.floor(cell / 10);
  const c = cell % 10;
  const out: Cell[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < 10 && cc >= 0 && cc < 10) out.push(rr * 10 + cc);
    }
  return out;
}

/**
 * Occupancy grid: ship index per cell or -1. Returns null if any ship is out of
 * bounds, ships overlap, or (noTouch) ships touch, including diagonally.
 * `skip` ignores one ship (used while dragging it).
 */
export function occupancy(fleet: Fleet, noTouch: boolean, skip = -1): Int8Array | null {
  return fleet.length === FLEET.length ? occupancyPartial(fleet, noTouch, skip) : null;
}

/** Same as occupancy() but for the first n ships of the fleet (n <= 5). */
export function occupancyPartial(fleet: Fleet, noTouch: boolean, skip = -1): Int8Array | null {
  if (fleet.length > FLEET.length) return null;
  const occ = new Int8Array(100).fill(-1);
  for (let i = 0; i < fleet.length; i++) {
    if (i === skip) continue;
    const cells = shipCells(fleet[i]!, FLEET[i]!);
    if (!cells) return null;
    for (const cell of cells) {
      if (occ[cell] !== -1) return null;
      occ[cell] = i;
    }
  }
  if (noTouch) {
    for (let cell = 0; cell < 100; cell++) {
      const s = occ[cell]!;
      if (s < 0) continue;
      for (const n of neighbours8(cell)) {
        const o = occ[n]!;
        if (o >= 0 && o !== s) return null;
      }
    }
  }
  return occ;
}

export const fleetLegal = (fleet: Fleet, noTouch: boolean): boolean => occupancy(fleet, noTouch) !== null;

/** Can ship i be placed at `ship` given the rest of the fleet? */
export function canPlace(fleet: Fleet, i: number, ship: Ship, noTouch: boolean): boolean {
  const next = fleet.slice();
  next[i] = ship;
  return occupancy(next, noTouch) !== null;
}

export function configFlags(c: Config): number {
  return (c.extraShot ? 1 : 0) | (c.noTouch ? 2 : 0);
}

export function encodeConfig(c: Config): [number, number, number] {
  return [c.mode, configFlags(c), c.timer];
}

export function decodeConfig(mode: number, flags: number, timer: number): Config | null {
  if (mode > 2 || flags > 3 || !TIMERS.includes(timer as Timer)) return null;
  return {
    mode: mode as Mode,
    // Extra shot only exists in Classic.
    extraShot: mode === 0 && (flags & 1) === 1,
    noTouch: (flags & 2) === 2,
    timer: timer as Timer,
  };
}

export function rulesLine(c: Config): string {
  const parts: string[] = [MODE_NAMES[c.mode]];
  if (c.mode === 0 && c.extraShot) parts.push('Extra shot after a hit');
  if (c.noTouch) parts.push("Ships can't touch");
  parts.push(c.timer ? `${c.timer} s turns` : 'No timer');
  return parts.join(' · ');
}
