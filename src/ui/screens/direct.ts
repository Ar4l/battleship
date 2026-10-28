import type { Controller } from '../../app/controller';
import { h } from '../h';
import { btn, copyBtn, gameUrl, label, linkBox, prettyUrl, shareBtn, type Screen } from '../kit';

const step = (n: number, title: string, ...body: (Node | null)[]) =>
  h('li', { cls: 'step' }, h('span', { cls: 'step-n mono', 'aria-hidden': 'true' }, n), h('div', { cls: 'step-body' }, h('h3', { cls: 'h3' }, title), ...body));

export function directHost(ctrl: Controller): Screen {
  const el = h('section', { cls: 'screen narrow' });
  let built = '';
  let paste: HTMLInputElement | null = null;
  let err: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'direct-host') return;
    if (s.blob && built !== s.blob) {
      built = s.blob;
      const url = gameUrl('o=' + s.blob);
      paste = h('input', { id: 'paste', cls: 'mono input', placeholder: 'Paste reply', autocomplete: 'off', 'aria-label': 'Reply link or code' });
      err = h('p', { cls: 'small error', role: 'alert' });
      status = h('p', { cls: 'small muted' });
      const connect = () => paste!.value.trim() && ctrl.pasteAnswer(paste!.value);
      paste.addEventListener('keydown', (e) => e.key === 'Enter' && connect());
      el.replaceChildren(
        label('Direct link'),
        h('h2', { cls: 'h2' }, 'Connect with a direct link'),
        h(
          'ol',
          { cls: 'steps' },
          step(1, 'Send this link to your friend', linkBox(prettyUrl(url), 'offer-link'), h('div', { cls: 'row-btns' }, copyBtn(() => url, 'Copy link', 'copy-offer'), shareBtn(() => url))),
          step(2, 'Paste their reply', h('div', { cls: 'join' }, paste, btn('Connect', connect, { primary: true, id: 'connect' })), err, status),
        ),
        h('p', { cls: 'small muted' }, 'Keep this tab open.'),
        btn('Cancel', () => ctrl.leave(), { quiet: true }),
      );
    } else if (!s.blob) {
      el.replaceChildren(label('Direct link'), h('h2', { cls: 'h2' }, 'Preparing link…'));
    }
    if (err) err.textContent = s.error ?? '';
    if (status) status.textContent = s.step === 'connecting' ? 'Connecting…' : '';
  };
  update();
  return { el, update };
}

export function directGuest(ctrl: Controller): Screen {
  const el = h('section', { cls: 'screen narrow' });
  let built = '';
  const update = () => {
    const s = ctrl.state;
    if (s.s !== 'direct-guest') return;
    if (!s.blob) return el.replaceChildren(label('Direct link'), h('h2', { cls: 'h2' }, 'Preparing reply…'));
    if (built === s.blob) return;
    built = s.blob;
    const url = gameUrl('a=' + s.blob);
    el.replaceChildren(
      label('Direct link'),
      h('h2', { cls: 'h2' }, 'Almost there'),
      h(
        'ol',
        { cls: 'steps' },
        step(
          1,
          'Send this reply link back',
          linkBox(prettyUrl(url), 'answer-link'),
          h('div', { cls: 'row-btns' }, copyBtn(() => url, 'Copy link', 'copy-answer'), shareBtn(() => url)),
          h('p', { cls: 'small muted' }, 'Or copy just the code:'),
          h('div', { cls: 'linkbox mono small', id: 'answer-code', tabindex: 0, 'aria-label': 'Reply code' }, s.blob),
          copyBtn(() => s.blob!, 'Copy code'),
        ),
        step(2, 'Your friend opens it', h('p', { cls: 'status-line' }, h('span', { cls: 'blink', 'aria-hidden': 'true' }), 'Waiting for your friend to connect…')),
      ),
      btn('Cancel', () => ctrl.leave(), { quiet: true }),
    );
  };
  update();
  return { el, update };
}

export function forwarded(ctrl: Controller): Screen {
  const s = ctrl.state;
  if (s.s !== 'forwarded') return { el: h('section') };
  const el = h(
    'section',
    { cls: 'screen narrow', id: 'forwarded' },
    label('Direct link'),
    s.ok
      ? h('div', { cls: 'stack' }, h('h2', { cls: 'h2' }, 'Sent to your game tab. You can close this tab.'))
      : h(
          'div',
          { cls: 'stack' },
          h('h2', { cls: 'h2' }, 'Open your game tab and paste this code there'),
          h('div', { cls: 'linkbox mono small', tabindex: 0 }, s.blob),
          copyBtn(() => s.blob, 'Copy code'),
        ),
  );
  return { el };
}
