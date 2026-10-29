import type { Controller } from '../app/controller';
import type { Config, Mode, Size, Timer } from '../game/types';
import { MODE_NAMES, SIZES, TIMERS } from '../game/rules';
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
function segmented<T>(name: string, opts: [T, string][], value: T, onChange: (v: T) => void, off?: (v: T) => boolean): HTMLElement {
  const group = 'seg' + ++segN;
  return h(
    'div',
    { cls: 'seg', role: 'radiogroup', 'aria-label': name },
    opts.map(([v, text]) => h('label', null, h('input', { type: 'radio', name: group, checked: v === value, disabled: off?.(v), onchange: () => onChange(v) }), h('span', null, text))),
  );
}

/** A settings row: label left, switch right; `why` explains a locked switch. */
const toggle = (text: string, checked: boolean, onChange: (v: boolean) => void, why = '') =>
  h(
    'label',
    'toggle',
    h('span', 'tl', h('span', null, text), why && h('span', 'why', why)),
    h('input', { type: 'checkbox', role: 'switch', checked, disabled: !!why, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('span', { cls: 'track', 'aria-hidden': 'true' }),
  );

const MODE_DESC = ['One shot a turn.', 'One shot for each ship you have left, all fired together.', 'Earn energy each turn. Spend it on sonar, torpedoes and strikes.', 'Ten ships, none touching. A hit shoots again.'];
const MAP_DESC = ['Small and quick.', 'Open sea.', 'With islands. Ships can\'t sit on land and torpedoes stop at it.'];
const opt = (name: string, control: HTMLElement, desc?: string | false) => h('div', 'opt', label(name), control, desc && h('p', 'small muted', desc));

/** Mode, map, timer and the rule switches, straight onto the controller's config. */
export function settings(ctrl: Controller): HTMLElement {
  const wrap = h('div', 'settings');
  const set = (p: Partial<Config>) => {
    ctrl.setConfig(p);
    // Redraw (locks and descriptions follow the mode), keeping keyboard focus where it was.
    const ins = () => [...wrap.querySelectorAll('input')];
    const at = ins().indexOf(document.activeElement as HTMLInputElement);
    render();
    ins()[at]?.focus();
  };
  const render = () => {
    const c = ctrl.config;
    const ru = c.mode === 3;
    const always = ru ? 'Always on in Russian' : '';
    wrap.replaceChildren(
      opt('Mode', segmented('Mode', MODE_NAMES.map((n, i) => [i as Mode, n]), c.mode, (mode) => set({ mode })), MODE_DESC[c.mode]),
      opt('Map', segmented('Map', SIZES.map((n, i) => [i as Size, `${n}×${n}`]), c.size, (size) => set({ size }), (v) => ru && v !== 1), ru ? 'Always 10×10 in Russian.' : MAP_DESC[Math.min(c.size, 2)]),
      opt('Turn timer', segmented('Turn timer', TIMERS.map((t) => [t, t ? t + ' s' : 'Off']), c.timer, (timer: Timer) => set({ timer }))),
      h(
        'div',
        'switches',
        toggle('Extra shot after a hit', c.extraShot, (extraShot) => set({ extraShot }), c.mode === 1 ? 'Not in Salvo' : always),
        toggle("Ships can't touch", c.noTouch, (noTouch) => set({ noTouch }), always),
      ),
    );
  };
  render();
  return wrap;
}

export const gameUrl = (hash: string): string => location.origin + import.meta.env.BASE_URL + '#' + hash;
export const prettyUrl = (u: string): string => u.replace(/^https?:\/\//, '');
