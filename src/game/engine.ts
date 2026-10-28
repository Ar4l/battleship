import { ENERGY_CAP, ITEMS, footprint, itemParamsValid, SONAR, TORPEDO } from './items';
import { resolveAttack, resolvedCells, strikeCells } from './resolve';
import { FLEET, TOTAL_SHIP_CELLS, neighbours8, occupancy, shipCells } from './rules';
import type { Answer, Attack, Cell, Config, Fleet, Ship } from './types';

export type Side = 'me' | 'them';
export type Phase = 'myTurn' | 'awaitingAnswer' | 'theirTurn' | 'over';

export interface BoardView {
  /** Resolved cells (fired at, struck, or crossed by a torpedo). */
  shot: Set<Cell>;
  /** Resolved cells that hold a ship. */
  hit: Set<Cell>;
  /** Known placement of each sunk ship, by fleet index. */
  sunk: (Ship | null)[];
  /** Display-only inferred water (sonar 0, no-touch neighbours). */
  known: Set<Cell>;
  sonar: { a: Cell; count: number }[];
  /** Cells resolved by the most recent attack on this board. */
  last: Cell[];
}

export interface Stats {
  shots: number;
  hits: number;
  turns: number;
  items: number;
}

export interface Match {
  config: Config;
  fleet: Fleet;
  /** Their board, as I know it. */
  target: BoardView;
  /** My board, with their attacks. */
  own: BoardView;
  phase: Phase;
  energy: Record<Side, number>;
  pending: Attack | null;
  /** My attacks and the answers they gave; replayed at reveal. */
  transcript: { attack: Attack; answer: Answer }[];
  winner: Side | null;
  stats: Record<Side, Stats>;
  iStarted: boolean;
}

const newBoard = (): BoardView => ({
  shot: new Set(),
  hit: new Set(),
  sunk: [null, null, null, null, null],
  known: new Set(),
  sonar: [],
  last: [],
});
const newStats = (): Stats => ({ shots: 0, hits: 0, turns: 0, items: 0 });

export function createMatch(config: Config, fleet: Fleet, iStart: boolean): Match {
  const m: Match = {
    config,
    fleet,
    target: newBoard(),
    own: newBoard(),
    phase: 'over',
    energy: { me: 0, them: 0 },
    pending: null,
    transcript: [],
    winner: null,
    stats: { me: newStats(), them: newStats() },
    iStarted: iStart,
  };
  startTurn(m, iStart ? 'me' : 'them');
  return m;
}

const other = (s: Side): Side => (s === 'me' ? 'them' : 'me');
const boardAttackedBy = (m: Match, s: Side): BoardView => (s === 'me' ? m.target : m.own);
export const sunkCount = (b: BoardView): number => b.sunk.filter(Boolean).length;
export const untargeted = (b: BoardView): Cell[] => {
  const out: Cell[] = [];
  for (let c = 0; c < 100; c++) if (!b.shot.has(c)) out.push(c);
  return out;
};

function startTurn(m: Match, s: Side): void {
  m.phase = s === 'me' ? 'myTurn' : 'theirTurn';
  m.stats[s].turns++;
  if (m.config.mode === 2) m.energy[s] = Math.min(ENERGY_CAP, m.energy[s] + 1);
}

/** Shots the side must fire this turn (Salvo: ships afloat, capped by untargeted cells). */
export function shotsAllowed(m: Match, s: Side): number {
  if (m.config.mode !== 1) return 1;
  const myShips = s === 'me' ? m.own : m.target; // the attacker's own fleet board
  const afloat = 5 - sunkCount(myShips);
  return Math.min(afloat, 100 - boardAttackedBy(m, s).shot.size);
}

/** null when legal, else a reason. */
export function legalAttack(m: Match, attack: Attack, s: Side): string | null {
  if (m.phase !== (s === 'me' ? 'myTurn' : 'theirTurn')) return 'not their turn';
  const board = boardAttackedBy(m, s);
  if (attack.k === 'fire') {
    const n = shotsAllowed(m, s);
    if (attack.cells.length !== n) return `fired ${attack.cells.length} shots, expected ${n}`;
    const seen = new Set<Cell>();
    for (const c of attack.cells) {
      if (!Number.isInteger(c) || c < 0 || c > 99) return 'shot off the board';
      if (seen.has(c) || board.shot.has(c)) return 'fired at the same cell twice';
      seen.add(c);
    }
    return null;
  }
  if (m.config.mode !== 2) return 'used an item outside Items mode';
  if (!itemParamsValid(attack.item, attack.a, attack.b)) return 'used an item with invalid inputs';
  const def = ITEMS[attack.item]!;
  if (m.energy[s] < def.cost) return `used ${def.name} without enough energy`;
  if (footprint(attack.item, attack.a, attack.b).every((c) => board.shot.has(c))) return 'used an item on cells already fired at';
  return null;
}

function applyToBoard(m: Match, board: BoardView, attack: Attack, answer: Answer): void {
  const cells = resolvedCells(attack, answer, board.shot);
  for (const c of cells) board.shot.add(c);
  board.last = cells;
  if (answer.k === 'sonar') {
    board.sonar.push({ a: attack.k === 'item' ? attack.a : 0, count: answer.count });
    if (answer.count === 0 && attack.k === 'item')
      for (const c of footprint(SONAR, attack.a, 0)) if (!board.shot.has(c)) board.known.add(c);
    board.last = attack.k === 'item' ? footprint(SONAR, attack.a, 0) : [];
    return;
  }
  if (attack.k === 'item' && attack.item === TORPEDO)
    for (const c of cells) if (c !== answer.entries[0]?.cell) board.known.add(c);
  for (const e of answer.entries) {
    if (e.code >= 1) board.hit.add(e.cell);
    if (e.code >= 2 && e.ship) {
      const i = e.code - 2;
      board.sunk[i] = e.ship;
      if (m.config.noTouch)
        for (const c of shipCells(e.ship, FLEET[i]!)!)
          for (const n of neighbours8(c)) if (!board.shot.has(n)) board.known.add(n);
    }
  }
}

function endOfAttack(m: Match, s: Side, attack: Attack, answer: Answer): void {
  const board = boardAttackedBy(m, s);
  const st = m.stats[s];
  if (attack.k === 'item') st.items++;
  if (answer.k === 'cells') {
    st.shots += answer.entries.length || (attack.k === 'item' && attack.item === TORPEDO ? 1 : 0);
    st.hits += answer.entries.filter((e) => e.code >= 1).length;
  }
  if (sunkCount(board) === 5) {
    m.winner = s;
    m.phase = 'over';
    return;
  }
  const hit = answer.k === 'cells' && answer.entries.some((e) => e.code >= 1);
  if (m.config.mode === 0 && m.config.extraShot && hit) {
    m.phase = s === 'me' ? 'myTurn' : 'theirTurn';
    return;
  }
  startTurn(m, other(s));
}

/** I attack. Throws if illegal (the UI prevents it). */
export function localAttack(m: Match, attack: Attack): Match {
  const r = legalAttack(m, attack, 'me');
  if (r) throw new Error(r);
  if (attack.k === 'item') m.energy.me -= ITEMS[attack.item]!.cost;
  m.pending = attack;
  m.phase = 'awaitingAnswer';
  return m;
}

/** They attack me: validate, compute my honest answer, advance. */
export function remoteAttack(m: Match, attack: Attack): { answer: Answer } | { cheat: string } {
  const r = legalAttack(m, attack, 'them');
  if (r) return { cheat: `they ${r}` };
  if (attack.k === 'item') m.energy.them -= ITEMS[attack.item]!.cost;
  const answer = resolveAttack(m.fleet, m.own.shot, attack);
  applyToBoard(m, m.own, attack, answer);
  endOfAttack(m, 'them', attack, answer);
  return { answer };
}

/** Live checks on an answer to my pending attack. null when plausible. */
export function checkAnswer(m: Match, answer: Answer): string | null {
  const attack = m.pending;
  const b = m.target;
  if (!attack) return 'they answered without an attack';
  const isSonar = attack.k === 'item' && attack.item === SONAR;
  if (isSonar !== (answer.k === 'sonar')) return 'they sent the wrong kind of answer';
  if (answer.k === 'sonar') {
    const open = footprint(SONAR, (attack as { a: number }).a, 0).filter((c) => !b.shot.has(c)).length;
    if (answer.count > open || answer.count > TOTAL_SHIP_CELLS - b.hit.size) return 'they reported an impossible sonar count';
    return null;
  }
  const entries = answer.entries;
  if (attack.k === 'item' && attack.item === TORPEDO) {
    if (entries.length > 1) return 'they reported more than one torpedo hit';
    const e = entries[0];
    if (e) {
      const line = footprint(TORPEDO, attack.a, attack.b);
      if (!line.includes(e.cell) || b.shot.has(e.cell) || e.code < 1) return 'they reported an invalid torpedo result';
    }
  } else {
    const want = strikeCells(attack, b.shot);
    if (want.length !== entries.length || want.some((c, i) => entries[i]!.cell !== c)) return 'they answered for the wrong cells';
  }
  const hits = new Set(b.hit);
  const claimed = new Set<Cell>();
  b.sunk.forEach((s, i) => s && shipCells(s, FLEET[i]!)!.forEach((c) => claimed.add(c)));
  const sunkNow = new Set<number>();
  for (const e of entries) {
    if (e.code < 1) continue;
    hits.add(e.cell);
    if (e.code < 2) continue;
    const i = e.code - 2;
    if (!e.ship || b.sunk[i] || sunkNow.has(i)) return 'they reported a ship sunk twice';
    const cells = shipCells(e.ship, FLEET[i]!);
    if (!cells || !cells.includes(e.cell) || cells.some((c) => !hits.has(c) || claimed.has(c)))
      return 'they reported a sunk ship that does not match their hits';
    cells.forEach((c) => claimed.add(c));
    sunkNow.add(i);
  }
  if (hits.size > TOTAL_SHIP_CELLS) return 'they reported more hits than there are ship cells';
  return null;
}

/** Apply their answer to my pending attack. */
export function applyAnswer(m: Match, answer: Answer): { ok: true } | { cheat: string } {
  const r = checkAnswer(m, answer);
  if (r) return { cheat: r };
  const attack = m.pending!;
  m.pending = null;
  applyToBoard(m, m.target, attack, answer);
  m.transcript.push({ attack, answer });
  endOfAttack(m, 'me', attack, answer);
  const b = m.target;
  if (m.phase !== 'over') {
    if (b.hit.size === TOTAL_SHIP_CELLS) return { cheat: 'they hid a sunk ship' };
    if (b.shot.size === 100) return { cheat: 'every cell was fired at but not every ship was sunk' };
  }
  return { ok: true };
}

/** Is my fleet legal under this config? (Used by verify too.) */
export const fleetOk = (f: Fleet, c: Config): boolean => occupancy(f, c.noTouch) !== null;
