import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, copyBtn, gameUrl, label, linkBox, prettyUrl, settings, shareBtn, type Screen } from '../kit';

export function lobbyHost(ctrl: Controller): Screen {
  const codeEl = h('div', { cls: 'room-code mono', id: 'room-code' });
  const link = linkBox('', 'room-link');
  const net = h('div', { cls: 'net-note' });
  const url = () => gameUrl(String((ctrl.state as { code: number }).code));
  const el = h(
    'section',
    { cls: 'screen lobby' },
    h(
      'div',
      { cls: 'lobby-code' },
      label('Game code'),
      codeEl,
      link,
      h('div', { cls: 'row-btns' }, copyBtn(url, 'Copy link', 'copy-link'), shareBtn(url)),
      h('p', { cls: 'status-line' }, h('span', { cls: 'blink', 'aria-hidden': 'true' }), 'Waiting for your friend…'),
      net,
    ),
    h('div', { cls: 'lobby-settings' }, h('h2', { cls: 'h3' }, 'Rules'), settings(ctrl.config, (p) => ctrl.setConfig(p))),
    h('div', { cls: 'lobby-foot' }, btn('Cancel', () => ctrl.leave(), { quiet: true })),
  );
  const direct = () => h('button', { type: 'button', cls: 'textlink', id: 'use-direct', onclick: () => void ctrl.startDirectHost() }, 'Use a direct link');
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'lobby-host') return;
    codeEl.textContent = String(s.code);
    link.textContent = prettyUrl(url());
    net.replaceChildren(
      s.relaysDown
        ? h('div', { cls: 'callout' }, h('p', null, "Can't reach the matchmaking network. Use a direct link instead."), btn('Use a direct link', () => void ctrl.startDirectHost(), { primary: true, id: 'use-direct' }))
        : h('p', { cls: 'small muted' }, 'Trouble connecting? ', direct()),
    );
  };
  update();
  return { el, update };
}

export function lobbyGuest(ctrl: Controller): Screen {
  const body = h('div', { cls: 'stack' });
  const el = h('section', { cls: 'screen narrow' }, body);
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'lobby-guest') return;
    body.replaceChildren(
      label('Joining'),
      h('h2', { cls: 'h2' }, `Joining game ${s.code}…`),
      s.slow
        ? h(
            'div',
            { cls: 'stack' },
            h('p', null, `Still looking for game ${s.code}. Check the code, or ask your friend for a direct link.`),
            h('div', { cls: 'row-btns' }, btn('Retry', () => ctrl.joinCode(s.code), { primary: true }), btn('Back', () => ctrl.leave())),
          )
        : h('p', { cls: 'status-line' }, h('span', { cls: 'blink', 'aria-hidden': 'true' }), 'Looking for the host'),
      s.slow ? '' : btn('Cancel', () => ctrl.leave(), { quiet: true }),
    );
  };
  update();
  return { el, update };
}
