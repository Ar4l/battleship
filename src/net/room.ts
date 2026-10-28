/**
 * All Trystero usage lives here. Trystero (torrent strategy) only does
 * matchmaking and SDP signalling; the game runs over our own negotiated
 * data channel on the peer connection it sets up.
 */
import { STUN, fromChannel, gameChannel, type Transport } from './transport';

export const APP_ID = 'aral.cc-battleship';
/** Live WebTorrent trackers (tracker.btorrent.xyz from the defaults is dead). */
const TRACKERS = ['open.ftorrent.com', 'tracker.webtorrent.dev', 'tracker.openwebtorrent.com', 'tracker.files.fm:7073/announce'].map((u) => 'wss://' + u);

type Trystero = typeof import('@trystero-p2p/torrent');
let lib: Promise<Trystero> | null = null;
/** Start downloading the Trystero chunk (idempotent). */
export const prefetch = (): Promise<Trystero> => (lib ??= import('@trystero-p2p/torrent'));

export interface RoomEvents {
  transport(t: Transport): void;
  /** Guest: host already has an opponent. */
  full(): void;
  /** ICE failed after signalling. */
  failed(): void;
  /** Host: no relay reachable after 6 s. */
  relaysDown(): void;
  /** Guest: no host found after 10 s. */
  slow(): void;
  /** Host: code re-rolled after a collision. */
  code(code: number): void;
}

export interface RoomHandle {
  leave(): void;
}

interface Hs {
  v: 1;
  r: 'h' | 'g';
  busy: boolean;
  t: number;
}

export const randomCode = (): number => 1000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 9000);

export function openRoom(role: 'host' | 'guest', code: number, ev: RoomEvents): RoomHandle {
  let left = false;
  let room: ReturnType<Trystero['joinRoom']> | null = null;
  let opponent: string | null = null;
  let reserved: string | null = null;
  let hostId: string | null = null;
  const idle = new Set<string>();
  const t0 = Date.now();
  const timers: number[] = [];

  const leaveRoom = () => {
    const r = room;
    room = null;
    r?.leave().catch(() => {});
  };

  const join = async (c: number) => {
    const T = await prefetch();
    if (left) return;
    const r = T.joinRoom(
      { appId: APP_ID, relayConfig: { urls: TRACKERS, warnOnRelayFailure: false }, rtcConfig: { iceServers: STUN } },
      'r' + c,
      {
        handshakeTimeoutMs: 10000,
        onJoinError: (e) => {
          if (!opponent && /after exchanging SDP/.test(e.error)) ev.failed();
        },
        onPeerHandshake: async (id, send, receive) => {
          const hello = (busy: boolean): Hs => ({ v: 1, r: role === 'host' ? 'h' : 'g', busy, t: t0 });
          if (role === 'host') {
            if (opponent || reserved) {
              await send(hello(true) as never);
              throw new Error('busy');
            }
            reserved = id;
            try {
              await send(hello(false) as never);
              const d = (await receive()).data as unknown as Hs;
              if (d?.r === 'g' && !d.busy) return;
              if (d?.r === 'h') {
                // Two hosts rolled the same code: the newer one re-rolls.
                if (t0 > d.t || (t0 === d.t && T.selfId > id)) setTimeout(reroll);
                throw new Error('collision');
              }
              throw new Error('bad handshake');
            } catch (err) {
              if (reserved === id) reserved = null;
              throw err;
            }
          }
          await send(hello(false) as never);
          const d = (await receive()).data as unknown as Hs;
          if (d?.r === 'h') {
            if (d.busy) {
              if (!opponent) {
                ev.full();
                left = true;
                setTimeout(leaveRoom);
              }
              throw new Error('full');
            }
            hostId = id;
            return;
          }
          // Another guest waiting on a code with no host yet: accept but stay idle,
          // rejecting would make both sides retry in a tight loop.
          if (d?.r === 'g') {
            idle.add(id);
            return;
          }
          throw new Error('bad handshake');
        },
      },
    );
    room = r;
    r.onPeerJoin = (id) => {
      if (opponent || (role === 'host' ? id !== reserved : id !== hostId)) return;
      opponent = id;
      const peers = r.getPeers();
      for (const i of idle) peers[i]?.close();
      const pc = peers[id];
      if (!pc) return;
      const dc = gameChannel(pc);
      fromChannel(dc, pc, () => {
        left = true;
        leaveRoom();
      }).then((t) => {
        transport = t;
        ev.transport(t);
      });
    };
    r.onPeerLeave = (id) => {
      if (id === opponent) transport?.end('left');
    };
  };

  let transport: Transport | null = null;
  const reroll = () => {
    if (left) return;
    leaveRoom();
    const c = randomCode();
    ev.code(c);
    void join(c);
  };

  void join(code).catch(() => ev.failed());

  if (role === 'host') {
    timers.push(
      window.setTimeout(async () => {
        if (left || opponent) return;
        const T = await prefetch();
        const socks = Object.values((T.getRelaySockets as () => Record<string, WebSocket>)() ?? {});
        if (!socks.some((s) => s.readyState === 1)) ev.relaysDown();
      }, 6000),
    );
  } else {
    timers.push(window.setTimeout(() => !left && !hostId && ev.slow(), 10000));
  }

  return {
    leave() {
      left = true;
      timers.forEach(clearTimeout);
      transport?.close();
      leaveRoom();
    },
  };
}
