import { execSync } from 'node:child_process';
import { chromium, expect, test, type Page } from '@playwright/test';
import { player, readyBoth, targetCell, waitTurn } from './util';

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
    // ...and they stay closed (no reconnects) while the game goes on.
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

  test('a guest frozen for 13 s (phone app switch) keeps the game', async ({ browser }) => {
    test.skip(process.platform !== 'linux', 'freezes the guest browser with SIGSTOP');
    test.setTimeout(90_000);
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
      const pid = server.process().pid!;
      const tree = execSync('ps -eo pid=,ppid=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
      const all = [pid];
      for (let i = 0; i < all.length; i++) for (const [c, pp] of tree) if (pp === all[i]) all.push(c!);
      const pids = all.join(' ');
      // Stock Trystero dropped the peer 5 s after 'disconnected' (about 11 s in all),
      // Chromium itself declares ICE failed at about 16 s.
      execSync(`kill -STOP ${pids}`);
      try {
        await A.waitForTimeout(13_000);
        await expect(A.locator('.placement')).toBeVisible({ timeout: 100 });
      } finally {
        execSync(`kill -CONT ${pids}`);
      }
      await A.waitForTimeout(3000);
      await expect(A.locator('.placement')).toBeVisible();
      await expect(B.locator('.placement')).toBeVisible();
      await readyBoth(A, B);
    } finally {
      await server.close();
    }
  });
});
