import type { Controller } from '../../app/controller';
import { prefetch } from '../../net/room';
import { h } from '../h';
import { btn, type Screen } from '../kit';

export function mark(): SVGElement {
  // 3×3 chart mark with one signal cell: the only logo.
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 31 31');
  el.setAttribute('class', 'mark');
  el.setAttribute('aria-hidden', 'true');
  let s = '<rect x=".5" y=".5" width="30" height="30" class="mk-frame"/>';
  for (let i = 1; i < 3; i++) s += `<path class="mk-rule" d="M${i * 10 + 0.5} 1v29M1 ${i * 10 + 0.5}h29"/>`;
  s += '<rect x="11" y="11" width="9" height="9" class="mk-hit"/>';
  el.innerHTML = s;
  return el;
}

export function home(ctrl: Controller, prefill = ''): Screen {
  const input = h('input', {
    id: 'code',
    cls: 'code-input mono',
    inputmode: 'numeric',
    pattern: '\\d{4}',
    maxlength: 4,
    autocomplete: 'off',
    'aria-label': '4-digit game code',
    value: prefill,
  });
  const err = h('p', { cls: 'small error', role: 'alert' });
  const submit = () => {
    const v = input.value;
    if (!/^\d{4}$/.test(v) || +v < 1000) {
      err.textContent = 'Enter the 4-digit code from your friend.';
      return;
    }
    ctrl.joinCode(+v);
  };
  input.addEventListener('input', () => {
    const v = input.value.replace(/\D/g, '').slice(0, 4);
    if (v !== input.value) input.value = v;
    err.textContent = '';
    if (v.length) void prefetch();
    if (v.length === 4) submit();
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  const create = btn('Create game', () => ctrl.createGame(), { primary: true, cls: 'wide', id: 'create' });
  for (const ev of ['pointerenter', 'touchstart', 'focus']) create.addEventListener(ev, () => void prefetch(), { once: true, passive: true });

  const el = h(
    'section',
    { cls: 'screen home' },
    h(
      'div',
      { cls: 'home-main' },
      h('h1', { cls: 'wordmark' }, mark(), h('span', null, 'Battleship')),
      h('p', { cls: 'lede muted' }, 'Two players. Peer-to-peer. No sign-up.'),
      create,
      h('div', { cls: 'divider label' }, h('span', null, 'Or join with a code')),
      h('div', { cls: 'join' }, input, btn('Join', submit, { id: 'join' })),
      err,
    ),
    h('aside', { cls: 'home-art', 'aria-hidden': 'true' }, chart()),
    h('p', { cls: 'foot small muted' }, 'No server. Your game runs directly between your devices.'),
  );
  return { el };
}

/** Static plotted board used as the home illustration on wide screens. */
function chart(): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 10 10');
  el.setAttribute('class', 'art');
  let s = '<rect class="art-bg" width="10" height="10"/>';
  for (let i = 1; i < 10; i++) s += `<path class="art-rule" d="M${i} 0v10M0 ${i}h10"/>`;
  s += '<rect class="own" x="1.14" y="2.14" width="3.72" height=".72" rx=".36"/>';
  s += '<rect class="own" x="7.14" y="4.14" width=".72" height="2.72" rx=".36"/>';
  for (const [x, y] of [[2, 6], [5, 1], [8, 8], [4, 4], [6, 7], [0, 9], [9, 1]]) s += `<circle class="miss" cx="${x! + 0.5}" cy="${y! + 0.5}" r=".14"/>`;
  for (const [x, y] of [[2, 2], [3, 2], [7, 5]]) s += `<rect class="hit" x="${x! + 0.18}" y="${y! + 0.18}" width=".64" height=".64"/>`;
  s += '<rect class="last" x="7.07" y="5.07" width=".86" height=".86"/>';
  el.innerHTML = s;
  return el;
}
