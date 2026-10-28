import { decodeFleet, decodeShip, encodeFleet, encodeShip } from '../game/board';
import { decodeConfig, encodeConfig } from '../game/rules';
import type { Answer, Attack, Config, Entry, Fleet, ItemId } from '../game/types';

export const PROTO_VERSION = 1;
export const MAX_FRAME = 65; // READY is the largest frame

export const OP = {
  HELLO: 0x01,
  CONFIG: 0x02,
  READY: 0x03,
  COIN: 0x04,
  FIRE: 0x10,
  ANSWER: 0x11,
  USE: 0x12,
  SONAR: 0x13,
  REVEAL: 0x20,
  VERDICT: 0x21,
  REMATCH: 0x30,
  BYE: 0x31,
} as const;

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
  | { t: 'bye' };

export function encode(m: Msg): Uint8Array {
  const b = (...xs: (number | ArrayLike<number>)[]): Uint8Array => {
    const out: number[] = [];
    for (const x of xs) typeof x === 'number' ? out.push(x) : out.push(...Array.from(x));
    return Uint8Array.from(out);
  };
  switch (m.t) {
    case 'hello':
      return b(OP.HELLO, m.ver, m.role);
    case 'config':
      return b(OP.CONFIG, encodeConfig(m.config));
    case 'ready':
      return b(OP.READY, m.board, m.coin);
    case 'coin':
      return b(OP.COIN, m.nonce);
    case 'fire':
      return b(OP.FIRE, m.cells);
    case 'answer':
      return b(OP.ANSWER, ...m.entries.flatMap((e) => (e.code >= 2 ? [e.cell, e.code, encodeShip(e.ship!)] : [e.cell, e.code])));
    case 'use':
      return b(OP.USE, m.item, m.a, m.b);
    case 'sonar':
      return b(OP.SONAR, m.count);
    case 'reveal':
      return b(OP.REVEAL, m.salt, encodeFleet(m.fleet));
    case 'verdict':
      return b(OP.VERDICT, m.ok ? 1 : 0);
    case 'rematch':
      return m.config ? b(OP.REMATCH, encodeConfig(m.config)) : b(OP.REMATCH);
    case 'bye':
      return b(OP.BYE);
  }
}

export function decode(u: Uint8Array): Msg | null {
  const n = u.length;
  if (n < 1 || n > MAX_FRAME) return null;
  const at = (i: number) => u[i]!;
  switch (at(0)) {
    case OP.HELLO:
      return n === 3 && at(2) <= 1 ? { t: 'hello', ver: at(1), role: at(2) as 0 | 1 } : null;
    case OP.CONFIG: {
      const config = n === 4 ? decodeConfig(at(1), at(2), at(3)) : null;
      return config ? { t: 'config', config } : null;
    }
    case OP.READY:
      return n === 65 ? { t: 'ready', board: u.slice(1, 33), coin: u.slice(33, 65) } : null;
    case OP.COIN:
      return n === 17 ? { t: 'coin', nonce: u.slice(1) } : null;
    case OP.FIRE: {
      const cells = Array.from(u.subarray(1));
      return cells.length >= 1 && cells.length <= 5 && cells.every((c) => c < 100) ? { t: 'fire', cells } : null;
    }
    case OP.ANSWER: {
      const entries: Entry[] = [];
      let i = 1;
      while (i < n) {
        if (i + 1 >= n) return null;
        const cell = at(i);
        const code = at(i + 1);
        i += 2;
        if (cell > 99 || code > 6) return null;
        if (code >= 2) {
          if (i >= n) return null;
          const ship = decodeShip(at(i++));
          if (!ship) return null;
          entries.push({ cell, code, ship });
        } else entries.push({ cell, code });
      }
      return { t: 'answer', entries };
    }
    case OP.USE:
      return n === 4 && at(1) <= 3 ? { t: 'use', item: at(1) as ItemId, a: at(2), b: at(3) } : null;
    case OP.SONAR:
      return n === 2 && at(1) <= 9 ? { t: 'sonar', count: at(1) } : null;
    case OP.REVEAL: {
      const fleet = n === 22 ? decodeFleet(u.subarray(17)) : null;
      return fleet ? { t: 'reveal', salt: u.slice(1, 17), fleet } : null;
    }
    case OP.VERDICT:
      return n === 2 && at(1) <= 1 ? { t: 'verdict', ok: at(1) === 1 } : null;
    case OP.REMATCH: {
      if (n === 1) return { t: 'rematch' };
      const config = n === 4 ? decodeConfig(at(1), at(2), at(3)) : null;
      return config ? { t: 'rematch', config } : null;
    }
    case OP.BYE:
      return n === 1 ? { t: 'bye' } : null;
  }
  return null;
}

export const attackMsg = (a: Attack): Msg =>
  a.k === 'fire' ? { t: 'fire', cells: a.cells } : { t: 'use', item: a.item, a: a.a, b: a.b };

export const answerMsg = (a: Answer): Msg =>
  a.k === 'sonar' ? { t: 'sonar', count: a.count } : { t: 'answer', entries: a.entries };

export function msgAttack(m: Msg): Attack | null {
  if (m.t === 'fire') return { k: 'fire', cells: m.cells };
  if (m.t === 'use') return { k: 'item', item: m.item, a: m.a, b: m.b };
  return null;
}

export function msgAnswer(m: Msg): Answer | null {
  if (m.t === 'answer') return { k: 'cells', entries: m.entries };
  if (m.t === 'sonar') return { k: 'sonar', count: m.count };
  return null;
}
