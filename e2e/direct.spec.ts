import { expect, test } from '@playwright/test';
import { bs, connectDirect, playOut, player, readyBoth, waitTurn, targetCell } from './util';

test.describe('direct-link fallback (offline-safe)', () => {
  test('Classic: full game, verified on both sides, then rematch swaps the starter', async ({ browser }) => {
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B);
    await readyBoth(A, B);
    await expect(A.locator('#strip')).toContainText(/go first/);
    await expect(B.locator('#strip')).toContainText(/go first/);
    const first = await waitTurn(A, B);
    await playOut(A, B, A);
    await expect(A.locator('#result')).toHaveText('You won');
    await expect(B.locator('#result')).toHaveText('You lost');
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
    await expect(A.locator('#their-verdict')).toHaveText('Opponent verified your fleet');
    await A.click('#rematch');
    await expect(B.locator('#rematch-note')).toHaveText('Opponent wants a rematch.');
    await B.click('#rematch');
    await expect(A.locator('.placement')).toBeVisible();
    await expect(B.locator('.placement')).toBeVisible();
    await readyBoth(A, B);
    const second = await waitTurn(A, B);
    expect(second).not.toBe(first);
  });

  test('Salvo: full game with multi-shot turns', async ({ browser }) => {
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B, 'Salvo');
    await readyBoth(A, B);
    await expect(A.locator('#fire')).toBeVisible();
    await playOut(A, B, B, 'salvo');
    await expect(B.locator('#result')).toHaveText('You won');
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  });

  test('Items: sonar, torpedo, cross bomb and line strike each used once', async ({ browser }) => {
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B, 'Items');
    // Known fleets so the item results are predictable.
    const fleetB = [
      { anchor: 9, vertical: true },
      { anchor: 7, vertical: true },
      { anchor: 5, vertical: true },
      { anchor: 3, vertical: true },
      { anchor: 1, vertical: true },
    ];
    await bs(B, 'setFleet', fleetB);
    await readyBoth(A, B);
    const items: [string, number, number][] = [
      ['Sonar', 11, 0],
      ['Torpedo', 99, 3], // column J from the bottom
      ['Cross bomb', 27, 0],
      ['Line strike', 5, 1], // column F, vertical
    ];
    let bWater = 90;
    for (const [name, cell, rot] of items) {
      let p = await waitTurn(A, B);
      if (p === B) {
        await targetCell(B, bWater++).click();
        p = await waitTurn(A, B);
      }
      // Give both sides' view of A's energy 6 (test shortcut).
      await A.evaluate(() => ((window as any).__bs.state().match.energy.me = 6));
      await B.evaluate(() => ((window as any).__bs.state().match.energy.them = 6));
      await A.evaluate(() => (window as any).__bs.ctrl.emit());
      await A.getByRole('button', { name: new RegExp('^' + name) }).click();
      for (let i = 0; i < rot; i++) await A.click('#item-dir');
      await targetCell(A, cell).hover();
      await targetCell(A, cell).click();
      await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('theirTurn');
      if (name === 'Sonar') await expect(A.locator('#strip')).toContainText('Sonar: 2 ship cells');
      if (name === 'Torpedo') await expect(A.locator('#strip')).toContainText('J5 hit');
      if (name === 'Line strike') await expect(A.locator('#strip')).toContainText('You sank their Cruiser');
      await targetCell(B, bWater++).click();
    }
    const stats = await A.evaluate(() => (window as any).__bs.state().match.stats.me.items);
    expect(stats).toBe(4);
    await playOut(A, B, A);
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  });
});
