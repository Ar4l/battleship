import type { Controller } from '../../app/controller';
import { cellName } from '../../game/board';
import { shotsAllowed, type BoardView, type Match } from '../../game/engine';
import { ENERGY_CAP, ITEMS, clampLine, clampSonar, footprint, itemParamsValid } from '../../game/items';
import { FLEET, SHIP_NAMES } from '../../game/rules';
import type { Attack, Fleet, ItemId } from '../../game/types';
import { Board, capsule, cellsOf, hit, knownDot, last, miss, sonarBox, sunk, type BoardModel } from '../grid';
import { h } from '../h';
import { btn, label, type Screen } from '../kit';

const sunkIndexAt = (b: BoardView, cell: number): number => b.sunk.findIndex((s, i) => !!s && cellsOf(s, i).includes(cell));

/** Marks shared by both boards. */
function marks(b: BoardView, anim: number[], showLast: boolean): string {
  let ov = '';
  const order = new Map(anim.map((c, i) => [c, i]));
  for (const c of b.shot) {
    const k = order.get(c);
    const a = k !== undefined;
    if (b.hit.has(c)) ov += hit(c, a, a ? k * 80 : 0);
    else if (b.known.has(c)) ov += knownDot(c);
    else ov += miss(c, a, a ? k * 80 : 0);
  }
  for (const c of b.known) if (!b.shot.has(c)) ov += knownDot(c);
  b.sunk.forEach((s, i) => s && (ov += sunk(s, i, cellsOf(s, i).some((c) => order.has(c)))));
  for (const s of b.sonar) ov += sonarBox(s.a, s.count);
  if (showLast) for (const c of b.last) if (b.shot.has(c)) ov += last(c);
  return ov;
}

function stateWord(b: BoardView, c: number, ownShip = -1): string {
  if (b.shot.has(c)) {
    const si = sunkIndexAt(b, c);
    if (si >= 0) return `sunk ${SHIP_NAMES[si]}`;
    if (b.hit.has(c)) return ownShip >= 0 ? `${SHIP_NAMES[ownShip]} hit` : 'hit';
    return b.known.has(c) ? 'known water' : 'miss';
  }
  if (b.known.has(c)) return 'known water';
  return ownShip >= 0 ? SHIP_NAMES[ownShip]! : ownShip === -2 ? 'water' : 'unknown';
}

export function targetModel(m: Match, o: { sel?: number[]; preview?: Set<number>; anim?: number[]; reveal?: Fleet; interactive?: boolean }): BoardModel {
  const b = m.target;
  const cls: string[] = [];
  const labels: string[] = [];
  for (let c = 0; c < 100; c++) {
    let k = b.shot.has(c) ? 'shot' : b.known.has(c) ? 'known' : '';
    if (b.shot.has(c) && b.known.has(c) && !b.hit.has(c)) k += ' known';
    if (o.sel?.includes(c)) k += ' sel';
    if (o.preview?.has(c)) k += ' pv';
    cls.push(k.trim());
    labels.push(`${cellName(c)}, ${stateWord(b, c)}${o.sel?.includes(c) ? ', selected' : ''}`);
  }
  let ov = '';
  if (o.reveal) o.reveal.forEach((s, i) => (ov += capsule(s, FLEET[i]!, 'reveal')));
  ov += marks(b, o.anim ?? [], true);
  return { cls, labels, overlay: ov };
}

export function ownModel(m: Match, anim: number[]): BoardModel {
  const occ = new Array<number>(100).fill(-2);
  m.fleet.forEach((s, i) => cellsOf(s, i).forEach((c) => (occ[c] = i)));
  const cls: string[] = [];
  const labels: string[] = [];
  for (let c = 0; c < 100; c++) {
    cls.push(m.own.shot.has(c) ? 'shot' : m.own.known.has(c) ? 'known' : '');
    labels.push(`${cellName(c)}, ${stateWord(m.own, c, occ[c]!)}`);
  }
  let ov = '';
  m.fleet.forEach((s, i) => (ov += capsule(s, FLEET[i]!, 'own')));
  ov += marks(m.own, anim, true);
  return { cls, labels, overlay: ov };
}

/** Fleet status list. For theirs only sunk is known; for mine segments fill as hit. */
export function fleetList(title: string, b: BoardView, mine: Fleet | null): HTMLElement {
  return h(
    'div',
    { cls: 'fleet' },
    label(title),
    h(
      'ul',
      null,
      SHIP_NAMES.map((name, i) => {
        const isSunk = !!b.sunk[i];
        const cells = mine ? cellsOf(mine[i]!, i) : [];
        return h(
          'li',
          { cls: isSunk ? 'is-sunk' : '' },
          h('span', { cls: 'fl-name' }, name, isSunk ? h('span', { cls: 'sr-only' }, ', sunk') : null),
          h(
            'span',
            { cls: 'segs', 'aria-hidden': 'true' },
            Array.from({ length: FLEET[i]! }, (_, k) => h('i', { cls: mine && b.hit.has(cells[k]!) ? 'hit' : '' })),
          ),
        );
      }),
    ),
  );
}

type Dir = number;

export function battle(ctrl: Controller): Screen {
  let item: ItemId | null = null;
  let dir: Dir = 0;
  let hover: number | null = null;
  let armed: number | null = null; // touch: first tap previews, second confirms

  const m = () => (ctrl.state.s === 'battle' ? ctrl.state.match : null);

  const itemAttack = (cell: number): Attack | null => {
    if (item === null) return null;
    let a = cell;
    let b = 0;
    if (item === 0) a = clampSonar(cell);
    else if (item === 1) {
      b = dir % 4;
      a = b <= 1 ? Math.floor(cell / 10) : cell % 10;
    } else if (item === 3) {
      b = dir % 2;
      a = clampLine(cell, b === 1);
    }
    if (!itemParamsValid(item, a, b)) return null;
    const mm = m();
    if (mm && footprint(item, a, b).every((c) => mm.target.shot.has(c))) return null;
    return { k: 'item', item, a, b };
  };

  const activate = (cell: number, touch: boolean) => {
    const mm = m();
    if (!mm || mm.phase !== 'myTurn') return;
    if (item !== null) {
      const atk = itemAttack(cell);
      if (!atk) return;
      if (touch && armed !== cell) {
        armed = cell;
        hover = cell;
        return render();
      }
      if (ctrl.attack(atk)) {
        item = null;
        armed = null;
      }
      return;
    }
    if (mm.target.shot.has(cell)) return;
    if (mm.config.mode === 1) {
      ctrl.toggleSel(cell);
      return;
    }
    ctrl.attack({ k: 'fire', cells: [cell] });
  };

  const target = new Board({
    label: 'Their waters',
    interactive: true,
    onActivate: activate,
    onHover: (c) => {
      hover = c;
      armed = null;
      if (item !== null) render();
    },
    onKey: (e) => {
      if (e.key === 'Escape') {
        if (item !== null) item = null;
        else ctrl.clearSel();
        render();
        return true;
      }
      if ((e.key === 'r' || e.key === 'R') && item !== null) {
        dir++;
        render();
        return true;
      }
      if (e.key === 'Enter' && m()?.config.mode === 1 && item === null) {
        const mm = m()!;
        if (ctrl.sel.length === shotsAllowed(mm, 'me') && !ctrl.sel.includes(target.focusIdx)) {
          ctrl.fireSalvo();
          return true;
        }
      }
      return false;
    },
  });
  const own = new Board({ label: 'Your fleet', interactive: false });
  own.el.classList.add('mini');

  const stripText = h('span', { cls: 'strip-main' });
  const stripSub = h('span', { cls: 'strip-sub' });
  const strip = h('div', { cls: 'strip', id: 'strip' }, stripText, stripSub);
  const bar = h('div', { cls: 'timer' }, h('i'));
  const actions = h('div', { cls: 'actions' });
  const theirs = h('div', { cls: 'a-theirs' });
  const yours = h('div', { cls: 'a-yours' });
  const stall = h('div', { cls: 'a-stall' });

  const el = h(
    'section',
    { cls: 'screen battle' },
    h('div', { cls: 'a-strip' }, strip, bar),
    h('div', { cls: 'a-target' }, h('div', { cls: 'cap-label label' }, 'Their waters'), target.el),
    actions,
    h('div', { cls: 'a-own' }, h('div', { cls: 'cap-label label' }, 'Your fleet'), own.el),
    theirs,
    yours,
    stall,
  );

  let timerKey = 0;
  const runTimer = (mm: Match) => {
    const i = bar.firstElementChild as HTMLElement;
    const total = ctrl.config.timer * 1000;
    const key = ctrl.deadline;
    if (!total || !ctrl.deadline || mm.phase === 'awaitingAnswer') {
      bar.hidden = !total;
      i.style.transition = 'none';
      i.style.transform = 'scaleX(0)';
      timerKey = 0;
      return;
    }
    bar.hidden = false;
    if (key === timerKey) return;
    timerKey = key;
    const left = Math.max(0, ctrl.deadline - Date.now());
    i.style.transition = 'none';
    i.style.transform = `scaleX(${left / total})`;
    i.classList.remove('low');
    void i.offsetWidth;
    i.style.transition = `transform ${left}ms linear`;
    i.style.transform = 'scaleX(0)';
    setTimeout(() => timerKey === key && i.classList.add('low'), Math.max(0, left - 5000));
  };

  let actionsKey = '';
  function renderActions(mm: Match): void {
    const my = mm.phase === 'myTurn';
    const key = [mm.phase, item, dir, mm.energy.me, ctrl.sel.length, mm.config.mode].join();
    if (key === actionsKey) return;
    actionsKey = key;
    if (mm.config.mode === 1) {
      const n = shotsAllowed(mm, 'me');
      actions.replaceChildren(
        h(
          'div',
          { cls: 'salvo' },
          btn(`Fire ${ctrl.sel.length}/${n}`, () => ctrl.fireSalvo(), { primary: true, disabled: !my || ctrl.sel.length !== n, id: 'fire' }),
          btn('Clear', () => ctrl.clearSel(), { disabled: !my || !ctrl.sel.length }),
          h('p', { cls: 'small muted' }, my ? `Pick ${n} cells, then fire.` : `You fire ${n} shot${n > 1 ? 's' : ''} next turn.`),
        ),
      );
    } else if (mm.config.mode === 2) {
      const pips = (n: number, of: number, cls: string) =>
        h('span', { cls: 'pips ' + cls, 'aria-hidden': 'true' }, Array.from({ length: of }, (_, k) => h('i', { cls: k < n ? 'on' : '' })));
      const needsDir = item === 1 || item === 3;
      const dirName = item === 1 ? ['from left', 'from right', 'from top', 'from bottom'][dir % 4] : item === 3 ? (dir % 2 ? 'vertical' : 'horizontal') : '';
      actions.replaceChildren(
        h(
          'div',
          { cls: 'items' },
          h('div', { cls: 'energy' }, label('Energy'), pips(mm.energy.me, ENERGY_CAP, 'energy-pips'), h('span', { cls: 'mono small', id: 'energy' }, `${mm.energy.me}/${ENERGY_CAP}`)),
          h(
            'div',
            { cls: 'item-row', role: 'group', 'aria-label': 'Items' },
            ITEMS.map((it) =>
              h(
                'button',
                {
                  type: 'button',
                  cls: 'item',
                  'data-item': it.id,
                  'aria-pressed': String(item === it.id),
                  'aria-label': `${it.name}, costs ${it.cost}. ${it.desc}`,
                  disabled: !my || mm.energy.me < it.cost,
                  onclick: () => {
                    item = item === it.id ? null : it.id;
                    dir = 0;
                    armed = null;
                    render();
                    if (item !== null) target.cells[target.focusIdx]?.focus({ preventScroll: true });
                  },
                },
                h('span', { cls: 'item-name' }, it.name),
                pips(it.cost, it.cost, 'cost'),
              ),
            ),
          ),
          h(
            'div',
            { cls: 'item-hint small' },
            item === null
              ? h('span', { cls: 'muted' }, my ? 'Fire a shot, or spend energy on an item.' : 'You gain 1 energy each turn.')
              : h('span', null, `${ITEMS[item]!.name}: ${ITEMS[item]!.desc.toLowerCase()}. Choose a target${needsDir ? `, ${dirName}` : ''}.`),
            needsDir ? btn(item === 1 ? 'Direction' : 'Rotate', () => (dir++, render()), { icon: 'rotate', id: 'item-dir' }) : null,
            item !== null ? btn('Cancel', () => ((item = null), render()), { quiet: true }) : null,
          ),
        ),
      );
    } else actions.replaceChildren();
  }

  function render(): void {
    const s = ctrl.state;
    if (s.s !== 'battle') return;
    const mm = s.match;
    const my = mm.phase === 'myTurn';
    if (!my) {
      item = null;
      armed = null;
    }
    strip.classList.toggle('mine', my);
    stripText.textContent = s.banner ?? (my ? 'Your turn' : mm.phase === 'awaitingAnswer' ? 'Firing…' : 'Waiting for opponent');
    stripSub.textContent = s.banner ? '' : ctrl.lastResult;
    let preview: Set<number> | undefined;
    if (item !== null && hover !== null) {
      const atk = itemAttack(hover);
      if (atk && atk.k === 'item') preview = new Set(footprint(atk.item, atk.a, atk.b));
    }
    target.el.classList.toggle('armed', my);
    target.el.classList.toggle('aiming', item !== null);
    target.update(targetModel(mm, { sel: ctrl.sel, preview, anim: ctrl.fx.target }));
    own.update(ownModel(mm, ctrl.fx.own));
    ctrl.fx = { target: [], own: [] };
    renderActions(mm);
    theirs.replaceChildren(fleetList('Their fleet', mm.target, null));
    yours.replaceChildren(fleetList('Your fleet', mm.own, mm.fleet));
    stall.replaceChildren(
      s.stalled ? h('div', { cls: 'callout' }, h('p', null, "Opponent isn't responding."), btn('Leave', () => ctrl.leaveStalled(), { primary: true })) : '',
    );
    runTimer(mm);
  }
  render();
  return { el, update: render };
}
