import './styles/tokens.css';
import './styles/app.css';
import { Controller } from './app/controller';
import { openRoom, prefetch, randomCode } from './net/room';
import { mountApp } from './ui/app-view';

// The direct-link fallback is loaded only when someone needs it.
const direct = () => import('./net/direct');
const forward = () => import('./net/forward');

const ctrl = new Controller({
  openRoom,
  randomCode,
  createDirectHost: async () => (await direct()).createDirectHost(),
  createDirectGuest: async (o) => (await direct()).createDirectGuest(o),
  listenForAnswers: (cb) => {
    let stop = () => {};
    let done = false;
    void forward().then((f) => !done && (stop = f.listenForAnswers(cb)));
    return () => ((done = true), stop());
  },
  forwardAnswer: async (b) => (await forward()).forwardAnswer(b),
});
let debug = false;
try {
  debug = localStorage.getItem('bs:debug') === '1';
} catch {
  /* storage blocked */
}
if (debug) void import('./app/debug').then((d) => d.installDebug(ctrl));
mountApp(document.getElementById('app')!, ctrl);

function route(): void {
  const hash = location.hash.slice(1);
  if (/^\d{4}$/.test(hash) && +hash >= 1000) {
    void prefetch();
    ctrl.joinCode(+hash);
  } else if (hash.startsWith('o=')) {
    history.replaceState(null, '', location.pathname + location.search);
    void ctrl.openOffer(hash.slice(2));
  } else if (hash.startsWith('a=')) {
    history.replaceState(null, '', location.pathname + location.search);
    void ctrl.openAnswer(hash.slice(2));
  }
}
route();
addEventListener('hashchange', () => {
  if (ctrl.state.s === 'home') route();
});
addEventListener('pagehide', () => ctrl.state.s !== 'home' && ctrl.leave());
