// Loaded on demand with the direct-link fallback.
import css from '../../styles/direct.css?inline';
import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, copyBtn, gameUrl, inApp, label, linkBox, prettyUrl, shareBtn, status, type Screen } from '../kit';

document.head.append(h('style', null, css));

const step = (n: number, title: string, ...body: unknown[]) =>
  h('li', null, h('span', { cls: 'step-n mono', 'aria-hidden': 'true' }, n), h('div', 'stack', h('h3', 'h3', title), ...(body as Node[])));
const head = (title: string) => [label('Direct link'), h('h2', 'h2', title)];
const share = (url: string, id: string) => [linkBox(prettyUrl(url), id + '-link'), h('div', 'row-btns', copyBtn(() => url, 'Copy link', 'copy-' + id), shareBtn(() => url))];

export function directHost(ctrl: Controller): Screen {
  const el = h('section', 'screen narrow', ...head('Preparing link…'));
  const paste = h('input', { id: 'paste', cls: 'mono input', placeholder: 'Paste reply', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Reply link or code' });
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
    note.textContent = s.connecting
      ? s.connecting > 1
        ? 'Still trying. Make sure your friend is back in the game. If nothing happens, your network may be blocking peer-to-peer.'
        : 'Waiting for your friend to come back to the game…'
      : '';
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
        step(2, 'Come back to this page', h('p', 'small muted', 'Keep it open. The game starts when your friend opens your reply.'), inApp('reply'), status('Waiting for your friend…')),
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
        ? [h('h2', 'h2', 'Sent. Switch back to your game tab.')]
        : [h('h2', 'h2', 'Go back to Battleship in your browser and paste this code'), linkBox(s.blob, '', 'small'), copyBtn(() => s.blob, 'Copy code')]),
    ),
  };
}
