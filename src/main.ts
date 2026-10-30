import './styles/tokens.css';
import './styles/app.css';
import { Controller } from './app/controller';
import { openRoom, prefetch, randomCode } from './net/room';
import { mountApp } from './ui/app-view';

// The direct-link fallback is loaded only when someone needs it.
const ctrl = new Controller({ openRoom, randomCode, direct: () => import('./net/direct') });
try {
  if (localStorage.getItem('bs:debug') === '1') void import('./app/debug').then((d) => d.installDebug(ctrl));
} catch {
  /* storage blocked */
}
mountApp(document.getElementById('app')!, ctrl);

const clearHash = () => history.replaceState(null, '', location.pathname + location.search);
function route(): void {
  const hash = location.hash.slice(1);
  const blob = hash.slice(2);
  const st = ctrl.state;
  const s = st.s;
  if (hash.startsWith('a=') && s === 'direct-host') {
    // The reply link was opened in the game tab itself.
    clearHash();
    ctrl.pasteAnswer(blob);
  }
  // A new link opened in a tab left on a finished screen (Android reuses the tab) counts too.
  else if (s !== 'home' && s !== 'notice' && !(s === 'end' && st.peerLeft)) return;
  else if (/^[1-9]\d{3}$/.test(hash)) {
    void prefetch();
    ctrl.joinCode(+hash);
  } else if (hash.startsWith('o=')) {
    clearHash();
    void ctrl.openOffer(blob);
  } else if (hash.startsWith('a=')) {
    clearHash();
    void ctrl.openAnswer(blob);
  }
}
route();
addEventListener('hashchange', route);
// Once connected, a #NNNN link has done its job; reopening the tab later must not join a stranger's game.
ctrl.subscribe(() => ctrl.state.s === 'placement' && location.hash && clearHash());
addEventListener('pagehide', () => ctrl.state.s !== 'home' && ctrl.leave());

// Keep the screen on while a game is set up or played: a phone that locks suspends
// the page and the link drops. Browsers release the lock whenever the page is hidden.
type Lock = Promise<WakeLockSentinel | void> | undefined;
let lock: Lock;
/** No tap or game event for 5 minutes outside placement and battle: let the screen sleep. */
let idle = false;
let idleTimer = 0;
const wake = () => {
  const s = ctrl.state;
  // Not on home, notice, forwarded or stats.
  const on = !document.hidden && (s.s === 'end' ? !s.peerLeft : !/^[hnfs]/.test(s.s)) && !(idle && s.s !== 'placement' && s.s !== 'battle');
  if (on && !lock) {
    // The system may drop the lock (battery saver) or refuse it: ask again on the next event.
    const drop = () => void (lock === p && (lock = undefined));
    const p: Lock = (lock = navigator.wakeLock?.request('screen').then((l) => ((l.onrelease = drop), l), drop));
  } else if (!on && lock) {
    void lock.then((l) => l?.release());
    lock = undefined;
  }
};
const poke = () => {
  idle = false;
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => ((idle = true), wake()), 300000);
  wake();
};
ctrl.subscribe(poke);
addEventListener('pointerdown', poke, { passive: true });
document.addEventListener('visibilitychange', () => {
  ctrl.visibility(document.hidden);
  wake();
});
