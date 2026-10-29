import { expect, test } from '@playwright/test';
import { bs, connectDirect, fleetCells, myTurn, playOut, player, readyBoth, waitTurn, targetCell } from './util';

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
    // Multi-shot results say who fired.
    const first = (await waitTurn(A, B))!;
    const other = first === A ? B : A;
    for (const c of [0, 1, 2, 3, 4]) await first.locator(`.a-target .cell[data-i="${c}"]`).click();
    await first.click('#fire');
    await expect(first.locator('.strip-sub')).toHaveText(/^(You hit [A-J]\d+|You missed all 5|You sank)/);
    await expect(other.locator('.strip-sub')).toHaveText(/^(They hit [A-J]\d+|They missed all 5|They sank)/);
    await playOut(A, B, B, 'salvo');
    await expect(B.locator('#result')).toHaveText('You won');
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  });

  test('Simultaneous salvo: both pick at once, wait for each other, then both results land', async ({ browser }) => {
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B, 'Simultaneous');
    await expect(B.locator('.placement .rules')).toHaveText('Salvo, simultaneous · 10×10 · No timer');
    await readyBoth(A, B);
    await expect(B.locator('#strip')).toContainText('Fire together');
    for (const p of [A, B]) await expect(p.locator('.strip-main')).toHaveText('Your turn');
    await expect(B.locator('#them-ready')).toHaveText("They're still picking.");
    for (const c of [0, 1, 2, 3, 4]) await targetCell(A, c).click();
    await A.click('#fire');
    await expect(A.locator('.strip-main')).toHaveText('Waiting for them');
    await expect(A.locator('#fire')).toHaveText('Sent');
    await expect(targetCell(A, 0)).toHaveClass(/\bsel\b/);
    await expect(B.locator('#them-ready')).toHaveText("They're ready.");
    await expect(B.locator('#clear-queue')).toBeHidden();
    for (const c of [90, 91, 92, 93, 94]) await targetCell(B, c).click();
    await B.click('#fire');
    for (const p of [A, B]) await expect(p.locator('.strip-sub')).toHaveText(/^You .* · They /);
    await playOut(A, B, A, 'sim');
    await expect(A.locator('#result')).toHaveText('You won');
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  });

  test('Pickups: shoot an item square, queue the item on their turn, it fires first; verified', async ({ browser }) => {
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B, 'Items', ['Pickups']);
    await expect(B.locator('.rules')).toContainText('Item pickups');
    await readyBoth(A, B);
    type W = { __bs: { state(): { match: { target: { pick: Map<number, number>; shot: Set<number> }; inv: { me: number[] }; stats: { me: { items: number } } } } } };
    const sq = (p: typeof A) => p.evaluate(() => [...(window as unknown as W).__bs.state().match.target.pick.keys()]);
    let p = await waitTurn(A, B);
    if (p === B) {
      await targetCell(B, 99).click();
      p = await waitTurn(A, B);
    }
    const [cell] = await sq(A);
    await expect(A.locator(`.a-target .cell[data-i="${cell}"]`)).toHaveAttribute('aria-label', /item square/);
    await expect(A.locator('.a-target .pick')).toHaveCount((await sq(A)).length);
    await targetCell(A, cell!).click();
    await expect.poll(() => A.evaluate(() => (window as unknown as W).__bs.state().match.inv.me.length)).toBe(1);
    await expect(A.locator('#energy')).toHaveText('1/3');
    await expect(A.locator('#strip')).toContainText('Got ');
    // Their turn: the held item is enabled; aim it and queue it.
    await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('theirTurn');
    await A.locator('.item:not([disabled])').first().click();
    const free = await A.evaluate(() => [44, 45, 54, 55, 33].find((c) => !(window as unknown as W).__bs.state().match.target.shot.has(c))!);
    await targetCell(A, free).hover();
    await targetCell(A, free).click();
    await expect(A.locator('.strip-sub')).toContainText('Next: ');
    await targetCell(B, 98).click();
    await expect.poll(() => A.evaluate(() => (window as unknown as W).__bs.state().match.stats.me.items)).toBe(1);
    expect(await A.evaluate(() => (window as unknown as W).__bs.state().match.inv.me.length)).toBe(0);
    await playOut(A, B, A);
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  });

  test('Russian: ten ships, a hit shoots again, verified at the end', async ({ browser }) => {
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B, 'Russian');
    await expect(A.locator('.dock-ship')).toHaveCount(10);
    await expect(B.locator('.rules')).toContainText('Russian');
    await readyBoth(A, B);
    const first = (await waitTurn(A, B))!;
    const theirs = fleetCells(await bs<{ anchor: number; vertical: boolean }[]>(first === A ? B : A, 'myFleet'), [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
    await targetCell(first, theirs[0]!).click();
    await expect.poll(() => myTurn(first)).toBe(true);
    await playOut(A, B, first);
    await expect(first.locator('#result')).toHaveText('You won');
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
      // Picking an item must not shift the layout (desktop: the boards sit side by side).
      const before = await A.locator('.a-own').boundingBox();
      await A.getByRole('button', { name: new RegExp('^' + name) }).click();
      expect(await A.locator('.a-own').boundingBox()).toEqual(before);
      for (let i = 0; i < rot; i++) await A.click('#item-dir');
      await targetCell(A, cell).hover();
      await targetCell(A, cell).click();
      await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('theirTurn');
      if (name === 'Sonar') await expect(A.locator('#strip')).toContainText('Sonar: 2 ship cells');
      if (name === 'Torpedo') await expect(A.locator('#strip')).toContainText('J5: hit');
      if (name === 'Line strike') await expect(A.locator('#strip')).toContainText('You sank their Cruiser');
      await targetCell(B, bWater++).click();
    }
    const stats = await A.evaluate(() => (window as any).__bs.state().match.stats.me.items);
    expect(stats).toBe(4);
    await playOut(A, B, A);
    await expect(A.locator('#verdict')).toHaveText('Fleet verified');
    await expect(B.locator('#verdict')).toHaveText('Fleet verified');
  });

  test('the guest waits while the reply travels: host pastes it 35 s later', async ({ browser }) => {
    test.setTimeout(120_000);
    const A = await player(browser);
    const B = await player(browser);
    await connectDirect(A, B, 'Classic', [], 35_000);
    await readyBoth(A, B);
  });
});
