import { describe, expect, it } from 'vitest';
import { canPlace, decodeConfig, encodeConfig, fleetLegal, geoOf, makeIslands, normConfig, occupancy, rulesLine, shipCells } from '../../src/game/rules';
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
      cfgOf({ extraShot: true, noTouch: true, timer: 30 }),
      cfgOf({ turns: 1 }),
      cfgOf({ turns: 2, noTouch: true, timer: 15, size: 2, seed: 9 }),
      cfgOf({ items: true, extraShot: true, noTouch: true, timer: 60, size: 3, seed: 51234 }),
      cfgOf({ russian: true, extraShot: true, noTouch: true, size: 1, seed: 7 }),
      cfgOf({ russian: true, turns: 2, noTouch: true }),
    ];
    for (const c of cs) expect(decodeConfig(encodeConfig(c))).toEqual(c);
    expect(encodeConfig(cs[3]!)).toEqual([11, 60, 3, 200, 34]);
    expect(encodeConfig(cs[5]!)).toEqual([38, 0, 1, 0, 0]);
    expect(decodeConfig([48, 0, 1, 0, 0])).toBeNull(); // turns 3
    expect(decodeConfig([0, 20, 1, 0, 0])).toBeNull();
    expect(decodeConfig([0, 0, 4, 0, 0])).toBeNull();
    expect(decodeConfig([0, 0, 0])).toBeNull();
    expect(decodeConfig([0, 0, 0, 1, 0, 0])).toBeNull();
  });
  it('normConfig: one place for every implied setting', () => {
    const n = (c: Partial<Config>) => normConfig(cfgOf(c));
    // Items and extra shot are one-shot turns only.
    for (const turns of [1, 2] as const) expect(n({ turns, items: true, extraShot: true })).toMatchObject({ items: false, extraShot: false });
    expect(n({ items: true, extraShot: true })).toMatchObject({ items: true, extraShot: true });
    // Russian: 10×10 and no touching always; hit shoots again under one-shot turns only.
    expect(n({ russian: true, size: 3 })).toMatchObject({ size: 1, noTouch: true, extraShot: true });
    expect(n({ russian: true, items: true })).toMatchObject({ items: true, extraShot: true });
    for (const turns of [1, 2] as const) expect(n({ russian: true, turns, extraShot: true })).toMatchObject({ turns, size: 1, noTouch: true, extraShot: false, items: false });
    expect(n({ seed: 0x12345 }).seed).toBe(0x2345);
    // Decoding normalises too.
    expect(decodeConfig([1 | 8 | 16, 0, 1, 0, 0])).toMatchObject({ turns: 1, items: false, extraShot: false });
  });
  it('rules line reads naturally and leaves out what Russian implies', () => {
    expect(rulesLine(cfgOf())).toBe('One shot · 10×10 · No timer');
    expect(rulesLine(cfgOf({ turns: 1, noTouch: true, timer: 30 }))).toBe("Salvo · 10×10 · Ships can't touch · 30 s turns");
    expect(rulesLine(cfgOf({ items: true, extraShot: true, size: 2 }))).toBe('One shot · Items · 12×12 · Extra shot after a hit · No timer');
    expect(rulesLine(cfgOf({ russian: true, turns: 2 }))).toBe('Russian · Salvo, simultaneous · 10×10 · No timer');
    expect(rulesLine(cfgOf({ russian: true }))).toBe('Russian · One shot · 10×10 · No timer');
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
    const g = geoOf(cfgOf({ russian: true, size: 3 }));
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
