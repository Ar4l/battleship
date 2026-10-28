import { FLEET, shipCells } from '../game/rules';
import type { Ship } from '../game/types';
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
  /** SVG markup drawn over the cells (viewBox 0 0 10 10). */
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

const COLS = 'ABCDEFGHIJ';
const span = (s: string | number) => `<span>${s}</span>`;

/** A 10×10 board with persistent cells (focus and pointer capture survive updates). */
export function board(label: string, mini: boolean, o: BoardOpts = {}): Board {
  const live = !!o.onActivate;
  let rows = '';
  for (let i = 0; i < 100; i++)
    rows +=
      (i % 10 ? '' : '<div role="row" class="row">') +
      `<div role="gridcell" class="gc">${live ? `<button class="cell" tabindex="${i ? -1 : 0}" data-i="${i}"></button>` : `<span class="cell" data-i="${i}"></span>`}</div>` +
      (i % 10 === 9 ? '</div>' : '');
  const el = h('div', { cls: 'board' + (mini ? ' mini' : '') });
  el.innerHTML =
    `<div></div><div class="colh" aria-hidden="true">${[...COLS].map(span).join('')}</div><div class="rowh" aria-hidden="true">${[...COLS].map((_, i) => span(i + 1)).join('')}</div>` +
    `<div class="field"><div class="cells" role="grid" aria-label="${label}"${live ? '' : ' aria-readonly="true"'}>${rows}</div><svg class="ov" viewBox="0 0 10 10" aria-hidden="true"></svg></div>`;
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
      const r = i - (i % 10);
      const n = { ArrowUp: i < 10 ? i : i - 10, ArrowDown: i > 89 ? i : i + 10, ArrowLeft: i === r ? i : i - 1, ArrowRight: i === r + 9 ? i : i + 1, Home: e.ctrlKey ? 0 : r, End: e.ctrlKey ? 99 : r + 9 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      touch = false;
      setFocus(n, true);
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
      const c = Math.floor(((x - r.left) / r.width) * 10);
      const row = Math.floor(((y - r.top) / r.height) * 10);
      return c < 0 || c > 9 || row < 0 || row > 9 ? -1 : row * 10 + c;
    },
  };
}

// ---------- SVG overlay builders (units: 1 = one cell) ----------

const x = (c: number) => c % 10;
const y = (c: number) => (c - (c % 10)) / 10;
const rect = (cls: string, x0: number, y0: number, w: number, hh: number, extra = '') =>
  `<rect class="${cls}" x="${x0}" y="${y0}" width="${w}" height="${hh}"${extra}/>`;
const square = (cls: string, c: number, inset: number, extra = '') => rect(cls, x(c) + inset, y(c) + inset, 1 - 2 * inset, 1 - 2 * inset, extra);
const dot = (cls: string, c: number, r: number, extra = '') => `<circle class="${cls}"${extra} cx="${x(c) + 0.5}" cy="${y(c) + 0.5}" r="${r}"/>`;
const delay = (ms: number) => (ms ? ` style="animation-delay:${ms}ms"` : '');

/** Ship outline; `round` draws a capsule. */
export function shipRect(ship: Ship, len: number, cls: string, inset: number, round = true): string {
  const c = ship.anchor;
  const w = ship.vertical ? 1 : len;
  const hh = ship.vertical ? len : 1;
  return rect(cls, x(c) + inset, y(c) + inset, w - 2 * inset, hh - 2 * inset, round ? ` rx="${0.5 - inset}"` : ' pathLength="100"');
}
export const capsule = (ship: Ship, i: number, cls: string) => shipRect(ship, FLEET[i]!, cls, 0.14);

/** `anim` is the stagger delay in ms, or -1 for no animation. */
export const miss = (c: number, anim = -1) => dot('miss', c, 0.14) + (anim < 0 ? '' : dot('ring', c, 0.36, delay(anim)));
export const hit = (c: number, anim = -1) => square('hit' + (anim < 0 ? '' : ' pop'), c, 0.18, delay(anim));
export const knownDot = (c: number) => dot('kdot', c, 0.07);
export const last = (c: number) => square('last', c, 0.07);
export const sunk = (ship: Ship, i: number, anim: boolean) =>
  shipRect(ship, FLEET[i]!, 'hatch' + (anim ? ' fade' : ''), 0.04, false) + shipRect(ship, FLEET[i]!, 'sunk' + (anim ? ' draw' : ''), 0.04, false);
export const sonarBox = (a: number, count: number) =>
  rect('sonar', x(a) - 0.96, y(a) - 0.96, 2.92, 2.92) + `<text class="sonar-n" x="${x(a) - 0.86}" y="${y(a) - 0.5}">${count}</text>`;

export const cellsOf = (ship: Ship, i: number): number[] => shipCells(ship, FLEET[i]!) ?? [];
