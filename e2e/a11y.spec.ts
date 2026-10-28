import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { connectDirect, player, playOut, readyBoth, waitTurn } from './util';

async function axe(p: Page, where: string): Promise<void> {
  const r = await new AxeBuilder({ page: p }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const)
  test(`axe: no serious violations on every screen (${colorScheme})`, async ({ browser }) => {
    const A = await player(browser, { colorScheme, reducedMotion: 'reduce' });
    const B = await player(browser, { colorScheme, reducedMotion: 'reduce' });
    await A.goto('./');
    await axe(A, 'home');
    await A.click('#create');
    await axe(A, 'lobby');
    await A.goto('./');
    await connectDirect(A, B, 'Items');
    await axe(A, 'placement');
    await readyBoth(A, B);
    await axe(A, 'battle');
    await playOut(A, B, A);
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await axe(A, 'end');
  });

test('keyboard: place a ship and take a turn without a mouse', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  await connectDirect(A, B);
  // Pick up the Destroyer with Enter, move it, drop it.
  const before = await A.evaluate(() => (window as any).__bs.myFleet()[4]);
  await A.locator('.dock-ship[data-ship="4"]').focus();
  await A.keyboard.press('Enter');
  // Find a legal move: try each direction until the anchor changes.
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    await A.keyboard.press(k);
    await A.keyboard.press('Enter');
    const now = await A.evaluate(() => (window as any).__bs.myFleet()[4]);
    if (now.anchor !== before.anchor) break;
    await A.keyboard.press('Escape');
    await A.keyboard.press('Enter');
  }
  const after = await A.evaluate(() => (window as any).__bs.myFleet()[4]);
  expect(after.anchor).not.toBe(before.anchor);
  await readyBoth(A, B);
  let p = await waitTurn(A, B);
  if (p === B) {
    await B.locator('.a-target .cell[data-i="0"]').click();
    p = await waitTurn(A, B);
  }
  await A.locator('.a-target .cell[data-i="0"]').focus();
  await A.keyboard.press('ArrowRight');
  await A.keyboard.press('ArrowDown');
  await A.keyboard.press('Enter');
  await expect.poll(() => A.evaluate(() => [...(window as any).__bs.state().match.target.shot])).toContain(11);
});
