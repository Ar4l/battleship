import type { Controller } from '../../app/controller';
import { cellName } from '../../game/board';
import { FLEET, SHIP_NAMES, canPlace, rulesLine } from '../../game/rules';
import type { Ship } from '../../game/types';
import { announce } from '../announce';
import { board, capsule, cellsOf } from '../grid';
import { h } from '../h';
import { blink, btn, label, type Screen } from '../kit';

type Ghost = { i: number; ship: Ship };

/** Move ship i's anchor by (dr, dc) and/or flip it, keeping it on the board. */
function shift(i: number, ship: Ship, dr = 0, dc = 0, flip = false): Ship {
  const len = FLEET[i]!;
  const v = ship.vertical !== flip;
  const r = Math.max(0, Math.min(v ? 10 - len : 9, (ship.anchor - (ship.anchor % 10)) / 10 + dr));
  const c = Math.max(0, Math.min(v ? 9 : 10 - len, (ship.anchor % 10) + dc));
  return { anchor: r * 10 + c, vertical: v };
}
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export function placement(ctrl: Controller): Screen {
  let sel = 0;
  let ghost: Ghost | null = null; // keyboard lift or drag
  let drag: { i: number; offset: number; x: number; y: number; moved: boolean; id: number } | null = null;
  const locked = () => ctrl.state.s !== 'placement' || ctrl.state.ready.me;
  const legal = (g: Ghost) => canPlace(ctrl.fleet, g.i, g.ship, ctrl.config.noTouch);
  const where = (g: Ghost) => `${cellName(g.ship.anchor)} ${g.ship.vertical ? 'vertical' : 'horizontal'}`;
  const snapback = () => {
    b.el.classList.add('snapback');
    setTimeout(() => b.el.classList.remove('snapback'), 160);
  };
  /** Commit a legal ghost, or flash and explain. */
  const place = (g: Ghost, ok: string, bad = "Can't place here.") => {
    sel = g.i;
    if (legal(g)) {
      const f = ctrl.fleet.slice();
      f[g.i] = g.ship;
      ctrl.setFleet(f);
      announce(ok);
      return true;
    }
    announce(bad);
    snapback();
    return false;
  };
  const rotate = (i: number) => {
    if (locked()) return;
    const g = { i, ship: shift(i, ctrl.fleet[i]!, 0, 0, true) };
    place(g, `${SHIP_NAMES[i]} ${where(g)}.`, "Can't rotate here.");
    render();
  };
  const drop = (g: Ghost) => place(g, `${SHIP_NAMES[g.i]} placed at ${cellName(g.ship.anchor)}.`);

  const b = board('Your fleet', false, {
    onPointerDown: (cell, e) => {
      const i = ctrl.fleet.findIndex((s, k) => cellsOf(s, k).includes(cell));
      if (locked() || i < 0) return;
      e.preventDefault();
      const s = ctrl.fleet[i]!;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drag = { i, offset: s.vertical ? (cell - s.anchor) / 10 : cell - s.anchor, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      sel = i;
      render();
    },
  });
  b.el.classList.add('placing');
  const on = (type: string, f: (e: PointerEvent) => void) => b.el.addEventListener(type, (e) => f(e as PointerEvent));
  on('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6)) return;
    drag.moved = true;
    const cell = b.cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    const v = ctrl.fleet[drag.i]!.vertical;
    const r = Math.max(0, (cell - (cell % 10)) / 10 - (v ? drag.offset : 0));
    const c = Math.max(0, (cell % 10) - (v ? 0 : drag.offset));
    ghost = { i: drag.i, ship: shift(drag.i, { anchor: r * 10 + c, vertical: v }) };
    render();
  });
  on('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    const g = ghost;
    drag = ghost = null;
    if (!d.moved) rotate(d.i);
    else if (g) drop(g);
    render();
  });
  on('pointercancel', () => {
    drag = ghost = null;
    render();
  });

  const dockBtns = SHIP_NAMES.map((name, i) =>
    h(
      'button',
      {
        cls: 'dock-ship',
        'data-ship': i,
        onclick: (e: MouseEvent) => {
          if (locked()) return;
          sel = i;
          // Keyboard (detail 0): pick up / drop.
          if (!e.detail) {
            if (ghost?.i === i) {
              if (drop(ghost)) ghost = null;
            } else {
              ghost = { i, ship: ctrl.fleet[i]! };
              announce(`${name} picked up. Arrows move, R rotates, Enter drops, Escape cancels.`);
            }
          }
          render();
        },
        onkeydown: (e: KeyboardEvent) => {
          const k = e.key;
          const r = k === 'r' || k === 'R';
          if (ghost?.i !== i) {
            if (!r) return;
            rotate(i);
          } else if (MOVES[k] || r) {
            ghost = { i, ship: shift(i, ghost.ship, ...(MOVES[k] ?? [0, 0]), r) };
            announce(where(ghost) + (legal(ghost) ? '.' : ', blocked.'));
          } else if (k === 'Escape') {
            ghost = null;
            announce('Cancelled.');
          } else return;
          e.preventDefault();
          render();
        },
      },
      h('span', { cls: 'cap-ship', style: `--len:${FLEET[i]}` }),
      h('span', null, name),
      h('span', 'mono muted small', FLEET[i]),
    ),
  );

  const rules = h('p', 'small muted rules');
  const status = h('p', 'status-line');
  const randomize = btn('Randomize', () => ((ghost = null), ctrl.randomize()), '', 'randomize', 'dice');
  const rot = btn('Rotate', () => rotate(sel), '', 'rotate', 'rotate');
  const ready = btn('Ready', () => void ctrl.ready(), 'primary wide', 'ready');

  const el = h(
    'section',
    'screen placement',
    h('div', 'pl-head', label('Place your fleet'), rules),
    b.el,
    h(
      'div',
      'pl-side',
      h('p', 'small muted hint', 'Drag ships to move them. Click a ship to rotate it.'),
      h('ul', { cls: 'dock', 'aria-label': 'Ships' }, dockBtns.map((d) => h('li', null, d))),
      h('div', 'row-btns', randomize, rot),
      ready,
      status,
    ),
  );

  function render(): void {
    const s = ctrl.state;
    if (s.s !== 'placement') return;
    const me = s.ready.me;
    rules.textContent = rulesLine(ctrl.config);
    const occ: number[] = [];
    let ov = '';
    ctrl.fleet.forEach((sh, i) => {
      cellsOf(sh, i).forEach((c) => (occ[c] = i));
      ov += capsule(sh, i, 'own' + (ghost?.i === i ? ' lifted' : '') + (i === sel && !me ? ' selected' : ''));
    });
    if (ghost) ov += capsule(ghost.ship, ghost.i, 'ghost' + (legal(ghost) ? '' : ' bad'));
    b.update({ cls: [], labels: Array.from({ length: 100 }, (_, c) => cellName(c) + (occ[c] === undefined ? '' : ', ' + SHIP_NAMES[occ[c]!])), overlay: ov });
    dockBtns.forEach((d, i) => {
      d.setAttribute('aria-pressed', String(i === sel));
      d.classList.toggle('lifted', ghost?.i === i);
      d.disabled = me;
    });
    randomize.disabled = rot.disabled = ready.disabled = me;
    status.replaceChildren(
      me ? blink() : '',
      me ? (s.ready.them ? 'Starting…' : 'Waiting for opponent to place their fleet') : s.ready.them ? h('span', { id: 'opp-ready' }, 'Opponent ready') : '',
    );
  }
  render();
  return { el, update: render };
}
