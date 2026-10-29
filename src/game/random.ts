import { occupancy } from './rules';
import type { Fleet, Geo, Rng } from './types';

export const cryptoRng: Rng = (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;

/** Random legal fleet (islands and no-touch respected): rejection sampling per ship, restarting on dead ends. */
export function randomFleet(g: Geo, rng: Rng = cryptoRng): Fleet {
  for (;;) {
    const fleet: Fleet = [];
    for (let tries = 0; tries < 1000 && fleet.length < g.fleet.length; tries++) {
      fleet.push({ anchor: rng(g.n * g.n), vertical: rng(2) === 1 });
      if (!occupancy(g, fleet)) fleet.pop();
    }
    if (fleet.length === g.fleet.length) return fleet;
  }
}
