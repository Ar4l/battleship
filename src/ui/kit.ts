import type { Config, Mode, Timer } from '../game/types';
import { MODE_NAMES, TIMERS } from '../game/rules';
import { h, type Child } from './h';
import { icon, type IconName } from './icons';

export interface Screen {
  el: HTMLElement;
  update?(): void;
}

/** `cls` adds to "btn", e.g. "primary", "quiet", "wide". */
export const btn = (text: Child, onclick: () => void, cls = '', id?: string, ic?: IconName): HTMLButtonElement =>
  h('button', { cls: 'btn ' + cls, onclick, id }, ic && icon(ic), h('span', null, text));

/**
 * In-app browsers (Instagram, Facebook, TikTok…) close the page when you go back to the
 * chat to send the code, which ends the game: ask to open it in the real browser.
 */
export const inApp = (what: string) =>
  /FBA[NV]|FB_IAB|Instagram|Line\/|musical_ly|Bytedance|Snapchat/.test(navigator.userAgent) && h('p', { cls: 'small', id: 'in-app' }, `Open this page in Safari or Chrome, so the game keeps running while you send the ${what}.`);

export const label = (text: string) => h('div', 'label', text);
export const blink = () => h('span', { cls: 'blink', 'aria-hidden': 'true' });
export const status = (text: string) => h('p', 'status-line', blink(), text);

/** Copy text; briefly shows "Copied". */
export function copyBtn(get: () => string, text = 'Copy link', id?: string): HTMLButtonElement {
  const done = () => {
    span.textContent = 'Copied';
    setTimeout(() => (span.textContent = text), 1500);
  };
  const b = btn(
    text,
    () =>
      void navigator.clipboard.writeText(get()).then(done, () => {
        const ta = h('textarea', { value: get(), cls: 'sr-only' });
        document.body.append(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      }),
    '',
    id,
    'copy',
  );
  const span = b.lastChild as HTMLElement;
  return b;
}

export const shareBtn = (get: () => string) =>
  'share' in navigator && btn('Share', () => void navigator.share({ title: 'Battleship', url: get() }).catch(() => {}), '', undefined, 'share');

export const linkBox = (text: string, id?: string, cls = '') => h('div', { cls: 'linkbox mono ' + cls, id, tabindex: 0 }, text);

let segN = 0;
/** Segmented control built on native radios (keyboard behaviour for free). */
function segmented<T>(name: string, opts: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const group = 'seg' + ++segN;
  return h(
    'div',
    { cls: 'seg', role: 'radiogroup', 'aria-label': name },
    opts.map(([v, text]) => h('label', null, h('input', { type: 'radio', name: group, checked: v === value, onchange: () => onChange(v) }), h('span', null, text))),
  );
}

const toggle = (text: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) =>
  h(
    'label',
    'toggle',
    h('input', { type: 'checkbox', role: 'switch', checked, disabled, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('span', { cls: 'track', 'aria-hidden': 'true' }),
    h('span', null, text),
  );

const MODE_DESC = ['One shot per turn.', 'Fire one shot for each ship you have left.', 'Earn energy each turn and spend it on sonar, torpedoes and bombs.'];

/** Mode, toggles and timer. Calls onChange with a partial config. */
export function settings(c: Config, onChange: (p: Partial<Config>) => void): HTMLElement {
  const wrap = h('div', 'settings');
  const set = (p: Partial<Config>, redraw = false) => {
    c = { ...c, ...p };
    onChange(p);
    if (redraw) render();
  };
  const render = () =>
    wrap.replaceChildren(
      h(
        'div',
        'opt',
        label('Mode'),
        segmented('Mode', MODE_NAMES.map((n, i) => [i as Mode, n]), c.mode, (mode) => set({ mode, extraShot: false }, true)),
        h('p', 'small muted', MODE_DESC[c.mode]),
      ),
      h(
        'div',
        null,
        toggle('Extra shot after a hit', c.extraShot, (extraShot) => set({ extraShot }), c.mode > 0),
        toggle("Ships can't touch", c.noTouch, (noTouch) => set({ noTouch })),
      ),
      h(
        'div',
        'opt',
        label('Turn timer'),
        segmented('Turn timer', TIMERS.map((t) => [t, t ? t + ' s' : 'Off']), c.timer, (timer: Timer) => set({ timer })),
      ),
    );
  render();
  return wrap;
}

export const gameUrl = (hash: string): string => location.origin + import.meta.env.BASE_URL + '#' + hash;
export const prettyUrl = (u: string): string => u.replace(/^https?:\/\//, '');
