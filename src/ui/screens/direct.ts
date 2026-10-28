// Loaded on demand with the direct-link fallback.
import css from '../../styles/direct.css?inline';
import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, copyBtn, gameUrl, label, linkBox, prettyUrl, shareBtn, status, type Screen } from '../kit';

document.head.append(h('style', null, css));

const step = (n: number, title: string, ...body: unknown[]) =>
  h('li', null, h('span', { cls: 'step-n mono', 'aria-hidden': 'true' }, n), h('div', 'stack', h('h3', 'h3', title), ...(body as Node[])));
const head = (title: string) => [label('Direct link'), h('h2', 'h2', title)];
const share = (url: string, id: string) => [linkBox(prettyUrl(url), id + '-link'), h('div', 'row-btns', copyBtn(() => url, 'Copy link', 'copy-' + id), shareBtn(() => url))];

export function directHost(ctrl: Controller): Screen {
  const el = h('section', 'screen narrow', ...head('Preparing link…'));
  const paste = h('input', { id: 'paste', cls: 'mono input', placeholder: 'Paste reply', autocomplete: 'off', 'aria-label': 'Reply link or code' });
  const err = h('p', { cls: 'small error', role: 'alert' });
  const note = h('p', 'small muted');
  const connect = () => paste.value.trim() && ctrl.pasteAnswer(paste.value);
  paste.addEventListener('keydown', (e) => e.key === 'Enter' && connect());
  let built = false;
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'direct-host' || !s.blob) return;
    if (!built)
      el.replaceChildren(
        ...head('Connect with a direct link'),
        h(
          'ol',
          'steps',
          step(1, 'Send this link to your friend', ...share(gameUrl('o=' + s.blob), 'offer')),
          step(2, 'Paste their reply', h('div', 'join', paste, btn('Connect', connect, 'primary', 'connect')), err, note),
        ),
        h('p', 'small muted', 'Keep this tab open.'),
        btn('Cancel', () => ctrl.leave(), 'quiet'),
      );
    built = true;
    err.textContent = s.error ?? '';
    note.textContent = s.connecting ? 'Connecting…' : '';
  };
  update();
  return { el, update };
}

export function directGuest(ctrl: Controller): Screen {
  const el = h('section', 'screen narrow', ...head('Preparing reply…'));
  let built = false;
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'direct-guest' || !s.blob || built) return;
    built = true;
    const blob = s.blob;
    el.replaceChildren(
      ...head('Almost there'),
      h(
        'ol',
        'steps',
        step(1, 'Send this reply link back', ...share(gameUrl('a=' + blob), 'answer'), h('p', 'small muted', 'Or copy just the code:'), linkBox(blob, 'answer-code', 'small'), copyBtn(() => blob, 'Copy code')),
        step(2, 'Your friend opens it', status('Waiting for your friend to connect…')),
      ),
      btn('Cancel', () => ctrl.leave(), 'quiet'),
    );
  };
  update();
  return { el, update };
}

export function forwarded(ctrl: Controller): Screen {
  const s = ctrl.state as Extract<typeof ctrl.state, { s: 'forwarded' }>;
  return {
    el: h(
      'section',
      { cls: 'screen narrow', id: 'forwarded' },
      label('Direct link'),
      ...(s.ok
        ? [h('h2', 'h2', 'Sent to your game tab. You can close this tab.')]
        : [h('h2', 'h2', 'Open your game tab and paste this code there'), linkBox(s.blob, '', 'small'), copyBtn(() => s.blob, 'Copy code')]),
    ),
  };
}
