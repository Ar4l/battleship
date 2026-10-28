/**
 * Pack a non-trickle data-channel SDP into a short base64url blob and back.
 *
 * byte 0      : version(4 bits)=1 | kind(4 bits) 0=offer 1=answer
 * ufrag       : len u8 + ASCII
 * pwd         : len u8 + ASCII
 * fingerprint : 32 raw bytes (sha-256)
 * candidates* : type u8 (0 host-v4 | 1 srflx-v4 | 2 mDNS-uuid) + addr (4 | 16 bytes) + port u16 BE
 */
export type SdpKind = 'offer' | 'answer';
const VERSION = 1;
const MAX_CANDS = 4;

export const b64u = (u8: Uint8Array): string =>
  btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function unb64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const hex2 = (x: number): string => x.toString(16).padStart(2, '0');

export function packSdp(sdp: string, kind: SdpKind): string | null {
  const g = (re: RegExp): string | undefined => re.exec(sdp)?.[1];
  const ufrag = g(/a=ice-ufrag:(\S+)/);
  const pwd = g(/a=ice-pwd:(\S+)/);
  const fpStr = g(/a=fingerprint:sha-256 (\S+)/i);
  if (!ufrag || !pwd || !fpStr || ufrag.length > 255 || pwd.length > 255) return null;
  const fp = fpStr.split(':').map((h) => parseInt(h, 16));
  if (fp.length !== 32 || fp.some((x) => !(x >= 0 && x <= 255))) return null;
  const out: number[] = [(VERSION << 4) | (kind === 'offer' ? 0 : 1)];
  const str = (s: string) => {
    out.push(s.length);
    for (const c of s) out.push(c.charCodeAt(0) & 255);
  };
  str(ufrag);
  str(pwd);
  out.push(...fp);
  const srflx: number[][] = [];
  const host: number[][] = [];
  const seen = new Set<string>();
  for (const [, addr, port, typ] of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx)/gi)) {
    const p = +port!;
    const key = addr + ':' + p;
    if (seen.has(key)) continue;
    seen.add(key);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(addr!)) {
      (typ === 'srflx' ? srflx : host).push([typ === 'srflx' ? 1 : 0, ...addr!.split('.').map(Number), p >> 8, p & 255]);
    } else if (/^[0-9a-f-]{36}\.local$/i.test(addr!)) {
      const bytes = addr!.slice(0, 36).replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16));
      host.push([2, ...bytes, p >> 8, p & 255]);
    } // IPv6, TCP and relay are dropped to keep links short
  }
  for (const c of [...srflx, ...host].slice(0, MAX_CANDS)) out.push(...c);
  return b64u(Uint8Array.from(out));
}

export function unpackSdp(code: string): RTCSessionDescriptionInit | null {
  const b = unb64u(code.trim());
  if (!b || b.length < 3) return null;
  if (b[0]! >> 4 !== VERSION || (b[0]! & 15) > 1) return null;
  const type: SdpKind = (b[0]! & 15) === 0 ? 'offer' : 'answer';
  let i = 1;
  const str = (): string | null => {
    const n = b[i++];
    if (n === undefined || n === 0 || i + n > b.length) return null;
    const s = String.fromCharCode(...b.slice(i, i + n));
    i += n;
    return /^[\x21-\x7e]+$/.test(s) ? s : null;
  };
  const ufrag = str();
  const pwd = str();
  if (!ufrag || !pwd || i + 32 > b.length) return null;
  const fp = [...b.slice(i, i + 32)].map((x) => hex2(x).toUpperCase()).join(':');
  i += 32;
  const cands: string[] = [];
  let k = 1;
  while (i < b.length) {
    const t = b[i++]!;
    let addr: string;
    if (t === 2) {
      if (i + 18 > b.length) return null;
      const h = [...b.slice(i, i + 16)].map(hex2).join('');
      i += 16;
      addr = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
    } else if (t <= 1) {
      if (i + 6 > b.length) return null;
      addr = [...b.slice(i, i + 4)].join('.');
      i += 4;
    } else return null;
    const port = (b[i]! << 8) | b[i + 1]!;
    i += 2;
    const typ = t === 1 ? 'srflx raddr 0.0.0.0 rport 0' : 'host';
    cands.push(`a=candidate:${k} 1 udp ${2130706431 - k} ${addr} ${port} typ ${typ}`);
    k++;
  }
  const sdp = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...cands,
    'a=end-of-candidates',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
  return { type, sdp };
}
