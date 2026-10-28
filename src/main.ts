import './styles/tokens.css';
import './styles/app.css';
import { Controller } from './app/controller';
import { installDebug } from './app/debug';
import { createDirectGuest, createDirectHost } from './net/direct';
import { forwardAnswer, listenForAnswers } from './net/forward';
import { openRoom, prefetch, randomCode } from './net/room';
import { mountApp } from './ui/app-view';

const ctrl = new Controller({ openRoom, randomCode, createDirectHost, createDirectGuest, listenForAnswers, forwardAnswer });
installDebug(ctrl);
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
