import { seededRng } from './seeded';
import type { Cell, Config, Fleet, Geo, Mode, Ship, Size, Timer } from './types';

export const MODE_NAMES = ['Classic', 'Salvo', 'Items', 'Russian'] as const;
export const RUSSIAN: Mode = 3;
export const SIZES = [8, 10, 12, 14] as const;
export const SIZE_NAMES = ['Small', 'Classic', 'Large', 'Huge'] as const;
export const TIMERS: readonly Timer[] = [0, 15, 30, 60];
export const DEFAULT_CONFIG: Config = { mode: 0, extraShot: false, noTouch: false, timer: 0, size: 1, seed: 0 };

// Fleet per board size (lengths, names), then the Russian fleet: 1×4, 2×3, 3×2, 4×1.
const FLEETS = ['4332', '54332', '5433322', '54433322', '4332221111'];
const NAMES = [
  'Battleship,Cruiser,Submarine,Destroyer',
  'Carrier,Battleship,Cruiser,Submarine,Destroyer',
  'Carrier,Battleship,Cruiser,Submarine,Frigate,Destroyer,Patrol boat',
  'Carrier,Battleship,Battlecruiser,Cruiser,Submarine,Frigate,Destroyer,Patrol boat',
  'Battleship,Cruiser,Cruiser,Destroyer,Destroyer,Destroyer,Boat,Boat,Boat,Boat',
];
/** Islands per board size. */
const ISLANDS = [0, 0, 3, 5];

/** Row of a cell on an n-wide board. */
export const row = (c: Cell, n: number): number => (c - (c % n)) / n;

/** 8-neighbourhood of a cell (on board, excluding the cell). */
export const neighbours8 = (c: Cell, n: number): Cell[] =>
  [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1].map((d) => c + d).filter((x) => x >= 0 && x < n * n && Math.abs((x % n) - (c % n)) < 2);

/**
 * Deterministic islands: `count` blobs of 2–4 cells, off the edge rows and
 * columns, at least two cells of water apart. Both players derive the same set
 * from the seed in the config.
 */
export function makeIslands(n: number, count: number, seed: number): Set<Cell> {
  const rng = seededRng(seed * 31 + n);
  const out = new Set<Cell>();
  const inner = () => 1 + rng(n - 2);
  for (let k = 0, tries = 0; k < count && tries < 200; tries++) {
    const blob = [inner() * n + inner()];
    for (let want = 2 + rng(3), steps = 0; blob.length < want && steps < 20; steps++) {
      const c = blob[rng(blob.length)]!;
      const [r, col] = [row(c, n), c % n];
      const d = rng(4);
      const [dr, dc] = d < 2 ? [d * 2 - 1, 0] : [0, d * 2 - 5];
      const x = (r + dr) * n + col + dc;
      if (r + dr > 0 && r + dr < n - 1 && col + dc > 0 && col + dc < n - 1 && !blob.includes(x)) blob.push(x);
    }
    const far = (a: Cell, b: Cell) => Math.abs(row(a, n) - row(b, n)) > 2 || Math.abs((a % n) - (b % n)) > 2;
    if (blob.every((c) => [...out].every((o) => far(c, o)))) {
      blob.forEach((c) => out.add(c));
      k++;
    }
  }
  return out;
}

/** Fill in the settings other settings imply: Russian is 10×10, no touching, hit shoots again; Salvo has no extra shot. */
export function normConfig(c: Config): Config {
  const ru = c.mode === RUSSIAN;
  return { ...c, extraShot: ru || (c.mode !== 1 && c.extraShot), noTouch: ru || c.noTouch, size: ru ? 1 : c.size, seed: c.seed & 0xffff };
}

const geos = new Map<string, Geo>();
/** The board a config is played on (memoised: the same object for the same rules). */
export function geoOf(config: Config): Geo {
  const c = normConfig(config);
  const f = c.mode === RUSSIAN ? 4 : c.size;
  const key = [f, c.size, c.size > 1 ? c.seed : 0, c.noTouch].join();
  let g = geos.get(key);
  if (!g) {
    const n = SIZES[c.size];
    const fleet = [...FLEETS[f]!].map(Number);
    g = { n, fleet, names: NAMES[f]!.split(','), islands: makeIslands(n, ISLANDS[c.size]!, c.seed), total: fleet.reduce((a, b) => a + b), noTouch: c.noTouch };
    geos.set(key, g);
  }
  return g;
}

/** Cells covered by ship i, or null if it leaves the board. */
export function shipCells(g: Geo, { anchor: a, vertical: v }: Ship, i: number): Cell[] | null {
  const n = g.n;
  const len = g.fleet[i]!;
  return Number.isInteger(a) && a >= 0 && a < n * n && (v ? row(a, n) : a % n) + len <= n ? Array.from({ length: len }, (_, k) => a + (v ? n * k : k)) : null;
}

/**
 * Occupancy grid: ship index per cell or -1. Null if any ship is off the board,
 * on an island, ships overlap, or (noTouch) ships touch, diagonals included.
 * Works for the first k ships of a fleet too.
 */
export function occupancy(g: Geo, fleet: Fleet, noTouch = g.noTouch): Int8Array | null {
  const n = g.n;
  const occ = new Int8Array(n * n).fill(-1);
  for (let i = 0; i < fleet.length; i++) {
    const cells = shipCells(g, fleet[i]!, i);
    if (!cells) return null;
    for (const c of cells) {
      if (occ[c]! >= 0 || g.islands.has(c)) return null;
      occ[c] = i;
    }
  }
  return noTouch && occ.some((s, c) => s >= 0 && neighbours8(c, n).some((x) => occ[x]! >= 0 && occ[x] !== s)) ? null : occ;
}

export const fleetLegal = (g: Geo, fleet: Fleet): boolean => fleet.length === g.fleet.length && !!occupancy(g, fleet);

/** Can ship i be placed at `ship` given the rest of the fleet? */
export const canPlace = (g: Geo, fleet: Fleet, i: number, ship: Ship): boolean => fleetLegal(g, fleet.map((s, k) => (k === i ? ship : s)));

export const encodeConfig = (c: Config): number[] => [c.mode, +c.extraShot | (+c.noTouch << 1), c.timer, c.size, c.seed >> 8, c.seed & 255];

export function decodeConfig(b: ArrayLike<number>): Config | null {
  const [mode = 9, flags = 9, timer = 9, size = 9, hi = 0, lo = 0] = Array.from(b);
  return b.length !== 6 || mode > 3 || flags > 3 || size > 3 || !TIMERS.includes(timer as Timer)
    ? null
    : normConfig({ mode: mode as Mode, extraShot: !!(flags & 1), noTouch: !!(flags & 2), timer: timer as Timer, size: size as Size, seed: (hi << 8) | lo });
}

export function rulesLine(config: Config): string {
  const c = normConfig(config);
  const n = SIZES[c.size];
  return [MODE_NAMES[c.mode], c.size !== 1 && `${SIZE_NAMES[c.size]} ${n}×${n}`, c.extraShot && 'Extra shot after a hit', c.noTouch && "Ships can't touch", c.timer ? c.timer + ' s turns' : 'No timer']
    .filter(Boolean)
    .join(' · ');
}
