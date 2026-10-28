import { describe, expect, it } from 'vitest';
import { canPlace, decodeConfig, encodeConfig, fleetLegal, occupancy, rulesLine, shipCells } from '../../src/game/rules';
import { cellName, decodeFleet, encodeFleet, parseCell } from '../../src/game/board';
import { randomFleet, seededRng } from '../../src/game/random';
import type { Config } from '../../src/game/types';
import { FLEET_A, FLEET_B } from './helpers';

describe('rules', () => {
  it('ship cells and bounds', () => {
    expect(shipCells({ anchor: 0, vertical: false }, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(shipCells({ anchor: 5, vertical: false }, 5)).toEqual([5, 6, 7, 8, 9]);
    expect(shipCells({ anchor: 6, vertical: false }, 5)).toBeNull();
    expect(shipCells({ anchor: 50, vertical: true }, 5)).toEqual([50, 60, 70, 80, 90]);
    expect(shipCells({ anchor: 60, vertical: true }, 5)).toBeNull();
    expect(shipCells({ anchor: 100, vertical: false }, 2)).toBeNull();
  });
  it('overlap and no-touch including diagonals', () => {
    expect(fleetLegal(FLEET_A, false)).toBe(true);
    expect(fleetLegal(FLEET_A, true)).toBe(true);
    expect(fleetLegal(FLEET_B, true)).toBe(true);
    const overlap = FLEET_A.slice();
    overlap[4] = { anchor: 2, vertical: true }; // crosses the carrier
    expect(fleetLegal(overlap, false)).toBe(false);
    const touching = FLEET_A.slice();
    touching[1] = { anchor: 10, vertical: false }; // directly below carrier
    expect(fleetLegal(touching, false)).toBe(true);
    expect(fleetLegal(touching, true)).toBe(false);
    const diagonal = FLEET_A.slice();
    diagonal[4] = { anchor: 15, vertical: false }; // F2: diagonal to carrier end E1
    expect(fleetLegal(diagonal, false)).toBe(true);
    expect(fleetLegal(diagonal, true)).toBe(false);
    expect(canPlace(FLEET_A, 4, { anchor: 15, vertical: false }, true)).toBe(false);
    expect(canPlace(FLEET_A, 4, { anchor: 16, vertical: false }, true)).toBe(true);
    expect(occupancy(FLEET_A.slice(0, 4), false)).toBeNull();
  });
  it('config bytes round-trip', () => {
    const cs: Config[] = [
      { mode: 0, extraShot: true, noTouch: true, timer: 30 },
      { mode: 1, extraShot: false, noTouch: false, timer: 0 },
      { mode: 2, extraShot: false, noTouch: true, timer: 60 },
    ];
    for (const c of cs) expect(decodeConfig(...encodeConfig(c))).toEqual(c);
    expect(decodeConfig(3, 0, 0)).toBeNull();
    expect(decodeConfig(0, 4, 0)).toBeNull();
    expect(decodeConfig(0, 0, 20)).toBeNull();
    // extra shot is Classic-only
    expect(decodeConfig(1, 1, 0)!.extraShot).toBe(false);
    expect(rulesLine(cs[1]!)).toBe('Salvo · No timer');
    expect(rulesLine({ mode: 1, extraShot: false, noTouch: true, timer: 30 })).toBe("Salvo · Ships can't touch · 30 s turns");
  });
});

describe('board', () => {
  it('fleet 5-byte round-trip', () => {
    const b = encodeFleet(FLEET_B);
    expect(b.length).toBe(5);
    expect(b[0]).toBe(9 | 128);
    expect(decodeFleet(b)).toEqual(FLEET_B);
    expect(decodeFleet([1, 2, 3])).toBeNull();
    expect(decodeFleet([100, 0, 0, 0, 0])).toBeNull();
  });
  it('cell names', () => {
    expect(cellName(62)).toBe('C7');
    expect(parseCell('C7')).toBe(62);
    expect(cellName(0)).toBe('A1');
    expect(cellName(99)).toBe('J10');
    expect(parseCell('j10')).toBe(99);
    expect(parseCell('K1')).toBe(-1);
  });
});

describe('random', () => {
  it('2000 random fleets are legal, with and without no-touch', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 1000; i++) expect(fleetLegal(randomFleet(false, rng), false)).toBe(true);
    for (let i = 0; i < 1000; i++) expect(fleetLegal(randomFleet(true, rng), true)).toBe(true);
  });
  it('seeded rng is deterministic', () => {
    expect(randomFleet(false, seededRng(7))).toEqual(randomFleet(false, seededRng(7)));
    expect(fleetLegal(randomFleet(true), true)).toBe(true);
  });
});
