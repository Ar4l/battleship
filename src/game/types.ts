/** Cell index 0..99, row * 10 + col. */
export type Cell = number;
/** A placed ship: top-left anchor cell and orientation. Length comes from FLEET[i]. */
export interface Ship {
  anchor: Cell;
  vertical: boolean;
}
/** Exactly 5 ships in FLEET order. */
export type Fleet = Ship[];
export type Mode = 0 | 1 | 2; // classic, salvo, items
export type Timer = 0 | 15 | 30 | 60;
export interface Config {
  mode: Mode;
  extraShot: boolean;
  noTouch: boolean;
  timer: Timer;
}
export type ItemId = 0 | 1 | 2 | 3;
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
