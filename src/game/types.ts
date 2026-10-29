/** Cell index 0..n²-1, row * n + col (n: board side, see Geo). */
export type Cell = number;
/** A placed ship: top-left anchor cell and orientation. Length comes from Geo.fleet[i]. */
export interface Ship {
  anchor: Cell;
  vertical: boolean;
}
/** One ship per Geo.fleet entry, in that order. */
export type Fleet = Ship[];
export type Mode = 0 | 1 | 2 | 3; // classic, salvo, items, russian
export type Timer = 0 | 15 | 30 | 60;
/** Board size index: 0 small 8×8, 1 classic 10×10, 2 large 12×12, 3 huge 14×14. */
export type Size = 0 | 1 | 2 | 3;
export interface Config {
  mode: Mode;
  extraShot: boolean;
  noTouch: boolean;
  timer: Timer;
  size: Size;
  /** Island layout seed (0..65535), chosen by the host. */
  seed: number;
}
/** Everything about the board that follows from a Config (rules.geoOf). */
export interface Geo {
  /** Side length. */
  n: number;
  /** Ship lengths, in fleet order. */
  fleet: readonly number[];
  names: readonly string[];
  /** Cells that hold no ship and can't be fired at. */
  islands: ReadonlySet<Cell>;
  /** Total ship cells. */
  total: number;
  noTouch: boolean;
}
export type ItemId = 0 | 1 | 2 | 3 | 4;
export type Attack =
  | { k: 'fire'; cells: Cell[] }
  | { k: 'item'; item: ItemId; a: number; b: number };
/** code: 0 miss, 1 hit, 2 + i sunk ship i (then `ship` is set). */
export interface Entry {
  cell: Cell;
  code: number;
  ship?: Ship;
}
export type Answer = { k: 'cells'; entries: Entry[] } | { k: 'sonar'; count: number };
/** Pseudo-random int in [0, n). */
export type Rng = (n: number) => number;
