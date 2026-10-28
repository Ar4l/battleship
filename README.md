# Battleship

Two-player Battleship that runs peer-to-peer in the browser. There is no server: a static page on GitHub Pages (`https://aral.cc/battleship/`) and a WebRTC data channel between the two players.

## Play

- **Create game** gives a 4-digit code and a link (`aral.cc/battleship/#4821`). Your friend opens the link or types the code.
- If matchmaking can't connect, use **Use a direct link**: send the link, your friend sends a reply link back, paste it, connect.
- Modes: **Classic** (optional extra shot after a hit), **Salvo** (one shot per ship you have left) and **Items** (energy for Sonar, Torpedo, Cross bomb and Line strike). Options: ships can't touch, turn timer.
- Fair play: each player commits to `SHA-256(salt, fleet, rules)` before the game and reveals at the end. Every answer the opponent gave is replayed against the revealed fleet; a lie is reported with the cell it happened on.

## Develop

```sh
npm ci
npm run dev        # Vite dev server
npm test           # unit tests (vitest)
npm run build      # dist/ with base /battleship/
npm run size       # gzip size table and budget check
npm run e2e        # Playwright: builds, serves on :4173, plays full games
npm run check      # everything above
```

The Trystero e2e spec (`@net`) skips itself when no WebTorrent tracker is reachable. Set `NET=0` to exclude it.

## Layout

- `src/game/` rules, items, engine, commit-reveal and verification. Pure, no DOM.
- `src/proto/` binary wire codec (a shot is 2 bytes) and SDP packing for direct links.
- `src/net/` Trystero room with a room lock, the direct-link fallback and tab forwarding.
- `src/app/controller.ts` the state machine joining game, network and UI.
- `src/ui/` vanilla DOM screens, the board component, WebAudio sound.

## Networking choice

Signalling uses Trystero's **torrent** strategy (`@trystero-p2p/torrent@0.26.0`, the package that `trystero/torrent` now points to). It is about 4.5 KB gzipped smaller than the Nostr strategy (no secp256k1), and matched peers roughly twice as fast in testing (about 340 ms against 650 ms). The default tracker list includes a dead tracker, so the app passes the four live ones. The game itself runs on a separate negotiated data channel (`id 512`), which the direct-link fallback uses too.
