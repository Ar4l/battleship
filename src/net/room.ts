/**
 * All Trystero usage lives here. Trystero (torrent strategy) only does
 * matchmaking and SDP signalling; the game runs over our own negotiated
 * data channel on the peer connection it sets up.
 */
import { STUN, fromChannel, gameChannel, type Transport } from './transport';

const APP_ID = 'aral.cc-battleship';
/** Live WebTorrent trackers (tracker.btorrent.xyz from the defaults is dead). */
const TRACKERS = ['open.ftorrent.com', 'tracker.webtorrent.dev', 'tracker.openwebtorrent.com', 'tracker.files.fm:7073/announce'].map((u) => 'wss://' + u);

type Trystero = typeof import('@trystero-p2p/torrent');
let lib: Promise<Trystero> | null = null;
/** Start downloading the Trystero chunk (idempotent). */
export const prefetch = (): Promise<Trystero> => (lib ??= import('@trystero-p2p/torrent'));
const sockets = (T: Trystero): WebSocket[] => Object.values((T.getRelaySockets as () => Record<string, WebSocket>)());

/** Only the events that apply to the role are fired. */
export interface RoomEvents {
  transport(t: Transport): void;
  /** Guest: host already has an opponent. */
  full(): void;
  /** ICE failed after signalling. */
  failed(): void;
  /** Host: no relay reachable after 6 s (true), or one is back (false). */
  relaysDown(down: boolean): void;
  /** Guest: no host found after 10 s. */
  slow(): void;
  /** Host: code re-rolled after a collision. */
  code(code: number): void;
}

interface Hs {
  r: 'h' | 'g';
  busy: boolean;
  t: number;
}

export const randomCode = (): number => 1000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 9000);

export function openRoom(role: 'host' | 'guest', code: number, ev: RoomEvents): { leave(): void } {
  const host = role === 'host';
  let left = false;
  let room: ReturnType<Trystero['joinRoom']> | null = null;
  let opponent: string | null = null;
  let reserved: string | null = null;
  let hostId: string | null = null;
  let transport: Transport | null = null;
  const idle = new Set<string>();
  const t0 = Date.now();
  /** When the page last went to the background, and when the current room was joined. */
  let hid = 0;
  let at = 0;

  const leaveRoom = () => {
    room?.leave().catch(() => {});
    room = null;
  };
  /** A peer dropped out before our channel opened: unlock the room for the next one. */
  const forget = (id?: string) => {
    if (reserved === id) reserved = null;
    if (!transport && (opponent === id || hostId === id)) opponent = hostId = null;
  };

  const join = async (c: number) => {
    const T = await prefetch();
    if (left) return;
    at = Date.now();
    T.resumeRelayReconnection();
    const r = (room = T.joinRoom(
      // manualReconnection: Trystero would reopen every tracker socket on each 'online' event,
      // also mid-game, and announce for the rest of it. The lobby does that itself (below).
      { appId: APP_ID, relayConfig: { urls: TRACKERS, warnOnRelayFailure: false, manualReconnection: true }, rtcConfig: { iceServers: STUN } },
      'r' + c,
      {
        handshakeTimeoutMs: 10000,
        onJoinError: (e) => {
          forget(e.peerId);
          // ICE fails before the handshake, so the host can't tell its friend from a
          // stray peer: it stays in the lobby (the direct link is one tap away). A guest
          // that was in another app meanwhile has a stale handshake, not a blocked
          // network: it starts a fresh one, and fails only if that fails too.
          if (!host && !opponent && /after exchanging SDP/.test(e.error)) hid < at ? ev.failed() : restart();
        },
        onPeerHandshake: async (id, send, receive) => {
          const say = (busy: boolean) => send({ r: host ? 'h' : 'g', busy, t: t0 } as never);
          const hear = async () => (await receive()).data as unknown as Hs;
          if (host) {
            if (opponent || reserved) {
              await say(true);
              throw new Error('busy');
            }
            reserved = id;
            try {
              await say(false);
              const d = await hear();
              if (d?.r === 'g' && !d.busy) return;
              // Two hosts rolled the same code: the newer one re-rolls.
              if (d?.r === 'h' && (t0 > d.t || (t0 === d.t && T.selfId > id))) setTimeout(reroll);
              throw new Error('rejected');
            } catch (err) {
              forget(id);
              throw err;
            }
          }
          await say(false);
          const d = await hear();
          if (d?.r === 'h') {
            if (!d.busy) return void (hostId = id);
            if (!opponent) {
              left = true;
              ev.full();
              setTimeout(leaveRoom);
            }
            throw new Error('full');
          }
          // Another guest waiting on a code with no host yet: accept but stay idle,
          // rejecting would make both sides retry in a tight loop.
          if (d?.r === 'g') return void idle.add(id);
          throw new Error('bad handshake');
        },
      },
    ));
    r.onPeerJoin = (id) => {
      if (opponent || id !== (host ? reserved : hostId)) return;
      opponent = id;
      const peers = r.getPeers();
      for (const i of idle) peers[i]?.close();
      const pc = peers[id];
      if (!pc) return forget(id);
      void fromChannel(gameChannel(pc), pc, () => {
        left = true;
        leaveRoom();
      }).then((t) => {
        transport = t;
        // Stop tracker traffic: the guest needs no tracker now, the host keeps
        // one socket so a third player still hears "room full".
        T.pauseRelayReconnection();
        let keep = host;
        for (const s of sockets(T)) (keep && s.readyState === 1 ? (keep = false) : s.close());
        ev.transport(t);
      });
    };
    r.onPeerLeave = (id) => (transport && id === opponent ? transport.end('left') : forget(id));
  };

  const restart = () => {
    if (left || transport) return;
    leaveRoom();
    opponent = null;
    void join(code);
  };

  const reroll = () => {
    if (left) return;
    leaveRoom();
    const c = randomCode();
    ev.code(c);
    void join(c);
  };

  join(code).catch(() => ev.failed());

  // Until connected: hold tracker reconnects while offline or in another app (failed tries
  // there only grow Trystero's backoff, up to 60 s), retry at once when back.
  const net = () => left || transport || void prefetch().then((T) => (navigator.onLine && !document.hidden ? T.resumeRelayReconnection() : T.pauseRelayReconnection()));
  // The host answers an offer for 23 s. A guest away for longer (its offer went out just
  // before) comes back to a dead handshake that would fail 23 s later, and the next
  // announce is up to 2 min off: start a fresh one now.
  const vis = () => {
    if (document.hidden) hid = Date.now();
    else if (!host && !hostId && hid && Date.now() - hid > 24e3) restart();
    net();
  };
  addEventListener('online', net);
  addEventListener('offline', net);
  document.addEventListener('visibilitychange', vis);

  // The host re-checks while the relays look down, and clears the warning once one is back
  // (sockets that died while the phone was in another app reconnect a moment after it returns).
  let down = false;
  const check = async () => {
    if (left || opponent || hostId) return;
    if (!host) return ev.slow();
    const d = !sockets(await prefetch()).some((s) => s.readyState === 1);
    if (d !== down) ev.relaysDown((down = d));
    if (d) timer = setTimeout(check, 2000);
  };
  let timer = setTimeout(check, host ? 6000 : 10000);

  return {
    leave() {
      left = true;
      clearTimeout(timer);
      removeEventListener('online', net);
      removeEventListener('offline', net);
      document.removeEventListener('visibilitychange', vis);
      transport?.close();
      leaveRoom();
    },
  };
}
