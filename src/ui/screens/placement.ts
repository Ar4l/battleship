import type { Controller } from '../../app/controller';
import { cellName } from '../../game/board';
import { canPlace, rulesLine } from '../../game/rules';
import type { Geo, Ship } from '../../game/types';
import { announce } from '../announce';
import { board, capsule, cellsOf, land } from '../grid';
import { h } from '../h';
import { btn, label, type Screen } from '../kit';

type Ghost = { i: number; ship: Ship };

/** Move ship i's anchor by (dr, dc) and/or flip it, keeping it on the board. */
function shift(g: Geo, i: number, ship: Ship, dr = 0, dc = 0, flip = false): Ship {
  const len = g.fleet[i]!;
  const n = g.n;
  const v = ship.vertical !== flip;
  const r = Math.max(0, Math.min(v ? n - len : n - 1, (ship.anchor - (ship.anchor % n)) / n + dr));
  const c = Math.max(0, Math.min(v ? n - 1 : n - len, (ship.anchor % n) + dc));
  return { anchor: r * n + c, vertical: v };
}
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export function placement(ctrl: Controller): Screen {
  let sel = 0;
  let ghost: Ghost | null = null; // keyboard lift or drag
  let drag: { i: number; offset: number; x: number; y: number; moved: boolean; id: number; t: number } | null = null;
  const locked = () => ctrl.state.s !== 'placement' || ctrl.state.ready.me;
  const geo = () => ctrl.geo;
  const SHIP_NAMES = geo().names;
  const legal = (g: Ghost) => canPlace(geo(), ctrl.fleet, g.i, g.ship);
  const where = (g: Ghost) => `${cellName(g.ship.anchor, geo().n)} ${g.ship.vertical ? 'vertical' : 'horizontal'}`;
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
    if (locked() || geo().fleet[i] === 1) return;
    const g = { i, ship: shift(geo(), i, ctrl.fleet[i]!, 0, 0, true) };
    place(g, `${SHIP_NAMES[i]} ${where(g)}.`, "Can't rotate here.");
    render();
  };
  const drop = (g: Ghost) => place(g, `${SHIP_NAMES[g.i]} placed at ${cellName(g.ship.anchor, geo().n)}.`);

  const b = board('Your fleet', false, geo().n, {
    onPointerDown: (cell, e) => {
      const i = ctrl.fleet.findIndex((s, k) => cellsOf(geo(), s, k).includes(cell));
      if (locked() || i < 0) return;
      e.preventDefault();
      const s = ctrl.fleet[i]!;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drag = { i, offset: s.vertical ? (cell - s.anchor) / geo().n : cell - s.anchor, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, t: e.timeStamp };
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
    const n = geo().n;
    const r = Math.max(0, (cell - (cell % n)) / n - (v ? drag.offset : 0));
    const c = Math.max(0, (cell % n) - (v ? 0 : drag.offset));
    ghost = { i: drag.i, ship: shift(geo(), drag.i, { anchor: r * n + c, vertical: v }) };
    render();
  });
  on('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    const g = ghost;
    drag = ghost = null;
    // A tap rotates; a press held in place (picking the ship up, then letting go) does not.
    if (!d.moved) e.timeStamp - d.t < 500 && rotate(d.i);
    else if (g) drop(g);
    render();
  });
  on('pointercancel', () => {
    drag = ghost = null;
    render();
  });

  // A legend of chips: the first ship of a class shows its name (and ×n); the rest only their capsule.
  const count = (name: string) => SHIP_NAMES.filter((x) => x === name).length;
  const dockBtns = SHIP_NAMES.map((name, i) =>
    h(
      'button',
      {
        cls: 'dock-ship',
        'data-ship': i,
        'aria-label': `${name}, ${geo().fleet[i]} cells`,
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
            ghost = { i, ship: shift(geo(), i, ghost.ship, ...(MOVES[k] ?? [0, 0]), r) };
            announce(where(ghost) + (legal(ghost) ? '.' : ', blocked.'));
          } else if (k === 'Escape') {
            ghost = null;
            announce('Cancelled.');
          } else return;
          e.preventDefault();
          render();
        },
      },
      h('span', { cls: 'cap-ship', style: `--len:${geo().fleet[i]}` }),
      SHIP_NAMES.indexOf(name) === i && h('span', null, name, count(name) > 1 && h('span', 'mono', ' ×' + count(name))),
    ),
  );

  const rules = h('p', 'small muted rules');
  const hint = h('p', 'small muted pl-hint');
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
      hint,
      h('ul', { cls: 'dock', 'aria-label': 'Ships' }, dockBtns.map((d) => h('li', null, d))),
      h('div', 'row-btns', randomize, rot),
      ready,
    ),
  );

  function render(): void {
    const s = ctrl.state;
    if (s.s !== 'placement') return;
    const me = s.ready.me;
    rules.textContent = rulesLine(ctrl.config);
    const occ: number[] = [];
    let ov = land(geo());
    ctrl.fleet.forEach((sh, i) => {
      cellsOf(geo(), sh, i).forEach((c) => (occ[c] = i));
      ov += capsule(sh, geo().fleet[i]!, 'own' + (ghost?.i === i ? ' lifted' : '') + (i === sel && !me ? ' selected' : ''));
    });
    if (ghost) ov += capsule(ghost.ship, geo().fleet[ghost.i]!, 'ghost' + (legal(ghost) ? '' : ' bad'));
    // Ship cells take the drag; water lets the page scroll and zoom (occ is sparse: water stays empty).
    const isl = geo().islands;
    b.update({
      cls: Array.from({ length: geo().n ** 2 }, (_, c) => (isl.has(c) ? 'land' : occ[c] === undefined || me ? '' : 'ship')),
      labels: Array.from({ length: geo().n ** 2 }, (_, c) => cellName(c, geo().n) + (isl.has(c) ? ', land' : occ[c] === undefined ? '' : ', ' + SHIP_NAMES[occ[c]!])),
      overlay: ov,
    });
    dockBtns.forEach((d, i) => {
      d.setAttribute('aria-pressed', String(i === sel));
      d.classList.toggle('lifted', ghost?.i === i);
      d.disabled = me;
    });
    randomize.disabled = ready.disabled = me;
    rot.disabled = me || geo().fleet[sel] === 1;
    // The waiting state shows where the player just tapped.
    ready.lastChild!.textContent = me ? (s.ready.them ? 'Starting…' : 'Waiting for opponent…') : 'Ready';
    hint.replaceChildren(!me && s.ready.them ? h('span', { id: 'opp-ready' }, 'Opponent ready') : 'Drag to move. Tap a ship to rotate.');
  }
  render();
  return { el, update: render };
}
