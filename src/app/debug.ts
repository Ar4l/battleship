import { packSdp } from '../proto/sdp';
import type { Msg } from '../proto/codec';
import { randomFleet } from '../game/random';
import { seededRng } from '../game/seeded';
import type { Controller } from './controller';

/** Cheat-test hook: answer "miss" whenever `cell` is hit. Wraps the controller's private send. */
export function lie(ctrl: Controller, cell: number): void {
  const c = ctrl as unknown as { send(m: Msg): void };
  const send = c.send.bind(ctrl);
  c.send = (m) =>
    send(m.t === 'answer' ? { t: 'answer', entries: m.entries.map((e) => (e.cell === cell && e.code ? { cell, code: 0 } : e)) } : m);
}

/** window.__bs hooks for e2e. main.ts loads this only when localStorage 'bs:debug' === '1'. */
export function installDebug(ctrl: Controller): void {
  const fp = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':');
  (window as unknown as { __bs: unknown }).__bs = {
    ctrl,
    state: () => ctrl.state,
    myFleet: () => ctrl.fleet,
    seed: (n: number) => {
      ctrl.rng = seededRng(n);
      if (ctrl.state.s === 'placement') ctrl.setFleet(randomFleet(ctrl.config.noTouch, ctrl.rng));
    },
    setFleet: (f: Controller['fleet']) => ctrl.setFleet(f),
    lie: (_kind: 'miss-on-hit', cell: string) => lie(ctrl, (+cell.slice(1) - 1) * 10 + 'ABCDEFGHIJ'.indexOf(cell[0]!)),
    /** An answer blob pointing at an unreachable address. */
    fakeAnswer: () =>
      packSdp(`a=ice-ufrag:abcd\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\na=fingerprint:sha-256 ${fp}\r\na=candidate:1 1 udp 2130706431 192.0.2.1 9 typ host\r\n`, 'answer'),
  };
}
