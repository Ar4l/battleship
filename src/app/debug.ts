import { packSdp } from '../proto/sdp';
import { seededRng, randomFleet } from '../game/random';
import type { Controller, Lie } from './controller';

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
    lie: (kind: Lie['kind'], cell: string) => {
      const m = /^([A-J])(\d+)$/.exec(cell)!;
      ctrl.lie = { kind, cell: (+m[2]! - 1) * 10 + 'ABCDEFGHIJ'.indexOf(m[1]!) };
    },
    /** An answer blob pointing at an unreachable address. */
    fakeAnswer: () =>
      packSdp(`a=ice-ufrag:abcd\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\na=fingerprint:sha-256 ${fp}\r\na=candidate:1 1 udp 2130706431 192.0.2.1 9 typ host\r\n`, 'answer'),
  };
}
