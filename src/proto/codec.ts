import { decodeFleet, decodeShip, encodeFleet, encodeShip } from '../game/board';
import { decodeConfig, encodeConfig } from '../game/rules';
import type { Config, Entry, Fleet, ItemId } from '../game/types';

/** 4: independent fleet, turns and items settings (5-byte config); simultaneous salvo. */
export const PROTO_VERSION = 4;

export type Msg =
  | { t: 'hello'; ver: number; role: 0 | 1 }
  | { t: 'config'; config: Config }
  | { t: 'ready'; board: Uint8Array; coin: Uint8Array }
  | { t: 'coin'; nonce: Uint8Array }
  | { t: 'fire'; cells: number[] }
  | { t: 'answer'; entries: Entry[] }
  | { t: 'use'; item: ItemId; a: number; b: number }
  | { t: 'sonar'; count: number }
  | { t: 'reveal'; salt: Uint8Array; fleet: Fleet }
  | { t: 'verdict'; ok: boolean }
  | { t: 'rematch'; config?: Config }
  | { t: 'bye' }
  | { t: 'ping' }
  | { t: 'pong' };

/** Opcode per message type; one byte, then the body. */
const OP = { hello: 1, config: 2, ready: 3, coin: 4, fire: 16, answer: 17, use: 18, sonar: 19, reveal: 32, verdict: 33, rematch: 48, bye: 49, ping: 50, pong: 51 } as const;

export function encode(m: Msg): Uint8Array {
  const body: ArrayLike<number>[] =
    m.t === 'hello' ? [[m.ver, m.role]]
    : m.t === 'config' || m.t === 'rematch' ? (m.config ? [encodeConfig(m.config)] : [])
    : m.t === 'ready' ? [m.board, m.coin]
    : m.t === 'coin' ? [m.nonce]
    : m.t === 'fire' ? [m.cells]
    : m.t === 'answer' ? m.entries.map((e) => (e.code > 1 ? [e.cell, e.code, ...encodeShip(e.ship!)] : [e.cell, e.code]))
    : m.t === 'use' ? [[m.item, m.a, m.b]]
    : m.t === 'sonar' ? [[m.count]]
    : m.t === 'reveal' ? [m.salt, encodeFleet(m.fleet)]
    : m.t === 'verdict' ? [[+m.ok]]
    : [];
  return Uint8Array.from([OP[m.t], ...body.flatMap((p) => Array.from(p))]);
}

/** null for anything malformed. */
export function decode(u: Uint8Array): Msg | null {
  const n = u.length;
  const [op, a = 0, b = 0, c = 0] = u;
  const config = decodeConfig(u.subarray(1));
  switch (op) {
    case OP.hello:
      return n === 3 && b < 2 ? { t: 'hello', ver: a, role: b as 0 | 1 } : null;
    case OP.config:
      return config && { t: 'config', config };
    case OP.ready:
      return n === 65 ? { t: 'ready', board: u.slice(1, 33), coin: u.slice(33) } : null;
    case OP.coin:
      return n === 17 ? { t: 'coin', nonce: u.slice(1) } : null;
    case OP.fire: {
      const cells = [...u.subarray(1)];
      return n > 1 && n < 7 && cells.every((x) => x < 196) ? { t: 'fire', cells } : null;
    }
    case OP.answer: {
      const entries: Entry[] = [];
      for (let i = 1; i < n; ) {
        const cell = u[i++]!;
        const code = u[i++] ?? 9;
        const ship = code > 1 ? decodeShip(u[i++] ?? 0, u[i++] ?? 9) : null;
        if (cell > 195 || code > 11 || i > n || (code > 1 && !ship)) return null;
        entries.push(ship ? { cell, code, ship } : { cell, code });
      }
      return { t: 'answer', entries };
    }
    case OP.use:
      return n === 4 && a < 5 ? { t: 'use', item: a as ItemId, a: b, b: c } : null;
    case OP.sonar:
      return n === 2 && a < 10 ? { t: 'sonar', count: a } : null;
    case OP.reveal: {
      const fleet = n > 17 && decodeFleet(u.subarray(17));
      return fleet ? { t: 'reveal', salt: u.slice(1, 17), fleet } : null;
    }
    case OP.verdict:
      return n === 2 && a < 2 ? { t: 'verdict', ok: a === 1 } : null;
    case OP.rematch:
      return n === 1 ? { t: 'rematch' } : config && { t: 'rematch', config };
    case OP.bye:
    case OP.ping:
    case OP.pong:
      return n === 1 ? { t: (['bye', 'ping', 'pong'] as const)[op - OP.bye]! } : null;
  }
  return null;
}
