/** Forward a guest's #a= answer from a new tab to the host's game tab. */
const NAME = 'battleship';

export function listenForAnswers(onBlob: (blob: string) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const bc = new BroadcastChannel(NAME);
  bc.onmessage = (e) => {
    const d = e.data as { t?: string; blob?: string };
    if (d?.t === 'a' && typeof d.blob === 'string') {
      bc.postMessage({ t: 'ack' });
      onBlob(d.blob);
    }
  };
  return () => bc.close();
}

/** Resolves true if a game tab acknowledged within 600 ms. */
export function forwardAnswer(blob: string, waitMs = 600): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(false);
  const bc = new BroadcastChannel(NAME);
  return new Promise((res) => {
    const t = setTimeout(() => {
      bc.close();
      res(false);
    }, waitMs);
    bc.onmessage = (e) => {
      if ((e.data as { t?: string })?.t === 'ack') {
        clearTimeout(t);
        bc.close();
        res(true);
      }
    };
    bc.postMessage({ t: 'a', blob });
  });
}
