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
type Pipe = Transport & { deliver(u8: Uint8Array): void };

export const STUN: RTCIceServer[] = ['stun.l.google.com:19302', 'stun1.l.google.com:19302', 'stun.cloudflare.com:3478'].map((u) => ({ urls: 'stun:' + u }));

/** Negotiated channel shared by Trystero and direct paths: label 'g', id 512. */
export const gameChannel = (pc: RTCPeerConnection): RTCDataChannel => {
  const dc = pc.createDataChannel('g', { negotiated: true, id: 512 });
  dc.binaryType = 'arraybuffer';
  return dc;
};

/** Messages arriving before onmessage is set are kept in an inbox. */
function pipe(sendRaw: (u8: Uint8Array) => void, closeRaw: () => void): Pipe {
  const inbox: Uint8Array[] = [];
  let f: ((u8: Uint8Array) => void) | null = null;
  let done = false;
  const t: Pipe = {
    send: (u8) => done || sendRaw(u8),
    get onmessage() {
      return f;
    },
    set onmessage(g) {
      f = g;
      while (g && inbox.length) g(inbox.shift()!);
    },
    onclose: null,
    close: () => {
      if (!done) (done = true), closeRaw();
    },
    end: (reason) => {
      if (!done) t.close(), t.onclose?.(reason);
    },
    deliver: (u8) => done || (f ? f(u8) : inbox.push(u8)),
  };
  return t;
}

/** Resolve with a Transport once the channel opens. */
export function fromChannel(dc: RTCDataChannel, pc: RTCPeerConnection, onClose?: () => void): Promise<Transport> {
  const t = pipe(
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
  dc.onmessage = (e) => t.deliver(new Uint8Array(e.data as ArrayBuffer));
  dc.onclose = () => t.end('closed');
  let disc = 0;
  pc.addEventListener('connectionstatechange', () => {
    const s = pc.connectionState;
    clearTimeout(disc);
    if (s === 'failed' || s === 'closed') t.end(s);
    else if (s === 'disconnected') disc = window.setTimeout(() => t.end(s), 8000);
  });
  return new Promise((res) => (dc.readyState === 'open' ? res(t) : (dc.onopen = () => res(t))));
}

/** Two connected in-memory transports (tests). */
export function memoryPair(): [Transport, Transport] {
  const link = (other: () => Pipe) =>
    pipe(
      (u8) => setTimeout(() => other().deliver(u8.slice())),
      () => setTimeout(() => other().end('closed')),
    );
  const a: Pipe = link(() => b);
  const b: Pipe = link(() => a);
  return [a, b];
}
