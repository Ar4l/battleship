import { expect, test, type Page } from '@playwright/test';
import { connectDirect, overflow, player, readyBoth, targetCell, waitTurn } from './util';

/** Every element is inside the viewport with the page unscrolled. */
const onScreen = (p: Page, sel: string) =>
  p.locator(sel).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return scrollY === 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5;
  });

test('a 14×14 Items battle fits one phone screen, portrait and landscape; land is drawn', async ({ browser }) => {
  test.setTimeout(90_000);
  const A = await player(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const B = await player(browser);
  await connectDirect(A, B, 'Items', ['14×14']);
  const islands: number = await A.evaluate(() => (window as any).__bs.ctrl.geo.islands.size);
  expect(islands).toBeGreaterThan(0);
  await expect(A.locator('.placing .cell.land')).toHaveCount(islands);
  await readyBoth(A, B);
  await expect(A.locator('.a-target .cell.land')).toHaveCount(islands);
  await expect(A.locator('.a-own .cell.land')).toHaveCount(islands);
  if ((await waitTurn(A, B)) === B) await targetCell(B, 14 * 14 - 1).click();
  await waitTurn(A, B);
  await expect(A.locator('.battle')).toHaveAttribute('data-turn', 'me');
  await A.evaluate(() => ((window as any).__bs.state().match.energy.me = 6));
  await A.getByRole('button', { name: /^Torpedo/ }).tap();
  await A.locator('#item-dir').tap();
  const shot = (name: string) => !process.env.CI && A.screenshot({ path: `screenshots/12-battle-islands-${name}.png` });
  await shot('mobile');
  for (const [width, height] of [[390, 844], [360, 740]] as const) {
    await A.setViewportSize({ width, height });
    expect(await overflow(A)).toEqual({ scroll: 0, out: [] });
    for (const sel of ['.a-target', '.a-items', '.a-own', '#item-fire']) expect(await onScreen(A, sel), `${sel} at ${width}×${height}`).toBe(true);
  }
  for (const [width, height] of [[844, 390], [932, 430], [740, 360]] as const) {
    await A.setViewportSize({ width, height });
    expect(await overflow(A), `${width}×${height}`).toEqual({ scroll: 0, out: [] });
    expect(await onScreen(A, '.a-target'), `board at ${width}×${height}`).toBe(true);
    if (width === 844) await shot('landscape');
  }
});

test('prefire: queue on their turn, tap again to remove, the queued shot fires when the turn comes', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  await connectDirect(A, B);
  await readyBoth(A, B);
  // A waits for B's shot.
  if ((await waitTurn(A, B)) === A) await targetCell(A, 99).click();
  await expect(A.locator('.battle')).toHaveAttribute('data-turn', 'them');
  await targetCell(A, 44).click();
  await expect(targetCell(A, 44)).toHaveClass(/queued/);
  await targetCell(A, 44).click();
  await expect(A.locator('.a-target .cell.queued')).toHaveCount(0);
  await targetCell(A, 45).click();
  await expect(A.locator('.strip-sub')).toHaveText('Next: F5');
  await expect(A.locator('#clear-queue')).toBeVisible();
  await expect(A.locator('.battle')).toHaveAttribute('data-turn', 'them');
  await targetCell(B, 98).click();
  await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.target.shot.has(45))).toBe(true);
});

test('lobby: Russian locks both switches and the map; Salvo disables extra shot and items', async ({ browser }) => {
  const A = await player(browser);
  await A.goto('./');
  await A.click('#create');
  const extra = A.getByRole('switch', { name: 'Extra shot after a hit' });
  const touch = A.getByRole('switch', { name: "Ships can't touch" });
  await A.getByRole('radio', { name: 'Russian' }).click();
  for (const s of [extra, touch]) {
    await expect(s).toBeChecked();
    await expect(s).toBeDisabled();
  }
  await expect(A.getByRole('radio', { name: '12×12' })).toBeDisabled();
  const items = A.getByRole('switch', { name: 'Items' });
  await expect(items).toBeEnabled();
  await A.getByRole('radio', { name: 'Salvo', exact: true }).click();
  for (const s of [extra, items]) {
    await expect(s).toBeDisabled();
    await expect(s).not.toBeChecked();
  }
  await expect(A.locator('.settings')).toContainText('One-shot turns only');
  await expect(touch).toBeDisabled(); // still Russian
  await A.getByRole('radio', { name: 'Standard' }).click();
  await expect(touch).toBeEnabled();
  await expect(touch).not.toBeChecked(); // implied by Russian, never picked
  await expect(A.getByRole('radio', { name: '12×12' })).toBeEnabled();
  await A.getByRole('radio', { name: 'One shot' }).click();
  await expect(extra).not.toBeChecked();
});
