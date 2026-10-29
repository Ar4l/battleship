# UX spec: round 4

This spec is for the UI and logic owners. It is based on the current screenshots (`screenshots/*`, 390×844, 844×390, 1440×900). Where a rule needs logic (Airstrike, islands, Russian, prefire), the UX is fixed here and the numbers marked *proposal* can be changed by the logic owner without changing the UI.

The design language stays: paper/ink, one signal orange, system fonts, 1 px rules, radius 0 on cells and 2 px on controls, no shadows, gradients (except the sunk hatch), emoji or icons beyond the existing set. Everything below is CSS plus small DOM changes, and should cost well under 2 KB gzipped.

Keep these strings, because e2e looks for them: "Classic", "Salvo", "Items", "Extra shot after a hit", "Ships can't touch", `#ready`, `#fire`, `.battle`, `.placement`, `.a-target .cell[data-i]`.

---

## 1. Shared components

### 1.1 Segmented control (`.seg`)
- Full width of its column. Segments have equal width, at least 64 px each. Height 44 px.
- Outer border is 1 px `--fg`, radius 2. Dividers between segments are 1 px `--fg`.
- Unselected: transparent, `--fg` text 15/500.
- Selected: `--fg` fill, `--bg` text 15/600.
- Hover (hover devices only): `--water` fill. Focus: the existing 2 px outline on the segment.
- Disabled segment: text at 40% opacity, no fill change.
- Above the control: a 12 px uppercase label (`MODE`, `MAP`, `TURN TIMER`). Below it, at most one line of 14 px `--muted` description that changes with the selection. Leave 24 px between settings.

### 1.2 Switch row (`.toggle`)
This replaces the small checkbox-like toggle that sits left of its label.
- The whole row is the hit target: 52 px min height, label on the left, switch on the right. There is a 1 px `--rule` line above the first row and below every row, so the switches read as a settings list.
- Label 16/400 `--fg`. An optional second line in 13 px `--muted` gives the state reason ("Not in Salvo", "Always on in Russian").
- Switch: a 44×26 track, radius 2, 1 px `--fg` border. The knob is a 20×20 square (radius 1) inset 3 px.
  - Off: track `--water`, knob `--muted` on the left.
  - On: track `--fg`, knob `--bg` on the right.
  - Knob moves over 120 ms (reduced motion: instant).
  - Disabled: the row is at 40% opacity and the reason line is shown. A switch that is locked on (Russian) shows On at 40%.
- Keep the native `<input type="checkbox" role="switch">` underneath for accessibility.

### 1.3 Rules summary
One mono 13 px `--muted` line, with parts joined by ` · `: `Items · 12×12 · 30 s turns`, `Russian · 10×10 · No timer`, `Classic · Extra shot · Ships can't touch`. It goes in the desktop header (already there), on the placement screen and on the guest's join screen once rules are known.

### 1.4 Header
- Mobile portrait: 44 px. Mark 16 px plus the wordmark at 14/800, `Leave` text link, mute icon. Remove the bottom rule in battle, because the turn bar does that job.
- Landscape ≤500 high: 36 px with the same content.
- Desktop: unchanged.

---

## 2. Home
This screen is fine. Two small changes:
- Keep **Join** disabled (40%) until 4 digits are in. Typing the 4th digit still auto-submits.
- On phones, vertically centre the block between header and footer (it is close to that already). No other changes.

## 3. Lobby (host): game setup
Order and grouping. Inviting comes first, because the friend needs the code now, and the rules can change while waiting.

**Mobile (single column, 16 px gutter):**
1. `GAME CODE` label, then the code in 48 px mono (down from 56, to save height).
2. A link box (14 px mono), then a button row: **Copy link** and **Share** (when available), side by side, each half width.
3. Status line: blinking 6 px ink square + "Waiting for your friend…". Under it, in 14 px: "Trouble connecting? Use a direct link".
4. A 1 px rule and 24 px space, then the heading `Rules` (16/600).
5. `MODE` segmented control: **Classic / Salvo / Items / Russian**. Description line:
   - Classic: "One shot a turn."
   - Salvo: "One shot for each ship you have left, all fired together."
   - Items: "Earn energy each turn. Spend it on sonar, torpedoes and strikes."
   - Russian: "Ten ships, none touching. A hit shoots again."
6. `MAP` segmented control: **10×10 / 12×12 / 14×14**. Description: 10×10 "Open sea.", 12×12 and 14×14 "With islands. Ships can't sit on land and torpedoes stop at it."
7. `TURN TIMER` segmented control: **Off / 15 s / 30 s / 60 s** (no description).
8. Switch list:
   - "Extra shot after a hit". Enabled in Classic and Items. In Salvo it is disabled with the reason "Not in Salvo". In Russian it is locked on with "Always on in Russian".
   - "Ships can't touch". In Russian it is locked on with "Always on in Russian".
9. `Cancel` text link.

**Desktop ≥900:** two columns, 48 px gap. Left is the invite block (items 1–3, plus Cancel). Right is Rules (items 4–8), max 440 px wide.

**Landscape ≤500 high:** the same two columns, and the page scrolls vertically if needed. It never scrolls sideways.

The host's selections persist in `localStorage` (`bs:rules`) so the next game starts with the same setup. *(Proposal; cheap.)*

## 4. Lobby (guest) and direct-link screens
- Guest: "Joining game 4821…" stays. Once connected, placement opens as today.
- Direct host/guest: no layout change. Use the same button-row pattern as the host lobby: Copy and Share half width each, side by side.

## 5. Placement
Goal: fits one screen on phones, so Ready is always visible without scrolling.

**Mobile, top to bottom:**
1. Header (44).
2. `PLACE YOUR FLEET` label, with the rules summary (1.3) on the next line.
3. Board at full width (same size rules as the battle target board, §7.1). Islands are drawn (§10).
4. Hint, 14 px `--muted`: "Drag to move. Tap a ship to rotate." (shorter than today's).
5. **Fleet legend, one or two lines, wrapped.** It replaces the two-column list that is currently about 130 px tall. Each class is an inline chip: a capsule glyph with width proportional to length (8 px per cell, 6 px tall), the name in 14 px, and `×n` in mono when n > 1. The selected ship's class is in `--fg` 600 and the others in `--muted`. Each class is one non-wrapping group: the name and `×n` first, then one capsule per ship (as in the battle fleet lists), so a line never starts with a stray capsule.
   - Classic: `Carrier 5 · Battleship 4 · Cruiser 3 · Submarine 3 · Destroyer 2` (name + capsule, no count).
   - Russian: `Battleship · Cruiser ×2 · Destroyer ×3 · Boat ×4` (capsules show the length, so no number is needed).
6. Button row: **Randomize** and **Rotate** (secondary, half width each). Rotate is disabled when no ship is selected, and also when a 1-cell ship is selected.
7. **Ready** (primary, full width, 48). After it is pressed it reads "Waiting for opponent…" (disabled). "Opponent ready" appears in the hint line in `--fg`.

Height check at 390×844: 44 + 40 + 358 + 28 + 48 + 56 + 56 ≈ 630. At 360×740 it is ≈ 600.

**Desktop:** board left. The right column has the label, rules summary, hint, legend (one chip per line here) and buttons.

**Landscape ≤500:** board left, sized to height (§7.3). The right column is the same as desktop.

---

## 6. Battle: turn state
The turn must be obvious at a glance, without being loud. Three things change together, and colours transition over 150 ms.

### 6.1 Turn bar (`.strip`)
- Height 48 desktop, 44 mobile. On mobile portrait it runs full-bleed, edge to edge (negative gutter margin).
- **Your turn:**
  - `--fg` background, `--bg` text.
  - Left: an 8×8 `--signal` square (steady), 8 px gap, then "Your turn" at 18/600. The orange square is the app's "your move" marker, the same as the cell in the logo mark.
  - Right: context in 14/400, coordinates in mono, e.g. "They fired at H10: miss", "Hit. Shoot again.", "Tap again to fire".
- **Their turn:**
  - Transparent background, 1 px `--rule` top and bottom.
  - Left: a 6×6 `--fg` square blinking at 1.2 s (the lobby's waiting motif; steady under reduced motion), then "Their turn" at 18/600 `--muted`.
  - Right: your last result ("You fired at E4: hit") or the prefire state (§8).
- **Timer** (when on): a 3 px bar along the bottom edge inside the turn bar, `--bg` at 60% on your turn and `--muted` on theirs, `--signal` in the last 5 s. Seconds left are shown in mono 14 at the far right (e.g. `12`), before the context text.
- `document.title` becomes "Your turn · Battleship" on your turn, and "Battleship" otherwise. This helps when the tab is in the background.

### 6.2 Whole-board treatment
The board that matters this turn is "live". The other one recedes.

| | Live board | Receded board |
|---|---|---|
| Frame | 2 px `--fg` | 1 px `--rule` |
| Unknown cells | `--water` | `--bg` (the board melts into the page) |
| Coordinate labels | `--fg` | `--muted` at 70% |
| Marks (hits, misses, ships, sonar) | unchanged | unchanged, so everything stays readable |
| Cursor | crosshair on targetable cells | default |

- Your turn: the target board is live and your fleet (or minimap) recedes.
- Their turn: your fleet is live (where their shot lands) and the target board recedes. It stays tappable for prefire.
- Hide the board titles ("THEIR WATERS" and "YOUR FLEET") on mobile portrait, where position and size make them clear. Keep them as `aria-label`. They stay visible on desktop and landscape.

### 6.3 Sound and motion
No new ones. The existing your-turn blip stays. Do not add pulses, glows or animated borders.

---

## 7. Battle: layouts

### 7.1 Mobile portrait (fits one screen at 390×844 and 360×740)
Use `100dvh`. Nothing above the dock may scroll. Top to bottom:

1. **Header**, 44.
2. **Turn bar**, 44, full-bleed.
3. 8 px gap, then the **target board** at full content width. The gutter is 12 px here (not 16), and the row-label column is 16 px. Cell size is `(100vw − 24 − 16) / N` with N = 10, 12 or 14, so the board is always about 350 px whatever the map size:
   - 390 wide: 35 / 29 / 25 px
   - 360 wide: 32 / 26.6 / 22.9 px
4. 8 px gap, then the **dock**:
   - **Items mode only:** the item row (§9.1), 52 px, full width, then 8 px.
   - **Main row**, 120 px tall:
     - Left: the **minimap**, your fleet at 120×120 outer size. It has no coordinate labels, cell = `(120 − (N − 1)) / N`, and the same marks scaled down: ships, hits and the last-shot outline.
     - Right, 12 px gap: the **side panel**. Its contents depend on the mode:
       - Classic and Russian: the fleet tally (below) and the rules summary.
       - Salvo: the fleet tally, then **Fire 3/5** (`#fire`) as a full-width primary button, 48 px, at the bottom of the panel. It is disabled until the selection is full.
       - Items: the energy meter (§9.2), the item hint (2 lines max, 14 px), then a button row with **Rotate** and **Fire** (§9.3).
   - **Fleet tally:** two lines of mono 14, e.g. `Them  4/5 afloat` and `You   5/5 afloat` (Russian: `/10`). Underneath, a text link "Fleet details" scrolls to the lists.
5. **Below the fold:** the full lists, ENEMY SHIPS and YOUR SHIPS. In Russian they are grouped by class (§11). They sit side by side when the width is ≥360, otherwise stacked.

Height check, 390×844 Items mode: 44 + 44 + 8 + 366 + 8 + 52 + 8 + 120 + 12 = 662. That also fits iOS Safari with toolbars showing (about 664 visible). At 360×740 it is about 630. Classic loses the 60 px item row.

### 7.2 Desktop ≥900
- Unchanged structure: turn bar across the top, target board left and own board right (both full size), with the whole-board treatment.
- The Items dock goes under the target board: the energy meter on one line, then the item row, then the hint with **Rotate**, **Fire** and Cancel on one line.
- The fleet lists stay under each board.
- At 12×12 and 14×14, cell = `min(40px, (100vh − 380px) / N)`, so the page still fits 900 high.

### 7.3 Landscape phones (any landscape with height ≤500, including ≥900 wide)
This fixes the TODO item: the media query must not depend on width. Use `(orientation: landscape) and (max-height: 500px)` and nothing else, and cap all content at `100vw`.

- Header 36. Under it, two columns with a 16 px gap and a 12 px outer gutter, centred.
  - **Left: the target board**, sized to height: cell = `(100dvh − 36 − 16 − 14) / N`, capped at 40. At 390 high and 10×10 that is about 32 px.
  - **Right: a panel**, filling the rest, max 520 px. From the top: the turn bar (40, not full-bleed), then for Items the item row (48), then a main row with the minimap at 112×112 and the side panel as in 7.1. The fleet lists come after that and scroll inside the panel (`overflow-y: auto`) if needed. The page itself never scrolls sideways.
- Checks: 844×390, 740×360 (right panel 388 wide, items 77 px each), 932×430, 1000×480.

---

## 8. Prefire (queue during their turn)
- During their turn the target board is receded (6.2) but still accepts taps. Tapping an untargeted cell **queues** it.
- **Queued mark:** a hollow ring, 2 px `--fg` stroke, 56% of the cell, centred. It differs from a miss (small filled dot) and from the last shot (square outline). When more than one cell is queued, the order number goes in the top-left corner in 10 px mono, as sonar does.
- **Cancel:**
  - Tap a queued cell again to remove it.
  - "Clear" is a text link in the turn bar's right side that removes all queued cells.
  - Esc clears too.
- **Turn bar right side during their turn:**
  - Nothing queued: "Tap a square to queue your next shot." Show this only for the first two their-turns of a session, then show the usual last result.
  - Queued: `Next: E4` (mono) followed by `Clear`. With several queued: `Next: E4, F4 · Clear`.
- **How many cells can be queued:**
  - One-shot turns (Classic, Items, Russian): up to 5. One fires each time you get a shot (turn start, and again after a hit when hits shoot again). Leftovers carry over to your next turn. A shot of your own only removes that cell from the queue; using an item clears it.
  - Salvo: up to the current shot count. If one of your ships sinks during their turn, drop the newest cells beyond the new count.
- **At turn start**, the turn bar switches to "Your turn" and the context reads "Firing E4". After 300 ms the queued shot fires as a normal shot, with the normal animation. Salvo auto-fires only if the queue fills the salvo. Otherwise the queued cells become the current selection and the player finishes it.
- Items cannot be queued. Picking an item during their turn does nothing (the item row is disabled then). Queuing a shot means you fire it instead of using an item. That is the player's choice, and it needs no warning.
- Announce through the live region: "Queued E4", "Queue cleared", "Firing queued shot E4".

---

## 9. Items

### 9.1 Item row
- Five buttons in one joined row, styled like the segmented control (1 px `--fg` borders shared, radius 2 on the outer corners). Height 52 mobile and 56 desktop, equal widths.
- Each button: the name 13/600, then the cost as small 6×6 squares in a row (4 px gap).
- Names (short everywhere): **Sonar**, **Torpedo**, **Cross**, **Line**, **Airstrike**.
- States:
  - Affordable: normal.
  - Selected: `--fg` fill, `--bg` text and pips.
  - Unaffordable, or no valid target anywhere: 40% opacity, disabled.
  - Their turn: the whole row is at 40% and disabled, but pip counts stay visible so you can plan.
- Tapping the selected item again deselects it (same as Cancel).

### 9.2 Energy meter
- `ENERGY` label (12 px uppercase), then 6 squares of 12×12 with a 1 px `--fg` border and 3 px gap, then `4/6` in mono 14.
- Filled squares are `--fg`. Empty squares are transparent.
- When an item is selected, the squares it would spend (the rightmost filled ones) switch to `--muted` fill, a preview of what is left.
- On their turn, append `+1 next turn` in 13 px `--muted`. At the cap: `Full`.

### 9.3 Targeting flow (all items)
1. **Pick an item.** The footprint preview appears **immediately**: at the last target cell, or the board centre on the first use. Touch players see what the item does before touching the board. The hint reads, e.g., "Line: 5 cells in a row. Tap to aim."
2. **Aim.** Hover (desktop) or tap (touch) moves the footprint. On touch the first tap aims and does not fire. Footprints are clamped onto the board as today, and they skip island cells (§10).
3. **Rotate** (Torpedo, Line, Airstrike): a secondary button with the existing rotate icon and the current orientation as its label: "Horizontal" or "Vertical" for Line; "↘" or "↙" for Airstrike, with the label "Diagonal ↘"; "From left", "From top", "From right" or "From bottom" for Torpedo. R does the same on keyboards. For Sonar and Cross the button is `visibility: hidden`, so nothing jumps.
4. **Fire.** A primary button **Fire** (or tap the aimed cell again, or click on desktop, or Enter). Fire is disabled until aimed on touch. On desktop, hover counts as aimed.
5. **Cancel:** tap the selected item, press Esc, or use the "Cancel" text link at the end of the hint line.

Footprint look (unchanged, but applied to every item): footprint cells get a 12% `--fg` overlay and a 1 px `--fg` inset border. Cells already fired at inside the footprint get the overlay but no border, so the new cells stand out.

### 9.4 Torpedo, cleaner
Today the whole lane is shaded like an area item, and the direction is hard to read. New look:
- **Lane:** the whole row or column of the aimed cell gets a faint 6% `--fg` overlay with no cell borders.
- **Track:** a 2 px `--fg` line through the cell centres. It starts at the entry edge and runs to the far edge, or to the first island (§10), where it ends in a short 2 px perpendicular bar.
- **Entry arrow:** a solid 8 px `--fg` triangle pointing inward, drawn in the entry cell against the board frame.
- Direction is sticky across taps. It defaults to "From left", and Rotate cycles clockwise: From left → From top → From right → From bottom. Tapping a cell changes the lane and keeps the direction, so a horizontal direction uses the cell's row and a vertical one uses its column.
- **Shortcut:** tapping a row label (1–N) aims "From left" along that row, and tapping a column label (A–…) aims "From top" down that column.
- Result: crossed cells become known water as today, and the hit cell gets the normal hit animation.

### 9.5 Airstrike (new; superseded in round 6 by a 5×5 scatter, see TODO.md "Round 6 notes")
*Rules proposal for logic:* cost 4. It hits 5 cells on a diagonal, ↘ (b = 0) or ↙ (b = 1), with `a` = the top end. All 5 cells must be on the board. Island cells are flown over: no effect, and they are not counted. ANSWER covers the untargeted cells. Diagonals cross ships of either orientation (at most one cell per ship), so Airstrike finds ships where Line finishes them.
- Footprint: the 5 diagonal cells with the standard footprint look.
- Rotate toggles ↘ and ↙. The aimed cell is the centre of the diagonal, clamped so all 5 fit.
- Description string: "Hits 5 cells on a diagonal".

### 9.6 Extra shot in Items mode
When the switch is on and a plain shot hits, the turn bar reads "Hit. Shoot again." and the energy does not change. A hit from an item does **not** give an extra shot. The hint line shows this once, on the first item use: "Items don't earn an extra shot." *(Proposal; logic owner decides. If items do earn one, drop the hint.)*

---

## 10. Map sizes and islands
- Sizes: 10×10 (no islands), 12×12 and 14×14 (islands). The same fleet for each mode. Larger maps are longer, calmer games. *(Proposal: about 8% of cells are land, so 12 cells on 12×12 and 16 on 14×14, in 2–4 islands of 2–7 cells each, kept 1 cell away from the edge, with every remaining water area large enough to fit the fleet. Both players get the same map, from the shared seed.)*
- Column labels continue alphabetically (A–L, A–N).
- **How islands look:** like land on a nautical chart, calm and flat.
  - New token `--land`: light `#E2D8C0` (sand-paper), dark `#2F3530` (dark olive-grey, warmer than water).
  - Draw land in the board's SVG layer as one shape per island: the union of its cells, so there are no internal grid lines, and the gaps between land cells are filled. It has a 1 px `--fg` coastline stroke at 60% opacity.
  - Optional chart detail: a sparse stipple of 1 px `--muted` dots at 6 px spacing inside the land, which costs about 100 bytes as an SVG pattern. Use no hatch (hatch means "sunk") and no colour beyond the token.
  - Land is identical and fully visible on both boards from the start of placement.
- **Interaction:**
  - Land cells are not targetable: default cursor, not focusable in the grid's arrow-key roving, and announced as "D4, land".
  - Area footprints skip land cells, with no overlay.
  - An item is invalid at a target only if no water cell in its footprint would be newly hit.
  - Placement: a ship over land shows the illegal dashed `--signal` ghost and snaps back. Randomize never uses land.
- The minimap shows land in the same way, without the stroke.

## 11. Russian mode
- Fleet: 1×4 Battleship, 2×3 Cruiser, 3×2 Destroyer, 4×1 Boat (10 ships, 20 cells). No touching (corners included) and a hit shoots again, both forced on.
- Lobby: as in §3. The two switches are locked on with their reasons.
- Placement: the compact legend (§5.5). 1-cell ships are dragged like any other, and tapping one only selects it.
- **Fleet lists in battle** are grouped by class: one row per class, with the name (14 px) and then one small capsule per ship (6 px tall, 8 px per cell, 4 px gap).
  - Enemy list: sunk ships are hatched and struck through, and afloat ships are an empty outline. When all ships of a class are sunk, the name goes to `--muted`.
  - Your list: segments fill `--signal` on hit, as today.
  - That is 4 rows instead of 10, about 110 px per list.
- Sunk-ship auto-marking of the 8 neighbours as known water applies (no-touch is on).
- Copy on the end screen is unchanged. The stats grid is unchanged.

## 12. End screen
- Keep: the heading, verdict, **Rematch / Change mode** row, and the stats grid.
- Add **Leave** as a third, text-link action after the buttons. Today it is only in the header.
- Mobile: the revealed boards show the target board at full width, then the minimap-sized own board with the title "YOUR FLEET". This is already close. Islands are drawn on both.
- "Change mode" opens the same Rules block as the lobby (§3, items 4–8), inline under the buttons.

## 13. Notices
No change, apart from the button-row pattern (side by side, half width) wherever there are two buttons.

---

## 14. Acceptance checks (small, targeted Playwright)
1. 390×844 and 360×740, Items battle on 14×14: `.a-target`, the item row, the minimap and `#fire` (or Fire) are all within the viewport with `scrollY = 0`, and there is no sideways overflow (`overflow()` helper).
2. 932×430 and 844×390 landscape: no sideways scroll, and the target board is fully visible.
3. The turn state: `.battle` carries `data-turn="me"|"them"`, the turn bar background differs between the two, and the target board frame is 2 px on "me".
4. Prefire: on "them", tapping a cell shows `.queued`, tapping again removes it, and after the opponent's shot the queued cell is fired.
5. Lobby: Russian locks both switches (checked + disabled), and Salvo disables "Extra shot after a hit".

## 15. Mapping to TODO
- Toggles look better: §1.1, §1.2, §3
- Much clearer when it's your turn: §6
- Mobile battle fits one screen + minimap: §7.1, §7.3 (also fixes the ≥900×≤500 landscape item)
- Torpedo UI cleaner: §9.3, §9.4
- Airstrike: §9.5
- Extra shot in Items: §9.6
- Prefire: §8
- Map size + islands: §10
- Russian mode: §11
- Review every screen: §2–§5, §12, §13
