import { expect, test } from '@playwright/test';
import { player, readyBoth, targetCell, waitTurn } from './util';

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
});
