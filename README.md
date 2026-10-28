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

- **Joining.** Each side creates channel 512 on its own schedule, and a message sent before the other side has created it is dropped. Both sides repeat HELLO every 250 ms until they hear anything, and the guest answers every HELLO. If no game starts within 6 s of the channel opening, the player sees the "Couldn't connect" notice and the room is released.
- **Trackers go quiet after connecting.** The guest closes every tracker socket and pauses reconnects. The host keeps one socket so a third player still gets "room full". Measured over 90 s of an idle battle: the guest sends and receives nothing; the host sends about 2.4 KB and receives 0.2 KB (about 100 KB an hour). Before this change it was 10 to 16 KB per player in the same 90 s.
- **Trimmed Trystero.** `vite.config.ts` swaps three Trystero modules for small versions in `build/trystero/` and drops the unused room-password challenge: no media, no public actions, and a one-frame JSON wire for Trystero's internal messages. This takes the Trystero chunk from 22.0 KB to 15.6 KB gzipped. Both peers must run this build. See `build/trystero/README.md`, and re-check it when upgrading Trystero.

## Size

`npm run size` gzips (level 9) every file in `dist/` and fails over budget. Current numbers:

| What | gzip |
|---|---|
| `index.html` with inlined CSS | 5.0 KB |
| app entry (game, UI, Trystero room code) | 18.6 KB |
| Trystero chunk, loaded on intent (Create focus/hover, first code digit, `#NNNN` link) | 15.6 KB |
| **Code game: everything downloaded** | **39.2 KB** (budget 40) |
| Direct-link game instead | 27.5 KB |
| First load before any click | 23.6 KB |
