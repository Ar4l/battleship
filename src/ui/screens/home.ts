import type { Controller } from '../../app/controller';
import { save } from '../../app/stats';
import { prefetch } from '../../net/room';
import { h, html } from '../h';
import { btn, type Screen } from '../kit';

/** 3×3 chart mark with one signal cell: the only logo. */
export const mark = () =>
  html(
    '<svg class="mark" viewBox="0 0 31 31" aria-hidden="true"><rect x=".5" y=".5" width="30" height="30" class="mk-frame"/><path class="mk-rule" d="M10.5 1v29M20.5 1v29M1 10.5h29M1 20.5h29"/><rect x="11" y="11" width="9" height="9" class="mk-hit"/></svg>',
  );

export function home(ctrl: Controller, prefill = ''): Screen {
  const input = h('input', { id: 'code', cls: 'code-input', inputmode: 'numeric', autocomplete: 'off', 'aria-label': '4-digit game code', value: prefill });
  const err = h('p', { cls: 'small error', role: 'alert' });
  const submit = () => {
    const v = input.value;
    if (/^[1-9]\d{3}$/.test(v)) ctrl.joinCode(+v);
    else err.textContent = 'Enter the 4-digit code from your friend.';
  };
  const boxes = [0, 1, 2, 3].map(() => h('span'));
  const paint = () => {
    join.disabled = input.value.length < 4;
    boxes.forEach((b, i) => {
      b.textContent = input.value[i] ?? '';
      b.className = i === Math.min(input.value.length, 3) ? 'at' : '';
    });
  };
  const join = btn('Join', submit, '', 'join');
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
  // Fetch the matchmaking code while the code is still being typed.
  input.addEventListener('focus', () => void prefetch(), { once: true });
  paint();
  const create = btn('Create game', () => ctrl.createGame(), 'primary wide', 'create');
  for (const ev of ['pointerenter', 'touchstart', 'focus']) create.addEventListener(ev, () => void prefetch(), { once: true, passive: true });

  const name = h('input', { id: 'name', cls: 'input', maxlength: 16, value: ctrl.me.name, oninput: () => save(((ctrl.me.name = name.value), ctrl.me)) });
  // The illustration only shows on wide screens (.home-art in app.css), so phones never load it.
  const art = h('div', { cls: 'home-art', 'aria-hidden': 'true' });
  if (innerWidth > 899) void import('../art').then((m) => art.append(m.chart()));
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
      h('div', 'join', h('div', 'code mono', input, h('div', { cls: 'boxes', 'aria-hidden': 'true' }, boxes)), join),
      err,
      h('div', 'join me', h('label', { for: 'name', cls: 'label' }, 'Your name'), name, btn('Stats', () => ctrl.set({ s: 'stats' }), 'quiet')),
    ),
    art,
    h('p', 'foot small muted', 'No server. Your game runs directly between your devices.'),
  );
  return { el };
}
