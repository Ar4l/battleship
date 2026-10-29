import { chromium, expect, test, type Page } from '@playwright/test';
import { frozen, player, readyBoth, setHidden, targetCell, waitTurn } from './util';

// Traces of the three-context test here raced into ENOENT; these tests need none.
test.use({ trace: 'off' });

/** Count this page's WebSockets that are still connecting or open (tracker sockets). */
const trackSockets = (p: Page) =>
  p.addInitScript(() => {
    const W = window.WebSocket;
    const all: WebSocket[] = ((window as unknown as { __ws: WebSocket[] }).__ws = []);
    window.WebSocket = class extends W {
      constructor(...a: ConstructorParameters<typeof WebSocket>) {
        super(...a);
        all.push(this);
      }
    } as typeof WebSocket;
  });
const openSockets = (p: Page) => p.evaluate(() => (window as unknown as { __ws: WebSocket[] }).__ws.filter((w) => w.readyState < 2).length);

/** Can this machine reach a WebTorrent tracker? */
async function online(): Promise<boolean> {
  return new Promise((res) => {
    try {
      const ws = new WebSocket('wss://tracker.openwebtorrent.com');
      const t = setTimeout(() => (ws.close(), res(false)), 5000);
      ws.onopen = () => (clearTimeout(t), ws.close(), res(true));
      ws.onerror = () => (clearTimeout(t), res(false));
    } catch {
      res(false);
    }
  });
}

test.describe('@net Trystero matchmaking', () => {
  test.beforeAll(async () => {
    test.skip(!(await online()), 'no internet: tracker unreachable');
  });

  test('code join, room lock for a third player, play continues', async ({ browser }) => {
    test.setTimeout(90_000);
    const A = await player(browser);
    const B = await player(browser);
    const C = await player(browser);
    await A.goto('./');
    await A.click('#create');
    const code = (await A.locator('#room-code').textContent())!;
    await B.goto('./');
    await B.locator('#code').pressSequentially(code);
    await expect(A.locator('.placement')).toBeVisible({ timeout: 30000 });
    await expect(B.locator('.placement')).toBeVisible({ timeout: 30000 });
    await C.goto('./#' + code);
    await expect(C.locator('#notice')).toContainText(`Game ${code} already has two players.`, { timeout: 30000 });
    await readyBoth(A, B);
    const p = await waitTurn(A, B);
    await targetCell(p!, 0).click();
    await expect.poll(() => p!.evaluate(() => (window as any).__bs.state().match.phase)).not.toBe('awaitingAnswer');
  });

  test('a slow host still meets a fast guest (HELLO is repeated until heard)', async ({ browser }) => {
    test.setTimeout(120_000);
    for (let i = 0; i < 3; i++) {
      const A = await player(browser);
      const B = await player(browser);
      // A mid-range phone: the host creates its channel well after the guest.
      await (await A.context().newCDPSession(A)).send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await A.goto('./');
      await A.click('#create');
      const code = (await A.locator('#room-code').textContent())!;
      await B.goto('./#' + code);
      await expect(A.locator('.placement')).toBeVisible({ timeout: 30000 });
      await expect(B.locator('.placement')).toBeVisible({ timeout: 30000 });
      await A.context().close();
      await B.context().close();
    }
  });

  test('trackers go quiet once connected: none for the guest, one for the host', async ({ browser }) => {
    test.setTimeout(60_000);
    const A = await player(browser);
    const B = await player(browser);
    await trackSockets(A);
    await trackSockets(B);
    await A.goto('./');
    await A.click('#create');
    const code = (await A.locator('#room-code').textContent())!;
    await B.goto('./#' + code);
    await readyBoth(A, B);
    await expect.poll(() => openSockets(B)).toBe(0);
    await expect.poll(() => openSockets(A)).toBeLessThanOrEqual(1);
    // ...and they stay closed (no reconnects) while the game goes on, even after the
    // network blips (Wi-Fi to cellular fires 'online').
    await B.evaluate(() => (dispatchEvent(new Event('offline')), dispatchEvent(new Event('online'))));
    await B.waitForTimeout(4000);
    expect(await openSockets(B)).toBe(0);
  });

  test('the #NNNN link joins directly', async ({ browser }) => {
    test.setTimeout(60_000);
    const A = await player(browser);
    const B = await player(browser);
    await A.goto('./');
    await A.click('#create');
    const code = (await A.locator('#room-code').textContent())!;
    await B.goto('./#' + code);
    await expect(A.locator('.placement')).toBeVisible({ timeout: 30000 });
    await expect(B.locator('.placement')).toBeVisible({ timeout: 30000 });
  });

  test('a guest frozen for 45 s mid-battle (phone app switch) keeps the game, and play goes on', async ({ browser }) => {
    test.skip(process.platform !== 'linux', 'freezes the guest browser with SIGSTOP');
    test.setTimeout(150_000);
    // The guest runs in its own browser so its processes can be stopped without touching the host.
    const server = await chromium.launchServer({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
    try {
      const A = await player(browser);
      const B = await player(await chromium.connect(server.wsEndpoint()));
      await A.goto('./');
      await A.click('#create');
      const code = (await A.locator('#room-code').textContent())!;
      await B.goto('./#' + code);
      await expect(A.locator('.placement')).toBeVisible({ timeout: 30000 });
      await expect(B.locator('.placement')).toBeVisible({ timeout: 30000 });
      await readyBoth(A, B);
      await setHidden(B, true);
      // Chromium reports 'disconnected' after about 5 s and 'failed' at about 16 s. Neither
      // is final: the link recovers when the guest comes back.
      await frozen(server, async () => {
        await expect(A.locator('#lost')).toBeVisible({ timeout: 15000 });
        await A.waitForTimeout(45_000);
        await expect(A.locator('.battle')).toBeVisible({ timeout: 100 });
      });
      await setHidden(B, false);
      await expect(A.locator('#lost')).toBeHidden({ timeout: 10000 });
      // B was away for more than 10 s: its ping must be answered, so no "connection lost" notice.
      await B.waitForTimeout(7000);
      await expect(A.locator('.battle')).toBeVisible();
      await expect(B.locator('.battle')).toBeVisible();
      for (let i = 0; i < 2; i++) {
        const p = (await waitTurn(A, B))!;
        await targetCell(p, 50 + i).click();
        await expect.poll(() => p.evaluate(() => (window as any).__bs.state().match.phase)).not.toBe('awaitingAnswer');
      }
    } finally {
      await server.close();
    }
  });
});
