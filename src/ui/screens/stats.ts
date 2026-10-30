// The Stats screen, loaded on demand from home.
import css from '../../styles/stats.css?inline';
import type { Controller } from '../../app/controller';
import { KEY, load, save } from '../../app/stats';
import { summarize } from '../../app/summary';
import { h } from '../h';
import { btn, label, type Screen } from '../kit';

document.head.append(h('style', null, css));

const pct = (x: number) => Math.round(x * 100) + '%';
const day = (t: number) => {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

export function stats(ctrl: Controller): Screen {
  const el = h('section', { cls: 'screen narrow st', id: 'stats-screen' });
  let asking = false;
  const link = (text: string, id: string, onclick: () => void) => h('button', { cls: 'textlink', id, onclick }, text);
  const ask = (on: boolean) => {
    asking = on;
    render();
    el.querySelector<HTMLElement>(on ? '#reset-no' : '#reset')?.focus();
  };
  const reset = () => {
    const p = load(ctrl.me);
    p.log = [];
    save((ctrl.me = p));
    ask(false);
  };
  const render = () => {
    const p = (ctrl.me = load(ctrl.me));
    let kept = false;
    try {
      kept = !!localStorage.getItem(KEY);
    } catch {
      /* blocked */
    }
    const t = summarize(p.log);
    const n = t.games;
    const rows: [string, number | string][] = [
      ['Games', n],
      ['Wins', t.me],
      ['Losses', t.them],
      ['Draws', t.draw],
      ['Win rate', n ? pct(t.me / n) : '–'],
      ['Current streak', t.streak],
      ['Best streak', t.best],
      ['Accuracy', t.accuracy === null ? '–' : pct(t.accuracy)],
    ];
    const opp = t.opponents.slice(0, 8);
    el.replaceChildren(
      label('This device'),
      h('h2', 'h1', 'Stats'),
      h('dl', { cls: 'stats', id: 'totals' }, rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', 'mono', v)))),
      t.forfeits ? h('p', { cls: 'small muted', id: 'forfeits' }, `${t.forfeits} of the wins ${t.forfeits > 1 ? 'were' : 'was'} by forfeit: the opponent left mid-battle.`) : '',
      h('h3', 'h3', 'Head to head'),
      opp.length
        ? h(
            'table',
            { cls: 'h2h', id: 'h2h' },
            h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'W–L–D'), h('th', null, 'Last played'))),
            h('tbody', null, opp.map((r) => h('tr', null, h('td', null, r.name || 'Friend'), h('td', 'mono', `${r.me}–${r.them}–${r.draw}`), h('td', null, day(r.last))))),
          )
        : h('p', 'muted', 'No games yet. Finished games show up here.'),
      h('p', 'small muted', kept ? 'Kept on this device only.' : "This browser isn't saving data, so these stats last only until the page closes."),
      h(
        'div',
        'row-btns',
        btn('Back', () => ctrl.set({ s: 'home' }), '', 'stats-back'),
        asking ? [h('span', null, 'Reset all stats?'), link('Reset', 'reset-yes', reset), link('Cancel', 'reset-no', () => ask(false))] : link('Reset stats', 'reset', () => ask(true)),
      ),
    );
  };
  render();
  return { el };
}
