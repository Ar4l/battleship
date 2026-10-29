import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, type Screen } from '../kit';

export function notice(ctrl: Controller): Screen {
  const s = ctrl.state as Extract<typeof ctrl.state, { s: 'notice' }>;
  const home = () => ctrl.retry();
  const [title, body, action] = {
    'room-full': [`Game ${s.code} already has two players.`, 'Ask your friend for a new code.'],
    failed: ["Couldn't connect — your network may be blocking peer-to-peer.", 'Try another network (e.g. switch Wi-Fi off) or a different browser.', btn('Retry', home, 'primary', 'retry')],
    left: ['Your opponent left or lost connection.', s.detail && 'You win by forfeit. Result not verified.'],
    away: ['Connection lost while Battleship was in the background.', 'Keep this page open until the game ends.'],
    version: ['Your friend is on a different version. Both reload the page.', '', btn('Reload', () => location.reload(), 'primary')],
    'invalid-move': ['Your opponent sent an invalid move.', 'The game was stopped.'],
    'bad-link': ['That link looks incomplete. Ask for it again.'],
  }[s.kind] as [string, string?, HTMLElement?];
  return {
    el: h('section', { cls: 'screen narrow', id: 'notice' }, h('h2', 'h2', title), body && h('p', 'muted', body), h('div', 'row-btns', action ?? btn('Home', home, 'primary'))),
  };
}
