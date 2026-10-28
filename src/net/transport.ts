/** A reliable ordered byte pipe to the opponent. */
export interface Transport {
  send(u8: Uint8Array): void;
  onmessage: ((u8: Uint8Array) => void) | null;
  onclose: ((reason: string) => void) | null;
  /** Close locally. Does not call onclose. */
  close(): void;
  /** Signal that the link is gone (calls onclose once). */
  end(reason: string): void;
}

export const STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Negotiated channel shared by Trystero and direct paths: label 'g', id 512. */
export const gameChannel = (pc: RTCPeerConnection): RTCDataChannel => {
  const dc = pc.createDataChannel('g', { negotiated: true, id: 512 });
  dc.binaryType = 'arraybuffer';
  return dc;
};

/** Base transport with an inbox so messages arriving before onmessage is set are kept. */
function base(sendRaw: (u8: Uint8Array) => void, closeRaw: () => void): Transport {
  const inbox: Uint8Array[] = [];
  let onmessage: ((u8: Uint8Array) => void) | null = null;
  let done = false;
  const t: Transport = {
    send: (u8) => {
      if (!done) sendRaw(u8);
    },
    get onmessage() {
      return onmessage;
    },
    set onmessage(f) {
      onmessage = f;
      if (f) while (inbox.length) f(inbox.shift()!);
    },
    onclose: null,
    close: () => {
      if (done) return;
      done = true;
      closeRaw();
    },
    end: (reason) => {
      if (done) return;
      done = true;
      closeRaw();
      t.onclose?.(reason);
    },
  };
  (t as Transport & { _deliver: (u8: Uint8Array) => void })._deliver = (u8) => {
    if (done) return;
    if (onmessage) onmessage(u8);
    else inbox.push(u8);
  };
  return t;
}
const deliver = (t: Transport, u8: Uint8Array) => (t as unknown as { _deliver: (u8: Uint8Array) => void })._deliver(u8);

/** Resolve with a Transport once the channel opens. */
export function fromChannel(dc: RTCDataChannel, pc: RTCPeerConnection, onClose?: () => void): Promise<Transport> {
  const t = base(
    (u8) => {
      try {
        dc.send(u8 as Uint8Array<ArrayBuffer>);
      } catch {
        t.end('send failed');
      }
    },
    () => {
      try {
        dc.close();
      } catch {
        /* already closed */
      }
      onClose?.();
    },
  );
  dc.onmessage = (e) => deliver(t, new Uint8Array(e.data as ArrayBuffer));
  dc.onclose = () => t.end('closed');
  let discTimer = 0;
  pc.addEventListener('connectionstatechange', () => {
    const s = pc.connectionState;
    clearTimeout(discTimer);
    if (s === 'failed' || s === 'closed') t.end(s);
    else if (s === 'disconnected') discTimer = window.setTimeout(() => t.end('disconnected'), 8000);
  });
  return new Promise((res) => {
    if (dc.readyState === 'open') res(t);
    else dc.addEventListener('open', () => res(t), { once: true });
  });
}

/** Two connected in-memory transports (tests). */
export function memoryPair(): [Transport, Transport] {
  let a: Transport;
  let b: Transport;
  a = base(
    (u8) => setTimeout(() => deliver(b, u8.slice()), 0),
    () => setTimeout(() => b.end('closed'), 0),
  );
  b = base(
    (u8) => setTimeout(() => deliver(a, u8.slice()), 0),
    () => setTimeout(() => a.end('closed'), 0),
  );
  return [a, b];
}
