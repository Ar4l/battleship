# TODO

Tick items (`[x]`) when done and verified. Owner in brackets.

## Carried over
- [x] Guest switching apps mid-join gets a false "Couldn't connect" (half-done in `src/net/room.ts`) [logic]
- [x] Large phones in landscape (≥900×≤500) get the desktop layout and scroll sideways [ui]

## Gameplay
- [x] Cross bomb can't be aimed at an already-hit square — allow it (skip already-revealed cells; block only if nothing new would be hit) [logic]
- [x] Add Airstrike item [logic + ui] — item 4, cost 4, 5 cells on a diagonal; Rotate toggles ↘/↙
- [x] "Extra shot after a hit" also available in Items mode [logic + ui]
- [x] Prefire: queue your next shot(s) during the opponent's turn; fires when your turn starts [logic + ui]
- [x] Map size choice; larger maps get islands (no ships on them, torpedoes stop at them) [logic + ui]
- [x] Russian mode ("Морской бой"): 1×4, 2×3, 3×2, 4×1 ships, no touching, hit = shoot again (check other games for variants) [logic + ui]

## UI / UX
- [x] Torpedo UI cleaner [ui]
- [x] Toggles look better [ui]
- [x] Much clearer when it's your turn [ui]
- [x] Mobile battle fits one screen; scrolling only for extra details; minimap of your own fleet [ui]
- [x] Review every screen: clearer, simpler layout and selection; keep the design language [design → ui]
- [x] Item bar labels fit on narrow phones (11.5px below 380px, no side padding, clipped as a last resort) [ui]
- [x] Russian placement legend: one non-wrapping group per class, name and ×n first, then its capsules [ui]

## Round 5: orthogonal rules
- [ ] Replace Mode with independent settings: Fleet (Standard / Russian), Turns (One shot / Salvo / Salvo simultaneous), Items (Off / On, one-shot turns only) [logic + ui]
- [ ] Russian + Salvo works (Russian drops "hit shoots again" under Salvo); Salvo shots = ships left, capped at 5 [logic]
- [ ] Simultaneous Salvo: both pick shots at once, resolve when both sent; draw if both fleets sink in the same round; prefire hidden in this mode [logic + ui]

## UI notes (round 4)

Where the UI differs from UX-SPEC.md, mostly to stay under 44 KB:
- The host's rules are not saved in `localStorage` (§3, a proposal). There is no "Fleet details" link under the tally, because the lists are one short scroll below.
- The prefire tip ("Tap a square to queue your next shot.") goes in the side panel, not the turn bar, so the bar keeps showing the last result. In Items mode it replaces the item hint for the whole of their turn.
- The Map control also offers 8×8 (logic's Small size).
- Board titles are hidden in landscape as well as portrait, because the board is sized to the full height.
- There is no live-region message for "Firing queued shot E4". "Queued E4", "Removed E4" and "Queue cleared" are announced.
- Labels on a receded board are not dimmed to 70%, because axe flags the contrast.
- No stipple pattern on land.

## Logic API for UI

Protocol is now version 3 (CONFIG is 7 bytes, ships are 2 bytes). Full rules are in PLAN.md §5–7.1.

**Config** (`game/types.ts`): `{ mode: 0 classic | 1 salvo | 2 items | 3 russian, extraShot, noTouch, timer, size: 0 small 8×8 | 1 classic 10×10 | 2 large 12×12 | 3 huge 14×14, seed }`.
- Use `ctrl.setConfig({ size })`, `ctrl.setConfig({ mode: 3 })`, and so on. The controller normalises through `normConfig`: Russian forces `size 1`, `noTouch` and `extraShot`; Salvo forces `extraShot` off. Extra shot is valid in Classic and Items.
- The host rolls `seed` itself for every game. The UI never sets it.
- `rules`: `MODE_NAMES` (now includes 'Russian'), `SIZES` = [8, 10, 12, 14], `SIZE_NAMES` = ['Small', 'Classic', 'Large', 'Huge'], `rulesLine(config)` (now names the size, e.g. "Large 12×12").

**Geometry** (`Geo`, from `geoOf(config)`; memoised, so it is safe to call every render):
- `n` is the side length. A cell is `row * n + col`.
- `fleet` holds the ship lengths in fleet order, and `names` the ship names. Russian has duplicate names ("Cruiser" ×2, …).
- `islands: Set<Cell>`, `total` (ship cells), `noTouch`.
- During placement use `ctrl.geo`, which comes from the current config. During a battle or at the end use `match.geo`, which holds that game's rules.
- `match.target.shot` and `match.own.shot` include the islands from the start, so check `geo.islands.has(c)` first to draw them as land.
- `match.target.known` now also includes the diagonal neighbours of hits when ships can't touch.

**Changed signatures** (every function now takes the geo first):
- `shipCells(g, ship, i)`, `occupancy(g, fleet)`, `fleetLegal(g, fleet)`, `canPlace(g, fleet, i, ship)`, `neighbours8(c, n)`, `row(c, n)`, `randomFleet(g, rng)`.
- `itemParamsValid(g, item, a, b)`, `footprint(g, item, a, b)`, `torpedoLine(g, a, b)`, `clampSonar(g, cell)`, `clampLine(g, cell, vertical)`.
- `cellName(c, n = 10)`, `parseCell(s, n = 10)`, `untargeted(match, board = match.target)`.
- UI helpers I changed minimally to compile: `grid.capsule(ship, len, cls)`, `grid.sunk(ship, len, anim)`, `grid.cellsOf(g, ship, i)`, `battle.model(g, board, opts)`.
- `grid.ts` itself (cells, keyboard nav, `cellAt`, SVG viewBox) is still hard-coded to 10×10. That is enough for Classic, Salvo, Items and Russian, but Small, Large and Huge need it to use `g.n`.

**Airstrike** (`items.AIRSTRIKE = 4`, cost 4, "Hits 5 cells on a diagonal"):
- `a` is the centre cell, with row and column in 2..n-3. `b` is 0 for `\` and 1 for `/`.
- `clampAirstrike(g, cell)` gives a valid centre. `battle.ts` already builds it: R rotates it, and the direction labels are "falling" and "rising".
- `ITEMS` now has 5 entries, and the ids equal the indexes.
- Area items (Cross, Line, Airstrike) may be aimed at already-hit cells. They are legal unless every footprint cell is already resolved.

**Extra shot in Items mode:** any hit by a shot, a torpedo or an area item gives another turn. Sonar never does. An extra turn adds no energy.

**Prefire** (purely local, `Controller`; follows UX-SPEC §8):
- `ctrl.queue: number[]` holds the queued cells, in order.
- `ctrl.prefireMax(match)` gives how many cells can be queued: Salvo `shotsAllowed`, otherwise 3 with extra shot on (Russian included), else 1.
- `ctrl.prefire(cell)` toggles a cell. It only works in phase `'theirTurn'`, and ignores cells that are already shot or are islands. When the queue is full a new pick is ignored, except that a 1-cell queue swaps.
- `ctrl.clearPrefire()` empties the queue.
- When my turn starts, cells already fired at and shots I no longer have are dropped. 300 ms later the queue fires: the whole salvo, or `queue[0]` alone (the next one fires after a hit). So "Firing E4" is `phase === 'myTurn' && queue.length`. A Salvo queue that is too short becomes `ctrl.sel` at once.
- Leftovers are dropped when my turn passes. Any move of my own (`ctrl.attack`, `fireSalvo`, the timer) cancels the queue.
- UI to do: on their turn, route target-board taps to `ctrl.prefire`, show the queued cells and a Clear link, and make Esc clear the queue.

**Where this differs from UX-SPEC proposals** (the logic owner's call; none of it changes the UI):
- Airstrike `a` is the diagonal's *centre*, not its top end, so hovering aims it the same way the Cross does. Use `clampAirstrike`. `b` is 0 for ↘ and 1 for ↙, as the spec says.
- Sizes: `SIZES` also has Small 8×8 (size 0). Leave it out of the MAP control if you only want 10/12/14.
- The fleet grows with the board, as TODO asked: 12×12 has 7 ships and 22 cells, 14×14 has 8 ships and 26 cells (PLAN.md §7.1). The ship names come from `geo.names`.
- Islands: 3 islands on 12×12 and 5 on 14×14, each 2–4 cells (about 6–8% land), kept 1 cell from the edge and 2 cells apart.
