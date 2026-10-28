import { encodeFleet } from './board';
import type { Fleet } from './types';

const enc = new TextEncoder();

function concat(...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** SHA-256("bs1/board" || salt || fleet5 || flags) */
export const commitBoard = (salt: Uint8Array, fleet: Fleet, flags: number): Promise<Uint8Array> =>
  sha256(concat(enc.encode('bs1/board'), salt, encodeFleet(fleet), [flags]));

/** SHA-256("bs1/coin" || nonce) */
export const commitCoin = (nonce: Uint8Array): Promise<Uint8Array> => sha256(concat(enc.encode('bs1/coin'), nonce));

/** 0 means the host starts. */
export const hostStarts = (nonceHost: Uint8Array, nonceGuest: Uint8Array): boolean =>
  ((nonceHost[0]! ^ nonceGuest[0]!) & 1) === 0;

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
