# Trystero trims

`vite.config.ts` loads these files in place of modules of `@trystero-p2p/core@0.26.0`
(pinned exactly in package.json). They remove code this game never runs: the Trystero chunk goes
from 22.0 KB to 15.6 KB gzipped. Relative imports resolve against the original module's folder.

- `media.mjs`: the game sends no audio or video. Every media method is a no-op.
- `actions.mjs`: no public `room.makeAction` (the game talks over its own data channel).
- `action-wire.mjs`: Trystero's internal actions (handshake, SDP renegotiation, leave, ping)
  as one small JSON frame each. The original adds chunking, binary payloads, progress and
  backpressure for large transfers, which these few-hundred-byte messages never need.
- `handshake.mjs` is patched in place (a `transform` in vite.config.ts): no room password is
  set, so the password challenge reduces to our own handshake. The build fails if the
  patched text is not found.

Both peers must run this build: the frame format differs from stock Trystero, so a stock
client with the same appId fails the handshake (it looks like "no host found").
Re-check these files when upgrading Trystero.
