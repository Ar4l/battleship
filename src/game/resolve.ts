import { FLEET, occupancyPartial, shipCells } from './rules';
import { footprint, TORPEDO, SONAR } from './items';
import type { Answer, Attack, Cell, Entry, Fleet } from './types';

/** Cells an attack strikes directly (fire and area items), filtered to untargeted ones. Not used for torpedo/sonar. */
export function strikeCells(attack: Attack, shot: ReadonlySet<Cell>): Cell[] {
  if (attack.k === 'fire') return attack.cells.slice();
  return footprint(attack.item, attack.a, attack.b).filter((c) => !shot.has(c));
}

/**
 * The single source of truth for what a defender must answer.
 * `shot` is every cell of the defender's board already resolved before this attack.
 */
export function resolveAttack(fleet: Fleet, shot: ReadonlySet<Cell>, attack: Attack): Answer {
  const occ = occupancyPartial(fleet, false) ?? new Int8Array(100).fill(-1);
  const local = new Set(shot);
  const entryFor = (cell: Cell): Entry => {
    local.add(cell);
    const s = occ[cell]!;
    if (s < 0) return { cell, code: 0 };
    const cells = shipCells(fleet[s]!, FLEET[s]!)!;
    if (cells.every((x) => local.has(x))) return { cell, code: 2 + s, ship: { ...fleet[s]! } };
    return { cell, code: 1 };
  };
  if (attack.k === 'item' && attack.item === SONAR) {
    let count = 0;
    for (const c of footprint(SONAR, attack.a, attack.b)) if (occ[c]! >= 0 && !shot.has(c)) count++;
    return { k: 'sonar', count };
  }
  if (attack.k === 'item' && attack.item === TORPEDO) {
    for (const c of footprint(TORPEDO, attack.a, attack.b)) {
      if (local.has(c)) continue;
      if (occ[c]! >= 0) return { k: 'cells', entries: [entryFor(c)] };
      local.add(c);
    }
    return { k: 'cells', entries: [] };
  }
  return { k: 'cells', entries: strikeCells(attack, shot).map(entryFor) };
}

/**
 * Cells that become resolved on the defender's board once `answer` is known.
 * For a torpedo this includes the water cells it crossed. Order: travel/footprint order.
 */
export function resolvedCells(attack: Attack, answer: Answer, shot: ReadonlySet<Cell>): Cell[] {
  if (answer.k === 'sonar') return [];
  if (attack.k === 'item' && attack.item === TORPEDO) {
    const stop = answer.entries[0]?.cell;
    const out: Cell[] = [];
    for (const c of footprint(TORPEDO, attack.a, attack.b)) {
      if (shot.has(c)) continue;
      out.push(c);
      if (c === stop) break;
    }
    return out;
  }
  return answer.entries.map((e) => e.cell);
}
