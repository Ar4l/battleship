import { describe, expect, it } from 'vitest';
import { decode, encode, type Msg } from '../../src/proto/codec';
import { FLEET_B } from './helpers';

const bytes = (n: number, v = 7) => new Uint8Array(n).fill(v);

describe('codec', () => {
  const msgs: [Msg, number][] = [
    [{ t: 'hello', ver: 1, role: 1 }, 3],
    [{ t: 'config', config: { mode: 2, extraShot: false, noTouch: true, timer: 30 } }, 4],
    [{ t: 'ready', board: bytes(32, 1), coin: bytes(32, 2) }, 65],
    [{ t: 'coin', nonce: bytes(16) }, 17],
    [{ t: 'fire', cells: [42] }, 2],
    [{ t: 'fire', cells: [0, 1, 2, 3, 99] }, 6],
    [{ t: 'answer', entries: [{ cell: 42, code: 0 }] }, 3],
    [{ t: 'answer', entries: [{ cell: 42, code: 4, ship: { anchor: 40, vertical: false } }] }, 4],
    [{ t: 'answer', entries: [] }, 1],
    [{ t: 'answer', entries: [{ cell: 1, code: 1 }, { cell: 11, code: 6, ship: { anchor: 1, vertical: true } }, { cell: 2, code: 0 }] }, 8],
    [{ t: 'use', item: 3, a: 5, b: 1 }, 4],
    [{ t: 'sonar', count: 9 }, 2],
    [{ t: 'reveal', salt: bytes(16), fleet: FLEET_B }, 22],
    [{ t: 'verdict', ok: true }, 2],
    [{ t: 'verdict', ok: false }, 2],
    [{ t: 'rematch' }, 1],
    [{ t: 'rematch', config: { mode: 0, extraShot: true, noTouch: false, timer: 15 } }, 4],
    [{ t: 'bye' }, 1],
    [{ t: 'ping' }, 1],
    [{ t: 'pong' }, 1],
  ];
  it.each(msgs)('round-trips %j with exact length', (m, len) => {
    const u = encode(m);
    expect(u.length).toBe(len);
    expect(decode(u)).toEqual(m);
  });
  it('rejects malformed frames', () => {
    const bad = [
      [],
      [0x99],
      [0x01, 1],
      [0x01, 1, 2],
      [0x02, 3, 0, 0],
      [0x03, 1, 2],
      [0x10],
      [0x10, 100],
      [0x10, 1, 2, 3, 4, 5, 6],
      [0x11, 5],
      [0x11, 5, 7],
      [0x11, 5, 2],
      [0x11, 5, 2, 120],
      [0x12, 4, 0, 0],
      [0x13, 10],
      [0x20, 1, 2],
      [0x21, 2],
      [0x30, 1],
      [0x31, 0],
      [0x32, 0],
      [0x33, 1],
      new Array(66).fill(0x11),
    ];
    for (const b of bad) expect(decode(Uint8Array.from(b)), JSON.stringify(b)).toBeNull();
  });
});
