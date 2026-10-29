import { expect, test, type Page } from '@playwright/test';
import { connectByTouch, fits, phone, readyByTouch } from './touch';
import { bs, fleetCells, playOut, setHidden, targetCell, waitTurn, type Fleet } from './util';

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

/** One-finger drag through CDP touch events (Chromium). */
async function touchDrag(p: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await p.context().newCDPSession(p);
  const at = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

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
  // touch-action is not inherited: the grid sets it for water, ship cells override it.
  const ta = (sel: string) => A.locator(sel).evaluate((e) => getComputedStyle(e).touchAction);
  expect(await ta('.placing .cells')).toBe('manipulation');
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
  // Chrome swallows a tap that lands right after a fast synthetic drag (seen as a fling).
  await A.waitForTimeout(1000);
  await A.locator('#ready').tap();
  await expect(A.locator('#ready')).toHaveText('Waiting for opponent…');
  await B.locator('#ready').tap();
  await expect(A.locator('.battle')).toBeVisible();
  await fits(A, 'battle');

  // Torpedo: the armed hint still says which way it runs, and Direction changes it.
  await aOnTurnWithEnergy(A, B);
  await A.getByRole('button', { name: /^Torpedo/ }).tap();
  await targetCell(A, 45).tap();
  const hint = A.locator('.item-hint > span');
  await expect(hint).toContainText('Tap again to fire, from left.');
  await A.locator('#item-dir').tap();
  await expect(hint).toContainText('Tap again to fire, from right.');
  expect(await A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('myTurn');
  await targetCell(A, 45).tap();
  await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('theirTurn');

  // Long results wrap instead of being cut off, and nothing scrolls sideways.
  for (const p of [A, B]) {
    await p.evaluate(() => {
      const c = (window as any).__bs.ctrl;
      c.lastResult = 'You sank their Carrier. You sank their Cruiser';
      c.emit();
    });
    expect(await p.locator('.strip-sub').evaluate((e) => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await fits(p, 'battle with a long result');
  }

  // A dropped link says so instead of showing a silent board.
  await expect(A.locator('#lost')).toBeHidden();
  await A.evaluate(() => (window as any).__bs.ctrl.t.onstate(false));
  await expect(A.locator('#lost')).toBeVisible();
  await A.evaluate(() => (window as any).__bs.ctrl.t.onstate(true));
  await expect(A.locator('#lost')).toBeHidden();

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
    await p.evaluate(() => {
      const c = (window as any).__bs.ctrl;
      c.lastResult = 'You sank their Carrier. You sank their Cruiser';
      c.emit();
    });
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
  await expect(A.locator('#notice')).toContainText('Connection lost while Battleship was in the background', { timeout: 6000 });
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
