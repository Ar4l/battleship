import { ENERGY_CAP, ITEMS, footprint, itemParamsValid, SONAR, TORPEDO } from './items';
import { resolveAttack, resolvedCells, strikeCells } from './resolve';
import { FLEET, TOTAL_SHIP_CELLS, neighbours8, shipCells } from './rules';
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

const newBoard = (): BoardView => ({ shot: new Set(), hit: new Set(), sunk: [null, null, null, null, null], known: new Set(), sonar: [], last: [] });
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

/** The board side `s` attacks. */
const attacked = (m: Match, s: Side): BoardView => (s === 'me' ? m.target : m.own);
const turnOf = (s: Side) => (s === 'me' ? 'myTurn' : 'theirTurn');
export const sunkCount = (b: BoardView): number => b.sunk.filter(Boolean).length;
export const untargeted = (b: BoardView): Cell[] => Array.from({ length: 100 }, (_, c) => c).filter((c) => !b.shot.has(c));

function startTurn(m: Match, s: Side): void {
  m.phase = turnOf(s);
  m.stats[s].turns++;
  if (m.config.mode === 2) m.energy[s] = Math.min(ENERGY_CAP, m.energy[s] + 1);
}

/** Shots the side must fire this turn (Salvo: ships afloat, capped by untargeted cells). */
export const shotsAllowed = (m: Match, s: Side): number =>
  m.config.mode === 1 ? Math.min(5 - sunkCount(attacked(m, s === 'me' ? 'them' : 'me')), 100 - attacked(m, s).shot.size) : 1;

/** null when legal, else a reason. */
export function legalAttack(m: Match, attack: Attack, s: Side): string | null {
  if (m.phase !== turnOf(s)) return 'not their turn';
  const board = attacked(m, s);
  if (attack.k === 'fire') {
    const n = shotsAllowed(m, s);
    const cells = attack.cells;
    if (cells.length !== n) return `fired ${cells.length} shots, expected ${n}`;
    if (cells.some((c) => !Number.isInteger(c) || c < 0 || c > 99)) return 'shot off the board';
    return new Set(cells).size < n || cells.some((c) => board.shot.has(c)) ? 'fired at the same cell twice' : null;
  }
  const def = ITEMS[attack.item]!;
  return m.config.mode !== 2
    ? 'used an item outside Items mode'
    : !itemParamsValid(attack.item, attack.a, attack.b)
      ? 'used an item with invalid inputs'
      : m.energy[s] < def.cost
        ? `used ${def.name} without enough energy`
        : footprint(attack.item, attack.a, attack.b).every((c) => board.shot.has(c))
          ? 'used an item on cells already fired at'
          : null;
}

/** Record an attack and its answer on `board`, then pass the turn or end the game. */
function apply(m: Match, s: Side, attack: Attack, answer: Answer): void {
  const board = attacked(m, s);
  const st = m.stats[s];
  const learn = (cells: Cell[]) => cells.forEach((c) => board.shot.has(c) || board.known.add(c));
  const cells = resolvedCells(attack, answer, board.shot);
  cells.forEach((c) => board.shot.add(c));
  board.last = cells;
  if (attack.k === 'item') st.items++;
  if (answer.k === 'sonar') {
    const fp = footprint(SONAR, (attack as { a: number }).a, 0);
    board.sonar.push({ a: fp[4]!, count: answer.count });
    if (!answer.count) learn(fp);
    board.last = fp;
  } else {
    const torpedo = attack.k === 'item' && attack.item === TORPEDO;
    if (torpedo) cells.forEach((c) => c === answer.entries[0]?.cell || board.known.add(c));
    for (const e of answer.entries) {
      if (e.code) board.hit.add(e.cell);
      if (e.code > 1 && e.ship) {
        board.sunk[e.code - 2] = e.ship;
        if (m.config.noTouch) shipCells(e.ship, FLEET[e.code - 2]!)!.forEach((c) => learn(neighbours8(c)));
      }
    }
    st.shots += answer.entries.length || +torpedo;
    st.hits += answer.entries.filter((e) => e.code).length;
  }
  if (sunkCount(board) === 5) {
    m.winner = s;
    m.phase = 'over';
  } else if (!m.config.mode && m.config.extraShot && answer.k === 'cells' && answer.entries.some((e) => e.code)) m.phase = turnOf(s);
  else startTurn(m, s === 'me' ? 'them' : 'me');
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
  if (r) return { cheat: 'they ' + r };
  if (attack.k === 'item') m.energy.them -= ITEMS[attack.item]!.cost;
  const answer = resolveAttack(m.fleet, m.own.shot, attack);
  apply(m, 'them', attack, answer);
  return { answer };
}

/** Live checks on an answer to my pending attack. null when plausible. */
export function checkAnswer(m: Match, answer: Answer): string | null {
  const attack = m.pending;
  const b = m.target;
  if (!attack) return 'they answered without an attack';
  if ((attack.k === 'item' && attack.item === SONAR) !== (answer.k === 'sonar')) return 'they sent the wrong kind of answer';
  if (answer.k === 'sonar')
    return answer.count > footprint(SONAR, (attack as { a: number }).a, 0).filter((c) => !b.shot.has(c)).length || answer.count > TOTAL_SHIP_CELLS - b.hit.size
      ? 'they reported an impossible sonar count'
      : null;
  const entries = answer.entries;
  if (attack.k === 'item' && attack.item === TORPEDO) {
    const e = entries[0];
    if (entries.length > 1) return 'they reported more than one torpedo hit';
    if (e && (!footprint(TORPEDO, attack.a, attack.b).includes(e.cell) || b.shot.has(e.cell) || !e.code)) return 'they reported an invalid torpedo result';
  } else {
    const want = strikeCells(attack, b.shot);
    if (want.length !== entries.length || want.some((c, i) => entries[i]!.cell !== c)) return 'they answered for the wrong cells';
  }
  const hits = new Set(b.hit);
  const claimed = new Set<Cell>();
  b.sunk.forEach((s, i) => s && shipCells(s, FLEET[i]!)!.forEach((c) => claimed.add(c)));
  for (const e of entries) {
    if (e.code) hits.add(e.cell);
    if (e.code < 2) continue;
    const i = e.code - 2;
    if (!e.ship || b.sunk[i]) return 'they reported a ship sunk twice';
    const cells = shipCells(e.ship, FLEET[i]!);
    if (!cells?.includes(e.cell) || cells.some((c) => !hits.has(c) || claimed.has(c))) return 'they reported a sunk ship that does not match their hits';
    cells.forEach((c) => claimed.add(c));
  }
  return hits.size > TOTAL_SHIP_CELLS ? 'they reported more hits than there are ship cells' : null;
}

/** Apply their answer to my pending attack. */
export function applyAnswer(m: Match, answer: Answer): { ok: true } | { cheat: string } {
  const r = checkAnswer(m, answer);
  if (r) return { cheat: r };
  const attack = m.pending!;
  m.pending = null;
  m.transcript.push({ attack, answer });
  apply(m, 'me', attack, answer);
  const b = m.target;
  if (m.phase !== 'over') {
    if (b.hit.size === TOTAL_SHIP_CELLS) return { cheat: 'they hid a sunk ship' };
    if (b.shot.size === 100) return { cheat: 'every cell was fired at but not every ship was sunk' };
  }
  return { ok: true };
}
