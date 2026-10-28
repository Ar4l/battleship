import type { Controller } from '../../app/controller';
import { sunkCount } from '../../game/engine';
import { Board } from '../grid';
import { h } from '../h';
import { icon } from '../icons';
import { btn, label, settings, type Screen } from '../kit';
import { ownModel, targetModel } from './battle';

export function end(ctrl: Controller): Screen {
  const target = new Board({ label: 'Their waters', interactive: false });
  const own = new Board({ label: 'Your fleet', interactive: false });
  own.el.classList.add('mini');
  const head = h('div', { cls: 'end-head' });
  const stats = h('div', { cls: 'end-stats' });
  const actions = h('div', { cls: 'end-actions' });
  const el = h(
    'section',
    { cls: 'screen end' },
    head,
    actions,
    h('div', { cls: 'end-boards' }, h('div', null, h('div', { cls: 'cap-label label' }, 'Their waters'), target.el), h('div', { cls: 'end-own' }, h('div', { cls: 'cap-label label' }, 'Your fleet'), own.el)),
    stats,
  );
  let lastKey = '';
  const render = () => {
    const s = ctrl.state;
    if (s.s !== 'end') return;
    const m = s.match;
    target.update(targetModel(m, { reveal: s.theirFleet }));
    own.update(ownModel(m, []));
    const key = JSON.stringify([s.verdict, s.reason, s.theirVerdict, s.rematch, s.peerLeft, s.editing, !!s.theirFleet, ctrl.config]);
    if (key === lastKey) return;
    lastKey = key;
    const title = m.winner === 'me' ? 'You won' : m.winner === 'them' ? 'You lost' : 'Game over';
    let verdict: Node;
    if (s.verdict === 'verified') verdict = h('p', { cls: 'verdict ok', id: 'verdict' }, icon('check'), h('span', null, 'Fleet verified'));
    else if (s.verdict === 'cheat') verdict = h('div', { cls: 'verdict cheat', id: 'verdict' }, h('p', null, s.reason ?? 'Cheating detected.'));
    else if (s.verdict === 'pending') verdict = h('p', { cls: 'verdict muted', id: 'verdict' }, 'Checking their fleet…');
    else verdict = h('p', { cls: 'verdict muted', id: 'verdict' }, s.reason ?? 'Result not verified.');
    head.replaceChildren(
      label('Game over'),
      h('h2', { cls: 'h1', id: 'result' }, title),
      verdict,
      s.theirVerdict === null ? '' : h('p', { cls: 'small muted', id: 'their-verdict' }, s.theirVerdict ? 'Opponent verified your fleet' : "Opponent's check failed"),
    );
    const st = m.stats.me;
    const rows: [string, string][] = [
      ['Shots', String(st.shots)],
      ['Hits', String(st.hits)],
      ['Accuracy', st.shots ? Math.round((st.hits / st.shots) * 100) + '%' : '–'],
      ['Ships lost', String(sunkCount(m.own))],
      ['Turns', String(st.turns)],
    ];
    if (m.config.mode === 2) rows.push(['Items used', String(st.items)]);
    stats.replaceChildren(h('table', { cls: 'stats' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', { cls: 'mono' }, v))))));
    const host = ctrl.role === 'host';
    const note = s.peerLeft
      ? 'Opponent left.'
      : s.rematch.me
        ? host
          ? 'Waiting for opponent…'
          : s.rematch.them
            ? ''
            : 'Waiting for host…'
        : s.rematch.them
          ? 'Opponent wants a rematch.'
          : '';
    actions.replaceChildren(
      s.editing ? h('div', { cls: 'end-settings' }, settings(ctrl.config, (p) => ctrl.setConfig(p))) : '',
      h(
        'div',
        { cls: 'row-btns' },
        btn('Rematch', () => ctrl.rematch(), { primary: true, disabled: s.rematch.me || s.peerLeft, id: 'rematch' }),
        host && !s.rematch.me && !s.peerLeft ? btn(s.editing ? 'Done' : 'Change mode', () => ctrl.toggleEditing(), { id: 'change-mode' }) : null,
        btn('Leave', () => ctrl.leave(), { quiet: true }),
      ),
      note ? h('p', { cls: 'status-line', id: 'rematch-note' }, note) : '',
    );
  };
  render();
  return { el, update: render };
}
