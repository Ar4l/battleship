import { FLEET, occupancy, shipCells } from './rules';
import { footprint, SONAR, TORPEDO } from './items';
import type { Answer, Attack, Cell, Entry, Fleet } from './types';

/** Cells an attack strikes directly (fire and area items), filtered to untargeted ones. Not used for torpedo/sonar. */
export const strikeCells = (attack: Attack, shot: ReadonlySet<Cell>): Cell[] =>
  attack.k === 'fire' ? attack.cells.slice() : footprint(attack.item, attack.a, attack.b).filter((c) => !shot.has(c));

/**
 * The single source of truth for what a defender must answer.
 * `shot` is every cell of the defender's board already resolved before this attack.
 */
export function resolveAttack(fleet: Fleet, shot: ReadonlySet<Cell>, attack: Attack): Answer {
  const occ = occupancy(fleet, false) ?? new Int8Array(100).fill(-1);
  const local = new Set(shot);
  const entry = (cell: Cell): Entry => {
    local.add(cell);
    const s = occ[cell]!;
    return s < 0 ? { cell, code: 0 } : shipCells(fleet[s]!, FLEET[s]!)!.every((x) => local.has(x)) ? { cell, code: 2 + s, ship: { ...fleet[s]! } } : { cell, code: 1 };
  };
  if (attack.k === 'item' && attack.item === SONAR) return { k: 'sonar', count: footprint(SONAR, attack.a, 0).filter((c) => occ[c]! >= 0 && !shot.has(c)).length };
  if (attack.k === 'item' && attack.item === TORPEDO) {
    const hit = footprint(TORPEDO, attack.a, attack.b).find((c) => !shot.has(c) && occ[c]! >= 0);
    return { k: 'cells', entries: hit === undefined ? [] : [entry(hit)] };
  }
  return { k: 'cells', entries: strikeCells(attack, shot).map(entry) };
}

/**
 * Cells that become resolved on the defender's board once `answer` is known.
 * For a torpedo this includes the water cells it crossed. Order: travel/footprint order.
 */
export function resolvedCells(attack: Attack, answer: Answer, shot: ReadonlySet<Cell>): Cell[] {
  if (answer.k === 'sonar') return [];
  if (attack.k !== 'item' || attack.item !== TORPEDO) return answer.entries.map((e) => e.cell);
  const line = footprint(TORPEDO, attack.a, attack.b).filter((c) => !shot.has(c));
  const stop = answer.entries[0]?.cell;
  return stop === undefined ? line : line.slice(0, line.indexOf(stop) + 1);
}
