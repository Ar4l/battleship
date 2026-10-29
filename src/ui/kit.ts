import type { Controller } from '../app/controller';
import type { Config, Size } from '../game/types';
import { SIZES, TIMERS } from '../game/rules';
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
const TURN_DESC = ['One shot a turn.', 'One shot per ship afloat, up to 5.', 'Both players fire their salvos at once.'];
const MAP_DESC = ['Small and quick.', 'Open sea.', "With islands. Ships can't sit on land and torpedoes stop at it."];
type Key = keyof Config;

/** Fleet, turns, map, timer and the rule switches, straight onto the controller's config. */
export function settings(ctrl: Controller): HTMLElement {
  const wrap = h('div', 'settings');
  const set = (p: Partial<Config>) => {
    ctrl.setConfig(p);
    // Redraw (locks and descriptions follow the rules), keeping keyboard focus where it was.
    const ins = () => [...wrap.querySelectorAll('input')];
    const at = ins().indexOf(document.activeElement as HTMLInputElement);
    render();
    ins()[at]?.focus();
  };
  const render = () => {
    const c = ctrl.config;
    /** Segmented control on native radios (keyboard behaviour for free), with a one-line description. */
    const seg = <K extends Key>(name: string, k: K, opts: [Config[K], string][], desc?: string | false, off?: (v: Config[K]) => boolean) => {
      const group = 'seg' + ++segN;
      return h(
        'div',
        'opt',
        label(name),
        h(
          'div',
          { cls: 'seg', role: 'radiogroup', 'aria-label': name },
          opts.map(([v, text]) => h('label', null, h('input', { type: 'radio', name: group, checked: v === c[k], disabled: off?.(v), onchange: () => set({ [k]: v }) }), h('span', null, text))),
        ),
        desc && h('p', 'small muted', desc),
      );
    };
    /** A settings row: label left, switch right; `why` explains a locked switch, or (`off` false) describes it. */
    const toggle = (text: string, k: 'items' | 'extraShot' | 'noTouch', why = '', off = !!why) =>
      h(
        'label',
        'toggle',
        h('span', 'tl', h('span', null, text), why && h('span', 'why', why)),
        h('input', { type: 'checkbox', role: 'switch', checked: c[k], disabled: off, onchange: (e: Event) => set({ [k]: (e.target as HTMLInputElement).checked }) }),
        h('span', { cls: 'track', 'aria-hidden': 'true' }),
      );
    const ru = c.russian;
    const always = ru ? 'Always on in Russian' : '';
    const salvo = c.turns ? 'One-shot turns only' : '';
    wrap.replaceChildren(
      seg('Fleet', 'russian', [[false, 'Standard'], [true, 'Russian']], ru ? 'Ten ships, 1×4 to 4×1, none touching.' : 'Four to eight ships, by map size.'),
      seg('Turns', 'turns', [[0, 'One shot'], [1, 'Salvo'], [2, 'Simultaneous']], TURN_DESC[c.turns]),
      seg('Map', 'size', SIZES.map((n, i) => [i as Size, `${n}×${n}`]), ru ? 'Always 10×10 in Russian.' : MAP_DESC[Math.min(c.size, 2)], (v) => ru && v !== 1),
      seg('Turn timer', 'timer', TIMERS.map((t) => [t, t ? t + ' s' : 'Off'])),
      h('div', 'switches', toggle('Items', 'items', salvo || 'Sonar, torpedoes and strikes', !!salvo), toggle('Extra shot after a hit', 'extraShot', salvo || always), toggle("Ships can't touch", 'noTouch', always)),
    );
  };
  render();
  return wrap;
}

export const gameUrl = (hash: string): string => location.origin + import.meta.env.BASE_URL + '#' + hash;
export const prettyUrl = (u: string): string => u.replace(/^https?:\/\//, '');
