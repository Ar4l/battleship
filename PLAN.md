# Battleship: implementation plan

This is a two-player online Battleship game. It is a static site built with vanilla TypeScript and Vite, and players connect peer-to-peer over WebRTC. It will be deployed later to `https://aral.cc/battleship/`, with Vite `base: '/battleship/'`. Project dir: `/home/aral/mellum-slack/battleship`.

Everything below has been decided. Where research offered alternatives, this plan names the choice and gives a one-line reason.

---

## 1. Key decisions

| Topic | Decision | Why |
|---|---|---|
| UI | Vanilla TS with a 20-line `h()` DOM helper. No framework. | Bundle size |
| Signaling | Trystero **Nostr** (`trystero@0.26.0`, pinned exactly), loaded lazily | Many independent relay operators, 5-way redundancy, and the README ranks it first. It costs 4.3 KB gz more than torrent, and one of torrent's default trackers is already dead. |
| Game transport | Our **own negotiated RTCDataChannel** (`label 'g'`, `negotiated: true`, `id: 512`), carrying binary frames | The same code path serves Trystero and the manual fallback. A shot is 2 bytes and skips Trystero's 36-byte header. |
| Fallback | Manual SDP exchanged through two links, using non-trickle ICE and a packed SDP blob (~118 chars) | Verified working in headless Chromium (`/tmp/sdp-test/page.js`) |
| ICE | Public STUN only: `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`, `stun:stun.cloudflare.com:3478` | The spec requires public STUN only |
| Anti-cheat | Commit-reveal: SHA-256 over (tag, salt, board) via `crypto.subtle` | Adds 0 bundle bytes |
| Who starts | Commit-reveal coin flip in game 1. The players then alternate in rematches. | Fair, and matches the anti-cheat theme |
| Modes | Classic (default), Salvo, Items. Toggles: Extra shot after hit (Classic only, default off), Ships can't touch (default off), Turn timer Off/15/30/60 s (default Off). | Research |
| Items | Sonar (2), Torpedo (3), Cross bomb (4), Line strike (5). Energy +1 per turn, cap 6. | Small and balanced; see §7 |
| Theme | Nautical-chart look: paper and ink, one signal orange. Light and dark follow `prefers-color-scheme`, with no theme toggle. | Spec, and the anti-AI-look rules |
| Routing | Hash only: `#4821`, `#o=<blob>`, `#a=<blob>` | Works on GitHub Pages without a 404 trick |

---

## 2. File and module layout

```
battleship/
  index.html               single page; inline SVG favicon; <meta name=theme-color>
  vite.config.ts           base '/battleship/', target es2022, modulePreload {polyfill:false},
                           cssCodeSplit false, tiny inline-css plugin (transformIndexHtml)
  tsconfig.json            strict, noUncheckedIndexedAccess
  package.json             deps: trystero@0.26.0 (exact). dev: vite, typescript, vitest,
                           @playwright/test, @axe-core/playwright
  playwright.config.ts
  scripts/size.mjs         gzip every dist asset, enforce budget (§12), exit 1 on breach
  src/
    main.ts                boot: read hash, create controller, mount root
    app/
      state.ts             AppState discriminated union (§3)
      controller.ts        the ONLY place joining engine + net + ui; owns the state machine
      debug.ts             window.__bs hooks for e2e (own board, force-direct, lie mode),
                           enabled only when localStorage 'bs:debug' === '1'
    game/                  PURE. No DOM, no network. Unit-tested.
      types.ts             Cell (0..99), Ship, Fleet, Config, Attack, Answer, MatchState
      rules.ts             FLEET [5,4,3,3,2] + names, config encode/decode, legality (bounds,
                           overlap, no-touch incl. diagonals)
      board.ts             shipCells(), fleet <-> 5-byte encoding, cellIndex <-> "C7"
      random.ts            randomFleet(config, rng) (rejection sampling, honours no-touch)
      items.ts             ITEM table (id, cost), footprint(item, a, b, shotSet) -> cells
      engine.ts            createMatch / localAttack / remoteAttack / applyAnswer / turn logic
      resolve.ts           resolveAttack(fleet, hitSet, attack) -> Answer   (shared by
                           defender AND verifier, so verification = recompute + compare)
      verify.ts            verifyOpponent(config, commit, reveal, transcript) -> Verdict
      commit.ts            sha256(), commitBoard(salt, fleet), commitCoin(nonce), coinWinner()
    proto/                 PURE. Unit-tested.
      codec.ts             encode(msg) -> Uint8Array / decode(Uint8Array) -> Msg | null
      sdp.ts               packSdp(sdp, kind) -> base64url / unpackSdp(code) -> RTCSessionDescriptionInit
    net/
      transport.ts         interface Transport { send(u8), onmessage, onclose, close() };
                           fromChannel(dc, pc): wraps RTCDataChannel + pc.connectionState
      room.ts              ALL Trystero usage (dynamic import('trystero')), room lock,
                           code collision handling, raw channel creation
      direct.ts            manual SDP host/guest, ICE gather with settle timer
      forward.ts           BroadcastChannel('battleship') answer forwarding
    ui/
      h.ts                 h(tag, attrs, ...children), clear(el), svg()
      icons.ts             4 inline SVG icons (copy, share, rotate, speaker on/off), 1.5px stroke
      grid.ts              renderBoard(el, model, opts): role=grid, roving tabindex, marks
      placement.ts         pointer drag/snap/rotate + keyboard placement
      status.ts            turn strip, timer bar, energy pips, fleet status lists
      announce.ts          aria-live polite region helper
      sound.ts             WebAudio synth (lazy AudioContext on first gesture), mute persisted
      screens/home.ts lobby.ts direct.ts placement.ts battle.ts end.ts notice.ts
    styles/
      tokens.css           colours, type, spacing (§9)
      app.css              layout, grid, buttons, animations, reduced-motion
  test/unit/*.test.ts      vitest (node env; Node 20+ has crypto.subtle + atob/btoa)
  e2e/*.spec.ts            Playwright
```

Rules:
- `game/` and `proto/` import nothing from `net/`, `ui/` or `app/`. Randomness is injected (`rng: (n) => int`), and the default rng uses `crypto.getRandomValues`.
- `net/room.ts` is the only file that imports `trystero`. The import is dynamic, so it becomes a separate chunk. Switching to `@trystero-p2p/torrent` means changing that one import line.
- `controller.ts` holds no game rules. It forwards events to `engine` and messages to `codec`, and calls `ui/screens/*` to render.

---

## 3. State machine

```
AppState =
  | {s:'home'}
  | {s:'lobby-host', code, net:'searching'|'relays-down'}       // waiting for friend
  | {s:'lobby-guest', code, slow:boolean}                       // looking for host
  | {s:'direct-host', step:'gathering'|'share'|'connecting'}     // fallback, host side
  | {s:'direct-guest', step:'gathering'|'share'|'connecting'}    // fallback, guest side
  | {s:'forwarded'}                                             // #a= tab after forwarding
  | {s:'placement', config, ready:{me:boolean, them:boolean}}
  | {s:'battle', match}                                         // sub-turns live in match
  | {s:'end', match, verdict:'pending'|'verified'|'cheat'|'unverified', reason?}
  | {s:'notice', kind:'room-full'|'failed'|'left'|'version'|'invalid-move'}
```

Transitions:

```
home --Create--> lobby-host --guest handshake ok + channel open--> placement
home --Join code / #NNNN--> lobby-guest --host handshake ok + channel open--> placement
lobby-host --"Use a direct link" (or relays-down auto-offer)--> direct-host
lobby-guest (10 s, no host) shows "Ask your friend for a direct link" (stays in lobby-guest)
#o=blob --> direct-guest --channel open--> placement
direct-host --answer pasted / forwarded + channel open--> placement
#a=blob (new tab) --> forwarded (or shows paste-code instructions)
placement --both READY + both COIN verified--> battle
battle --fleet sunk--> end(pending) --REVEAL verified--> end(verified|cheat)
end --both REMATCH--> placement (same transport, first player swapped)
any connected state --channel close / pc failed / BYE--> notice('left')
lobby-guest --busy:true from host--> notice('room-full')
any connect attempt --ICE failed / direct timeout--> notice('failed') --Retry--> home(prefilled)
HELLO version mismatch --> notice('version')
peer sent an illegal move --> end(cheat, reason) (battle ends; reveal is still requested)
```

Inside a battle, `match.phase` is one of `myTurn | awaitingAnswer | theirTurn | over`. Both peers compute the turn from the same shared, deterministic log, so neither side sends a "turn" message.

---

## 4. Connection flow

### 4.1 Trystero path (`net/room.ts`)

```ts
const { joinRoom } = await import('trystero');
room = joinRoom({ appId: 'aral.cc-battleship',
                  relayConfig: { warnOnRelayFailure: false } },
                'r' + code, { onJoinError, onPeerHandshake, handshakeTimeoutMs: 10000 });
```

- Room id is `'r' + code`. The code is a random integer from 1000 to 9999, generated with `crypto.getRandomValues`, so there are no leading-zero codes.
- Prefetching: call `import('trystero')` on the first `pointerenter`/`touchstart`/`focus` of Create, on the first digit typed into the code field, and immediately when the page loads with `#NNNN`. Users who only view the home page download about 11 KB.
- **Handshake (room lock).** This uses Trystero's handshake `send`/`receive` with JSON `{v:1, r:'h'|'g', busy:boolean, t:createdAtMs}`.
  - Host: if `opponent || reserved` is set, send `busy:true` and throw. Otherwise set `reserved = id` *synchronously* before the first await, send `busy:false`, and receive.
    - If the remote is `r:'g'` and not busy, accept.
    - If the remote is `r:'h'`, the code has collided. The host with the larger `t` calls `leave()`, re-rolls the code and rejoins, then updates the UI code and link. The other host throws.
    - If accepting fails, clear `reserved`.
  - Guest: send `busy:false`.
    - If the remote is a host with `busy:true`, go to `notice('room-full')`, run `setTimeout(() => room.leave())`, and throw. Leaving immediately is required to stop the tight retry loop on Nostr.
    - If the remote is a host that is not busy, accept.
    - If the remote is another guest (two guests waiting on a code that has no host yet), **accept but ignore** the peer, which stays idle. Rejecting would cause a tight retry loop. Once the real host arrives, call `getPeers()[idleId].close()`.
- `onPeerJoin(id)`: if `id === reserved` (host) or the peer is the host (guest), set `opponent = id`. Then both sides run `pc = room.getPeers()[id]` and `dc = pc.createDataChannel('g', {negotiated:true, id:512})` with `binaryType='arraybuffer'`, and wrap it in a Transport. When the channel opens, both send HELLO (§5).
- `onPeerLeave(id === opponent)` maps to `notice('left')`.
- Keep the room open for the whole session, because `leave()` closes the peer connections. Call `room.leave()` only on BYE, when the user leaves, or on `pagehide`.
- **Timeouts:**
  - Host after 6 s: if `getRelaySockets()` reports no socket in `readyState === 1`, set `net:'relays-down'` and show the direct-link panel prominently ("Can't reach the matchmaking network. Use a direct link instead."). Otherwise, wait for the friend indefinitely. A link reading "Trouble connecting? Use a direct link" is always visible.
  - Guest after 10 s with no host handshake: set `slow:true`. The guest sees "Still looking for game 4821. Check the code, or ask your friend for a direct link." with a Retry button. The guest keeps listening in the background.
  - `onJoinError` after SDP was exchanged means ICE failed. The fallback uses the same STUN servers and would fail the same way, so go straight to `notice('failed')`. If the error is a handshake timeout, go back to waiting.
  - After the channel opens, if `pc.connectionState === 'failed'`, or it stays `'disconnected'` for more than 8 s, go to `notice('left')`.

### 4.2 Direct-link fallback (`net/direct.ts`, `proto/sdp.ts`)

- `pc = new RTCPeerConnection({iceServers: STUN})` and `dc = pc.createDataChannel('g', {negotiated:true, id:512})` on both sides.
- **Gathering:** resolve when `iceGatheringState === 'complete'`, or 250 ms after the first `srflx` candidate, or at a hard cap of 3.5 s, whichever happens first. If the cap is reached with only host candidates, continue anyway; this still works on a LAN or on the same machine.
- **Packed blob** (base64url, no padding):
  ```
  byte 0      : version(4 bits)=1 | kind(4 bits) 0=offer 1=answer
  ufrag       : len u8 + ASCII
  pwd         : len u8 + ASCII
  fingerprint : 32 raw bytes (sha-256)
  candidates* : type u8 (0 host-v4 | 1 srflx-v4 | 2 mDNS-uuid) + addr (4 | 16 bytes) + port u16 BE
  ```
  - Drop IPv6, TCP and relay candidates. Keep at most 4 candidates: all srflx first, then host.
  - Size is about 118 chars. Full link: `https://aral.cc/battleship/#o=<blob>`, about 150 chars.
- **Unpack** with the fixed template from `/tmp/sdp-test/page.js`. Use `a=setup:actpass` for the offer and `a=setup:active` for the answer, then `mid:0`, `sctp-port:5000` and `max-message-size:262144`. Port that function verbatim, add the version byte, and validate lengths. Malformed input returns `null`, and the UI says "That link looks incomplete. Ask for it again."
- **Host flow:**
  1. Gather, then show the "Send this link to your friend" step: the link in a mono box, plus Copy and Share buttons.
  2. Below that, the "Paste their reply" step: a paste field that accepts the full `#a=` link or the bare blob, plus a Connect button.
  3. Also listen on `BroadcastChannel('battleship')` for `{t:'a', blob}`, and reply `{t:'ack'}` when one arrives.
  4. The host tab must stay open. Show the line "Keep this tab open."
- **Guest flow (`#o=`):**
  1. Unpack, `setRemoteDescription`, `createAnswer`, then gather.
  2. Show "Send this reply link back": `#a=<blob>` with Copy and Share, plus a copy-code box holding the bare blob.
  3. Show "Waiting for your friend to connect…".
- **`#a=` tab:** post `{t:'a', blob}` on BroadcastChannel and wait 600 ms for an ack.
  - With an ack, show "Sent to your game tab. You can close this tab."
  - Without one, show "Open your game tab and paste this code there", followed by the blob and a Copy button. This is the in-app browser case.
- **Timeout:** the host goes to `notice('failed')` 15 s after `setRemoteDescription(answer)` if the channel is not open, or at once on `connectionState === 'failed'`. The guest gets the same 15 s limit, counted from when its pc reaches `'checking'`. If its pc never reaches `'checking'`, the guest gives up after 120 s of waiting for the friend.
- After reading `#o=` or `#a=`, call `history.replaceState` to clear the hash. A `#NNNN` hash stays, so a reload rejoins.

### 4.3 Failure notice

The notice reads "Couldn't connect — your network may be blocking peer-to-peer." It has a single Retry button, which tears down the room or pc and returns to home with the code prefilled. Below it, a slate line reads: "Try another network (e.g. switch Wi-Fi off) or a different browser."

---

## 5. Wire protocol (binary, over DataChannel `g`/512)

Each frame is one message. Byte 0 is the opcode. The channel is reliable and ordered (the default). Cell = `row*10 + col` (0..99). Frames over 64 bytes are rejected. If a message fails to decode or arrives in the wrong state, the receiver goes to `end(cheat, 'invalid message')` during battle and ignores it at other times.

| Op | Name | Layout | Bytes | Sender |
|---|---|---|---|---|
| 0x01 | HELLO | `01 ver=1 role(0 host,1 guest)` | 3 | both, on channel open |
| 0x02 | CONFIG | `02 mode(0 classic,1 salvo,2 items) flags(b0 extraShot, b1 noTouch) timerSec(0/15/30/60)` | 4 | host, after HELLO and in REMATCH |
| 0x03 | READY | `03 boardCommit[32] coinCommit[32]` | 65 | both, on Ready |
| 0x04 | COIN | `04 nonce[16]` | 17 | both, after having sent READY **and** received the peer's READY (game 1 only) |
| 0x10 | FIRE | `10 c1 … cn` (n = 1 in Classic/Items, 1..5 in Salvo) | 2–6 | attacker |
| 0x11 | ANSWER | `11` then entries `cell code` with code 0 miss, 1 hit, 2+i sunk ship i; a sunk entry is followed by one byte `anchor | vertical<<7` | 1 + 2/entry (+1 if sunk) | defender |
| 0x12 | USE | `12 item a b` (see §7) | 4 | attacker, Items mode |
| 0x13 | SONAR | `13 count(0..9)` | 2 | defender |
| 0x20 | REVEAL | `20 salt[16] fleet[5]` | 22 | both, at game over |
| 0x21 | VERDICT | `21 ok(0/1)` | 2 | both, after verifying |
| 0x30 | REMATCH | guest: `30`. host: `30 mode flags timerSec` | 1 / 4 | both |
| 0x31 | BYE | `31` | 1 | on Leave |

Typical sizes: a Classic shot is 2 B and its answer is 3 B (4 B on a sunk). A full Salvo of 5 shots is 6 B, answered with at most 16 B. A Torpedo "clean run" is the 1-byte frame `11` (an empty ANSWER).

**Fleet encoding** (5 bytes): one byte per ship in the fixed order Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2. Each byte is `anchor | vertical<<7`, where the anchor is the top-left cell.

**Defender rules for answers:** the ANSWER lists exactly the footprint cells that had not been fired at before, in footprint order (§7). Both sides compute the footprint the same way, so the attacker checks that the answer's cell list matches.

**Defender checks on the attacker** (a failed check means `end(cheat, reason)`):
- It is actually the attacker's turn.
- Cells are in range and distinct, and none has been fired at before.
- The Salvo count equals `min(shipsAfloat(attacker), untargetedCells)`.
- In Items mode the attacker has the energy for the item, and the item parameters are valid.

**Attacker's live checks on answers:**
- The cell list matches the footprint.
- A sunk ship index is not already sunk.
- A sunk ship's anchor and orientation cover only cells this attacker has now hit, and its length matches.
- The total number of hit cells never exceeds 17.
- If all 100 cells have been fired at without 5 sinks, the defender is cheating.

The full check happens at reveal.

---

## 6. Commit-reveal and coin flip (`game/commit.ts`, `game/verify.ts`)

- When a player presses Ready:
  - Generate `salt = getRandomValues(16)` and `nonce = getRandomValues(16)`.
  - Compute `boardCommit = SHA-256("bs1/board" ‖ salt ‖ fleet5 ‖ flags)` and `coinCommit = SHA-256("bs1/coin" ‖ nonce)`.
  - `flags` is the CONFIG flags byte. It binds the board to the rules in force.
  - Send READY. The local fleet then locks and cannot be changed.
- **Coin (game 1):** after both READYs, each side sends COIN. The receiver checks `SHA-256("bs1/coin" ‖ nonce) == coinCommit`, and a mismatch means `notice('invalid-move')`. The starter is chosen by `(nonceHost[0] ^ nonceGuest[0]) & 1`: 0 means the host starts. Show the result for 1.2 s ("You go first" / "They go first") as a strip message, then the battle begins.
- **Rematch:** new salt and new commit. The coin step is skipped, and the player who did not start the previous game starts.
- **Transcript:** each side records every attack it made and the answer it received, as `{attack, answerBytes}`.
- **Game over:** when an ANSWER sinks ship #5, both sides know the game is over. Each sends REVEAL immediately. A loser's client also reveals automatically, with no button.
- **`verifyOpponent`, in order:**
  1. The hash matches the commit, else "Their fleet doesn't match what they committed to at the start."
  2. The fleet is legal under the config: in bounds, no overlap, no-touch if that flag is set. Else "Their fleet layout was illegal."
  3. Replay the transcript: for each attack, `resolveAttack(revealedFleet, hitSetSoFar, attack)` must encode to the same bytes the peer sent. The first mismatch produces a specific reason, e.g. "Cheating detected: they reported a miss at E4 but a ship was there", "…reported 1 ship cell in the sonar at C3–E5, there were 3", or "…torpedo passed through a ship at G7".
- If no REVEAL arrives within 10 s of game over, or the peer left, the verdict is `unverified` and reads "Opponent left before revealing their fleet — result not verified." A forfeit win is still shown as a win.
- Each side sends VERDICT, so the end screen can say "Opponent verified your fleet" or "Opponent's check failed".
- The end screen shows the opponent's revealed fleet in slate on your target board, overlaid on the marks.

---

## 7. Game modes: exact rules

Every mode uses a 10×10 board, the fleet Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2 (17 cells), and straight ships, horizontal or vertical.

**Placement.** The board starts **pre-filled with a random legal fleet**, so a player can just press Ready.
- Randomize re-rolls the fleet.
- Ships can be dragged, and tapping a ship (or pressing R) rotates it.
- Illegal positions are shown with a red (signal) dashed outline and cannot be dropped. The ship snaps back.
- With **Ships can't touch** on, legality also forbids ships being adjacent orthogonally or diagonally.

**Classic.**
- One shot per turn.
- With **Extra shot after a hit** on (Classic only, default off), a hit or sunk gives the same player another shot. The turn timer then restarts.
- A miss passes the turn.

**Salvo.**
- Shots this turn = `min(your ships afloat, untargeted cells)`, so 5 at the start, minus one per ship of yours that has been sunk.
- The attacker selects that many distinct untargeted cells and presses "Fire 3/3". Enter also fires once the selection is full, and tapping a selected cell deselects it.
- All the shots resolve in one ANSWER, and the turn always passes. Extra shot is disabled in this mode.

**Items.**
- Shots are as in Classic, with Extra shot disabled.
- Energy: at the **start of each of your turns** you gain +1, capped at 6. You start a game at 0, so your first turn has 1. Both sides track both energies deterministically.
- On your turn you either **fire one shot** or **use one item**. An item replaces the shot and costs energy. After that the turn always passes.
- Each item names its footprint inputs `a` and `b`, and its footprint cells are taken in the order listed:

| Id | Item | Cost | Input (a, b) | Effect | Answer |
|---|---|---|---|---|---|
| 0 | **Sonar** | 2 | a = centre cell with row and col in 1..8 (the UI clamps it), b = 0 | Counts the **intact** (not yet hit) ship cells in that 3×3. Does no damage. | SONAR count |
| 1 | **Torpedo** | 3 | a = line index 0..9, b = entry edge 0 left, 1 right, 2 top, 3 bottom (0/1 for a row, 2/3 for a column) | Travels from the edge cell by cell. Cells already fired at are passed over. It stops at the first intact ship cell, which it hits. Every cell it crossed is learned as water. | ANSWER with 1 entry, or empty for a clean run (the whole line holds no intact ship) |
| 2 | **Cross bomb** | 4 | a = centre cell, b = 0 | Centre, N, E, S, W. Arms that fall off the board are dropped. | ANSWER over the untargeted cells |
| 3 | **Line strike** | 5 | a = start cell (left or top end), b = 0 horizontal / 1 vertical; all 5 cells must be on the board | 5 consecutive cells | ANSWER over the untargeted cells |

Balance notes for implementers (these are not settings):
- Cross and Line hit the same number of cells. Line costs more because, once lined up with a ship, it can sink a Carrier in one go.
- The cap of 6 means a player can never bank two big items.
- If every cell of an area item's footprint has already been fired at, the UI disables the item at that target, and the defender's check rejects it.
- Learned water from a torpedo and the cells of a sonar result reading 0 are drawn as "known water".

**Turn timer** (Off/15/30/60 s, default Off):
- On expiry the local client auto-acts. In Classic and Items it fires a random untargeted cell; in Salvo it fills the remaining selection randomly and fires.
- A thin bar depletes under the status strip, and it turns signal colour in the last 5 s.
- On the opponent's turn the bar shows their time. If nothing arrives for timer + 15 s, show "Opponent isn't responding" with a Leave button. Leaving counts as a forfeit win, unverified.

**Auto-marked water.** Only with no-touch on: when a ship sinks, its 8-neighbourhood is drawn as known water on the attacker's board.

**Win.** A player wins by sinking all 5 enemy ships. There are no draws, because play is sequential.

**Stats on the end screen:** shots fired (cells), hits, accuracy %, ships lost, turns, and items used (Items mode only).

---

## 8. Screens and copy

The text is short and literal. There is no marketing copy and no exclamation marks.

1. **Home**
   - The wordmark "BATTLESHIP" sits flush left, with a 3×3 grid mark beside it in which one cell is signal orange; this is the only logo.
   - Subline in slate: "Two players. Peer-to-peer. No sign-up."
   - A primary button, **Create game**.
   - A divider label "OR JOIN WITH A CODE", then the code field and a **Join** button. Typing the 4th digit auto-submits.
   - The mute toggle is top right.
   - The footer, 12 px slate, reads "No server. Your game runs directly between your devices."
   - The code field is a single `<input inputmode="numeric" pattern="\d{4}" maxlength=4 aria-label="4-digit game code">`. Four drawn boxes come from `background` plus mono `letter-spacing`, so it remains one accessible input.
2. **Lobby (host)**
   - The label "GAME CODE", then the code in 56 px mono. The link `aral.cc/battleship/#4821` appears in a 14 px mono box.
   - Buttons: **Copy link**, and **Share** (only if `navigator.share` exists).
   - Settings, which the host can edit while waiting:
     - Mode segmented control: Classic / Salvo / Items, with a one-line description under it.
     - Toggles: "Extra shot after a hit" (Classic), "Ships can't touch".
     - Timer segmented control: Off / 15 s / 30 s / 60 s.
   - Status line: "Waiting for your friend…" next to a 6 px ink square that blinks at 1.2 s; the blink is disabled under reduced motion.
   - Link: "Trouble connecting? Use a direct link".
3. **Lobby (guest):** "Joining game 4821…" and, after 10 s, the slow-state text from §4.1.
4. **Direct host / direct guest:** two numbered steps (1, 2) in a 1 px ruled list. Each step has a mono link box and Copy/Share buttons. The host's step 2 has a paste field and a Connect button.
5. **Placement**
   - Your board at full size.
   - Below it, the ship dock lists the fleet as capsules with names. This is a drag source only when a ship is lifted off the board.
   - Buttons: **Randomize**, **Rotate** (applies to the selected ship), **Ready** (primary).
   - A rules line in slate, e.g. "Salvo · Ships can't touch · 30 s turns".
   - After Ready: "Waiting for opponent to place their fleet". The opponent's ready state shows as "Opponent ready".
6. **Battle** (layout in §9.5)
   - The target board is labelled "THEIR WATERS" and your own board "YOUR FLEET".
   - Status strip: "Your turn" or "Waiting for opponent", plus the last result, e.g. "E4 hit" or "You sank their Cruiser".
   - Items mode shows the items bar: 4 buttons with name, cost pips and energy pips. Unaffordable items are disabled. Selecting an item previews its footprint on hover or focus, and a tap or Enter confirms. Esc cancels, and R rotates the Line strike or cycles the torpedo edge.
7. **End**
   - Heading "You won" / "You lost" (28 px).
   - Verdict line:
     - Verified: "Fleet verified" with a check icon drawn as an SVG path in ink.
     - Cheat: a signal-colour rule above the reason text.
     - Not verified: the reason.
   - The stats table (mono numbers) and the revealed enemy fleet.
   - Buttons: **Rematch** (primary) and **Leave**.
     - The host also gets "Change mode", which reopens the settings inline. Pressing Rematch sends REMATCH with the config.
     - On the guest, Rematch shows "Waiting for host…". Placement starts when both have sent REMATCH.
8. **Notices:** Room full ("Game 4821 already has two players."), Failed (§4.3), Opponent left ("Your opponent left. You win by forfeit." plus the verdict line), Version mismatch ("Your friend is on a different version. Both reload the page.").

---

## 9. Visual design system

### 9.1 Anti-AI-look rules (enforced in review)

- No gradients for decoration. The one exception is a 45° hatch made with `repeating-linear-gradient`, used only as a hatch pattern.
- No `backdrop-filter`. No `box-shadow` anywhere; focus uses `outline`.
- No purple, indigo or violet hues.
- No emoji, and no sparkle or star icons.
- No gradient text and no hero banner.
- No rounded cards. Borders are 1 px ink or rule-colour lines. Radius is 0 on cells and 2 px on buttons and inputs.
- Text is flush left (Swiss). Only the room code and board labels are centred.

### 9.2 Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4F1EA` paper | `#0E1A2B` ink | page |
| `--fg` | `#0E1A2B` (15.5:1) | `#F4F1EA` | text, primary button fill, rules |
| `--muted` | `#5B6B7F` (4.83:1) | `#8A9BB0` (6.16:1) | secondary text, own ships |
| `--water` | `#FBFAF6` | `#13233A` | board cells |
| `--rule` | `#C9CFD6` | `#2A3A52` | grid hairlines (decorative) |
| `--known` | `#E3EBEF` | `#1B2E47` | known/auto-marked water |
| `--signal` | `#D9480F` (3.81:1) | `#FF6A1F` (6.1:1) | hits, timer < 5 s, cheat rule, illegal placement |
| `--focus` | `#0E1A2B` | `#F4F1EA` | 2 px focus outline |

The signal colour is never used for decoration: not for buttons and not for headings.

### 9.3 Type

- Stacks: `--sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` and `--mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Scale (px / line-height / weight):
  - label 12/16/600, uppercase, letter-spacing .08em
  - small 14/20/400
  - body 16/24/400
  - status 20/28/600
  - h2 28/32/700, letter-spacing -.01em
  - wordmark 32 (mobile) / 44 (≥900) at 800, letter-spacing .14em, uppercase
  - room code 56 mono 600, letter-spacing .15em
- Board coordinate labels are 11 px mono in `--muted`. Use `font-variant-numeric: tabular-nums` on the timer and stats.

### 9.4 Spacing and components

- Spacing uses a 4 px base: 4, 8, 12, 16, 24, 32, 48. The page gutter is 16 px on mobile and 32 px on desktop, and content is capped at 1040 px.
- Buttons are 48 px tall with 0 16px padding, 16/600 text and radius 2.
  - Primary: `--fg` background, `--bg` text.
  - Secondary: transparent with a 1 px `--fg` border.
  - Disabled: 40% opacity.
  - Active: `translateY(1px)`. Focus: `outline: 2px solid var(--focus); outline-offset: 2px`.
- Segmented controls are 1 px bordered rows. The selected segment is filled `--fg`.
- Toggles are a checkbox styled as a 36×20 square-ish switch with radius 2.

### 9.5 Board and layout

- Board: a CSS grid with a label column and label row of 20 px plus 10×10 cells. There is a 1 px gap, and the `--rule` background shows through as hairlines. A 1 px `--fg` outer border gives the chart frame. Columns are labelled A–J across the top and rows 1–10 down the side.
- Cell size:
  - `--cell: clamp(24px, calc((min(100vw, 480px) - 52px) / 10), 40px)`, which is about 30 px at 360 wide and 33 px at 390.
  - Mini own board on mobile: `--mini: calc(var(--cell) * .55)`.
  - Desktop (≥900 px): both boards at 40 px.
- **Portrait phone, top to bottom:**
  1. A thin header with the game code and mute.
  2. The target board at full width.
  3. The status strip, 44 px tall. It is inverted on your turn (`--fg` background, `--bg` text) and plain with `--muted` text on theirs. A 3 px timer bar sits under it.
  4. The items bar (Items mode).
  5. A row with the mini own board on the left and two fleet-status lists (Theirs / Yours) on the right.
- **Desktop ≥900:** the status strip runs full width on top, with the boards side by side below it (target left, own right, 48 px gap) and the fleet lists under each board. The items bar sits under the target board.
- **Landscape phone** (`max-height: 500px` and landscape): boards side by side with the cell size computed from the height.
- **Marks** use different shapes, so they work for colour-blind players:
  - unknown: an empty `--water` cell
  - miss: a centred ink dot (28% of the cell) at 45% opacity
  - hit: a `--signal` filled square inset 18%
  - sunk: hit squares plus a 45° ink hatch on the ship's cells and a 2 px ink outline around the ship's extent
  - known water: `--known` fill with a small 3 px `--muted` dot
  - last shot on each board: a 2 px `--fg` inset outline
  - sonar: a 1 px dashed `--fg` box around the 3×3, with the count in 11 px mono in its top-left corner. It persists.
  - item preview: footprint cells get a 12% `--fg` overlay and a 1 px `--fg` inset border
- **Ships** are SVG capsules (`rect` with `rx = height/2`), inset 4 px, filled `--muted`. On the placement board the selected ship gets a 2 px `--fg` outline, and an illegal ghost gets a dashed `--signal` outline.
- **Fleet status:** one row per ship with the name (14 px) and a capsule split into L segments. For your own fleet the segments fill `--signal` as they are hit. For the enemy fleet only sunk is known, so a sunk row is hatched with a 1 px strike-through and its name drops to `--muted`.

### 9.6 Motion (all inside `@media (prefers-reduced-motion: no-preference)`; otherwise instant)

- Miss: an SVG circle ring scales from 0.3 to 1.4 while opacity goes from 0.6 to 0, over 350 ms ease-out.
- Hit: the square pops from scale 0.6 to 1 in 120 ms `cubic-bezier(.2,.9,.3,1.3)`, and the cell does a 2 px shake over 160 ms.
- Sunk: the outline draws via `stroke-dashoffset` over 400 ms, then the hatch fades in over 150 ms.
- Status strip: background and colour transition over 150 ms.
- A placement snap takes 80 ms on transform, and an illegal drop snaps back in 160 ms.
- Salvo answers are revealed with an 80 ms stagger per cell.
- Screens have no transitions; they swap instantly.

### 9.7 Sound (`ui/sound.ts`)

- The `AudioContext` is created on the first user gesture. Mute state is stored in `localStorage['bs:mute']`, default unmuted, and the toggle is an icon button with `aria-pressed`.
- Miss: 120 ms white noise through a bandpass at 900 Hz, with a quick decay.
- Hit: a sine dropping from 110 to 55 Hz over 180 ms plus a 60 ms noise burst at 2 kHz lowpass.
- Sunk: a descending triangle 440 → 330 → 220 Hz, 120 ms each.
- Your turn: one soft 660 Hz blip of 40 ms at 0.08 gain.
- Master gain is 0.25, and there are no files.

---

## 10. Accessibility

- Boards use `role="grid"` with `aria-label` "Their waters" / "Your fleet". Each row is `role="row"`, and each cell is a `role="gridcell"` that contains a `<button>` with `aria-label="C7, miss"`. The states are unknown, miss, hit, sunk Cruiser and known water.
- Your board is `aria-readonly="true"` and its cells are not buttons during battle.
- Focus uses a roving tabindex: one tab stop per board. Arrows move, Home/End go to the row ends, and Ctrl+Home/End to the corners. Enter or Space fires, toggles a Salvo selection, or confirms an item. Esc cancels the item or the Salvo selection.
- Keyboard placement:
  - Tab reaches the ship list, and Enter picks up a ship.
  - Arrows move the ghost and R rotates it. Enter drops it if legal; if not, the announcer says "Can't place here."
  - Esc cancels.
- An `aria-live="polite"` region announces "You fired at E4: hit.", "They fired at B2: miss. Your turn.", "You sank their Cruiser.", the coin result and the verdict. Turn changes are announced in the same region.
- Contrast: text is at least 4.5:1 and UI graphics at least 3:1 in both themes (tokens in §9.2). The hairline grid is decorative, because the cells' fill contrast and outer frame carry the structure.
- Targets: cells are at least 24 px (WCAG 2.5.8) and are about 30 px on a 360-wide phone. Buttons are at least 48 px tall.
- `prefers-reduced-motion` is respected. `lang="en"` is set, and the `<title>` changes to "Your turn · Battleship" when it is your turn.
- An axe-core scan runs in e2e on every screen, with zero serious or critical violations allowed.

---

## 11. Engine API sketch (`game/engine.ts`)

```ts
type Config = { mode: 0|1|2; extraShot: boolean; noTouch: boolean; timer: 0|15|30|60 };
type Attack = { k: 'fire'; cells: number[] } | { k: 'item'; item: 0|1|2|3; a: number; b: number };
type Answer = { k: 'cells'; entries: { cell: number; code: number; ship?: number }[] } | { k: 'sonar'; count: number };

createMatch(config, myFleet, iStart: boolean): Match
legalAttack(m, attack, side: 'me'|'them'): string | null        // null = OK, else reason
localAttack(m, attack): { m, out: Msg }                          // throws if illegal (UI prevents)
remoteAttack(m, attack): { m, out: Msg } | { cheat: string }     // computes answer via resolve.ts
applyAnswer(m, answer): { m, events: UiEvent[] } | { cheat: string }
// Turn, energy, ships afloat and game over are derived inside the engine; both peers stay in lockstep.
```

`resolveAttack(fleet, hitSet, attack): Answer` is the single source of truth. The defender calls it to answer, and the verifier replays it.

---

## 12. Bundle budget (enforced by `npm run size` in CI and before deploy)

| Asset | Budget (gzip -9) |
|---|---|
| `index.html` with inlined CSS | ≤ 3.5 KB |
| app JS (entry chunk: game + proto + ui + direct fallback) | ≤ 9 KB |
| trystero chunk (lazy) | ≤ 28.5 KB (measured 27.6) |
| **Total** | **≤ 40 KB hard, 37 KB target** |
| First load before any intent | ≤ 12.5 KB |

- No fonts, images or audio files. The favicon is an inline SVG data URI.
- If the total goes over budget, switch `net/room.ts` to `@trystero-p2p/torrent` with `relayConfig.urls` set to the three live trackers (open.ftorrent.com, tracker.webtorrent.dev, tracker.openwebtorrent.com). That saves 4.4 KB. Do not trim features first.
- `scripts/size.mjs` prints a table and exits 1 on any breach.

---

## 13. Test plan

### 13.1 Unit tests (vitest, `test/unit`)

- `rules`: bounds, overlap and no-touch (including diagonals); config byte round-trip.
- `random`: 2,000 random fleets are all legal, with and without no-touch, using a seeded rng.
- `board`: fleet 5-byte encode/decode round-trip; `"C7"` ↔ 62.
- `engine`:
  - Classic turn passing.
  - Extra shot on and off.
  - Salvo shot counts going 5 → 4 after a sink, and capped by the untargeted cells.
  - Items: energy accrual, the cap of 6, affordability, and that an item replaces the shot.
  - Game over detection.
  - Rematch swaps the starter.
- `items`:
  - Footprints at edges and corners. Cross arms are dropped off the board; Line must fit.
  - Torpedo from each of the 4 edges: clean run, passing over already-hit cells, stopping at the first intact ship cell, and the learned-water set.
  - Sonar counts only intact cells.
- `codec`: every message round-trips. Exact byte lengths are asserted (FIRE classic = 2, ANSWER miss = 3, sunk = 4, READY = 65, REVEAL = 22). Malformed frames decode to null.
- `sdp`: pack/unpack round-trip on fixture SDPs captured from Chromium (mDNS host plus srflx), Firefox and Safari. The packed length is ≤ 140 chars, and the rebuilt SDP keeps ufrag, pwd, fingerprint and candidates. Bad base64 or truncated input returns null.
- `commit` / `verify`:
  - An honest game verifies.
  - A flipped hit→miss, a wrong sunk ship, a wrong sonar count, a torpedo that passed through a ship, a changed board after the commit, a wrong salt and an illegal layout under no-touch are each detected, with the expected reason string.
- `coin`: the commit is checked, and the XOR rule is deterministic.
- `controller` (with a fake in-memory Transport pair): two controllers play a full scripted Classic, Salvo and Items game to the end with a verified verdict. Includes BYE leading to `notice('left')`.

### 13.2 End-to-end (Playwright, `e2e/`)

- The server is `vite build && vite preview --port 4173`, and tests use `http://localhost:4173/battleship/`, which is a secure context, so `crypto.subtle` is available.
- Chromium is the required project. Firefox is an optional project that runs when it is installed. Every page sets `localStorage['bs:debug']='1'`.
- **Two browser contexts** (A = host, B = guest) for every multiplayer test.

1. **`direct.spec.ts` (required, offline-safe)**
   - A: Create, then "Use a direct link". Read the `#o=` link from the link box.
   - B: `goto(link)`. Read the reply blob.
   - A: paste it, then Connect.
   - Both reach placement. Both press Ready, and the coin result shows on both.
   - Play to the end by clicking real cells: A reads B's fleet via `__bs.myFleet()` on B's page and fires at those cells, and B fires misses where it can.
   - Assert the "Fleet verified" verdict on both sides, then Rematch: placement appears again and the other player starts.
   - Repeat in Salvo and Items mode with shortened scripts that use each item once: Sonar count shown, Torpedo hit, Cross, Line.
2. **`forward.spec.ts`**: within context A, a second page opens `#a=<blob>` and shows "Sent to your game tab". The host page connects.
3. **`cheat.spec.ts`**: B sets `__bs.lie('miss-on-hit', 'E4')` and the game is played to the end. A shows "Cheating detected: they reported a miss at E4 but a ship was there".
4. **`leave.spec.ts`**: closing B's page mid-battle makes A show "Your opponent left".
5. **`failed.spec.ts`**: with a test hook that sets `iceServers: []` and replaces candidates with an unreachable address, A shows "Couldn't connect — your network may be blocking peer-to-peer" within 20 s, and Retry returns home.
6. **`trystero.spec.ts` (tagged `@net`)**
   - It first checks whether `wss://nos.lol` can be opened and skips if it cannot.
   - A: Create and read the code. B: type the code. Both reach placement within 15 s.
   - A third context C joins the same code and sees "Game NNNN already has two players." A and B stay connected; a FIRE still works after C joins.
   - Also check the `#NNNN` link path.
7. **`a11y.spec.ts`**:
   - axe on home, lobby, placement, battle and end in light and dark.
   - Play one Classic game turn with the keyboard only: arrows, then Enter.
   - Place a ship with the keyboard.
8. **`visual.spec.ts`**:
   - Viewports: 360×740, 390×844 and 1280×800, for each of `colorScheme: light/dark`.
   - Screens: home, lobby, placement, battle mid-game (fixed seeded fleets through `__bs.seed(n)`), Items battle and end.
   - Animations are disabled via `reducedMotion: 'reduce'`. Uses `toHaveScreenshot` with `maxDiffPixelRatio: 0.01`.
   - DOM assertions: the battle target board fits the viewport width without horizontal scroll, and cells are ≥ 24 px. A script scans computed styles and finds no `box-shadow`, `backdrop-filter` or `linear-gradient` other than the hatch class, and no colour with hue in 230–300° and saturation > 30%.
   - The first baseline images are reviewed by eye against §9.1 before they are committed.

The npm scripts are:
- `dev`
- `build`
- `preview`
- `test` (vitest)
- `e2e` (playwright, which excludes `@net` unless `NET=1`)
- `size`
- `check`, which runs tsc, then test, build, size and e2e

---

## 14. Build order

1. Scaffold Vite with TS strict, tokens.css and the `h()` helper. Add `size.mjs` early so the budget is visible from day one.
2. `game/` and `proto/`, test-first: rules, board, random, items, resolve, engine, commit, verify, codec, sdp. Get these 100% green before any UI.
3. `net/transport.ts` and `net/direct.ts`, plus a bare page that connects two tabs through the direct links. Then `direct.spec.ts` with a stub UI.
4. UI: grid rendering, then placement (pointer and keyboard), the battle screen and the end screen. Then `controller.ts` wiring the full state machine over the direct transport.
5. `net/room.ts` with Trystero: lazy import, room lock, collision re-roll, timeouts. Then `trystero.spec.ts`.
6. Salvo, Items with the items bar and previews, the timer, sound and the a11y pass.
7. Visual polish against §9, screenshot baselines, the size check and a final `npm run check`.

Deployment to GitHub Pages is not part of this work. `base: '/battleship/'` and hash routing make it a plain copy of `dist/`.
