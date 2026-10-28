import type { Controller } from '../../app/controller';
import { cellName } from '../../game/board';
import { FLEET, SHIP_NAMES, canPlace, rulesLine } from '../../game/rules';
import type { Fleet, Ship } from '../../game/types';
import { announce } from '../announce';
import { Board, capsule, cellsOf } from '../grid';
import { h } from '../h';
import { btn, label, type Screen } from '../kit';

interface Ghost {
  i: number;
  ship: Ship;
}

/** Move an anchor by (dr, dc), keeping the ship on the board. */
function shift(ship: Ship, len: number, dr: number, dc: number): Ship {
  let r = Math.floor(ship.anchor / 10) + dr;
  let c = (ship.anchor % 10) + dc;
  const maxR = ship.vertical ? 10 - len : 9;
  const maxC = ship.vertical ? 9 : 10 - len;
  r = Math.max(0, Math.min(maxR, r));
  c = Math.max(0, Math.min(maxC, c));
  return { anchor: r * 10 + c, vertical: ship.vertical };
}

function rotated(ship: Ship, len: number): Ship {
  return shift({ anchor: ship.anchor, vertical: !ship.vertical }, len, 0, 0);
}

export function placement(ctrl: Controller): Screen {
  let sel = 0;
  let ghost: Ghost | null = null; // keyboard lift or drag
  let drag: { i: number; offset: number; x: number; y: number; moved: boolean; pointer: number; target: Element } | null = null;
  const noTouch = () => ctrl.config.noTouch;
  const locked = () => ctrl.state.s === 'placement' && ctrl.state.ready.me;
  const legal = (g: Ghost) => canPlace(ctrl.fleet, g.i, g.ship, noTouch());
  const commit = (i: number, ship: Ship) => {
    const f: Fleet = ctrl.fleet.slice();
    f[i] = ship;
    ctrl.setFleet(f);
  };

  const shipAt = (cell: number): number => ctrl.fleet.findIndex((s, i) => cellsOf(s, i).includes(cell));

  const board = new Board({
    label: 'Your fleet',
    interactive: false,
    onPointerDown: (cell, e) => {
      if (locked()) return;
      const i = shipAt(cell);
      if (i < 0) return;
      e.preventDefault();
      const s = ctrl.fleet[i]!;
      const offset = s.vertical ? Math.floor(cell / 10) - Math.floor(s.anchor / 10) : (cell % 10) - (s.anchor % 10);
      const target = e.target as Element;
      target.setPointerCapture?.(e.pointerId);
      drag = { i, offset, x: e.clientX, y: e.clientY, moved: false, pointer: e.pointerId, target };
      sel = i;
      render();
    },
  });
  board.el.classList.add('placing');

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.moved = true;
    const cell = board.cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    const s = ctrl.fleet[drag.i]!;
    const len = FLEET[drag.i]!;
    const r = Math.floor(cell / 10) - (s.vertical ? drag.offset : 0);
    const c = (cell % 10) - (s.vertical ? 0 : drag.offset);
    const want: Ship = { anchor: Math.max(0, r) * 10 + Math.max(0, c), vertical: s.vertical };
    ghost = { i: drag.i, ship: shift(want, len, 0, 0) };
    render();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      ghost = null;
      rotate(d.i);
      return;
    }
    if (ghost && legal(ghost)) {
      commit(ghost.i, ghost.ship);
      announce(`${SHIP_NAMES[ghost.i]} placed at ${cellName(ghost.ship.anchor)}.`);
    } else {
      announce("Can't place here.");
      board.el.classList.add('snapback');
      setTimeout(() => board.el.classList.remove('snapback'), 160);
    }
    ghost = null;
    render();
  };
  board.el.addEventListener('pointermove', onMove);
  board.el.addEventListener('pointerup', onUp);
  board.el.addEventListener('pointercancel', () => {
    drag = null;
    ghost = null;
    render();
  });

  function rotate(i: number): void {
    if (locked()) return;
    const g = { i, ship: rotated(ctrl.fleet[i]!, FLEET[i]!) };
    sel = i;
    if (legal(g)) {
      commit(i, g.ship);
      announce(`${SHIP_NAMES[i]} ${g.ship.vertical ? 'vertical' : 'horizontal'}.`);
    } else {
      announce("Can't rotate here.");
      render();
    }
  }

  const dock = h('ul', { cls: 'dock', 'aria-label': 'Ships' });
  const dockBtns = SHIP_NAMES.map((name, i) => {
    const b = h(
      'button',
      {
        type: 'button',
        cls: 'dock-ship',
        'data-ship': i,
        onclick: (e: MouseEvent) => {
          if (locked()) return;
          sel = i;
          if (e.detail === 0) {
            // Keyboard: pick up / drop
            if (ghost && ghost.i === i) drop();
            else {
              ghost = { i, ship: { ...ctrl.fleet[i]! } };
              announce(`${name} picked up. Arrows move, R rotates, Enter drops, Escape cancels.`);
            }
          }
          render();
        },
        onkeydown: (e: KeyboardEvent) => {
          if (!ghost || ghost.i !== i) {
            if (e.key === 'r' || e.key === 'R') {
              e.preventDefault();
              rotate(i);
            }
            return;
          }
          const len = FLEET[i]!;
          const k = e.key;
          const mv: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
          if (mv[k]) ghost = { i, ship: shift(ghost.ship, len, ...mv[k]!) };
          else if (k === 'r' || k === 'R') ghost = { i, ship: rotated(ghost.ship, len) };
          else if (k === 'Escape') {
            ghost = null;
            announce('Cancelled.');
          } else return;
          e.preventDefault();
          if (ghost) announce(`${cellName(ghost.ship.anchor)} ${ghost.ship.vertical ? 'vertical' : 'horizontal'}${legal(ghost) ? '' : ', blocked'}.`);
          render();
        },
      },
      h('span', { cls: 'cap', style: `--len:${FLEET[i]}` }),
      h('span', { cls: 'dock-name' }, name),
      h('span', { cls: 'mono muted small' }, FLEET[i]),
    );
    dock.append(h('li', null, b));
    return b;
  });

  function drop(): void {
    if (!ghost) return;
    if (legal(ghost)) {
      commit(ghost.i, ghost.ship);
      announce(`${SHIP_NAMES[ghost.i]} placed at ${cellName(ghost.ship.anchor)}.`);
      ghost = null;
    } else announce("Can't place here.");
  }

  const rules = h('p', { cls: 'small muted rules-line' });
  const status = h('p', { cls: 'status-line', 'aria-live': 'off' });
  const randomize = btn('Randomize', () => {
    ghost = null;
    ctrl.randomize();
  }, { icon: 'dice', id: 'randomize' });
  const rot = btn('Rotate', () => rotate(sel), { icon: 'rotate', id: 'rotate' });
  const ready = btn('Ready', () => void ctrl.ready(), { primary: true, id: 'ready' });

  const el = h(
    'section',
    { cls: 'screen placement' },
    h('div', { cls: 'pl-head' }, label('Place your fleet'), rules),
    h('div', { cls: 'pl-board' }, board.el),
    h(
      'div',
      { cls: 'pl-side' },
      h('p', { cls: 'small muted hint' }, 'Drag ships to move them. Tap a ship to rotate it.'),
      dock,
      h('div', { cls: 'row-btns' }, randomize, rot),
      ready,
      status,
    ),
  );

  function render(): void {
    const s = ctrl.state;
    if (s.s !== 'placement') return;
    rules.textContent = rulesLine(ctrl.config);
    const fleet = ctrl.fleet;
    const cls: string[] = new Array(100).fill('');
    const labels: string[] = [];
    const occ = new Array<number>(100).fill(-1);
    fleet.forEach((sh, i) => cellsOf(sh, i).forEach((c) => (occ[c] = i)));
    for (let c = 0; c < 100; c++) labels.push(cellName(c) + (occ[c]! >= 0 ? ', ' + SHIP_NAMES[occ[c]!] : ''));
    let ov = '';
    fleet.forEach((sh, i) => {
      const lifted = ghost?.i === i;
      ov += capsule(sh, FLEET[i]!, 'own' + (lifted ? ' lifted' : '') + (i === sel && !locked() ? ' selected' : ''));
    });
    if (ghost) ov += capsule(ghost.ship, FLEET[ghost.i]!, 'ghost' + (legal(ghost) ? '' : ' bad'));
    board.update({ cls, labels, overlay: ov });
    dockBtns.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i === sel));
      b.classList.toggle('lifted', ghost?.i === i);
      b.disabled = s.ready.me;
    });
    randomize.disabled = rot.disabled = ready.disabled = s.ready.me;
    ready.querySelector('span')!.textContent = s.ready.me ? 'Ready' : 'Ready';
    status.replaceChildren(
      s.ready.me
        ? h('span', null, h('span', { cls: 'blink', 'aria-hidden': 'true' }), s.ready.them ? 'Starting…' : 'Waiting for opponent to place their fleet')
        : s.ready.them
          ? h('span', { id: 'opp-ready' }, 'Opponent ready')
          : '',
    );
  }
  render();
  return { el, update: render };
}
