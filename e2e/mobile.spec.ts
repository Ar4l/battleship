import { chromium, devices, expect, test, type Page } from '@playwright/test';
import { connectByTouch, fits, phone, readyByTouch } from './touch';
import { bs, fleetCells, frozen, playOut, player, setHidden, stubPlatform, targetCell, waitTurn, type Fleet } from './util';

// Phones in Chromium's mobile emulation (isMobile + hasTouch), driven by touch taps only.
// e2e/webkit.spec.ts covers the Safari engine.

/** A on turn (B fires a miss first if needed), with energy for any item. */
async function aOnTurnWithEnergy(A: Page, B: Page): Promise<void> {
  if ((await waitTurn(A, B)) === B) {
    await targetCell(B, 99).tap();
    await waitTurn(A, B);
  }
  await A.evaluate(() => ((window as any).__bs.state().match.energy.me = 6));
  await B.evaluate(() => ((window as any).__bs.state().match.energy.them = 6));
  await A.evaluate(() => (window as any).__bs.ctrl.emit());
}

/** One-finger drag through CDP touch events (Chromium); `to` omitted: a press held for `holdMs`. */
async function touchDrag(p: Page, from: { x: number; y: number }, to?: { x: number; y: number }, holdMs = 0): Promise<void> {
  const cdp = await p.context().newCDPSession(p);
  const at = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
  if (holdMs) await p.waitForTimeout(holdMs);
  for (let i = 1; to && i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const LONG = "Time's up. You sank their Carrier and Cruiser";

const center = async (p: Page, sel: string) => {
  const b = (await p.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('phones: an Items game by touch alone (iPhone 13 hosts, Pixel 7 joins)', async ({ browser }) => {
  test.setTimeout(120_000);
  const A = await phone(browser, 'iPhone 13');
  const B = await phone(browser, 'Pixel 7');
  await connectByTouch(A, B, 'Items');

  // Sound: started from a gesture iOS accepts (not touchstart or pointerdown).
  const audio = () => A.evaluate(() => (window as any).__ac && { ran: (window as any).__ac.ran, state: (window as any).__ac.state });
  expect(await audio()).toMatchObject({ ran: true });
  // iOS interrupts audio on an app switch or a call; the next tap brings it back.
  await A.evaluate(() => (window as any).__ac.to('interrupted'));
  await A.locator('.dock-ship').first().tap();
  expect((await audio())!.state).toBe('running');
  // The screen stays on while a game is open.
  expect(await A.evaluate(() => (window as any).__wl)).toEqual(['request']);

  // Placement: ship cells take a drag, water lets the page scroll and pinch.
  const fleet = await bs<Fleet>(A, 'myFleet');
  const shipCell = fleet[4]!.anchor;
  const water = [...Array(100).keys()].find((c) => !fleetCells(fleet).includes(c))!;
  // No double-tap zoom anywhere (set on the root, it applies to all of the page); ship
  // cells also stop panning so a drag moves the ship.
  const ta = (sel: string) => A.locator(sel).evaluate((e) => getComputedStyle(e).touchAction);
  expect(await ta('html')).toBe('manipulation');
  expect(await ta(`.placing .cell[data-i="${shipCell}"]`)).toBe('none');
  expect(await ta(`.placing .cell[data-i="${water}"]`)).toBe('auto');
  await fits(A, 'placement');
  // Drag the Destroyer somewhere legal: the page must not scroll, the ship must move.
  await bs(A, 'setFleet', [
    { anchor: 0, vertical: false },
    { anchor: 20, vertical: false },
    { anchor: 40, vertical: false },
    { anchor: 60, vertical: false },
    { anchor: 80, vertical: false },
  ]);
  const y0 = await A.evaluate(() => scrollY);
  await touchDrag(A, await center(A, '.placing .cell[data-i="80"]'), await center(A, '.placing .cell[data-i="87"]'));
  expect((await bs<{ anchor: number }[]>(A, 'myFleet'))[4]!.anchor).toBe(87);
  expect(await A.evaluate(() => scrollY)).toBe(y0);
  // A press held in place (picking the ship up, then letting go) does not rotate it; a tap does.
  await A.waitForTimeout(300);
  await touchDrag(A, await center(A, '.placing .cell[data-i="87"]'), undefined, 800);
  expect((await bs<{ vertical: boolean }[]>(A, 'myFleet'))[4]!.vertical).toBe(false);
  await A.waitForTimeout(300);
  await A.locator('.placing .cell[data-i="87"]').tap();
  expect((await bs<{ vertical: boolean }[]>(A, 'myFleet'))[4]!.vertical).toBe(true);
  // Chrome swallows a tap that lands right after a fast synthetic drag (seen as a fling).
  await A.waitForTimeout(1000);
  await A.locator('#ready').tap();
  await expect(A.locator('#ready')).toHaveText('Waiting for opponent…');
  await B.locator('#ready').tap();
  await expect(A.locator('.battle')).toBeVisible();
  await fits(A, 'battle');

  // Torpedo: the footprint shows as soon as an item is picked; a tap aims, a second tap fires.
  await aOnTurnWithEnergy(A, B);
  await A.getByRole('button', { name: /^Cross bomb/ }).tap();
  await expect(A.locator('.a-target .cell.pv')).not.toHaveCount(0);
  await expect(A.locator('#item-dir')).toBeHidden();
  await A.getByRole('button', { name: /^Torpedo/ }).tap();
  await expect(A.locator('.a-target .cell.lane')).not.toHaveCount(0);
  await expect(A.locator('#item-fire')).toBeDisabled();
  await targetCell(A, 45).tap();
  await expect(A.locator('.a-target .cell.lane')).toHaveCount(10);
  await expect(A.locator('.a-target .ov .arrow')).toHaveCount(1);
  await expect(A.locator('.item-hint > span')).toContainText('Tap again to fire.');
  await expect(A.locator('.strip-sub')).toHaveText('Tap again to fire, from left');
  await expect(A.locator('#item-dir')).toHaveText('From left');
  await A.locator('#item-dir').tap();
  await expect(A.locator('#item-dir')).toHaveText('From top');
  await expect(A.locator('.strip-sub')).toHaveText('Tap again to fire, from top');
  expect(await A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('myTurn');
  await A.locator('#item-fire').tap();
  await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('theirTurn');

  // Long results wrap instead of being cut off, and nothing scrolls sideways.
  for (const p of [A, B]) {
    await p.evaluate((t) => {
      const c = (window as any).__bs.ctrl;
      c.lastResult = t;
      c.emit();
    }, LONG);
    expect(await p.locator('.strip-sub').evaluate((e) => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await fits(p, 'battle with a long result');
  }

  // A dropped link says so instead of showing a silent board, without moving the board
  // under a finger: the notice takes the brand's place in the header, on one line.
  for (const width of [390, 360]) {
    await A.setViewportSize({ width, height: 664 });
    await expect(A.locator('#lost')).toBeHidden();
    const board = await A.locator('.a-target').boundingBox();
    const strip = await A.locator('#strip').boundingBox();
    await A.evaluate(() => (window as any).__bs.ctrl.t.onstate(false));
    await expect(A.locator('#lost')).toBeVisible();
    await expect(A.locator('#lost')).toHaveText('Connection lost. Waiting…');
    expect((await A.locator('#lost').boundingBox())!.height).toBeLessThanOrEqual(24);
    expect(await A.locator('.a-target').boundingBox()).toEqual(board);
    expect(await A.locator('#strip').boundingBox()).toEqual(strip);
    await expect(A.locator('#leave')).toBeVisible();
    await fits(A, `battle, link lost, ${width} px`);
    await A.evaluate(() => (window as any).__bs.ctrl.t.onstate(true));
    await expect(A.locator('#lost')).toBeHidden();
  }
  await A.setViewportSize(devices['iPhone 13'].viewport);

  await playOut(A, B, A, 'classic', true);
  await expect(A.locator('#verdict')).toHaveText('Fleet verified');
  await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  await fits(A, 'end');
  await B.locator('#leave').tap();
  await expect(A.locator('#rematch-note')).toHaveText('Opponent left.');
  // The opponent is gone: let the screen sleep again.
  await expect.poll(() => A.evaluate(() => (window as any).__wl)).toEqual(['request', 'release']);
});

test('landscape phones: placement and battle fit without sideways scrolling', async ({ browser }) => {
  test.setTimeout(120_000);
  const A = await phone(browser, 'iPhone 13 landscape');
  const B = await phone(browser, 'Pixel 7 landscape');
  await connectByTouch(A, B, 'Items');
  for (const p of [A, B]) {
    await fits(p, 'placement');
    // Side by side: Ready is on screen without scrolling.
    const r = (await p.locator('#ready').boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual(p.viewportSize()!.height);
  }
  await readyByTouch(A, B);
  await aOnTurnWithEnergy(A, B);
  for (const p of [A, B]) {
    await p.evaluate((t) => {
      const c = (window as any).__bs.ctrl;
      c.lastResult = t;
      c.emit();
    }, LONG);
    await fits(p, 'battle');
    expect(await p.evaluate(() => innerHeight)).toBe(p.viewportSize()!.height);
  }
  await playOut(A, B, B, 'classic', true);
  await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  await fits(A, 'end');
});

test('back from a long app switch with a dead link: an honest notice, not a forfeit win', async ({ browser }) => {
  test.setTimeout(60_000);
  const A = await phone(browser, 'Pixel 7');
  const B = await phone(browser, 'iPhone 13');
  await connectByTouch(A, B);
  await readyByTouch(A, B);
  // The browser drops the wake lock while hidden; it is taken again on return.
  await setHidden(A, true);
  expect(await A.evaluate(() => (window as any).__wl)).toEqual(['request', 'release']);
  // A short switch: the game goes on, no questions asked.
  await setHidden(A, false);
  expect(await A.evaluate(() => (window as any).__wl)).toEqual(['request', 'release', 'request']);
  // B stops hearing anything (its side of the link is gone), and A is away for 10 s.
  await B.evaluate(() => ((window as any).__bs.ctrl.t.onmessage = null));
  await setHidden(A, true);
  await A.waitForTimeout(10_200);
  await setHidden(A, false);
  await expect(A.locator('#notice')).toContainText('Connection lost while Battleship was in the background', { timeout: 10000 });
  await expect(A.locator('#notice')).not.toContainText('forfeit');
  // Here the link was still up, so B hears the close: for B the opponent left.
  await expect(B.locator('#notice')).toContainText('Your opponent left');
});

test('home code field: pasted codes with spaces or a label still work, Backspace edits the end', async ({ browser }) => {
  const A = await phone(browser, 'Pixel 7');
  await A.goto('./');
  for (const [paste, want] of [
    [' 98', '98'],
    ['9 8 7', '987'],
    ['Code: 98', '98'],
  ] as const) {
    await A.locator('#code').fill(paste);
    await expect(A.locator('#code')).toHaveValue(want);
  }
  await A.locator('#code').fill('987');
  await A.locator('#code').tap({ position: { x: 10, y: 28 } });
  // The caret goes to the end even when an earlier box is tapped.
  expect(await A.locator('#code').evaluate((e: HTMLInputElement) => e.selectionStart)).toBe(3);
});

test('an opponent frozen for 20 s (iOS suspends the page) keeps the game; a shot fired meanwhile lands when they return', async ({ browser }) => {
  test.skip(process.platform !== 'linux', 'freezes a browser with SIGSTOP');
  test.setTimeout(120_000);
  // B runs in its own browser so its processes can be stopped without touching A.
  const server = await chromium.launchServer({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    const A = await phone(browser, 'Pixel 7');
    const B = await phone(await chromium.connect(server.wsEndpoint()), 'iPhone 13');
    await connectByTouch(A, B);
    await readyByTouch(A, B);
    if ((await waitTurn(A, B)) === B) {
      await targetCell(B, 99).tap();
      await waitTurn(A, B);
    }
    const board = await A.locator('.a-target').boundingBox();
    await setHidden(B, true);
    // Chromium reports 'disconnected' after about 5 s and 'failed' at about 16 s;
    // the game used to end at 'failed'.
    await frozen(server, async () => {
      await expect(A.locator('#lost')).toBeVisible({ timeout: 12000 });
      expect(await A.locator('.a-target').boundingBox()).toEqual(board);
      await targetCell(A, 0).tap();
      await A.waitForTimeout(20_000 - 6000);
      await expect(A.locator('.battle')).toBeVisible({ timeout: 100 });
      expect(await A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('awaitingAnswer');
    });
    await setHidden(B, false);
    // The shot is delivered and answered, the link is back, and B (away 20 s) gets its ping answered.
    await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase), { timeout: 10000 }).toBe('theirTurn');
    await expect(A.locator('#lost')).toBeHidden();
    await B.waitForTimeout(7000);
    await expect(B.locator('.battle')).toBeVisible();
    await targetCell(B, 98).tap();
    await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('myTurn');
  } finally {
    await server.close();
  }
});

test('host lobby: "can\'t reach the matchmaking network" clears once a tracker is back', async ({ browser }) => {
  const A = await phone(browser, 'Pixel 7');
  // Fake trackers: first every socket dies at once, then they stay open (and silent).
  let up = false;
  await A.routeWebSocket(/^wss:/, (ws) => void (up || ws.close()));
  await A.goto('./');
  await A.locator('#create').tap();
  await expect(A.locator('main')).toContainText("Can't reach the matchmaking network", { timeout: 10000 });
  up = true;
  await expect(A.locator('main')).not.toContainText("Can't reach the matchmaking network", { timeout: 30000 });
  await expect(A.locator('#use-direct')).toHaveText('Use a direct link');
});

test('stale screens: a new game link still joins; in-app browsers get a hint; the screen sleeps after 5 idle minutes', async ({ browser }) => {
  const A = await phone(browser, 'Pixel 7');
  await A.routeWebSocket(/^wss:/, () => {});
  await A.clock.install();
  // A tab left on a notice (Android reuses it for the next link from the same app).
  await A.goto('./#o=nonsense');
  await expect(A.locator('#notice')).toBeVisible();
  await A.evaluate(() => (location.hash = '#5678'));
  await expect(A.locator('main')).toContainText('Joining game 5678');
  await A.locator('main').getByRole('button', { name: 'Cancel' }).tap();
  await A.evaluate(() => ((window as any).__wl.length = 0));

  await A.locator('#create').tap();
  await expect(A.locator('#room-code')).toHaveText(/^\d{4}$/);
  await expect(A.locator('#in-app')).toHaveCount(0);
  expect(await A.evaluate(() => (window as any).__wl)).toEqual(['request']);
  // A host whose friend never shows up: the screen may sleep after 5 minutes, and a tap wakes it.
  await A.clock.fastForward('04:50');
  expect(await A.evaluate(() => (window as any).__wl)).toEqual(['request']);
  await A.clock.fastForward('00:20');
  await expect.poll(() => A.evaluate(() => (window as any).__wl)).toEqual(['request', 'release']);
  await A.locator('#room-code').tap();
  await expect.poll(() => A.evaluate(() => (window as any).__wl)).toEqual(['request', 'release', 'request']);

  // Instagram's in-app browser closes the page when its user goes back to the chat.
  const ig = await player(browser, { ...devices['iPhone 13'], userAgent: devices['iPhone 13'].userAgent + ' Instagram 300.0.0.0' });
  await stubPlatform(ig);
  await ig.routeWebSocket(/^wss:/, () => {});
  await ig.goto('./');
  await ig.locator('#create').tap();
  await expect(ig.locator('#in-app')).toContainText('Open this page in Safari or Chrome');
});
