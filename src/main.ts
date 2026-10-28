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
  const s = ctrl.state.s;
  if (hash.startsWith('a=') && s === 'direct-host') {
    // The reply link was opened in the game tab itself.
    clearHash();
    ctrl.pasteAnswer(blob);
  } else if (s !== 'home') return;
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
