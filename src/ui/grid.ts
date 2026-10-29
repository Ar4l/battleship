import { shipCells } from '../game/rules';
import type { Geo, Ship } from '../game/types';
import { h } from './h';

export interface BoardOpts {
  /** Makes the cells buttons with a roving tabindex. */
  onActivate?(cell: number, touch: boolean): void;
  onHover?(cell: number | null): void;
  /** Return true when handled. */
  onKey?(e: KeyboardEvent): boolean;
  onPointerDown?(cell: number, e: PointerEvent): void;
}

export interface BoardModel {
  /** Extra classes per cell. */
  cls: string[];
  /** Accessible label per cell, e.g. "C7, miss". */
  labels: string[];
  /** SVG markup drawn over the cells (viewBox 0 0 n n). */
  overlay: string;
}

export interface Board {
  el: HTMLElement;
  cells: HTMLElement[];
  focused(): number;
  update(m: BoardModel): void;
  /** Cell under a client point, or -1 when off the board. */
  cellAt(x: number, y: number): number;
}

const span = (s: string | number) => `<span>${s}</span>`;

/** An n×n board with persistent cells (focus and pointer capture survive updates). */
export function board(label: string, mini: boolean, n: number, o: BoardOpts = {}): Board {
  const live = !!o.onActivate;
  const nn = n * n;
  const cols = [...'ABCDEFGHIJKLMN'.slice(0, n)];
  let rows = '';
  for (let i = 0; i < nn; i++)
    rows +=
      (i % n ? '' : '<div role="row" class="row">') +
      `<div role="gridcell" class="gc">${live ? `<button class="cell" tabindex="${i ? -1 : 0}" data-i="${i}"></button>` : `<span class="cell" data-i="${i}"></span>`}</div>` +
      (i % n === n - 1 ? '</div>' : '');
  const el = h('div', { cls: 'board' + (mini ? ' mini' : ''), style: '--n:' + n });
  el.innerHTML =
    `<div></div><div class="colh" aria-hidden="true">${cols.map(span).join('')}</div><div class="rowh" aria-hidden="true">${cols.map((_, i) => span(i + 1)).join('')}</div>` +
    `<div class="field"><div class="cells" role="grid" aria-label="${label}"${live ? '' : ' aria-readonly="true"'}>${rows}</div><svg class="ov" viewBox="0 0 ${n} ${n}" aria-hidden="true"></svg></div>`;
  const grid = el.querySelector<HTMLElement>('.cells')!;
  const ov = el.querySelector('svg')!;
  const cells = [...grid.querySelectorAll<HTMLElement>('.cell')];
  let focus = 0;
  let touch = false;
  const idx = (e: Event): number => {
    const t = (e.target as HTMLElement).closest?.<HTMLElement>('[data-i]');
    return t ? +t.dataset.i! : -1;
  };
  const setFocus = (i: number, move = false) => {
    cells[focus]!.tabIndex = -1;
    cells[(focus = i)]!.tabIndex = 0;
    if (move) cells[i]!.focus();
  };
  const on = (type: string, f: (e: PointerEvent & KeyboardEvent, i: number) => unknown) =>
    grid.addEventListener(type, (e) => f(e as PointerEvent & KeyboardEvent, idx(e)));
  on('pointerdown', (e, i) => {
    touch = e.pointerType !== 'mouse';
    if (i >= 0) o.onPointerDown?.(i, e);
  });
  if (live) {
    on('click', (e, i) => {
      if (i < 0) return;
      setFocus(i);
      // Keyboard "clicks" have detail 0.
      o.onActivate!(i, e.detail > 0 && touch);
    });
    on('pointerover', (e, i) => e.pointerType === 'mouse' && i >= 0 && o.onHover?.(i));
    on('pointerleave', (e) => e.pointerType === 'mouse' && o.onHover?.(null));
    on('focusin', (_, i) => {
      if (i < 0) return;
      focus = i;
      if (!touch) o.onHover?.(i);
    });
    on('keydown', (e, i) => {
      if (o.onKey?.(e)) return e.preventDefault();
      const r = i - (i % n);
      const d = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 }[e.key];
      let j = { Home: e.ctrlKey ? 0 : r, End: e.ctrlKey ? nn - 1 : r + n - 1 }[e.key] ?? i;
      // Arrows step over land; at the edge (or only land beyond) focus stays put.
      if (d) {
        let k = i + d;
        while (k >= 0 && k < nn && (d * d > 1 || k - (k % n) === r) && cells[k]!.classList.contains('land')) k += d;
        if (k >= 0 && k < nn && (d * d > 1 || k - (k % n) === r)) j = k;
      } else if (j === i) return;
      e.preventDefault();
      touch = false;
      setFocus(j, true);
    });
  }
  return {
    el,
    cells,
    focused: () => focus,
    update(m) {
      cells.forEach((c, i) => {
        const cls = 'cell ' + (m.cls[i] ?? '');
        if (c.className !== cls) c.className = cls;
        const l = m.labels[i]!;
        if (live) c.getAttribute('aria-label') !== l && c.setAttribute('aria-label', l);
        else if (c.textContent !== l) c.textContent = l;
      });
      ov.innerHTML = m.overlay;
    },
    cellAt(x, y) {
      const r = grid.getBoundingClientRect();
      const c = Math.floor(((x - r.left) / r.width) * n);
      const row = Math.floor(((y - r.top) / r.height) * n);
      return c < 0 || c >= n || row < 0 || row >= n ? -1 : row * n + c;
    },
  };
}

// ---------- SVG overlay builders (units: 1 = one cell) ----------

/** Side length for the builders below; set by `land`, which every board model calls first. */
let N = 10;
export const setN = (n: number) => (N = n);
const x = (c: number) => c % N;
const y = (c: number) => (c - (c % N)) / N;
const rect = (cls: string, x0: number, y0: number, w: number, hh: number, extra = '') =>
  `<rect class="${cls}" x="${x0}" y="${y0}" width="${w}" height="${hh}"${extra}/>`;
const square = (cls: string, c: number, inset: number, extra = '') => rect(cls, x(c) + inset, y(c) + inset, 1 - 2 * inset, 1 - 2 * inset, extra);
const dot = (cls: string, c: number, r: number, extra = '') => `<circle class="${cls}"${extra} cx="${x(c) + 0.5}" cy="${y(c) + 0.5}" r="${r}"/>`;
const delay = (ms: number) => (ms ? ` style="animation-delay:${ms}ms"` : '');

/** Ship outline; `round` draws a capsule. */
function shipRect(ship: Ship, len: number, cls: string, inset: number, round = true): string {
  const c = ship.anchor;
  const w = ship.vertical ? 1 : len;
  const hh = ship.vertical ? len : 1;
  return rect(cls, x(c) + inset, y(c) + inset, w - 2 * inset, hh - 2 * inset, round ? ` rx="${0.5 - inset}"` : ' pathLength="100"');
}
export const capsule = (ship: Ship, len: number, cls: string) => shipRect(ship, len, cls, 0.14);

/** `anim` is the stagger delay in ms, or -1 for no animation. */
export const miss = (c: number, anim = -1) => dot('miss', c, 0.14) + (anim < 0 ? '' : dot('ring', c, 0.36, delay(anim)));
/** `round`: on my own capsules, so the corners stay inside the rounded ends. */
export const hit = (c: number, anim = -1, round = false) => square('hit' + (anim < 0 ? '' : ' pop'), c, 0.18, delay(anim) + (round ? ' rx=".23"' : ''));
export const knownDot = (c: number) => dot('kdot', c, 0.07);
export const last = (c: number) => square('last', c, 0.07);
export const sunk = (ship: Ship, len: number, anim: boolean) =>
  shipRect(ship, len, 'hatch' + (anim ? ' fade' : ''), 0.04, false) + shipRect(ship, len, 'sunk' + (anim ? ' draw' : ''), 0.04, false);
export const sonarBox = (a: number, count: number) =>
  rect('sonar', x(a) - 0.96, y(a) - 0.96, 2.92, 2.92) + `<text class="sonar-n" x="${x(a) - 0.86}" y="${y(a) - 0.5}">${count}</text>`;

/** Islands as land on a chart: one filled shape per island and a coastline only on its outer edges. */
export function land(g: Geo): string {
  N = g.n;
  let fill = '';
  let coast = '';
  for (const c of g.islands) {
    const X = x(c);
    const Y = y(c);
    fill += `M${X} ${Y}h1v1h-1z`;
    const has = (dx: number, dy: number) => X + dx >= 0 && X + dx < N && g.islands.has(c + dx + dy * N);
    if (!has(0, -1)) coast += `M${X} ${Y}h1`;
    if (!has(0, 1)) coast += `M${X} ${Y + 1}h1`;
    if (!has(-1, 0)) coast += `M${X} ${Y}v1`;
    if (!has(1, 0)) coast += `M${X + 1} ${Y}v1`;
  }
  return fill && `<path class="land" d="${fill}"/><path class="coast" d="${coast}"/>`;
}
/** Pickups: an item square, a small diamond with the item's initial. */
export const pickup = (c: number, k: string) =>
  `<path class="pick" d="M${x(c) + 0.5} ${y(c) + 0.12}l.38 .38-.38 .38-.38-.38z"/><text class="pick-k" x="${x(c) + 0.5}" y="${y(c) + 0.62}">${k}</text>`;
/** Prefire: a hollow ring, numbered when several are queued. */
export const queued = (c: number, k: number, many: boolean) =>
  dot('queued', c, 0.28) + (many ? `<text class="sonar-n" x="${x(c) + 0.08}" y="${y(c) + 0.36}">${k + 1}</text>` : '');
/** Torpedo: a track from the entry edge through the lane, an arrow at the entry and a bar where land stops it. */
export function torpedo(g: Geo, line: number[], b: number, stopped: boolean): string {
  if (!line.length) return '';
  const v = b > 1;
  const s = b & 1 ? -1 : 1;
  const a = line[0]!;
  const z = line[line.length - 1]!;
  const [x0, y0] = v ? [x(a) + 0.5, b & 1 ? N : 0] : [b & 1 ? N : 0, y(a) + 0.5];
  const x1 = v ? x0 : x(z) + 0.5 + (s * 0.5);
  const y1 = v ? y(z) + 0.5 + s * 0.5 : y0;
  const arrow = v ? `M${x0 - 0.22} ${y0}h.44L${x0} ${y0 + s * 0.3}z` : `M${x0} ${y0 - 0.22}v.44L${x0 + s * 0.3} ${y0}z`;
  const bar = stopped ? (v ? `M${x1 - 0.3} ${y1}h.6` : `M${x1} ${y1 - 0.3}v.6`) : '';
  return `<path class="tpath" d="M${x0} ${y0}L${x1} ${y1}${bar}"/><path class="arrow" d="${arrow}"/>`;
}

export const cellsOf = (g: Geo, ship: Ship, i: number): number[] => shipCells(g, ship, i) ?? [];
