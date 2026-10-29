import type { Controller } from '../../app/controller';
import { sunkCount } from '../../game/engine';
import { board } from '../grid';
import { h } from '../h';
import { icon } from '../icons';
import { btn, label, settings, type Screen } from '../kit';
import { cap, model } from './battle';

export function end(ctrl: Controller): Screen {
  const target = board('Their waters', false);
  const own = board('Your fleet', true);
  const head = h('div', 'end-head');
  const stats = h('dl', 'stats');
  const actions = h('div', 'end-actions');
  const el = h(
    'section',
    'screen end',
    head,
    actions,
    stats,
    h('div', 'end-boards', h('div', null, cap('Their waters'), target.el), h('div', null, cap('Your fleet'), own.el)),
  );
  let lastKey = '';
  const render = () => {
    const s = ctrl.state;
    if (s.s !== 'end') return;
    const m = s.match;
    target.update(model(m.geo, m.target, { reveal: s.theirFleet }));
    own.update(model(m.geo, m.own, { own: m.fleet }));
    const key = JSON.stringify([s.verdict, s.reason, s.theirVerdict, s.rematch, s.peerLeft, s.editing, !!s.theirFleet, ctrl.config]);
    if (key === lastKey) return;
    lastKey = key;
    const v = s.verdict;
    head.replaceChildren(
      label('Game over'),
      h('h2', { cls: 'h1', id: 'result' }, m.winner === 'me' ? 'You won' : m.winner ? 'You lost' : 'Game over'),
      h(
        'p',
        { cls: 'verdict ' + (v === 'verified' ? 'ok' : v), id: 'verdict' },
        v === 'verified' ? [icon('check'), h('span', null, 'Fleet verified')] : v === 'pending' ? 'Checking their fleet…' : (s.reason ?? 'Result not verified.'),
      ),
      s.theirVerdict === null ? '' : h('p', { cls: 'small muted', id: 'their-verdict' }, s.theirVerdict ? 'Opponent verified your fleet' : "Opponent's check failed"),
    );
    const st = m.stats.me;
    const rows: [string, number | string][] = [
      ['Shots', st.shots],
      ['Hits', st.hits],
      ['Accuracy', st.shots ? Math.round((st.hits / st.shots) * 100) + '%' : '–'],
      ['Ships lost', sunkCount(m.own)],
      ['Turns', st.turns],
    ];
    if (m.config.mode === 2) rows.push(['Items used', st.items]);
    stats.replaceChildren(...rows.map(([k, n]) => h('div', null, h('dt', null, k), h('dd', 'mono', n))));
    const host = ctrl.role === 'host';
    const r = s.rematch;
    const open = !r.me && !s.peerLeft;
    const rematch = btn('Rematch', () => ctrl.rematch(), 'primary', 'rematch');
    rematch.disabled = !open;
    const note = s.peerLeft ? 'Opponent left.' : r.me ? (host ? 'Waiting for opponent…' : !r.them && 'Waiting for host…') : r.them && 'Opponent wants a rematch.';
    actions.replaceChildren(
      s.editing ? h('div', 'end-settings', settings(ctrl.config, (p) => ctrl.setConfig(p))) : '',
      h('div', 'row-btns', rematch, host && open && btn(s.editing ? 'Done' : 'Change mode', () => ctrl.toggleEditing(), '', 'change-mode')),
      note ? h('p', { cls: 'status-line', id: 'rematch-note' }, note) : '',
    );
  };
  render();
  return { el, update: render };
}
