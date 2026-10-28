import { describe, expect, it } from 'vitest';
import { clampLine, clampSonar, footprint, itemParamsValid, torpedoLine } from '../../src/game/items';
import { resolveAttack, resolvedCells } from '../../src/game/resolve';
import { FLEET_A, FLEET_B } from './helpers';

describe('items footprints', () => {
  it('sonar must be inside the border ring', () => {
    expect(itemParamsValid(0, 11, 0)).toBe(true);
    expect(itemParamsValid(0, 88, 0)).toBe(true);
    expect(itemParamsValid(0, 0, 0)).toBe(false);
    expect(itemParamsValid(0, 19, 0)).toBe(false);
    expect(itemParamsValid(0, 91, 0)).toBe(false);
    expect(footprint(0, 11, 0)).toEqual([0, 1, 2, 10, 11, 12, 20, 21, 22]);
    expect(clampSonar(0)).toBe(11);
    expect(clampSonar(99)).toBe(88);
  });
  it('cross drops arms off the board', () => {
    expect(footprint(2, 55, 0)).toEqual([55, 45, 56, 65, 54]);
    expect(footprint(2, 0, 0)).toEqual([0, 1, 10]);
    expect(footprint(2, 99, 0)).toEqual([99, 89, 98]);
    expect(footprint(2, 9, 0)).toEqual([9, 19, 8]);
  });
  it('line must fit', () => {
    expect(itemParamsValid(3, 5, 0)).toBe(true);
    expect(itemParamsValid(3, 6, 0)).toBe(false);
    expect(itemParamsValid(3, 50, 1)).toBe(true);
    expect(itemParamsValid(3, 60, 1)).toBe(false);
    expect(itemParamsValid(3, 0, 2)).toBe(false);
    expect(footprint(3, 50, 1)).toEqual([50, 60, 70, 80, 90]);
    expect(clampLine(9, false)).toBe(5);
    expect(clampLine(99, true)).toBe(59);
  });
  it('torpedo lines from all four edges', () => {
    expect(torpedoLine(2, 0)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    expect(torpedoLine(2, 1)).toEqual([29, 28, 27, 26, 25, 24, 23, 22, 21, 20]);
    expect(torpedoLine(3, 2)).toEqual([3, 13, 23, 33, 43, 53, 63, 73, 83, 93]);
    expect(torpedoLine(3, 3)[0]).toBe(93);
    expect(itemParamsValid(1, 9, 3)).toBe(true);
    expect(itemParamsValid(1, 10, 0)).toBe(false);
    expect(itemParamsValid(1, 0, 4)).toBe(false);
  });
});

describe('resolve items', () => {
  it('torpedo: clean run learns the whole line as water', () => {
    const atk = { k: 'item', item: 1, a: 1, b: 0 } as const; // row 2 is empty in FLEET_A
    const ans = resolveAttack(FLEET_A, new Set(), atk);
    expect(ans).toEqual({ k: 'cells', entries: [] });
    expect(resolvedCells(atk, ans, new Set([12]))).toEqual([10, 11, 13, 14, 15, 16, 17, 18, 19]);
  });
  it('torpedo: stops at the first intact ship cell, from each edge', () => {
    // FLEET_B: columns 9,7,5,3,1 vertical. Row 0 from left hits col 1 (Destroyer) first.
    expect(resolveAttack(FLEET_B, new Set(), { k: 'item', item: 1, a: 0, b: 0 })).toEqual({ k: 'cells', entries: [{ cell: 1, code: 1 }] });
    expect(resolveAttack(FLEET_B, new Set(), { k: 'item', item: 1, a: 0, b: 1 })).toEqual({ k: 'cells', entries: [{ cell: 9, code: 1 }] });
    // Column 9 from top hits 9; from bottom: carrier rows 0..4, so first ship cell from bottom is 49
    expect(resolveAttack(FLEET_B, new Set(), { k: 'item', item: 1, a: 9, b: 2 })).toEqual({ k: 'cells', entries: [{ cell: 9, code: 1 }] });
    const up = { k: 'item', item: 1, a: 9, b: 3 } as const;
    const ans = resolveAttack(FLEET_B, new Set(), up);
    expect(ans).toEqual({ k: 'cells', entries: [{ cell: 49, code: 1 }] });
    expect(resolvedCells(up, ans, new Set())).toEqual([99, 89, 79, 69, 59, 49]);
  });
  it('torpedo passes over already-hit cells and can sink', () => {
    // Destroyer at col 1 rows 0-1. Cell 1 already hit; row 1 from left: 10 water, 11 ship -> sunk
    const ans = resolveAttack(FLEET_B, new Set([1]), { k: 'item', item: 1, a: 1, b: 0 });
    expect(ans).toEqual({ k: 'cells', entries: [{ cell: 11, code: 6, ship: { anchor: 1, vertical: true } }] });
    // Column 1 from top with 1 and 11 shot: passes over both, rest water -> clean run
    expect(resolveAttack(FLEET_B, new Set([1, 11]), { k: 'item', item: 1, a: 1, b: 2 })).toEqual({ k: 'cells', entries: [] });
  });
  it('sonar counts only intact cells', () => {
    // centre B2 (11): cells 0,1,2,10,11,12,20,21,22. FLEET_A ship cells: 0,1,2,20,21,22 -> 6
    expect(resolveAttack(FLEET_A, new Set(), { k: 'item', item: 0, a: 11, b: 0 })).toEqual({ k: 'sonar', count: 6 });
    expect(resolveAttack(FLEET_A, new Set([0, 1, 10]), { k: 'item', item: 0, a: 11, b: 0 })).toEqual({ k: 'sonar', count: 4 });
  });
  it('cross and line answer only untargeted cells, in footprint order', () => {
    const ans = resolveAttack(FLEET_A, new Set([0]), { k: 'item', item: 2, a: 1, b: 0 });
    expect(ans).toEqual({ k: 'cells', entries: [{ cell: 1, code: 1 }, { cell: 2, code: 1 }, { cell: 11, code: 0 }] });
    const line = resolveAttack(FLEET_A, new Set(), { k: 'item', item: 3, a: 0, b: 0 });
    expect(line.k === 'cells' && line.entries.map((e) => e.code)).toEqual([1, 1, 1, 1, 2]);
  });
});
