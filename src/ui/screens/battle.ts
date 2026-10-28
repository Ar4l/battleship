import type { Controller } from '../../app/controller';
import { cellName } from '../../game/board';
import { shotsAllowed, type BoardView, type Match } from '../../game/engine';
import { ENERGY_CAP, ITEMS, clampLine, clampSonar, footprint, itemParamsValid } from '../../game/items';
import { FLEET, SHIP_NAMES } from '../../game/rules';
import type { Attack, Fleet, ItemId } from '../../game/types';
import { board, capsule, cellsOf, hit, knownDot, last, miss, sonarBox, sunk, type BoardModel } from '../grid';
import { h } from '../h';
import { btn, label, type Screen } from '../kit';

/** Board heading. */
export const cap = (text: string) => h('div', 'cap label', text);

/**
 * Classes, labels and overlay for a board. `own`: my fleet on my board.
 * `reveal`: their fleet after the game.
 */
export function model(b: BoardView, o: { own?: Fleet; reveal?: Fleet; sel?: number[]; preview?: Set<number>; anim?: number[] } = {}): BoardModel {
  const occ: number[] = [];
  const sunkAt: number[] = [];
  const delay = new Map((o.anim ?? []).map((c, i) => [c, i * 80]));
  const cls: string[] = [];
  const labels: string[] = [];
  let ov = '';
  o.own?.forEach((s, i) => cellsOf(s, i).forEach((c) => (occ[c] = i)));
  b.sunk.forEach((s, i) => s && cellsOf(s, i).forEach((c) => (sunkAt[c] = i)));
  (o.own ?? o.reveal)?.forEach((s, i) => (o.own || !b.sunk[i]) && (ov += capsule(s, i, o.own ? 'own' : 'reveal')));
  for (let c = 0; c < 100; c++) {
    const shot = b.shot.has(c);
    const isHit = b.hit.has(c);
    const known = b.known.has(c);
    const sel = o.sel?.includes(c);
    const name = SHIP_NAMES[occ[c]!];
    cls.push([shot && 'shot', known && !isHit && 'known', sel && 'sel', o.preview?.has(c) && 'pv'].filter(Boolean).join(' '));
    labels.push(
      `${cellName(c)}, ${sunkAt[c] !== undefined ? 'sunk ' + SHIP_NAMES[sunkAt[c]!] : isHit ? (name ? name + ' hit' : 'hit') : known ? 'known water' : shot ? 'miss' : name || (o.own ? 'water' : 'unknown')}${sel ? ', selected' : ''}`,
    );
    const a = delay.get(c) ?? -1;
    if (known && !isHit) ov += knownDot(c);
    else if (shot) ov += isHit ? hit(c, a) : miss(c, a);
  }
  b.sunk.forEach((s, i) => s && (ov += sunk(s, i, cellsOf(s, i).some((c) => delay.has(c)))));
  for (const s of b.sonar) ov += sonarBox(s.a, s.count);
  for (const c of b.last) if (b.shot.has(c)) ov += last(c);
  return { cls, labels, overlay: ov };
}

/** Fleet status. For theirs only sunk is known; for mine segments fill as hit. */
const fleetList = (title: string, b: BoardView, mine?: Fleet) =>
  h(
    'div',
    'fleet',
    label(title),
    h(
      'ul',
      null,
      SHIP_NAMES.map((name, i) => {
        const cells = mine ? cellsOf(mine[i]!, i) : [];
        return h(
          'li',
          { cls: b.sunk[i] ? 'is-sunk' : '' },
          h('span', null, name, b.sunk[i] && h('span', 'sr-only', ', sunk')),
          h('span', { cls: 'segs', 'aria-hidden': 'true' }, Array.from({ length: FLEET[i]! }, (_, k) => h('i', { cls: b.hit.has(cells[k]!) ? 'hit' : '' }))),
        );
      }),
    ),
  );

const pips = (n: number, of: number, cls: string) => h('span', { cls: 'pips ' + cls, 'aria-hidden': 'true' }, Array.from({ length: of }, (_, k) => h('i', { cls: k < n ? 'on' : '' })));

export function battle(ctrl: Controller): Screen {
  let item: ItemId | null = null;
  let dir = 0;
  let hover: number | null = null;
  /** Touch: the first tap previews an item, the second fires it. */
  let armed: number | null = null;
  const m = () => ctrl.match!;
  const pick = (i: ItemId | null) => {
    item = i;
    dir = 0;
    armed = null;
    render();
  };

  const itemAttack = (cell: number): Attack | null => {
    if (item === null) return null;
    let a = cell;
    let b = 0;
    if (item === 0) a = clampSonar(cell);
    else if (item === 1) {
      b = dir % 4;
      a = b < 2 ? (cell - (cell % 10)) / 10 : cell % 10;
    } else if (item === 3) {
      b = dir % 2;
      a = clampLine(cell, b === 1);
    }
    return itemParamsValid(item, a, b) && !footprint(item, a, b).every((c) => m().target.shot.has(c)) ? { k: 'item', item, a, b } : null;
  };

  const activate = (cell: number, touch: boolean) => {
    const mm = m();
    if (mm.phase !== 'myTurn') return;
    if (item !== null) {
      const atk = itemAttack(cell);
      if (!atk) return;
      if (touch && armed !== cell) {
        armed = hover = cell;
        return render();
      }
      if (ctrl.attack(atk)) item = armed = null;
    } else if (mm.target.shot.has(cell)) return;
    else if (mm.config.mode === 1) ctrl.toggleSel(cell);
    else ctrl.attack({ k: 'fire', cells: [cell] });
  };

  const target = board('Their waters', false, {
    onActivate: activate,
    onHover: (c) => {
      hover = c;
      armed = null;
      if (item !== null) render();
    },
    onKey: (e) => {
      const k = e.key;
      if (k === 'Escape') {
        if (item === null) ctrl.clearSel();
        pick(null);
      } else if ((k === 'r' || k === 'R') && item !== null) {
        dir++;
        render();
      } else if (k === 'Enter' && m().config.mode === 1 && item === null && !ctrl.sel.includes(target.focused())) return ctrl.fireSalvo();
      else return false;
      return true;
    },
  });
  const own = board('Your fleet', true);

  const stripText = h('span', 'strip-main');
  const stripSub = h('span', 'strip-sub');
  const strip = h('div', { cls: 'strip', id: 'strip' }, stripText, stripSub);
  const bar = h('i');
  const timer = h('div', 'timer', bar);
  const actions = h('div', 'actions');
  const theirs = h('div', 'a-theirs');
  const yours = h('div', 'a-yours');
  const stall = h('div', 'a-stall');
  const el = h(
    'section',
    'screen battle',
    h('div', 'a-strip', strip, timer),
    h('div', 'a-target', cap('Their waters'), target.el),
    actions,
    h('div', 'a-own', cap('Your fleet'), own.el),
    theirs,
    yours,
    stall,
  );

  let timerKey = 0;
  const runTimer = (mm: Match) => {
    const total = ctrl.config.timer * 1000;
    const key = ctrl.deadline;
    timer.hidden = !total;
    if (key === timerKey) return;
    timerKey = key;
    const left = key && mm.phase !== 'awaitingAnswer' ? Math.max(0, key - Date.now()) : 0;
    const s = bar.style;
    s.transition = 'none';
    s.transform = `scaleX(${left / total || 0})`;
    bar.className = '';
    if (!left) return;
    void bar.offsetWidth;
    s.transition = `transform ${left}ms linear`;
    s.transform = 'scaleX(0)';
    setTimeout(() => timerKey === key && (bar.className = 'low'), left - 5000);
  };

  let actionsKey = '';
  function renderActions(mm: Match): void {
    const my = mm.phase === 'myTurn';
    const mode = mm.config.mode;
    const n = shotsAllowed(mm, 'me');
    const e = mm.energy.me;
    const key = [mm.phase, item, dir, armed, e, ctrl.sel.length].join();
    if (key === actionsKey) return;
    actionsKey = key;
    if (mode === 1) {
      const fire = btn(`Fire ${ctrl.sel.length}/${n}`, () => ctrl.fireSalvo(), 'primary', 'fire');
      const clear = btn('Clear', () => ctrl.clearSel());
      fire.disabled = !my || ctrl.sel.length !== n;
      clear.disabled = !my || !ctrl.sel.length;
      actions.replaceChildren(h('div', 'salvo', fire, clear, h('p', 'small muted', my ? `Pick ${n} cells, then fire.` : `You fire ${n} shot${n > 1 ? 's' : ''} next turn.`)));
    } else if (mode === 2) {
      const it = item === null ? null : ITEMS[item]!;
      const dirName = item === 1 ? ['from left', 'from right', 'from top', 'from bottom'][dir % 4] : item === 3 && (dir % 2 ? 'vertical' : 'horizontal');
      actions.replaceChildren(
        h('div', 'energy', label('Energy'), pips(e, ENERGY_CAP, ''), h('span', { cls: 'mono small', id: 'energy' }, `${e}/${ENERGY_CAP}`)),
        h(
          'div',
          { cls: 'items', role: 'group', 'aria-label': 'Items' },
          ITEMS.map((d) =>
            h(
              'button',
              {
                cls: 'item',
                'aria-pressed': String(item === d.id),
                'aria-label': `${d.name}, costs ${d.cost}. ${d.desc}`,
                disabled: !my || e < d.cost,
                onclick: () => {
                  pick(item === d.id ? null : d.id);
                  if (item !== null) target.cells[target.focused()]!.focus({ preventScroll: true });
                },
              },
              h('span', null, d.name),
              pips(d.cost, d.cost, 'cost'),
            ),
          ),
        ),
        h(
          'div',
          'item-hint small',
          h(
            'span',
            { cls: it ? '' : 'muted' },
            !it
              ? my
                ? 'Fire a shot, or spend energy on an item.'
                : 'You gain 1 energy each turn.'
              : `${it.name}: ${it.desc.toLowerCase()}. ${armed !== null ? 'Tap again to fire.' : `Choose a target${dirName ? ', ' + dirName : ''}.`}`,
          ),
          dirName && btn(item === 1 ? 'Direction' : 'Rotate', () => (dir++, render()), '', 'item-dir', 'rotate'),
          it && btn('Cancel', () => pick(null), 'quiet'),
        ),
      );
    }
  }

  function render(): void {
    const s = ctrl.state;
    if (s.s !== 'battle') return;
    const mm = s.match;
    const my = mm.phase === 'myTurn';
    if (!my) item = armed = null;
    strip.classList.toggle('mine', my);
    stripText.textContent = s.banner ?? (my ? 'Your turn' : mm.phase === 'awaitingAnswer' ? 'Firing…' : 'Their turn');
    stripSub.textContent = s.banner ? '' : ctrl.lastResult;
    const atk = hover === null ? null : itemAttack(hover);
    const preview = atk?.k === 'item' ? new Set(footprint(atk.item, atk.a, atk.b)) : undefined;
    target.el.classList.toggle('armed', my);
    target.update(model(mm.target, { sel: ctrl.sel, preview, anim: ctrl.fx.target }));
    own.update(model(mm.own, { own: mm.fleet, anim: ctrl.fx.own }));
    ctrl.fx = { target: [], own: [] };
    renderActions(mm);
    theirs.replaceChildren(fleetList('Enemy ships', mm.target));
    yours.replaceChildren(fleetList('Your ships', mm.own, mm.fleet));
    stall.replaceChildren(s.stalled ? h('div', 'callout', h('p', null, "Opponent isn't responding."), btn('Leave', () => ctrl.leaveStalled(), 'primary')) : '');
    runTimer(mm);
  }
  render();
  return { el, update: render };
}
