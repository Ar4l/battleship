# Trystero trims

`vite.config.ts` loads these files in place of modules of `@trystero-p2p/core@0.26.0`
(pinned exactly in package.json). They remove code this game never runs: the Trystero chunk goes
from 22.0 KB to 15.0 KB gzipped. Relative imports resolve against the original module's folder.

- `media.mjs`: the game sends no audio or video. Every media method is a no-op.
- `actions.mjs`: no public `room.makeAction` (the game talks over its own data channel).
- `action-wire.mjs`: Trystero's internal actions (handshake, SDP renegotiation, leave, ping)
  as one small JSON frame each. The original adds chunking, binary payloads, progress and
  backpressure for large transfers, which these few-hundred-byte messages never need.
- `handshake.mjs` is patched in place (a `transform` in vite.config.ts): no room password is
  set, so the password challenge reduces to our own handshake. The build fails if the
  patched text is not found.
- `peer.mjs` is patched in place too. It no longer closes the peer on connection or ICE state
  `failed` (only on `closed`), and `disconnectedCloseDelayMs` goes from 5 s to 100 s: a phone
  that comes back from another app recovers from both states on its own, and the game's own
  90 s grace (`GRACE` in src/net/transport.ts) decides when to give up. The track handler, the
  pending-track flush and the per-peer media methods go too.
- `room.mjs` is patched in place: no remote stream/track handlers and no public media methods
  (`addStream`, `addTrack`, `onPeerStream`, …).
- `shared-peer.mjs` is patched in place as well: the per-room stream and track ownership
  (`addStream`, `addTrack`, `replaceTrack` and their release helpers) goes, because only the
  stubbed media manager would call it.
- The build also fails unless `@trystero-p2p/core` is exactly 0.26.0, so an upgrade can't
  silently pair new modules with these stale copies.

Both peers must run this build: the frame format differs from stock Trystero, so a stock
client with the same appId fails the handshake (it looks like "no host found").
Re-check these files when upgrading Trystero.
