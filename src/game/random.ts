import { FLEET, occupancy } from './rules';
import type { Fleet, Rng } from './types';

export const cryptoRng: Rng = (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;

/** Random legal fleet: rejection sampling per ship, restarting on dead ends. */
export function randomFleet(noTouch: boolean, rng: Rng = cryptoRng): Fleet {
  for (;;) {
    const fleet: Fleet = [];
    for (let tries = 0; tries < 1000 && fleet.length < FLEET.length; tries++) {
      fleet.push({ anchor: rng(100), vertical: rng(2) === 1 });
      if (!occupancy(fleet, noTouch)) fleet.pop();
    }
    if (fleet.length === FLEET.length) return fleet;
  }
}
