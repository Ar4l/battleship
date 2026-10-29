import { describe, expect, it } from 'vitest';
import { clampLine, clampSonar, footprint, itemParamsValid, scatter, torpedoLine } from '../../src/game/items';
import { geoOf } from '../../src/game/rules';
import { resolveAttack, resolvedCells } from '../../src/game/resolve';
import { FLEET_A, FLEET_B, G, cfgOf } from './helpers';

describe('items footprints', () => {
  it('sonar must be inside the border ring', () => {
    expect(itemParamsValid(G, 0, 11, 0)).toBe(true);
    expect(itemParamsValid(G, 0, 88, 0)).toBe(true);
    expect(itemParamsValid(G, 0, 0, 0)).toBe(false);
    expect(itemParamsValid(G, 0, 19, 0)).toBe(false);
    expect(itemParamsValid(G, 0, 91, 0)).toBe(false);
    expect(footprint(G, 0, 11, 0)).toEqual([0, 1, 2, 10, 11, 12, 20, 21, 22]);
    expect(clampSonar(G, 0)).toBe(11);
    expect(clampSonar(G, 99)).toBe(88);
  });
  it('cross drops arms off the board', () => {
    expect(footprint(G, 2, 55, 0)).toEqual([55, 45, 56, 65, 54]);
    expect(footprint(G, 2, 0, 0)).toEqual([0, 1, 10]);
    expect(footprint(G, 2, 99, 0)).toEqual([99, 89, 98]);
    expect(footprint(G, 2, 9, 0)).toEqual([9, 19, 8]);
  });
  it('line must fit', () => {
    expect(itemParamsValid(G, 3, 5, 0)).toBe(true);
    expect(itemParamsValid(G, 3, 6, 0)).toBe(false);
    expect(itemParamsValid(G, 3, 50, 1)).toBe(true);
    expect(itemParamsValid(G, 3, 60, 1)).toBe(false);
    expect(itemParamsValid(G, 3, 0, 2)).toBe(false);
    expect(footprint(G, 3, 50, 1)).toEqual([50, 60, 70, 80, 90]);
    expect(clampLine(G, 9, false)).toBe(5);
    expect(clampLine(G, 99, true)).toBe(59);
  });
  it('torpedo lines from all four edges', () => {
    expect(torpedoLine(G, 2, 0)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    expect(torpedoLine(G, 2, 1)).toEqual([29, 28, 27, 26, 25, 24, 23, 22, 21, 20]);
    expect(torpedoLine(G, 3, 2)).toEqual([3, 13, 23, 33, 43, 53, 63, 73, 83, 93]);
    expect(torpedoLine(G, 3, 3)[0]).toBe(93);
    expect(itemParamsValid(G, 1, 9, 3)).toBe(true);
    expect(itemParamsValid(G, 1, 10, 0)).toBe(false);
    expect(itemParamsValid(G, 1, 0, 4)).toBe(false);
  });
});

describe('resolve items', () => {
  it('torpedo: clean run learns the whole line as water', () => {
    const atk = { k: 'item', item: 1, a: 1, b: 0 } as const; // row 2 is empty in FLEET_A
    const ans = resolveAttack(G, FLEET_A, new Set(), atk);
    expect(ans).toEqual({ k: 'cells', entries: [] });
    expect(resolvedCells(G, atk, ans, new Set([12]))).toEqual([10, 11, 13, 14, 15, 16, 17, 18, 19]);
  });
  it('torpedo: stops at the first intact ship cell, from each edge', () => {
    // FLEET_B: columns 9,7,5,3,1 vertical. Row 0 from left hits col 1 (Destroyer) first.
    expect(resolveAttack(G, FLEET_B, new Set(), { k: 'item', item: 1, a: 0, b: 0 })).toEqual({ k: 'cells', entries: [{ cell: 1, code: 1 }] });
    expect(resolveAttack(G, FLEET_B, new Set(), { k: 'item', item: 1, a: 0, b: 1 })).toEqual({ k: 'cells', entries: [{ cell: 9, code: 1 }] });
    // Column 9 from top hits 9; from bottom: carrier rows 0..4, so first ship cell from bottom is 49
    expect(resolveAttack(G, FLEET_B, new Set(), { k: 'item', item: 1, a: 9, b: 2 })).toEqual({ k: 'cells', entries: [{ cell: 9, code: 1 }] });
    const up = { k: 'item', item: 1, a: 9, b: 3 } as const;
    const ans = resolveAttack(G, FLEET_B, new Set(), up);
    expect(ans).toEqual({ k: 'cells', entries: [{ cell: 49, code: 1 }] });
    expect(resolvedCells(G, up, ans, new Set())).toEqual([99, 89, 79, 69, 59, 49]);
  });
  it('torpedo passes over already-hit cells and can sink', () => {
    // Destroyer at col 1 rows 0-1. Cell 1 already hit; row 1 from left: 10 water, 11 ship -> sunk
    const ans = resolveAttack(G, FLEET_B, new Set([1]), { k: 'item', item: 1, a: 1, b: 0 });
    expect(ans).toEqual({ k: 'cells', entries: [{ cell: 11, code: 6, ship: { anchor: 1, vertical: true } }] });
    // Column 1 from top with 1 and 11 shot: passes over both, rest water -> clean run
    expect(resolveAttack(G, FLEET_B, new Set([1, 11]), { k: 'item', item: 1, a: 1, b: 2 })).toEqual({ k: 'cells', entries: [] });
  });
  it('sonar counts only intact cells', () => {
    // centre B2 (11): cells 0,1,2,10,11,12,20,21,22. FLEET_A ship cells: 0,1,2,20,21,22 -> 6
    expect(resolveAttack(G, FLEET_A, new Set(), { k: 'item', item: 0, a: 11, b: 0 })).toEqual({ k: 'sonar', count: 6 });
    expect(resolveAttack(G, FLEET_A, new Set([0, 1, 10]), { k: 'item', item: 0, a: 11, b: 0 })).toEqual({ k: 'sonar', count: 4 });
  });
  it('cross and line answer only untargeted cells, in footprint order', () => {
    const ans = resolveAttack(G, FLEET_A, new Set([0]), { k: 'item', item: 2, a: 1, b: 0 });
    expect(ans).toEqual({ k: 'cells', entries: [{ cell: 1, code: 1 }, { cell: 2, code: 1 }, { cell: 11, code: 0 }] });
    const line = resolveAttack(G, FLEET_A, new Set(), { k: 'item', item: 3, a: 0, b: 0 });
    expect(line.k === 'cells' && line.entries.map((e) => e.code)).toEqual([1, 1, 1, 1, 2]);
  });
});

describe('airstrike', () => {
  it('aims anywhere; its area is the 5×5 around the square, clipped at the edges', () => {
    expect(itemParamsValid(G, 4, 0, 0)).toBe(true);
    expect(itemParamsValid(G, 4, 99, 0)).toBe(true);
    expect(itemParamsValid(G, 4, 55, 1)).toBe(false);
    expect(footprint(G, 4, 55, 0)).toHaveLength(25);
    expect(footprint(G, 4, 0, 0)).toEqual([0, 1, 2, 10, 11, 12, 20, 21, 22]);
  });
  it('scatter: the square plus 4 random untargeted ones near it, fixed by seed and board state', () => {
    const shot = new Set([44, 45]);
    const s = scatter(G, 55, shot);
    expect(s).toHaveLength(5);
    expect(s).toContain(55);
    expect(s.every((c) => footprint(G, 4, 55, 0).includes(c) && !shot.has(c))).toBe(true);
    expect(scatter(G, 55, new Set(shot))).toEqual(s);
    // Another seed or move gives other cells (for most draws).
    const other = geoOf(cfgOf({ seed: 777 }));
    const differ = [0, 1, 2, 3, 4, 5].filter((k) => scatter(other, 55, new Set([...shot, ...Array.from({ length: k }, (_, i) => i)])).join() !== s.join());
    expect(differ.length).toBeGreaterThan(3);
    // An already-shot square: 5 from the area; a corner with 3 free cells: all of them.
    expect(scatter(G, 44, shot).includes(44)).toBe(false);
    expect(scatter(G, 44, shot)).toHaveLength(5);
    expect(scatter(G, 0, new Set([1, 2, 10, 12, 20, 22]))).toEqual([0, 11, 21]);
    const ans = resolveAttack(G, FLEET_A, shot, { k: 'item', item: 4, a: 55, b: 0 });
    expect(ans.k === 'cells' && ans.entries.map((e) => e.cell)).toEqual(s);
  });
});

describe('islands (Large, seed 4: 13 25 | 56 57 | 106 118 130)', () => {
  const L = geoOf(cfgOf({ size: 2, seed: 4 }));
  it('layout', () => expect([...L.islands].sort((a, b) => a - b)).toEqual([13, 25, 56, 57, 106, 118, 130]));
  it('torpedoes stop at islands', () => {
    expect(torpedoLine(L, 4, 0)).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
    expect(torpedoLine(L, 4, 1)).toEqual([59, 58]);
    expect(torpedoLine(L, 0, 0)).toHaveLength(12);
    expect(itemParamsValid(L, 1, 11, 3)).toBe(true);
    expect(itemParamsValid(L, 1, 12, 0)).toBe(false);
  });
  it('area items skip islands; sonar keeps its 3×3', () => {
    expect(footprint(L, 2, 13, 0)).toEqual([1, 14, 12]);
    expect(footprint(L, 3, 53, 0)).toEqual([53, 54, 55]);
    expect(footprint(L, 0, 13, 0)).toHaveLength(9);
    expect(clampLine(L, 143, false)).toBe(139);
    expect(clampSonar(L, 143)).toBe(130);
  });
});
