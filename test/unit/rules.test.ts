import { describe, expect, it } from 'vitest';
import { canPlace, decodeConfig, encodeConfig, fleetLegal, geoOf, makeIslands, occupancy, rulesLine, shipCells } from '../../src/game/rules';
import { cellName, decodeFleet, encodeFleet, parseCell } from '../../src/game/board';
import { randomFleet } from '../../src/game/random';
import { seededRng } from '../../src/game/seeded';
import type { Config } from '../../src/game/types';
import { FLEET_A, FLEET_B, G, GT, cfgOf } from './helpers';

describe('rules', () => {
  it('ship cells and bounds', () => {
    expect(shipCells(G, { anchor: 0, vertical: false }, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(shipCells(G, { anchor: 5, vertical: false }, 0)).toEqual([5, 6, 7, 8, 9]);
    expect(shipCells(G, { anchor: 6, vertical: false }, 0)).toBeNull();
    expect(shipCells(G, { anchor: 50, vertical: true }, 0)).toEqual([50, 60, 70, 80, 90]);
    expect(shipCells(G, { anchor: 60, vertical: true }, 0)).toBeNull();
    expect(shipCells(G, { anchor: 100, vertical: false }, 4)).toBeNull();
    expect(shipCells(G, { anchor: 0, vertical: false }, 5)).toBeNull();
  });
  it('overlap and no-touch including diagonals', () => {
    expect(fleetLegal(G, FLEET_A)).toBe(true);
    expect(fleetLegal(GT, FLEET_A)).toBe(true);
    expect(fleetLegal(GT, FLEET_B)).toBe(true);
    const overlap = FLEET_A.slice();
    overlap[4] = { anchor: 2, vertical: true }; // crosses the carrier
    expect(fleetLegal(G, overlap)).toBe(false);
    const touching = FLEET_A.slice();
    touching[1] = { anchor: 10, vertical: false }; // directly below carrier
    expect(fleetLegal(G, touching)).toBe(true);
    expect(fleetLegal(GT, touching)).toBe(false);
    const diagonal = FLEET_A.slice();
    diagonal[4] = { anchor: 15, vertical: false }; // F2: diagonal to carrier end E1
    expect(fleetLegal(G, diagonal)).toBe(true);
    expect(fleetLegal(GT, diagonal)).toBe(false);
    expect(canPlace(GT, FLEET_A, 4, { anchor: 15, vertical: false })).toBe(false);
    expect(canPlace(GT, FLEET_A, 4, { anchor: 16, vertical: false })).toBe(true);
    expect(fleetLegal(G, FLEET_A.slice(0, 4))).toBe(false);
    expect(occupancy(G, FLEET_A.slice(0, 4))).not.toBeNull();
  });
  it('config bytes round-trip', () => {
    const cs: Config[] = [
      cfgOf({ mode: 0, extraShot: true, noTouch: true, timer: 30 }),
      cfgOf({ mode: 1 }),
      cfgOf({ mode: 2, extraShot: true, noTouch: true, timer: 60, size: 3, seed: 51234 }),
      cfgOf({ mode: 3, extraShot: true, noTouch: true, size: 1, seed: 7 }),
    ];
    for (const c of cs) expect(decodeConfig(encodeConfig(c))).toEqual(c);
    expect(encodeConfig(cs[2]!)).toEqual([2, 3, 60, 3, 200, 34]);
    expect(decodeConfig([4, 0, 0, 1, 0, 0])).toBeNull();
    expect(decodeConfig([0, 4, 0, 1, 0, 0])).toBeNull();
    expect(decodeConfig([0, 0, 20, 1, 0, 0])).toBeNull();
    expect(decodeConfig([0, 0, 0, 4, 0, 0])).toBeNull();
    expect(decodeConfig([0, 0, 0])).toBeNull();
    // Extra shot: Classic and Items, not Salvo. Russian forces it, no-touch and 10×10.
    expect(decodeConfig([1, 1, 0, 1, 0, 0])!.extraShot).toBe(false);
    expect(decodeConfig([2, 1, 0, 1, 0, 0])!.extraShot).toBe(true);
    expect(decodeConfig([3, 0, 0, 3, 0, 0])).toMatchObject({ extraShot: true, noTouch: true, size: 1 });
    expect(rulesLine(cs[1]!)).toBe('Salvo · No timer');
    expect(rulesLine(cfgOf({ mode: 1, noTouch: true, timer: 30 }))).toBe("Salvo · Ships can't touch · 30 s turns");
    expect(rulesLine(cfgOf({ size: 2 }))).toBe('Classic · Large 12×12 · No timer');
    expect(rulesLine(cfgOf({ mode: 3 }))).toBe("Russian · Extra shot after a hit · Ships can't touch · No timer");
  });
});

describe('board sizes, fleets and islands', () => {
  it('fleet scales with the board', () => {
    const t = ([0, 1, 2, 3] as const).map((size) => geoOf(cfgOf({ size, seed: 5 })));
    expect(t.map((g) => g.n)).toEqual([8, 10, 12, 14]);
    expect(t.map((g) => g.total)).toEqual([12, 17, 22, 26]);
    expect(t.map((g) => g.islands.size > 0)).toEqual([false, false, true, true]);
    for (const g of t) expect(g.names.length).toBe(g.fleet.length);
  });
  it('Russian: 1×4, 2×3, 3×2, 4×1 on 10×10, no touching', () => {
    const g = geoOf(cfgOf({ mode: 3, size: 3 }));
    expect([g.n, g.fleet.join(''), g.total, g.noTouch, g.islands.size]).toEqual([10, '4332221111', 20, true, 0]);
    const rng = seededRng(3);
    for (let i = 0; i < 200; i++) expect(fleetLegal(g, randomFleet(g, rng))).toBe(true);
  });
  it('islands are deterministic from the seed, inland and apart', () => {
    const a = geoOf(cfgOf({ size: 3, seed: 99 }));
    expect([...makeIslands(14, 5, 99)]).toEqual([...a.islands]);
    expect([...geoOf(cfgOf({ size: 3, seed: 100 })).islands]).not.toEqual([...a.islands]);
    for (const seed of [0, 1, 2, 3, 65535]) {
      const isl = makeIslands(12, 3, seed);
      expect(isl.size).toBeGreaterThanOrEqual(6);
      for (const c of isl) expect([Math.floor(c / 12), c % 12].every((x) => x > 0 && x < 11)).toBe(true);
    }
  });
  it('ships cannot sit on islands; random fleets avoid them', () => {
    for (const noTouch of [false, true]) {
      const g = geoOf(cfgOf({ size: 2, seed: 4, noTouch }));
      const isl = [...g.islands][0]!;
      const f = randomFleet(g, seededRng(1));
      expect(fleetLegal(g, f)).toBe(true);
      const i = g.fleet.length - 1;
      expect(canPlace(g, f, i, { anchor: isl, vertical: false }) || canPlace(g, f, i, { anchor: isl - 1, vertical: false })).toBe(false);
      const rng = seededRng(9);
      for (let k = 0; k < 200; k++) expect(fleetLegal(g, randomFleet(g, rng))).toBe(true);
    }
  });
});

describe('board', () => {
  it('fleet 2-byte-per-ship round-trip', () => {
    const b = encodeFleet(FLEET_B);
    expect(b.length).toBe(10);
    expect([b[0], b[1]]).toEqual([9, 1]);
    expect(decodeFleet(b)).toEqual(FLEET_B);
    expect(decodeFleet([1, 2, 3])).toBeNull();
    expect(decodeFleet([100, 2])).toBeNull();
    expect(decodeFleet([])).toBeNull();
  });
  it('cell names', () => {
    expect(cellName(62)).toBe('C7');
    expect(parseCell('C7')).toBe(62);
    expect(cellName(0)).toBe('A1');
    expect(cellName(99)).toBe('J10');
    expect(parseCell('j10')).toBe(99);
    expect(parseCell('K1')).toBe(-1);
    expect(cellName(195, 14)).toBe('N14');
    expect(parseCell('N14', 14)).toBe(195);
    expect(parseCell('A11')).toBe(-1);
  });
});

describe('random', () => {
  it('2000 random fleets are legal, with and without no-touch', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 1000; i++) expect(fleetLegal(G, randomFleet(G, rng))).toBe(true);
    for (let i = 0; i < 1000; i++) expect(fleetLegal(GT, randomFleet(GT, rng))).toBe(true);
  });
  it('seeded rng is deterministic', () => {
    expect(randomFleet(G, seededRng(7))).toEqual(randomFleet(G, seededRng(7)));
    expect(fleetLegal(GT, randomFleet(GT))).toBe(true);
  });
});
