import { FLEET, shipCells } from '../game/rules';
import type { Ship } from '../game/types';
import { h } from './h';

export interface BoardOpts {
  label: string;
  interactive: boolean;
  onActivate?(cell: number, touch: boolean): void;
  onHover?(cell: number | null): void;
  /** Return true when handled. */
  onKey?(e: KeyboardEvent, cell: number): boolean;
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

const COLS = 'ABCDEFGHIJ';

/** A 10×10 board with persistent cells (focus and pointer capture survive updates). */
export class Board {
  el: HTMLElement;
  cells: HTMLElement[] = [];
  private grid: HTMLElement;
  private ov: SVGSVGElement;
  focusIdx = 0;
  private lastTouch = false;

  constructor(private o: BoardOpts) {
    this.grid = h('div', { cls: 'cells', role: 'grid', 'aria-label': o.label, 'aria-readonly': o.interactive ? undefined : 'true' });
    for (let r = 0; r < 10; r++) {
      const row = h('div', { role: 'row', cls: 'row' });
      for (let c = 0; c < 10; c++) {
        const i = r * 10 + c;
        const inner = o.interactive
          ? h('button', { type: 'button', cls: 'cell', tabindex: i === 0 ? 0 : -1, 'data-i': i })
          : h('span', { cls: 'cell', 'data-i': i });
        this.cells.push(inner);
        row.append(h('div', { role: 'gridcell', cls: 'gc' }, inner));
      }
      this.grid.append(row);
    }
    this.ov = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.ov.setAttribute('viewBox', '0 0 10 10');
    this.ov.setAttribute('class', 'ov');
    this.ov.setAttribute('aria-hidden', 'true');
    this.el = h(
      'div',
      { cls: 'board' },
      h('div', { cls: 'corner', 'aria-hidden': 'true' }),
      h('div', { cls: 'colh', 'aria-hidden': 'true' }, [...COLS].map((ch) => h('span', null, ch))),
      h('div', { cls: 'rowh', 'aria-hidden': 'true' }, Array.from({ length: 10 }, (_, i) => h('span', null, i + 1))),
      h('div', { cls: 'field' }, this.grid, this.ov),
    );
    const idx = (e: Event): number => {
      const t = (e.target as HTMLElement).closest?.('[data-i]');
      return t ? +(t as HTMLElement).dataset.i! : -1;
    };
    this.grid.addEventListener('pointerdown', (e) => {
      this.lastTouch = e.pointerType !== 'mouse';
      const i = idx(e);
      if (i >= 0) o.onPointerDown?.(i, e);
    });
    if (o.interactive) {
      this.grid.addEventListener('click', (e) => {
        const i = idx(e);
        if (i < 0) return;
        this.setFocus(i, false);
        // Keyboard "clicks" have detail 0.
        o.onActivate?.(i, (e as MouseEvent).detail > 0 && this.lastTouch);
      });
      this.grid.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'mouse') {
          const i = idx(e);
          if (i >= 0) o.onHover?.(i);
        }
      });
      this.grid.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && o.onHover?.(null));
      this.grid.addEventListener('focusin', (e) => {
        const i = idx(e);
        if (i >= 0) {
          this.focusIdx = i;
          if (!this.lastTouch) o.onHover?.(i);
        }
      });
      this.grid.addEventListener('keydown', (e) => this.key(e));
    }
  }

  private key(e: KeyboardEvent): void {
    const i = this.focusIdx;
    if (this.o.onKey?.(e, i)) return e.preventDefault();
    const r = Math.floor(i / 10);
    const c = i % 10;
    let n = -1;
    switch (e.key) {
      case 'ArrowUp':
        n = r > 0 ? i - 10 : i;
        break;
      case 'ArrowDown':
        n = r < 9 ? i + 10 : i;
        break;
      case 'ArrowLeft':
        n = c > 0 ? i - 1 : i;
        break;
      case 'ArrowRight':
        n = c < 9 ? i + 1 : i;
        break;
      case 'Home':
        n = e.ctrlKey ? 0 : r * 10;
        break;
      case 'End':
        n = e.ctrlKey ? 99 : r * 10 + 9;
        break;
    }
    if (n >= 0) {
      e.preventDefault();
      this.lastTouch = false;
      this.setFocus(n, true);
    }
  }

  setFocus(i: number, move: boolean): void {
    this.cells[this.focusIdx]?.setAttribute('tabindex', '-1');
    this.focusIdx = i;
    const el = this.cells[i]!;
    el.setAttribute('tabindex', '0');
    if (move) el.focus();
  }

  update(m: BoardModel): void {
    for (let i = 0; i < 100; i++) {
      const el = this.cells[i]!;
      const cls = 'cell' + (m.cls[i] ? ' ' + m.cls[i] : '');
      if (el.className !== cls) el.className = cls;
      if (this.o.interactive) {
        if (el.getAttribute('aria-label') !== m.labels[i]) el.setAttribute('aria-label', m.labels[i]!);
      } else if (el.textContent !== m.labels[i]) el.textContent = m.labels[i]!;
    }
    this.ov.innerHTML = m.overlay;
  }

  /** Cell under a client point, or -1 when off the board. */
  cellAt(x: number, y: number): number {
    const r = this.grid.getBoundingClientRect();
    const c = Math.floor(((x - r.left) / r.width) * 10);
    const row = Math.floor(((y - r.top) / r.height) * 10);
    return c < 0 || c > 9 || row < 0 || row > 9 ? -1 : row * 10 + c;
  }
}

// ---------- SVG overlay builders (units: 1 = one cell) ----------

const xy = (cell: number) => [cell % 10, Math.floor(cell / 10)] as const;

export function capsule(ship: Ship, len: number, cls: string): string {
  const [x, y] = xy(ship.anchor);
  const w = ship.vertical ? 1 : len;
  const hh = ship.vertical ? len : 1;
  const inset = 0.14;
  return `<rect class="${cls}" x="${x + inset}" y="${y + inset}" width="${w - 2 * inset}" height="${hh - 2 * inset}" rx="${0.5 - inset}"/>`;
}

export function shipRect(ship: Ship, len: number, cls: string, inset = 0): string {
  const [x, y] = xy(ship.anchor);
  const w = ship.vertical ? 1 : len;
  const hh = ship.vertical ? len : 1;
  return `<rect class="${cls}" x="${x + inset}" y="${y + inset}" width="${w - 2 * inset}" height="${hh - 2 * inset}" pathLength="100"/>`;
}

export function miss(cell: number, anim: boolean, delay = 0): string {
  const [x, y] = xy(cell);
  const st = delay ? ` style="animation-delay:${delay}ms"` : '';
  return `<circle class="miss" cx="${x + 0.5}" cy="${y + 0.5}" r=".14"/>` + (anim ? `<circle class="ring"${st} cx="${x + 0.5}" cy="${y + 0.5}" r=".36"/>` : '');
}

export function hit(cell: number, anim: boolean, delay = 0): string {
  const [x, y] = xy(cell);
  const st = delay ? ` style="animation-delay:${delay}ms"` : '';
  return `<rect class="hit${anim ? ' pop' : ''}"${st} x="${x + 0.18}" y="${y + 0.18}" width=".64" height=".64"/>`;
}

export function knownDot(cell: number): string {
  const [x, y] = xy(cell);
  return `<circle class="kdot" cx="${x + 0.5}" cy="${y + 0.5}" r=".07"/>`;
}

export function last(cell: number): string {
  const [x, y] = xy(cell);
  return `<rect class="last" x="${x + 0.07}" y="${y + 0.07}" width=".86" height=".86"/>`;
}

export function sunk(ship: Ship, i: number, anim: boolean): string {
  const len = FLEET[i]!;
  return shipRect(ship, len, 'hatch' + (anim ? ' fade' : ''), 0.04) + shipRect(ship, len, 'sunk' + (anim ? ' draw' : ''), 0.04);
}

export function sonarBox(a: number, count: number): string {
  const [x, y] = xy(a);
  return `<rect class="sonar" x="${x - 1 + 0.04}" y="${y - 1 + 0.04}" width="2.92" height="2.92"/><text class="sonar-n" x="${x - 1 + 0.14}" y="${y - 1 + 0.5}">${count}</text>`;
}

export const cellsOf = (ship: Ship, i: number): number[] => shipCells(ship, FLEET[i]!) ?? [];
