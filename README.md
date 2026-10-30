# Battleship

Two-player Battleship that runs peer-to-peer in the browser. There is no server: a static page on GitHub Pages (`https://aral.cc/battleship/`) and a WebRTC data channel between the two players.

## Play

- **Create game** gives a 4-digit code and a link (`aral.cc/battleship/#4821`). Your friend opens the link or types the code.
- If matchmaking can't connect, use **Use a direct link**: send the link, your friend sends a reply link back, paste it, connect.
- Rules are independent settings. **Fleet:** Standard or **Russian** (Морской бой: 1×4, 2×3, 3×2, 4×1 on 10×10, no touching; a hit shoots again with one-shot turns). **Turns:** One shot, **Salvo** (one shot per ship you have left, at most 5) or **Simultaneous** salvo (both players pick at once; a round where both fleets sink is a draw). **Items** (one-shot turns only): Sonar, Torpedo, Cross bomb, Line strike and a scattering Airstrike, paid with energy or collected from item squares on the board (Pickups); an item can be queued during the opponent's turn. Board sizes 8×8 to 14×14; Large and Huge have islands. Options: extra shot after a hit, ships can't touch, turn timer. Prefire: queue up to 5 shots during the opponent's turn; they fire in order on your turns.
- **Stats** (a link on home) are kept on each device only: games, wins, losses, draws, win rate, streaks, accuracy and a head-to-head record per friend. Each device has a random player id and an optional name (“Your name” on home), sent once when the game connects. A rematch shows the series score (“You 3 – 2 Sam”).
- Fair play: each player commits to `SHA-256(salt, fleet, rules)` before the game and reveals at the end. Every answer the opponent gave is replayed against the revealed fleet; a lie is reported with the cell it happened on.

## Develop

```sh
npm ci
npm run dev        # Vite dev server
npm test           # unit tests (vitest)
npm run build      # dist/ with base /battleship/
npm run size       # gzip size table and budget check
npm run e2e        # Playwright: builds, serves dist-e2e on :4174, plays full games
npm run check      # everything above
```

The Trystero e2e spec (`@net`) skips itself when no WebTorrent tracker is reachable. Set `NET=0` to exclude it.

`e2e/mobile.spec.ts` plays whole games with touch taps on emulated phones (iPhone 13, Pixel 7, both in landscape) in Chromium. On Linux it also freezes one player's whole browser with SIGSTOP for 20 s mid-battle (how iOS suspends a page in another app) while the other fires, and checks the game carries on. `WEBKIT=1` adds a `webkit` project for Safari's engine (`e2e/webkit.spec.ts`; needs `npx playwright install --with-deps webkit`). Two WebKit pages can't reach each other over WebRTC on Linux (mDNS-only host candidates), so it tests single pages there and plays one game with a Chromium host, which CI skips.

## Layout

- `src/game/` rules, items, engine, commit-reveal and verification. Pure, no DOM.
- `src/proto/` binary wire codec (a shot is 2 bytes) and SDP packing for direct links.
- `src/net/` Trystero room with a room lock, the direct-link fallback and tab forwarding.
- `src/app/controller.ts` the state machine joining game, network and UI. `src/app/stats.ts` the stats log in `localStorage`.
- `src/ui/` vanilla DOM screens, the board component, WebAudio sound.

## Networking choice

Signalling uses Trystero's **torrent** strategy (`@trystero-p2p/torrent@0.26.0`, the package that `trystero/torrent` now points to). It is about 4.5 KB gzipped smaller than the Nostr strategy (no secp256k1), and matched peers roughly twice as fast in testing (about 340 ms against 650 ms). The default tracker list includes a dead tracker, so the app passes the four live ones. The game itself runs on a separate negotiated data channel (`id 512`), which the direct-link fallback uses too.

- **Joining.** Each side creates channel 512 on its own schedule, and a message sent before the other side has created it is dropped. Both sides repeat HELLO every 250 ms until they hear anything, and the guest answers every HELLO. If no game starts within 6 s of the channel opening, the player sees the "Couldn't connect" notice and the room is released.
- **Trackers go quiet after connecting.** The guest closes every tracker socket and pauses reconnects. Trystero's own `online` handler is off (`manualReconnection`), so a network blip mid-game doesn't reopen them; in the lobby the app pauses and resumes reconnects on `offline`/`online` itself. The host keeps one socket so a third player still gets "room full". If that one socket drops during the match it is not reopened (reconnects are paused), so a third player then sees "Still looking for game …" instead of "room full". The game itself is not affected. Measured over 90 s of an idle battle: the guest sends and receives nothing; the host sends about 2.4 KB and receives 0.2 KB (about 100 KB an hour). Before this change it was 10 to 16 KB per player in the same 90 s.
- **Drop-outs of a minute or so.** A phone that switches to another app stops answering. Chromium reports the connection `disconnected` about 5 s later and `failed` about 16 s later, but neither is final: ICE recovers within half a second of the phone coming back, and the data channel delivers anything sent meanwhile. So the game only ends on `closed` or after 90 s without recovery (`GRACE` in `transport.ts`); the build patches Trystero so it no longer closes the peer on `failed` and waits 100 s after `disconnected`. e2e: a direct-link opponent frozen with SIGSTOP for 20 s while the other player fires, and a code-game guest frozen for 45 s. Meanwhile the header says "Connection lost. Waiting…" in place of the brand, so the board doesn't move. A page that comes back after 10 s or more checks the link with a 1-byte PING (6 s to answer), and if the link died it says "Connection lost while Battleship was in the background" rather than claiming a forfeit win. A screen wake lock keeps the phone from locking during a game; outside placement and battle it is let go after 5 minutes without a tap or game event.
- **Direct link from a phone.** The guest sends the reply from a messenger, so their browser is usually suspended when the host pastes it. The host waits 90 s and treats an early ICE failure as recoverable: ICE reconnects within a second of the guest coming back.
- **Trimmed Trystero.** `vite.config.ts` swaps three Trystero modules for small versions in `build/trystero/`, patches three more, and drops the unused room-password challenge (and fails the build on any other Trystero version): no media, no public actions, and a one-frame JSON wire for Trystero's internal messages. It also drops Trystero's stream and track plumbing. This takes the Trystero chunk from 22.0 KB to 15.0 KB gzipped. Both peers must run this build. See `build/trystero/README.md`, and re-check it when upgrading Trystero.

## Size

`npm run size` gzips (level 9) every file in `dist/` and fails over budget. The hard budget is 44.5 KB for a code game; the per-file budgets are guard rails. Current numbers (they move by a few hundred bytes between changes; run the script for exact values):

| What | gzip |
|---|---|
| `index.html` with inlined CSS | 5.9 KB |
| app entry (game, UI, Trystero room code) | 23.5 KB |
| Trystero chunk, loaded on intent (Create focus/hover, code field focus, `#NNNN` link) | 15.0 KB |
| **Code game: everything downloaded** | **44.4 KB** (budget 44.5) |
| Direct-link game instead | 33.4 KB |
| First load before any click | 29.4 KB |
