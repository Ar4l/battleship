import { devices, expect, type Browser, type Page } from '@playwright/test';
import { overflow, player, stubPlatform } from './util';

/** Shared by the touch specs: a phone page, layout checks, and a game set up by taps alone. */
export const phone = async (browser: Browser, name: string) => {
  const p = await player(browser, { ...devices[name], reducedMotion: 'reduce' });
  await stubPlatform(p);
  return p;
};
export const fontSize = (p: Page, sel: string) => p.locator(sel).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
export const fits = async (p: Page, what: string) => expect(await overflow(p), what).toEqual({ scroll: 0, out: [] });

/** Host A and guest B meet over the direct link with taps; checks iOS zoom traps on the way. */
export async function connectByTouch(A: Page, B: Page, mode: 'Classic' | 'Items' = 'Classic', home = './'): Promise<void> {
  await A.goto(home);
  // iOS Safari zooms into any focused input under 16 px and stays zoomed.
  expect(await fontSize(A, '#code')).toBeGreaterThanOrEqual(16);
  await A.locator('#create').tap();
  await expect(A.locator('#room-code')).toHaveText(/^\d{4}$/);
  if (mode !== 'Classic') await A.getByRole('radio', { name: mode }).tap();
  // The escape hatch from matchmaking is a full-size tap target.
  expect((await A.locator('#use-direct').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await A.locator('#use-direct').tap();
  const offer = (await A.locator('#offer-link').textContent())!;
  await B.goto('http://' + offer);
  const code = (await B.locator('#answer-code').textContent({ timeout: 15000 }))!;
  await expect(B.locator('main')).toContainText('Come back to this page');
  await A.locator('#paste').tap();
  await expect(A.locator('#paste')).toBeFocused();
  expect(await fontSize(A, '#paste')).toBeGreaterThanOrEqual(16);
  await A.locator('#paste').fill(code);
  await A.locator('#connect').tap();
  await expect(A.locator('.placement')).toBeVisible({ timeout: 20000 });
  await expect(B.locator('.placement')).toBeVisible({ timeout: 20000 });
}

export async function readyByTouch(A: Page, B: Page): Promise<void> {
  await A.locator('#ready').tap();
  await B.locator('#ready').tap();
  await expect(A.locator('.battle')).toBeVisible();
  await expect(B.locator('.battle')).toBeVisible();
}

