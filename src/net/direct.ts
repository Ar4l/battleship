import { packSdp, unpackSdp } from '../proto/sdp';
import { STUN, fromChannel, gameChannel, type Transport } from './transport';

export class DirectError extends Error {}

/** Resolve when gathering completes, 250 ms after the first srflx, or after 3.5 s. */
export function gather(pc: RTCPeerConnection, capMs = 3500): Promise<void> {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    let settle = 0;
    const cap = setTimeout(res, capMs);
    const done = () => {
      clearTimeout(cap);
      clearTimeout(settle);
      res();
    };
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && done());
    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate) return done();
      if (/ typ srflx/.test(e.candidate.candidate) && !settle) settle = window.setTimeout(done, 250);
    });
  });
}

/** Debug hook: swap candidates for an unreachable address. */
export const testHooks = { unreachable: false };
const mangle = (sdp: string) =>
  testHooks.unreachable ? sdp.replace(/a=candidate:.*\r\n/g, '') + 'a=candidate:1 1 udp 2130706431 192.0.2.1 9 typ host\r\n' : sdp;

function openOrFail(pc: RTCPeerConnection, dc: RTCDataChannel): { open: Promise<Transport>; arm: (ms: number) => void } {
  let timer = 0;
  let reject!: (e: Error) => void;
  const open = new Promise<Transport>((res, rej) => {
    reject = rej;
    fromChannel(dc, pc, () => pc.close()).then((t) => {
      clearTimeout(timer);
      res(t);
    });
  });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') reject(new DirectError('failed'));
  });
  return {
    open,
    arm: (ms) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        reject(new DirectError('timeout'));
        pc.close();
      }, ms);
    },
  };
}

export interface DirectHost {
  blob: string;
  /** Apply the guest's answer (full #a= link or bare blob). Throws DirectError on malformed input. */
  accept(answer: string): Promise<void>;
  transport: Promise<Transport>;
  close(): void;
}

export const blobFrom = (s: string): string => {
  const m = /[#&]a=([A-Za-z0-9_-]+)/.exec(s) ?? /[#&]o=([A-Za-z0-9_-]+)/.exec(s);
  return (m ? m[1]! : s).trim();
};

export async function createDirectHost(): Promise<DirectHost> {
  const pc = new RTCPeerConnection({ iceServers: testHooks.unreachable ? [] : STUN });
  const dc = gameChannel(pc);
  const { open, arm } = openOrFail(pc, dc);
  open.catch(() => {});
  await pc.setLocalDescription(await pc.createOffer());
  await gather(pc);
  const blob = packSdp(mangle(pc.localDescription!.sdp), 'offer');
  if (!blob) throw new DirectError('pack');
  let accepted = false;
  return {
    blob,
    transport: open,
    close: () => pc.close(),
    async accept(answer) {
      if (accepted) return;
      const desc = unpackSdp(blobFrom(answer));
      if (!desc || desc.type !== 'answer') throw new DirectError('malformed');
      accepted = true;
      await pc.setRemoteDescription(desc);
      arm(15000);
    },
  };
}

export interface DirectGuest {
  blob: string;
  transport: Promise<Transport>;
  close(): void;
}

/** Returns null for a malformed offer. */
export async function createDirectGuest(offer: string): Promise<DirectGuest | null> {
  const desc = unpackSdp(blobFrom(offer));
  if (!desc || desc.type !== 'offer') return null;
  const pc = new RTCPeerConnection({ iceServers: testHooks.unreachable ? [] : STUN });
  const dc = gameChannel(pc);
  const { open, arm } = openOrFail(pc, dc);
  open.catch(() => {});
  arm(120000);
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'checking') arm(15000);
  });
  await pc.setRemoteDescription(desc);
  await pc.setLocalDescription(await pc.createAnswer());
  await gather(pc);
  const blob = packSdp(mangle(pc.localDescription!.sdp), 'answer');
  if (!blob) return null;
  return { blob, transport: open, close: () => pc.close() };
}
