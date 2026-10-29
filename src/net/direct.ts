import type { Controller } from '../app/controller';
import { packSdp, unpackSdp } from '../proto/sdp';
import { forwardAnswer, listenForAnswers } from './forward';
import { STUN, fromChannel, gameChannel, type Transport } from './transport';

class DirectError extends Error {}

/** Resolve when gathering completes, 250 ms after the first srflx, or after 3.5 s. */
function gather(pc: RTCPeerConnection, capMs = 3500): Promise<void> {
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

/** `open` rejects only when the armed timer runs out; `onFail` hears ICE failures meanwhile. */
function openOrFail(pc: RTCPeerConnection, dc: RTCDataChannel, onFail?: () => void): { open: Promise<Transport>; arm: (ms: number) => void } {
  let timer = 0;
  let reject!: (e: Error) => void;
  const open = new Promise<Transport>((res, rej) => {
    reject = rej;
    fromChannel(dc, pc, () => pc.close()).then((t) => {
      clearTimeout(timer);
      res(t);
    });
  });
  pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && onFail?.());
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
  /** Called when ICE fails while waiting (it may still recover). */
  onFail: (() => void) | null;
  transport: Promise<Transport>;
  close(): void;
}

const blobFrom = (s: string): string => {
  const m = /[#&]a=([A-Za-z0-9_-]+)/.exec(s) ?? /[#&]o=([A-Za-z0-9_-]+)/.exec(s);
  return (m ? m[1]! : s).trim();
};

async function createDirectHost(): Promise<DirectHost> {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const dc = gameChannel(pc);
  const { open, arm } = openOrFail(pc, dc, () => h.onFail?.());
  open.catch(() => {});
  await pc.setLocalDescription(await pc.createOffer());
  await gather(pc);
  const blob = packSdp(pc.localDescription!.sdp, 'offer');
  if (!blob) throw new DirectError('pack');
  let accepted = false;
  const h: DirectHost = {
    blob,
    transport: open,
    onFail: null,
    close: () => pc.close(),
    async accept(answer) {
      if (accepted) return;
      const desc = unpackSdp(blobFrom(answer));
      if (!desc || desc.type !== 'answer') throw new DirectError('malformed');
      // Only lock once the answer is applied, so a bad paste can be corrected.
      await pc.setRemoteDescription(desc);
      accepted = true;
      // The guest may still be in the messenger they sent the reply from, with their
      // browser suspended until they come back.
      arm(90000);
    },
  };
  return h;
}

export interface DirectGuest {
  blob: string;
  transport: Promise<Transport>;
  close(): void;
}

/** Returns null for a malformed offer. */
async function createDirectGuest(offer: string): Promise<DirectGuest | null> {
  const desc = unpackSdp(blobFrom(offer));
  if (!desc || desc.type !== 'offer') return null;
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const dc = gameChannel(pc);
  const { open, arm } = openOrFail(pc, dc);
  open.catch(() => {});
  // The guest's ICE starts checking as soon as it has the offer (the host's agent
  // answers STUN before it has our answer), so there is no signal for "host pasted".
  // The reply travels by messenger, and ICE failures may recover (see fromChannel): wait long.
  arm(300000);
  await pc.setRemoteDescription(desc);
  await pc.setLocalDescription(await pc.createAnswer());
  await gather(pc);
  const blob = packSdp(pc.localDescription!.sdp, 'answer');
  if (!blob) return null;
  return { blob, transport: open, close: () => pc.close() };
}

// ---------- flows driven by the controller (this chunk loads on demand) ----------

/** Host: make the offer link, accept a reply pasted or forwarded from another tab. */
export async function host(c: Controller): Promise<void> {
  if (c.state.s !== 'direct-host') return;
  try {
    const h = await createDirectHost();
    if (c.state.s !== 'direct-host') return h.close();
    c.accept = (a) =>
      void h.accept(a).then(
        () => c.patch('direct-host', { connecting: 1, error: undefined }),
        () => c.patch('direct-host', { error: 'That link looks incomplete. Ask for it again.' }),
      );
    h.onFail = () => c.patch('direct-host', { connecting: 2 });
    c.closers.push(h.close, listenForAnswers((b) => c.accept?.(b)));
    c.set({ s: 'direct-host', blob: h.blob });
    c.link(h.transport);
  } catch {
    c.notice('failed');
  }
}

/** Guest: answer the offer from a #o= link. */
export async function guest(c: Controller, offer: string): Promise<void> {
  if (c.state.s !== 'direct-guest') return;
  try {
    const g = await createDirectGuest(offer);
    if (!g) return c.notice('bad-link');
    c.closers.push(g.close);
    c.set({ s: 'direct-guest', blob: g.blob });
    c.link(g.transport);
  } catch {
    c.notice('failed');
  }
}

/** A #a= reply opened in a new tab: hand it to the game tab, or show it for pasting. */
export async function forward(c: Controller, blob: string): Promise<void> {
  c.set({ s: 'forwarded', ok: await forwardAnswer(blob), blob });
}
