import type { Controller } from '../app/controller';
import { rulesLine } from '../game/rules';
import { announce, mountAnnouncer } from './announce';
import { h } from './h';
import { icon } from './icons';
import type { Screen } from './kit';
import { battle } from './screens/battle';
import { directGuest, directHost, forwarded } from './screens/direct';
import { end } from './screens/end';
import { home, mark } from './screens/home';
import { lobbyGuest, lobbyHost } from './screens/lobby';
import { notice } from './screens/notice';
import { placement } from './screens/placement';
import { isMuted, play, setMuted, unlockAudio } from './sound';

/** Mounts the shell and swaps screens when the state kind changes. */
export function mountApp(root: HTMLElement, ctrl: Controller): void {
  const muteBtn = h('button', { type: 'button', cls: 'iconbtn', id: 'mute', 'aria-label': 'Sound' });
  const paintMute = () => {
    muteBtn.setAttribute('aria-pressed', String(!isMuted()));
    muteBtn.title = isMuted() ? 'Sound off' : 'Sound on';
    muteBtn.replaceChildren(icon(isMuted() ? 'soundOff' : 'soundOn'));
  };
  muteBtn.addEventListener('click', () => {
    unlockAudio();
    setMuted(!isMuted());
    paintMute();
  });
  paintMute();
  const brand = h('div', { cls: 'brand' }, mark(), h('span', null, 'Battleship'));
  const meta = h('div', { cls: 'meta small mono muted' });
  const leaveBtn = h('button', { type: 'button', cls: 'textlink small', id: 'leave', onclick: () => ctrl.leave() }, 'Leave');
  const header = h('header', { cls: 'top' }, brand, meta, h('div', { cls: 'top-right' }, leaveBtn, muteBtn));
  const main = h('main', { id: 'main' });
  root.replaceChildren(header, main);
  mountAnnouncer(root);
  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  ctrl.onSfx = play;
  ctrl.onAnnounce = announce;

  let kind = '';
  let screen: Screen | null = null;
  const render = () => {
    const s = ctrl.state;
    if (s.s !== kind) {
      kind = s.s;
      screen?.destroy?.();
      const make = {
        home: () => home(ctrl, s.s === 'home' ? s.code : ''),
        'lobby-host': () => lobbyHost(ctrl),
        'lobby-guest': () => lobbyGuest(ctrl),
        'direct-host': () => directHost(ctrl),
        'direct-guest': () => directGuest(ctrl),
        forwarded: () => forwarded(ctrl),
        placement: () => placement(ctrl),
        battle: () => battle(ctrl),
        end: () => end(ctrl),
        notice: () => notice(ctrl),
      }[s.s];
      screen = make();
      main.replaceChildren(screen.el);
      document.body.dataset.screen = s.s;
      const focusable = screen.el.querySelector<HTMLElement>('h1, h2, [autofocus]');
      if (s.s !== 'home' && focusable) {
        focusable.tabIndex = -1;
        focusable.focus({ preventScroll: true });
      }
      window.scrollTo(0, 0);
    } else screen?.update?.();
    const inGame = s.s === 'placement' || s.s === 'battle' || s.s === 'end';
    header.classList.toggle('is-home', s.s === 'home');
    leaveBtn.hidden = !inGame;
    meta.textContent = inGame ? rulesLine(ctrl.config) : '';
  };
  ctrl.subscribe(render);
  render();
}
