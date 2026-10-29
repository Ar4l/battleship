import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRACE, fromChannel } from '../../src/net/transport';

/** Just enough of RTCPeerConnection and RTCDataChannel for fromChannel. */
function fakeLink() {
  const pc = Object.assign(new EventTarget(), { connectionState: 'connected' as RTCPeerConnectionState });
  const dc = { readyState: 'open', binaryType: 'arraybuffer', send() {}, close() {} } as unknown as RTCDataChannel;
  const to = (s: RTCPeerConnectionState) => {
    pc.connectionState = s;
    pc.dispatchEvent(new Event('connectionstatechange'));
  };
  return { pc: pc as unknown as RTCPeerConnection, dc, to };
}

describe('fromChannel: a phone in another app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const open = async () => {
    const l = fakeLink();
    const t = await fromChannel(l.dc, l.pc);
    const log: string[] = [];
    t.onstate = (up) => log.push(up ? 'up' : 'down');
    t.onclose = (r) => log.push('end ' + r);
    return { ...l, log };
  };

  it("'failed' on an open channel is not final: the link comes back", async () => {
    const { to, log } = await open();
    to('disconnected');
    to('failed');
    vi.advanceTimersByTime(GRACE - 1000);
    to('connected');
    vi.advanceTimersByTime(2 * GRACE);
    expect(log).toEqual(['down', 'down', 'up']);
  });

  it('the grace runs from the first drop, and ends the link if nothing comes back', async () => {
    const { to, log } = await open();
    to('disconnected');
    vi.advanceTimersByTime(10_000);
    to('failed');
    vi.advanceTimersByTime(GRACE - 10_001);
    expect(log).toEqual(['down', 'down']);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(['down', 'down', 'end disconnected']);
  });

  it("covers at least a minute away, and 'closed' ends the link at once", async () => {
    expect(GRACE).toBeGreaterThanOrEqual(60_000);
    const { to, log } = await open();
    to('closed');
    expect(log).toEqual(['end closed']);
  });
});
