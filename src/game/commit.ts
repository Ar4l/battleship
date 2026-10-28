import { encodeFleet } from './board';
import type { Fleet } from './types';

const sha256 = async (tag: string, ...parts: ArrayLike<number>[]): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from([...new TextEncoder().encode(tag), ...parts.flatMap((p) => Array.from(p))])));

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** SHA-256("bs1/board" || salt || fleet5 || flags) */
export const commitBoard = (salt: Uint8Array, fleet: Fleet, flags: number): Promise<Uint8Array> => sha256('bs1/board', salt, encodeFleet(fleet), [flags]);

/** SHA-256("bs1/coin" || nonce) */
export const commitCoin = (nonce: Uint8Array): Promise<Uint8Array> => sha256('bs1/coin', nonce);

/** Even XOR of the first bytes: the host starts. */
export const hostStarts = (nonceHost: Uint8Array, nonceGuest: Uint8Array): boolean => !((nonceHost[0]! ^ nonceGuest[0]!) & 1);

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
