import { describe, expect, it } from 'vitest';
import { packSdp, unpackSdp } from '../../src/proto/sdp';

const CHROMIUM =
  'v=0\r\no=- 5394109753215148540 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 35328 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 35.195.235.219\r\na=candidate:2292655051 1 udp 2113937151 eb8de1e7-0b54-41c0-8ef5-d39dc687683a.local 37718 typ host generation 0 network-cost 999\r\na=candidate:2517700060 1 udp 1677729535 35.195.235.219 35328 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999\r\na=ice-ufrag:fJHO\r\na=ice-pwd:APyu2HGCJ458w20K59gIVPb0\r\na=ice-options:trickle\r\na=fingerprint:sha-256 1E:C1:A3:3C:18:52:42:3B:0F:FD:37:24:1E:BB:9C:96:49:E8:D5:1D:64:6D:16:E3:51:C3:E3:FB:3C:E3:CD:40\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n';

const FIREFOX = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 7140843432375291023 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 51234 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.7',
  'a=candidate:0 1 UDP 2122252543 192.168.1.23 51234 typ host',
  'a=candidate:1 1 UDP 2122187007 2001:db8::1 51235 typ host',
  'a=candidate:2 1 TCP 2105524479 192.168.1.23 9 typ host tcptype active',
  'a=candidate:3 1 UDP 1685987327 203.0.113.7 51234 typ srflx raddr 192.168.1.23 rport 51234',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:3c4f5e6d7a8b9c0d1e2f3a4b5c6d7e8f',
  'a=ice-ufrag:ab12cd34',
  'a=mid:0',
  'a=setup:active',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
  '',
].join('\r\n');

const SAFARI = [
  'v=0',
  'o=- 1234567890 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.local 60001 typ host generation 0',
  'a=candidate:2 1 udp 2113939711 6a7b8c9d-0e1f-2a3b-4c5d-6e7f8a9b0c1d.local 60002 typ host generation 0',
  'a=candidate:3 1 udp 1677729535 198.51.100.4 60001 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=candidate:4 1 udp 1677729535 198.51.100.5 60003 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=candidate:5 1 udp 1677729535 198.51.100.6 60004 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=ice-ufrag:Zq9x',
  'a=ice-pwd:k2Pq8w0Vb3nM5tY7uR1eL4oH',
  'a=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\r\n');

const cands = (sdp: string) => [...sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (\w+)/gi)].map((m) => `${m[3]} ${m[1]}:${m[2]}`);

describe('sdp pack/unpack', () => {
  it.each([
    ['chromium', CHROMIUM, 'offer' as const],
    ['firefox', FIREFOX, 'answer' as const],
    ['safari', SAFARI, 'offer' as const],
  ])('%s round-trips ufrag, pwd, fingerprint and candidates', (_, sdp, kind) => {
    const code = packSdp(sdp, kind)!;
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThanOrEqual(140);
    const out = unpackSdp(code)!;
    expect(out.type).toBe(kind);
    const s = out.sdp!;
    expect(s).toContain('a=ice-ufrag:' + /a=ice-ufrag:(\S+)/.exec(sdp)![1]);
    expect(s).toContain('a=ice-pwd:' + /a=ice-pwd:(\S+)/.exec(sdp)![1]);
    expect(s).toContain('a=fingerprint:sha-256 ' + /a=fingerprint:sha-256 (\S+)/.exec(sdp)![1]);
    expect(s).toContain(kind === 'offer' ? 'a=setup:actpass' : 'a=setup:active');
    const kept = cands(s);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(4);
    for (const c of kept) expect(cands(sdp)).toContain(c);
    // srflx come first
    expect(kept[0]!.startsWith('srflx')).toBe(true);
  });
  it('drops IPv6 and TCP candidates', () => {
    const s = unpackSdp(packSdp(FIREFOX, 'answer')!)!.sdp!;
    expect(s).not.toContain('2001:db8');
    expect(cands(s)).toEqual(['srflx 203.0.113.7:51234', 'host 192.168.1.23:51234']);
  });
  it('chromium blob is about 118 chars or less', () => {
    expect(packSdp(CHROMIUM, 'offer')!.length).toBeLessThanOrEqual(120);
  });
  it('bad or truncated input returns null', () => {
    const code = packSdp(CHROMIUM, 'offer')!;
    expect(unpackSdp('')).toBeNull();
    expect(unpackSdp('!!!')).toBeNull();
    expect(unpackSdp(code.slice(0, 20))).toBeNull();
    expect(unpackSdp(code.slice(0, code.length - 3))).toBeNull();
    expect(unpackSdp('A' + code.slice(1))).toBeNull(); // wrong version
    expect(packSdp('v=0\r\n', 'offer')).toBeNull();
  });
});
