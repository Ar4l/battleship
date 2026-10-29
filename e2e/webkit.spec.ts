import { chromium, expect, test, type Page } from '@playwright/test';
import { connectByTouch, fits, fontSize, phone, readyByTouch } from './touch';
import { playOut } from './util';

// Safari's engine (Playwright WebKit with iPhone descriptors). Runs only in the `webkit`
// project (WEBKIT=1, see playwright.config.ts). Two WebKit pages can't reach each other
// over WebRTC here (their host candidates are mDNS names), so the WebKit-only tests use
// one page, and the full game pairs a Chromium host with a WebKit guest.

const HOME = 'http://localhost:4174/battleship/';
const sizes = [
  { width: 390, height: 664 },
  { width: 750, height: 342 },
];

async function eachSize(p: Page, what: string): Promise<void> {
  for (const s of sizes) {
    await p.setViewportSize(s);
    await fits(p, `${what} ${s.width}x${s.height}`);
  }
  await p.setViewportSize(sizes[0]!);
}

test('WebKit iPhone: no zoom traps, sound starts on a tap, layouts fit', async ({ browser }) => {
  const A = await phone(browser, 'iPhone 13');
  await A.goto('./');
  expect(await fontSize(A, '#code')).toBeGreaterThanOrEqual(16);
  await eachSize(A, 'home');
  await A.locator('#create').tap();
  await expect(A.locator('#room-code')).toHaveText(/^\d{4}$/);
  // WebKit's real tap event order: the AudioContext must be resumed in an event iOS accepts.
  expect(await A.evaluate(() => (window as any).__ac?.ran)).toBe(true);
  expect(await A.evaluate(() => (window as any).__wl)).toEqual(['request']);
  await eachSize(A, 'lobby');
  await A.locator('#use-direct').tap();
  await expect(A.locator('#offer-link')).toBeVisible({ timeout: 15000 });
  await A.locator('#paste').tap();
  await expect(A.locator('#paste')).toBeFocused();
  expect(await fontSize(A, '#paste')).toBeGreaterThanOrEqual(16);
  await eachSize(A, 'direct host');
  await A.getByRole('button', { name: 'Cancel' }).tap();
  await expect(A.locator('#create')).toBeVisible();
});

test('WebKit iPhone guest plays a Classic game against a Chromium host, by touch', async ({ browser }) => {
  // CI runners may not resolve WebKit's mDNS candidates either; this one is for local runs.
  test.skip(!!process.env.CI, 'needs mDNS between engines');
  test.setTimeout(120_000);
  const other = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    const A = await phone(other, 'Pixel 7');
    const B = await phone(browser, 'iPhone 13');
    await connectByTouch(A, B, 'Classic', HOME);
    await fits(B, 'placement');
    // A tap on a ship rotates it (or snaps back) without errors.
    await B.locator('.dock-ship').first().tap();
    await readyByTouch(A, B);
    await fits(B, 'battle');
    await playOut(A, B, B, 'classic', true);
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await fits(B, 'end');
  } finally {
    await other.close();
  }
});
