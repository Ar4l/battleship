import { ENERGY_CAP, ITEMS, footprint, itemParamsValid, SONAR, TORPEDO } from './items';
import { resolveAttack, resolvedCells, strikeCells } from './resolve';
import { geoOf, neighbours8, normConfig, shipCells } from './rules';
import type { Answer, Attack, Cell, Config, Fleet, Geo, Ship } from './types';

export type Side = 'me' | 'them';
type Phase = 'myTurn' | 'awaitingAnswer' | 'theirTurn' | 'over';

export interface BoardView {
  /** Resolved cells (fired at, struck, or crossed by a torpedo). Islands start in here: they can't be fired at. */
  shot: Set<Cell>;
  /** Resolved cells that hold a ship. */
  hit: Set<Cell>;
  /** Known placement of each sunk ship, by fleet index. */
  sunk: (Ship | null)[];
  /** Display-only inferred water (sonar 0, torpedo path; no-touch: around sunk ships and diagonal to hits). */
  known: Set<Cell>;
  sonar: { a: Cell; count: number }[];
  /** Cells resolved by the most recent attack on this board. */
  last: Cell[];
}

interface Stats {
  shots: number;
  hits: number;
  turns: number;
  items: number;
}

export interface Match {
  config: Config;
  /** Board size, fleet and islands for this game. */
  geo: Geo;
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
  /** Simultaneous salvo: this round's two halves, applied together once both are in. */
  round: { me?: [Attack, Answer]; them?: [Attack, Answer] };
  winner: Side | 'draw' | null;
  stats: Record<Side, Stats>;
  iStarted: boolean;
}

const newBoard = (g: Geo): BoardView => ({ shot: new Set(g.islands), hit: new Set(), sunk: g.fleet.map(() => null), known: new Set(), sonar: [], last: [] });
const newStats = (): Stats => ({ shots: 0, hits: 0, turns: 0, items: 0 });

export function createMatch(config: Config, fleet: Fleet, iStart: boolean): Match {
  const geo = geoOf(config);
  const m: Match = {
    config: normConfig(config),
    geo,
    fleet,
    target: newBoard(geo),
    own: newBoard(geo),
    phase: 'over',
    energy: { me: 0, them: 0 },
    pending: null,
    transcript: [],
    round: {},
    winner: null,
    stats: { me: newStats(), them: newStats() },
    iStarted: iStart,
  };
  startTurn(m, iStart || m.config.turns > 1 ? 'me' : 'them');
  return m;
}

/** The board side `s` attacks. */
const attacked = (m: Match, s: Side): BoardView => (s === 'me' ? m.target : m.own);
const turnOf = (s: Side) => (s === 'me' ? 'myTurn' : 'theirTurn');
export const sunkCount = (b: BoardView): number => b.sunk.filter(Boolean).length;
/** Cells of `b` that can still be fired at. */
export const untargeted = (m: Match, b: BoardView = m.target): Cell[] => Array.from({ length: m.geo.n ** 2 }, (_, c) => c).filter((c) => !b.shot.has(c));

function startTurn(m: Match, s: Side): void {
  m.phase = turnOf(s);
  m.stats[s].turns++;
  if (m.config.items) m.energy[s] = Math.min(ENERGY_CAP, m.energy[s] + 1);
}

/** Shots the side must fire this turn (Salvo: ships afloat, at most 5, capped by untargeted cells). */
export const shotsAllowed = (m: Match, s: Side): number =>
  m.config.turns ? Math.min(5, m.geo.fleet.length - sunkCount(attacked(m, s === 'me' ? 'them' : 'me')), m.geo.n ** 2 - attacked(m, s).shot.size) : 1;

/** null when legal, else a reason. */
export function legalAttack(m: Match, attack: Attack, s: Side): string | null {
  // Simultaneous: they may fire any time in the round, once; I fire while picking.
  if (m.config.turns > 1 && s === 'them' ? m.phase === 'over' || m.round.them : m.phase !== turnOf(s)) return 'not their turn';
  const board = attacked(m, s);
  if (attack.k === 'fire') {
    const n = shotsAllowed(m, s);
    const cells = attack.cells;
    if (cells.length !== n) return `fired ${cells.length} shots, expected ${n}`;
    if (cells.some((c) => !Number.isInteger(c) || c < 0 || c >= m.geo.n ** 2)) return 'shot off the board';
    if (cells.some((c) => m.geo.islands.has(c))) return 'fired at an island';
    return new Set(cells).size < n || cells.some((c) => board.shot.has(c)) ? 'fired at the same cell twice' : null;
  }
  const def = ITEMS[attack.item]!;
  return !m.config.items
    ? 'used an item outside Items mode'
    : !itemParamsValid(m.geo, attack.item, attack.a, attack.b)
      ? 'used an item with invalid inputs'
      : m.energy[s] < def.cost
        ? `used ${def.name} without enough energy`
        : footprint(m.geo, attack.item, attack.a, attack.b).every((c) => board.shot.has(c))
          ? 'used an item on cells already fired at'
          : null;
}

/**
 * Record an attack and its answer on `board`, then pass the turn or end the game.
 * Extra shot (Classic, Items, Russian): any hit, by a shot or an item other than
 * sonar, gives the same side another turn, without the turn's energy.
 */
function apply(m: Match, s: Side, attack: Attack, answer: Answer): void {
  const g = m.geo;
  const board = attacked(m, s);
  const st = m.stats[s];
  const learn = (cells: Cell[]) => cells.forEach((c) => board.shot.has(c) || board.known.add(c));
  const cells = resolvedCells(g, attack, answer, board.shot);
  cells.forEach((c) => board.shot.add(c));
  board.last = cells;
  if (attack.k === 'item') st.items++;
  if (answer.k === 'sonar') {
    const fp = footprint(g, SONAR, (attack as { a: number }).a, 0);
    board.sonar.push({ a: fp[4]!, count: answer.count });
    if (!answer.count) learn(fp);
  } else {
    const torpedo = attack.k === 'item' && attack.item === TORPEDO;
    if (torpedo) cells.forEach((c) => c === answer.entries[0]?.cell || board.known.add(c));
    for (const e of answer.entries) {
      if (e.code) board.hit.add(e.cell);
      // Ships are straight and can't touch: a hit's diagonal neighbours are water.
      if (e.code && g.noTouch) learn(neighbours8(e.cell, g.n).filter((c) => c % g.n !== e.cell % g.n && Math.abs(c - e.cell) !== 1));
      if (e.code > 1 && e.ship) {
        board.sunk[e.code - 2] = e.ship;
        if (g.noTouch) shipCells(g, e.ship, e.code - 2)!.forEach((c) => learn(neighbours8(c, g.n)));
      }
    }
    st.shots += answer.entries.length || +torpedo;
    st.hits += answer.entries.filter((e) => e.code).length;
  }
  if (sunkCount(board) === g.fleet.length) {
    // Simultaneous: both fleets can go down in the same round.
    m.winner = m.winner ? 'draw' : s;
    m.phase = 'over';
  } else if (m.config.turns > 1) return;
  else if (m.config.extraShot && answer.k === 'cells' && answer.entries.some((e) => e.code)) m.phase = turnOf(s);
  else startTurn(m, s === 'me' ? 'them' : 'me');
}

/** Simultaneous: once both halves of the round are in, apply them and start the next round. */
function settle(m: Match): void {
  const { me, them } = m.round;
  if (!me || !them) return;
  m.round = {};
  apply(m, 'me', ...me);
  apply(m, 'them', ...them);
  if (m.phase !== 'over') startTurn(m, 'me');
}

/** Record or (simultaneous) hold a half round. */
function half(m: Match, s: Side, attack: Attack, answer: Answer): void {
  if (m.config.turns < 2) return apply(m, s, attack, answer);
  m.round[s] = [attack, answer];
  settle(m);
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
  const answer = resolveAttack(m.geo, m.fleet, m.own.shot, attack);
  half(m, 'them', attack, answer);
  // Simultaneous: this may have applied their answer to me as well.
  const why = hidden(m);
  return why ? { cheat: why } : { answer };
}

/** Live checks on an answer to my pending attack. null when plausible. */
function checkAnswer(m: Match, answer: Answer): string | null {
  const attack = m.pending;
  const b = m.target;
  const g = m.geo;
  if (!attack) return 'they answered without an attack';
  if ((attack.k === 'item' && attack.item === SONAR) !== (answer.k === 'sonar')) return 'they sent the wrong kind of answer';
  if (answer.k === 'sonar')
    return answer.count > footprint(g, SONAR, (attack as { a: number }).a, 0).filter((c) => !b.shot.has(c)).length || answer.count > g.total - b.hit.size
      ? 'they reported an impossible sonar count'
      : null;
  const entries = answer.entries;
  if (attack.k === 'item' && attack.item === TORPEDO) {
    const e = entries[0];
    if (entries.length > 1) return 'they reported more than one torpedo hit';
    if (e && (!footprint(g, TORPEDO, attack.a, attack.b).includes(e.cell) || b.shot.has(e.cell) || !e.code)) return 'they reported an invalid torpedo result';
  } else {
    const want = strikeCells(g, attack, b.shot);
    if (want.length !== entries.length || want.some((c, i) => entries[i]!.cell !== c)) return 'they answered for the wrong cells';
  }
  const hits = new Set(b.hit);
  const claimed = new Set<Cell>();
  b.sunk.forEach((s, i) => s && shipCells(g, s, i)!.forEach((c) => claimed.add(c)));
  for (const e of entries) {
    if (e.code) hits.add(e.cell);
    if (e.code < 2) continue;
    const i = e.code - 2;
    if (i >= g.fleet.length) return 'they reported a ship that is not in the fleet';
    if (!e.ship || b.sunk[i]) return 'they reported a ship sunk twice';
    const cells = shipCells(g, e.ship, i);
    if (!cells?.includes(e.cell) || cells.some((c) => !hits.has(c) || claimed.has(c))) return 'they reported a sunk ship that does not match their hits';
    cells.forEach((c) => claimed.add(c));
  }
  return hits.size > g.total ? 'they reported more hits than there are ship cells' : null;
}

/** Apply their answer to my pending attack. */
export function applyAnswer(m: Match, answer: Answer): { ok: true } | { cheat: string } {
  const r = checkAnswer(m, answer);
  if (r) return { cheat: r };
  const attack = m.pending!;
  m.pending = null;
  m.transcript.push({ attack, answer });
  half(m, 'me', attack, answer);
  const why = hidden(m);
  return why ? { cheat: why } : { ok: true };
}

/** After their answers are applied: did they hide a sunk ship? */
function hidden(m: Match): string | null {
  const b = m.target;
  return m.phase === 'over' ? null : b.hit.size === m.geo.total ? 'they hid a sunk ship' : b.shot.size === m.geo.n ** 2 ? 'every cell was fired at but not every ship was sunk' : null;
}
