import type { Config, Mode, Timer } from '../game/types';
import { MODE_NAMES, TIMERS } from '../game/rules';
import { h, type Child } from './h';
import { icon, type IconName } from './icons';

export interface Screen {
  el: HTMLElement;
  update?(): void;
  destroy?(): void;
}

export function btn(label: Child, onClick: (e: MouseEvent) => void, o: { primary?: boolean; icon?: IconName; disabled?: boolean; cls?: string; id?: string; quiet?: boolean } = {}): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', cls: `btn${o.primary ? ' primary' : ''}${o.quiet ? ' quiet' : ''}${o.cls ? ' ' + o.cls : ''}`, onclick: onClick, disabled: o.disabled, id: o.id },
    o.icon ? icon(o.icon) : null,
    h('span', null, label),
  );
}

export const label = (text: string, attrs: Record<string, unknown> = {}) => h('div', { cls: 'label', ...attrs }, text);

/** Copy text; temporarily shows "Copied". */
export function copyBtn(get: () => string, text = 'Copy link', id?: string): HTMLButtonElement {
  const b = btn(text, async () => {
    try {
      await navigator.clipboard.writeText(get());
    } catch {
      const ta = h('textarea', { value: get(), cls: 'sr-only' });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const span = b.querySelector('span')!;
    span.textContent = 'Copied';
    setTimeout(() => (span.textContent = text), 1500);
  }, { icon: 'copy', id });
  return b;
}

export function shareBtn(get: () => string, title = 'Battleship'): HTMLButtonElement | null {
  if (!('share' in navigator)) return null;
  return btn('Share', () => void navigator.share({ title, url: get() }).catch(() => {}), { icon: 'share' });
}

export const linkBox = (text: string, id?: string) => h('div', { cls: 'linkbox mono', id, tabindex: 0, 'aria-label': 'Link' }, text);

let segN = 0;
/** Segmented control built on native radios (keyboard behaviour for free). */
export function segmented<T extends string | number>(name: string, opts: { v: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const group = 'seg' + ++segN;
  return h(
    'div',
    { cls: 'seg', role: 'radiogroup', 'aria-label': name },
    opts.map((o) =>
      h('label', null, h('input', { type: 'radio', name: group, checked: o.v === value, onchange: () => onChange(o.v) }), h('span', null, o.label)),
    ),
  );
}

export function toggle(text: string, checked: boolean, onChange: (v: boolean) => void, disabled = false): HTMLElement {
  return h(
    'label',
    { cls: 'toggle' + (disabled ? ' off' : '') },
    h('input', { type: 'checkbox', role: 'switch', checked, disabled, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('span', { cls: 'track', 'aria-hidden': 'true' }),
    h('span', null, text),
  );
}

const MODE_DESC = [
  'One shot per turn.',
  'Fire one shot for each ship you have left.',
  'Earn energy each turn and spend it on sonar, torpedoes and bombs.',
];

/** Mode, toggles and timer. Calls onChange with a partial config. */
export function settings(c: Config, onChange: (p: Partial<Config>) => void): HTMLElement {
  const wrap = h('div', { cls: 'settings' });
  const render = () => {
    wrap.replaceChildren(
      h(
        'div',
        { cls: 'field-row' },
        label('Mode', { id: 'lbl-mode' }),
        segmented('Mode', MODE_NAMES.map((n, i) => ({ v: i as Mode, label: n })), c.mode, (v) => {
          c = { ...c, mode: v, extraShot: v === 0 ? c.extraShot : false };
          onChange({ mode: v });
          render();
        }),
        h('p', { cls: 'small muted' }, MODE_DESC[c.mode]),
      ),
      h(
        'div',
        { cls: 'field-row toggles' },
        toggle('Extra shot after a hit', c.extraShot, (v) => onChange({ extraShot: v }), c.mode !== 0),
        toggle("Ships can't touch", c.noTouch, (v) => onChange({ noTouch: v })),
      ),
      h(
        'div',
        { cls: 'field-row' },
        label('Turn timer'),
        segmented('Turn timer', TIMERS.map((t) => ({ v: t, label: t ? `${t} s` : 'Off' })), c.timer, (v: Timer) => onChange({ timer: v })),
      ),
    );
  };
  render();
  return wrap;
}

export const gameUrl = (hash: string): string => location.origin + import.meta.env.BASE_URL + '#' + hash;
export const prettyUrl = (u: string): string => u.replace(/^https?:\/\//, '');
