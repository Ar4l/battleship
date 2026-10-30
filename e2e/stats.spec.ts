import { expect, test, type Page } from '@playwright/test';
import { connectDirect, player, playOut, readyBoth } from './util';

const series = (p: Page) => p.locator('.end-head .mono');

test('stats: both sides show the series score after a game and a rematch; Stats sums it up', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  for (const [p, name] of [[A, 'Ann'], [B, 'Bob']] as const) {
    await p.goto('./');
    await p.fill('#name', name);
  }
  await connectDirect(A, B);
  await readyBoth(A, B);
  await playOut(A, B, A);
  await expect(series(A)).toHaveText('You 1 – 0 Bob');
  await expect(series(B)).toHaveText('You 0 – 1 Ann');

  await A.click('#rematch');
  await B.click('#rematch');
  // The header keeps the score through the rematch.
  await expect(A.locator('.meta')).toHaveText(/^You 1 – 0 Bob · One shot/);
  await readyBoth(A, B);
  await expect(B.locator('.meta')).toHaveText(/^You 0 – 1 Ann · /);
  await playOut(A, B, B);
  await expect(series(A)).toHaveText('You 1 – 1 Bob');
  await expect(series(B)).toHaveText('You 1 – 1 Ann');

  await A.click('#leave');
  await A.getByRole('button', { name: 'Stats' }).click();
  const totals = A.locator('#totals');
  await expect(totals.locator('div').filter({ hasText: 'Games' }).locator('dd')).toHaveText('2');
  await expect(totals.locator('div').filter({ hasText: 'Win rate' }).locator('dd')).toHaveText('50%');
  await expect(A.locator('#h2h tbody tr')).toHaveText(['Bob1–1–0Today']);
  // Reset asks first.
  await A.click('#reset');
  await A.click('#reset-yes');
  await expect(A.locator('#h2h')).toHaveCount(0);
  await expect(totals.locator('dd').first()).toHaveText('0');
  await A.click('#stats-back');
  await expect(A.locator('#name')).toHaveValue('Ann');
});
