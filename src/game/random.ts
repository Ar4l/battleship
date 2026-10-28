import { FLEET, occupancyPartial } from './rules';
import type { Fleet, Rng } from './types';

export const cryptoRng: Rng = (n) => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % n;
};

/** Deterministic rng (mulberry32) for tests and debug seeding. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return (n) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

/** Random legal fleet: rejection sampling per ship, restarting on dead ends. */
export function randomFleet(noTouch: boolean, rng: Rng = cryptoRng): Fleet {
  for (;;) {
    const fleet: Fleet = [];
    for (let i = 0; i < FLEET.length; i++) {
      for (let tries = 0; tries < 200; tries++) {
        const ship = { anchor: rng(100), vertical: rng(2) === 1 };
        fleet.push(ship);
        if (occupancyPartial(fleet, noTouch)) break;
        fleet.pop();
      }
      if (fleet.length !== i + 1) break;
    }
    if (fleet.length === FLEET.length) return fleet;
  }
}
