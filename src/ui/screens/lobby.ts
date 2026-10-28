import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, copyBtn, gameUrl, label, linkBox, prettyUrl, settings, shareBtn, status, type Screen } from '../kit';

export function lobbyHost(ctrl: Controller): Screen {
  const code = h('div', { cls: 'room-code mono', id: 'room-code' });
  const link = linkBox('', 'room-link');
  const net = h('div');
  const url = () => gameUrl(String((ctrl.state as { code: number }).code));
  const direct = () => void ctrl.startDirectHost();
  const el = h(
    'section',
    'screen lobby',
    h(
      'div',
      'stack',
      label('Game code'),
      code,
      link,
      h('div', 'row-btns', copyBtn(url, 'Copy link', 'copy-link'), shareBtn(url)),
      status('Waiting for your friend…'),
      net,
    ),
    h('div', 'lobby-settings', h('h2', 'h3', 'Rules'), settings(ctrl.config, (p) => ctrl.setConfig(p))),
    h('div', 'lobby-foot', btn('Cancel', () => ctrl.leave(), 'quiet')),
  );
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'lobby-host') return;
    code.textContent = String(s.code);
    link.textContent = prettyUrl(url());
    net.replaceChildren(
      s.relaysDown
        ? h('div', 'callout', h('p', null, "Can't reach the matchmaking network. Use a direct link instead."), btn('Use a direct link', direct, 'primary', 'use-direct'))
        : h('p', 'small muted', 'Trouble connecting? ', h('button', { cls: 'textlink', id: 'use-direct', onclick: direct }, 'Use a direct link')),
    );
  };
  update();
  return { el, update };
}

export function lobbyGuest(ctrl: Controller): Screen {
  const el = h('section', 'screen narrow');
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'lobby-guest') return;
    el.replaceChildren(
      label('Game code'),
      h('h2', 'h2', `Joining game ${s.code}…`),
      ...(s.slow
        ? [
            h('p', null, `Still looking for game ${s.code}. Check the code, or ask your friend for a direct link.`),
            h('div', 'row-btns', btn('Retry', () => ctrl.joinCode(s.code), 'primary'), btn('Back', () => ctrl.leave())),
          ]
        : [status('Looking for the host'), btn('Cancel', () => ctrl.leave(), 'quiet')]),
    );
  };
  update();
  return { el, update };
}
