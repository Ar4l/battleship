import type { Fleet } from '../../src/game/types';
// Rows 0,2,4,6,8 horizontal from column 0:  A1-E1, A3-D3, A5-C5, A7-C7, A9-B9
export const FLEET_A: Fleet = [
  { anchor: 0, vertical: false },
  { anchor: 20, vertical: false },
  { anchor: 40, vertical: false },
  { anchor: 60, vertical: false },
  { anchor: 80, vertical: false },
];
// Columns 9,7,5,3,1 vertical from row 0
export const FLEET_B: Fleet = [
  { anchor: 9, vertical: true },
  { anchor: 7, vertical: true },
  { anchor: 5, vertical: true },
  { anchor: 3, vertical: true },
  { anchor: 1, vertical: true },
];

import { DEFAULT_CONFIG, geoOf } from '../../src/game/rules';
import type { Config } from '../../src/game/types';
export const cfgOf = (c: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...c });
/** Classic 10×10 board, and the same with no-touch. */
export const G = geoOf(DEFAULT_CONFIG);
export const GT = geoOf(cfgOf({ noTouch: true }));
