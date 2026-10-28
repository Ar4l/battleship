import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, type Screen } from '../kit';

export function notice(ctrl: Controller): Screen {
  const s = ctrl.state;
  if (s.s !== 'notice') return { el: h('section') };
  const home = () => ctrl.retry();
  let title = '';
  let body: (Node | string)[] = [];
  let actions: Node[] = [btn('Home', home, { primary: true })];
  switch (s.kind) {
    case 'room-full':
      title = `Game ${s.code} already has two players.`;
      body = ['Ask your friend for a new code.'];
      break;
    case 'failed':
      title = "Couldn't connect — your network may be blocking peer-to-peer.";
      body = [h('p', { cls: 'muted' }, 'Try another network (e.g. switch Wi-Fi off) or a different browser.')];
      actions = [btn('Retry', home, { primary: true, id: 'retry' })];
      break;
    case 'left':
      title = s.detail ? 'Your opponent left. You win by forfeit.' : 'Your opponent left.';
      if (s.detail) body = [h('p', { cls: 'muted' }, 'Result not verified.')];
      break;
    case 'version':
      title = 'Your friend is on a different version. Both reload the page.';
      actions = [btn('Reload', () => location.reload(), { primary: true })];
      break;
    case 'invalid-move':
      title = 'Your opponent sent an invalid move.';
      body = [h('p', { cls: 'muted' }, 'The game was stopped.')];
      break;
    case 'bad-link':
      title = 'That link looks incomplete. Ask for it again.';
      break;
  }
  const el = h('section', { cls: 'screen narrow notice', id: 'notice' }, h('h2', { cls: 'h2' }, title), ...body.map((b) => (typeof b === 'string' ? h('p', null, b) : b)), h('div', { cls: 'row-btns' }, ...actions));
  return { el };
}
