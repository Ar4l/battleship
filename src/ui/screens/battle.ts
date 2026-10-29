import type { Controller } from '../../app/controller';
import { cellName } from '../../game/board';
import { shotsAllowed, type BoardView, type Match } from '../../game/engine';
import { ENERGY_CAP, HOLD_CAP, ITEMS, clampLine, clampSonar, footprint, itemParamsValid } from '../../game/items';
import { rulesLine } from '../../game/rules';
import type { Attack, Fleet, Geo, ItemId } from '../../game/types';
import { announce } from '../announce';
import { board, capsule, cellsOf, hit, knownDot, land, last, miss, pickup, queued, sonarBox, sunk, torpedo, type BoardModel } from '../grid';
import { h } from '../h';
import { btn, label, type Screen } from '../kit';

/** Board heading. */
export const cap = (text: string) => h('div', 'cap label', text);

/**
 * Classes, labels and overlay for a board. `own`: my fleet on my board.
 * `reveal`: their fleet after the game. `lane`: the torpedo's path.
 */
export function model(
  g: Geo,
  b: BoardView,
  o: { own?: Fleet; reveal?: Fleet; sel?: number[]; preview?: Set<number>; lane?: boolean; queue?: number[]; anim?: number[] } = {},
): BoardModel {
  const occ: number[] = [];
  const sunkAt: number[] = [];
  const delay = new Map((o.anim ?? []).map((c, i) => [c, i * 80]));
  const cls: string[] = [];
  const labels: string[] = [];
  let ov = land(g);
  const SHIP_NAMES = g.names;
  o.own?.forEach((s, i) => cellsOf(g, s, i).forEach((c) => (occ[c] = i)));
  b.sunk.forEach((s, i) => s && cellsOf(g, s, i).forEach((c) => (sunkAt[c] = i)));
  (o.own ?? o.reveal)?.forEach((s, i) => (o.own || !b.sunk[i]) && (ov += capsule(s, g.fleet[i]!, o.own ? 'own' : 'reveal')));
  for (let c = 0; c < g.n ** 2; c++) {
    if (g.islands.has(c)) {
      cls.push('land');
      labels.push(cellName(c, g.n) + ', land');
      continue;
    }
    const shot = b.shot.has(c);
    const isHit = b.hit.has(c);
    const known = b.known.has(c);
    const sel = o.sel?.includes(c);
    const q = o.queue?.indexOf(c) ?? -1;
    const name = SHIP_NAMES[occ[c]!];
    const pk = b.pick.get(c);
    cls.push([shot && 'shot', known && !isHit && 'known', sel && 'sel', o.preview?.has(c) && (o.lane ? 'lane' : 'pv'), q >= 0 && 'queued'].filter(Boolean).join(' '));
    labels.push(
      `${cellName(c, g.n)}, ${sunkAt[c] !== undefined ? 'sunk ' + SHIP_NAMES[sunkAt[c]!] : isHit ? (name ? name + ' hit' : 'hit') : known ? 'known water' : shot ? 'miss' : name || (o.own ? 'water' : 'unknown')}${pk === undefined ? '' : ', item square: ' + ITEMS[pk]!.name}${sel ? ', selected' : q >= 0 ? ', queued' : ''}`,
    );
    const a = delay.get(c) ?? -1;
    if (known && !isHit) ov += knownDot(c);
    else if (shot) ov += isHit ? hit(c, a, !!o.own) : miss(c, a);
    if (pk !== undefined) ov += pickup(c, ITEMS[pk]!.name[0]!);
    if (q >= 0) ov += queued(c, q, o.queue!.length > 1);
  }
  b.sunk.forEach((s, i) => s && (ov += sunk(s, g.fleet[i]!, cellsOf(g, s, i).some((c) => delay.has(c)))));
  for (const s of b.sonar) ov += sonarBox(s.a, s.count);
  // Not inside a sunk ship's outline: the marker would split the capsule.
  for (const c of b.last) if (b.shot.has(c) && sunkAt[c] === undefined) ov += last(c);
  return { cls, labels, overlay: ov };
}

/** Fleet status, one row per class. For theirs only sunk is known; for mine segments fill as hit. */
const fleetList = (g: Geo, title: string, b: BoardView, mine?: Fleet) => {
  const classes = new Map<string, number[]>();
  g.names.forEach((n, i) => classes.set(n, [...(classes.get(n) ?? []), i]));
  return h(
    'div',
    'fleet',
    label(title),
    h(
      'ul',
      null,
      [...classes].map(([name, ids]) => {
        const down = ids.filter((i) => b.sunk[i]).length;
        return h(
          'li',
          { cls: down === ids.length ? 'is-sunk' : '' },
          h('span', null, name, down > 0 && h('span', 'sr-only', `, ${down} sunk`)),
          h(
            'span',
            { cls: 'ships', 'aria-hidden': 'true' },
            ids.map((i) => {
              const cells = mine ? cellsOf(g, mine[i]!, i) : [];
              return h('span', { cls: 'segs' + (b.sunk[i] ? ' sunk' : '') }, Array.from({ length: g.fleet[i]! }, (_, k) => h('i', { cls: b.hit.has(cells[k]!) ? 'hit' : '' })));
            }),
          ),
        );
      }),
    ),
  );
};

const pips = (n: number, of: number, cls: string, spend = 0) =>
  h('span', { cls: 'pips ' + cls, 'aria-hidden': 'true' }, Array.from({ length: of }, (_, k) => h('i', { cls: k < n - spend ? 'on' : k < n ? 'on spend' : '' })));

/** Short names: "Cross", "Line". */
const short = (id: number) => ITEMS[id]!.name.split(' ')[0];
/** Torpedo directions in Rotate order (clockwise), and the wire edge b for each. */
const TORPEDO_DIRS = ['From left', 'From top', 'From right', 'From bottom'];
const TORPEDO_B = [0, 2, 1, 3];
const TIP = 'Tap squares to queue shots.';
/** Their turns seen this session: the prefire tip shows for the first two. */
let theirTurns = 0;

export function battle(ctrl: Controller): Screen {
  let item: ItemId | null = null;
  let dir = 0;
  /** Where the item footprint sits, and whether the player chose it (Fire needs that). */
  let aim: number | null = null;
  let armed = false;
  /** Aimed by a touch tap: the next tap on that cell fires. */
  let tapped = false;
  let lastAim: number | null = null;
  let phase = '';
  const m = () => ctrl.match!;
  const g = m().geo;
  const n = g.n;
  const pick = (i: ItemId | null) => {
    item = i;
    dir = 0;
    // The footprint shows at once: where the last item went, or the board centre.
    aim = i === null ? null : (lastAim ?? (n >> 1) * n + (n >> 1));
    armed = tapped = false;
    render();
  };
  const dirName = () => (item === 1 ? TORPEDO_DIRS[dir % 4] : item === 3 ? (dir % 2 ? 'Vertical' : 'Horizontal') : '');

  const itemAttack = (cell: number | null): Attack | null => {
    if (item === null || cell === null) return null;
    let a = cell;
    let b = 0;
    if (item === 0) a = clampSonar(g, cell);
    else if (item === 1) {
      b = TORPEDO_B[dir % 4]!;
      a = b < 2 ? (cell - (cell % n)) / n : cell % n;
    } else if (item === 3) {
      b = dir % 2;
      a = clampLine(g, cell, b === 1);
    }
    return itemParamsValid(g, item, a, b) && !footprint(g, item, a, b).every((c) => m().target.shot.has(c)) ? { k: 'item', item, a, b } : null;
  };
  /** Fire the item, or on their turn queue it. */
  const fireItem = (cell: number | null) => {
    const atk = itemAttack(cell);
    if (atk && (m().phase === 'myTurn' ? ctrl.attack(atk) : (ctrl.prefireItem(atk), announce('Queued ' + ITEMS[item!]!.name), true))) {
      lastAim = cell;
      item = aim = null;
    }
  };

  const activate = (cell: number, touch: boolean) => {
    const mm = m();
    const later = mm.phase === 'theirTurn';
    if (later && item === null) {
      if (g.islands.has(cell) || mm.target.shot.has(cell)) return;
      const had = ctrl.queue.includes(cell);
      ctrl.prefire(cell);
      return announce(ctrl.queue.includes(cell) ? `Queued ${cellName(cell, n)}` : had ? `Removed ${cellName(cell, n)}` : 'Queue full');
    }
    if (mm.phase !== 'myTurn' && !later) return;
    if (item !== null) {
      if (!itemAttack(cell)) return;
      // Touch: the first tap aims, a second tap on the same cell fires.
      if (touch && (!tapped || aim !== cell)) {
        aim = cell;
        armed = tapped = true;
        return render();
      }
      fireItem(cell);
    } else if (mm.target.shot.has(cell)) return;
    else if (mm.config.turns) ctrl.toggleSel(cell);
    else ctrl.attack({ k: 'fire', cells: [cell] });
  };

  const target = board('Their waters', false, n, {
    onActivate: activate,
    onHover: (c) => {
      if (item === null || c === null) return;
      aim = c;
      armed = true;
      tapped = false;
      render();
    },
    onKey: (e) => {
      const k = e.key;
      if (k === 'Escape') {
        if (item !== null) pick(null);
        else if (ctrl.queue.length || ctrl.qItem) {
          ctrl.clearPrefire();
          announce('Queue cleared');
        } else ctrl.clearSel();
      } else if ((k === 'r' || k === 'R') && item !== null) {
        dir++;
        render();
      } else if (k === 'Enter' && m().config.turns && item === null && !ctrl.sel.includes(target.focused())) return ctrl.fireSalvo();
      else return false;
      return true;
    },
  });
  // Torpedo shortcut: a row label aims from the left along it, a column label from the top.
  target.el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const p = t.parentElement!;
    if (item !== 1 || !p.matches('.colh, .rowh')) return;
    const k = [...p.children].indexOf(t);
    const row = p.matches('.rowh');
    dir = row ? 0 : 1;
    aim = row ? k * n : k;
    armed = true;
    render();
  });
  const own = board('Your fleet', true, n);

  const stripText = h('span', 'strip-main');
  const stripSub = h('span', 'strip-sub');
  const secs = h('span', 'secs mono');
  const clear = h('button', { cls: 'textlink', id: 'clear-queue', onclick: () => (ctrl.clearPrefire(), announce('Queue cleared')) }, 'Clear');
  const bar = h('i');
  const timer = h('div', 'timer', bar);
  const strip = h('div', { cls: 'strip', id: 'strip' }, h('i', 'tsq'), stripText, secs, h('span', 'strip-r', stripSub, clear), timer);
  const items = h('div', 'a-items');
  const side = h('div', 'a-side');
  const theirs = h('div', 'a-theirs');
  const yours = h('div', 'a-yours');
  const stall = h('div', 'a-stall');
  const el = h(
    'section',
    'screen battle',
    h('div', 'a-strip', strip),
    h('div', 'a-target', cap('Their waters'), target.el),
    items,
    h('div', 'a-own', cap('Your fleet'), own.el),
    side,
    stall,
    h('div', 'a-lists', theirs, yours),
  );

  let timerKey = 0;
  const tick = () => {
    if (!el.isConnected && timerKey) return;
    const left = ctrl.deadline && m().phase !== 'awaitingAnswer' ? Math.ceil((ctrl.deadline - Date.now()) / 1000) : 0;
    secs.textContent = left > 0 ? String(left) : '';
    if (left > 0) setTimeout(tick, 250);
  };
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
    tick();
    if (!left) return;
    void bar.offsetWidth;
    s.transition = `transform ${left}ms linear`;
    s.transform = 'scaleX(0)';
    setTimeout(() => timerKey === key && (bar.className = 'low'), left - 5000);
  };

  const tally = (mm: Match) => {
    const afloat = (b: BoardView) => `${b.sunk.filter((s) => !s).length}/${g.fleet.length} afloat`;
    return h(
      'div',
      'tally',
      h('p', 'mono small', h('span', null, 'Them'), afloat(mm.target)),
      h('p', 'mono small', h('span', null, 'You'), afloat(mm.own)),
    );
  };

  let actionsKey = '';
  function renderActions(mm: Match): void {
    const my = mm.phase === 'myTurn';
    const { turns, items: hasItems } = mm.config;
    const shots = shotsAllowed(mm, 'me');
    const e = mm.energy.me;
    const tip = mm.phase === 'theirTurn' && theirTurns <= 2 && h('p', 'small', TIP);
    // Simultaneous: whether their salvo is in yet.
    const ready = turns > 1 && h('p', { cls: 'small muted', id: 'them-ready' }, mm.round.them ? "They're ready." : "They're still picking.");
    const inv = mm.inv.me;
    const key = [mm.phase, !!tip, item, dir, armed, tapped, aim, e, ctrl.sel.length, shots, mm.target.sunk.join(), mm.own.sunk.join(), !!mm.round.them, inv.join(), ctrl.qItem?.k].join();
    if (key === actionsKey) return;
    actionsKey = key;
    if (!hasItems) {
      const fire = !!turns && btn(mm.pending || mm.round.me ? 'Sent' : `Fire ${ctrl.sel.length}/${shots}`, () => ctrl.fireSalvo(), 'primary wide', 'fire');
      if (fire) fire.disabled = !my || ctrl.sel.length !== shots;
      side.replaceChildren(tally(mm), h('div', 'act', tip || ready || (!fire && h('p', 'small muted rules', rulesLine(mm.config))), fire));
      return;
    }
    const it = item === null ? null : ITEMS[item]!;
    const dn = dirName();
    const cost = it?.cost ?? 0;
    const pk = mm.config.pickups;
    const held = (id: number) => inv.filter((x) => x === id).length;
    // On their turn items can be queued: what I'll have when my turn starts.
    const later = mm.phase === 'theirTurn';
    const at = later ? Math.min(ENERGY_CAP, e + 1) : e;
    const verb = my ? 'fire' : 'queue';
    items.replaceChildren(
      h(
        'div',
        { cls: 'items', role: 'group', 'aria-label': 'Items' },
        ITEMS.map((d) =>
          h(
            'button',
            {
              cls: 'item',
              'aria-pressed': String(item === d.id),
              'aria-label': `${d.name}, ${pk ? held(d.id) + ' held' : 'costs ' + d.cost}. ${d.desc}`,
              disabled: !(my || later) || (pk ? !held(d.id) : at < d.cost),
              onclick: (ev: MouseEvent) => {
                pick(item === d.id ? null : d.id);
                // Keyboard (detail 0): on to the board, where arrows move the footprint.
                if (item !== null && !ev.detail) target.cells[target.focused()]!.focus({ preventScroll: true });
              },
            },
            h('span', null, short(d.id)),
            pk ? h('span', 'mono small', '×' + held(d.id)) : pips(d.cost, d.cost, 'cost'),
          ),
        ),
      ),
    );
    const rot = btn(dn || 'Rotate', () => (dir++, render()), '', 'item-dir', 'rotate');
    rot.style.visibility = dn ? '' : 'hidden';
    const fire = btn(my ? 'Fire' : 'Queue', () => fireItem(aim), 'primary', 'item-fire');
    fire.disabled = !(my || later) || !armed || !itemAttack(aim);
    // Energy, or (pickups) items held.
    const [have, cap] = pk ? [inv.length, HOLD_CAP] : [e, ENERGY_CAP];
    side.replaceChildren(
      h(
        'div',
        'energy',
        label(pk ? 'Held' : 'Energy'),
        pips(have, cap, '', pk ? 0 : cost),
        h('span', { cls: 'mono small', id: 'energy' }, `${have}/${cap}`),
        !my && h('span', 'small muted', pk ? 'Shoot ◇ to collect' : e < cap ? '+1 next turn' : 'Full'),
      ),
      h(
        'div',
        'act',
        h(
          'p',
          'item-hint small',
          h('span', { cls: it ? '' : 'muted' }, !it ? (my ? 'Fire a shot, or pick an item.' : 'Queue shots, or an item.') : `${short(it.id)}: ${it.desc.toLowerCase()}. ${tapped ? `Tap again to ${verb}.` : 'Pick a target.'}`),
          it && ' ',
          it && h('button', { cls: 'textlink', onclick: () => pick(null) }, 'Cancel'),
        ),
        h('div', 'act-btns', rot, fire),
      ),
    );
  }

  function render(): void {
    const s = ctrl.state;
    if (s.s !== 'battle') return;
    const mm = s.match;
    const my = mm.phase === 'myTurn';
    const theirTurn = mm.phase === 'theirTurn';
    if (theirTurn && phase !== mm.phase) theirTurns++;
    phase = mm.phase;
    if (!my && !theirTurn) item = aim = null;
    const q = ctrl.queue;
    const qi = ctrl.qItem;
    const qName = qi?.k === 'item' ? short(qi.item) : '';
    const qNames = [qName, ...q.map((c) => cellName(c, n))].filter(Boolean).join(', ');
    el.dataset.turn = theirTurn ? 'them' : 'me';
    stripText.textContent = s.banner ?? (my ? 'Your turn' : mm.phase !== 'awaitingAnswer' ? 'Their turn' : mm.config.turns > 1 ? 'Waiting for them' : 'Firing…');
    const dn = dirName();
    const r = ctrl.lastResult;
    stripSub.textContent = s.banner
      ? ''
      : my && (q.length || qi)
        ? 'Firing ' + (qName || (mm.config.turns ? qNames : cellName(q[0]!, n)))
        : tapped && item !== null
          ? `Tap again to ${my ? 'fire' : 'queue'}` + (dn ? ', ' + dn.toLowerCase() : '')
          : theirTurn && qNames
            ? 'Next: ' + qNames
            : my && r.startsWith('You') && mm.config.turns < 2
                ? r + '. Shoot again.'
                : r;
    clear.hidden = !(theirTurn && qNames);
    // The item being aimed, else (their turn) the queued one.
    const atk = (my || theirTurn ? itemAttack(aim) : null) ?? (theirTurn ? qi : null);
    const preview = atk?.k === 'item' ? new Set(footprint(g, atk.item, atk.a, atk.b)) : undefined;
    target.el.classList.toggle('armed', my || item !== null);
    target.el.classList.toggle('live', !theirTurn);
    target.el.classList.toggle('dim', theirTurn);
    own.el.classList.toggle('live', theirTurn);
    own.el.classList.toggle('dim', !theirTurn);
    // A sent salvo stays marked until the answer lands.
    const out = mm.pending ?? mm.round.me?.[0];
    const sent = out?.k === 'fire' ? out.cells : ctrl.sel;
    const tm = model(g, mm.target, { sel: sent, preview, lane: atk?.k === 'item' && atk.item === 1, queue: q, anim: ctrl.fx.target });
    if (atk?.k === 'item' && atk.item === 1) tm.overlay += torpedo(g, [...preview!], atk.b, preview!.size < n);
    target.update(tm);
    own.update(model(g, mm.own, { own: mm.fleet, anim: ctrl.fx.own }));
    ctrl.fx = { target: [], own: [] };
    renderActions(mm);
    theirs.replaceChildren(fleetList(g, 'Enemy ships', mm.target));
    yours.replaceChildren(fleetList(g, 'Your ships', mm.own, mm.fleet));
    stall.replaceChildren(s.stalled ? h('div', 'callout', h('p', null, "Opponent isn't responding."), btn('Leave', () => ctrl.leaveStalled(), 'primary')) : '');
    runTimer(mm);
  }
  render();
  return { el, update: render };
}
