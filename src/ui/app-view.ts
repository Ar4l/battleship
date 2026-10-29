import type { Controller } from '../app/controller';
import { rulesLine } from '../game/rules';
import { announce, mountAnnouncer } from './announce';
import { h } from './h';
import { icon } from './icons';
import { blink, type Screen } from './kit';
import { battle } from './screens/battle';
import { end } from './screens/end';
import { home, mark } from './screens/home';
import { lobbyGuest, lobbyHost } from './screens/lobby';
import { notice } from './screens/notice';
import { placement } from './screens/placement';
import { armAudio, isMuted, play, setMuted, unlockAudio } from './sound';

type Direct = typeof import('./screens/direct');
let direct: Direct | null = null;

/** Mounts the shell and swaps screens when the state kind changes. */
export function mountApp(root: HTMLElement, ctrl: Controller): void {
  const mute = h('button', { cls: 'iconbtn', id: 'mute', 'aria-label': 'Sound' });
  const paintMute = () => {
    mute.setAttribute('aria-pressed', String(!isMuted()));
    mute.title = isMuted() ? 'Sound off' : 'Sound on';
    mute.replaceChildren(icon(isMuted() ? 'soundOff' : 'soundOn'));
  };
  mute.onclick = () => {
    unlockAudio();
    setMuted(!isMuted());
    paintMute();
  };
  paintMute();
  // Leaving a live game takes two steps: "Leave" asks, "Leave" again confirms.
  // "Stay" lands where "Leave" was, so a double tap is harmless.
  const confirm = (on: boolean) => {
    header.classList.toggle('confirm', on);
    if (on) stay.focus();
  };
  const live = () => ctrl.state.s === 'placement' || ctrl.state.s === 'battle';
  const leave = h('button', { cls: 'textlink', id: 'leave', onclick: () => (live() ? confirm(true) : ctrl.leave()) }, 'Leave');
  const yes = h('button', { cls: 'textlink ask', id: 'leave-yes', 'aria-label': 'Leave this game', onclick: () => ctrl.leave() }, 'Leave');
  const stay = h('button', { cls: 'textlink ask', id: 'stay', 'aria-label': 'Stay in this game', onclick: () => (confirm(false), leave.focus()) }, 'Stay');
  const meta = h('div', 'meta small mono muted');
  const header = h(
    'header',
    'top',
    h('div', 'brand', mark(), h('span', null, 'Battleship')),
    meta,
    h('p', 'ask', 'Leave game?'),
    yes,
    stay,
    leave,
    mute,
  );
  const main = h('main', { id: 'main' });
  const lost = h('p', { cls: 'status-line lost', id: 'lost', role: 'status' }, blink(), 'Connection lost. Waiting for your opponent…');
  root.replaceChildren(header, lost, main);
  mountAnnouncer(root);
  armAudio();
  ctrl.onSfx = play;
  ctrl.onAnnounce = announce;

  let kind = '';
  let screen: Screen | null = null;
  const render = () => {
    const s = ctrl.state;
    if (s.s !== kind) {
      kind = s.s;
      confirm(false);
      const lazy = s.s === 'direct-host' ? 'directHost' : s.s === 'direct-guest' ? 'directGuest' : s.s === 'forwarded' ? 'forwarded' : null;
      if (lazy && !direct)
        void import('./screens/direct').then((d) => {
          direct = d;
          kind = '';
          render();
        });
      screen = lazy
        ? direct
          ? direct[lazy](ctrl)
          : { el: h('section') }
        : ({ home: () => home(ctrl, s.s === 'home' ? s.code : ''), 'lobby-host': lobbyHost, 'lobby-guest': lobbyGuest, placement, battle, end, notice } as Record<string, (c: Controller) => Screen>)[
            s.s
          ]!(ctrl);
      main.replaceChildren(screen.el);
      document.body.dataset.screen = s.s;
      const focusable = screen.el.querySelector<HTMLElement>('h2');
      if (s.s !== 'home' && focusable) {
        focusable.tabIndex = -1;
        focusable.focus({ preventScroll: true });
      }
      scrollTo(0, 0);
    } else screen?.update?.();
    const inGame = live() || s.s === 'end';
    header.classList.toggle('is-home', s.s === 'home');
    leave.hidden = !inGame;
    lost.hidden = !(ctrl.lost && live());
    meta.textContent = inGame ? rulesLine(ctrl.config) : '';
  };
  ctrl.subscribe(render);
  render();
}
