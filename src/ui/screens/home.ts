import type { Controller } from '../../app/controller';
import { prefetch } from '../../net/room';
import { capsule, hit, last, miss } from '../grid';
import { h, html } from '../h';
import { btn, type Screen } from '../kit';

/** 3×3 chart mark with one signal cell: the only logo. */
export const mark = () =>
  html(
    '<svg class="mark" viewBox="0 0 31 31" aria-hidden="true"><rect x=".5" y=".5" width="30" height="30" class="mk-frame"/><path class="mk-rule" d="M10.5 1v29M20.5 1v29M1 10.5h29M1 20.5h29"/><rect x="11" y="11" width="9" height="9" class="mk-hit"/></svg>',
  );

/** Static plotted board used as the home illustration on wide screens. */
const chart = () => {
  let s = '<svg class="art" viewBox="0 0 10 10"><rect class="art-bg" width="10" height="10"/><path class="art-rule" d="';
  for (let i = 1; i < 10; i++) s += `M${i} 0v10M0 ${i}h10`;
  s += '"/>' + capsule({ anchor: 21, vertical: false }, 1, 'own') + capsule({ anchor: 47, vertical: true }, 2, 'own');
  for (const c of [62, 15, 88, 44, 76, 90, 19]) s += miss(c);
  for (const c of [22, 23, 57]) s += hit(c);
  return html(s + last(57) + '</svg>');
};

export function home(ctrl: Controller, prefill = ''): Screen {
  const input = h('input', { id: 'code', cls: 'code-input', inputmode: 'numeric', autocomplete: 'off', 'aria-label': '4-digit game code', value: prefill });
  const err = h('p', { cls: 'small error', role: 'alert' });
  const submit = () => {
    const v = input.value;
    if (/^[1-9]\d{3}$/.test(v)) ctrl.joinCode(+v);
    else err.textContent = 'Enter the 4-digit code from your friend.';
  };
  const boxes = [0, 1, 2, 3].map(() => h('span'));
  const paint = () =>
    boxes.forEach((b, i) => {
      b.textContent = input.value[i] ?? '';
      b.className = i === Math.min(input.value.length, 3) ? 'at' : '';
    });
  input.addEventListener('input', () => {
    const v = (input.value = input.value.replace(/\D/g, '').slice(0, 4));
    paint();
    err.textContent = '';
    if (v) void prefetch();
    if (v.length === 4) submit();
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  // The input is invisible: keep the caret at the end so Backspace deletes the last digit.
  input.onfocus = input.onclick = () => input.setSelectionRange(4, 4);
  paint();
  const create = btn('Create game', () => ctrl.createGame(), 'primary wide', 'create');
  for (const ev of ['pointerenter', 'touchstart', 'focus']) create.addEventListener(ev, () => void prefetch(), { once: true, passive: true });

  const el = h(
    'section',
    'screen home',
    h(
      'div',
      'home-main',
      h('h1', 'wordmark', mark(), h('span', null, 'Battleship')),
      h('p', 'lede muted', 'Two players. Peer-to-peer. No sign-up.'),
      create,
      h('div', 'divider label', 'Or join with a code'),
      h('div', 'join', h('div', 'code mono', input, h('div', { cls: 'boxes', 'aria-hidden': 'true' }, boxes)), btn('Join', submit, '', 'join')),
      err,
    ),
    h('div', { cls: 'home-art', 'aria-hidden': 'true' }, chart()),
    h('p', 'foot small muted', 'No server. Your game runs directly between your devices.'),
  );
  return { el };
}
