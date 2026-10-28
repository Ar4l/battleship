import { expect, test, type Page } from '@playwright/test';
import { bs, connectDirect, player, readyBoth, targetCell, waitTurn, playOut } from './util';

const SIZES = [
  { name: 'mobile', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
];
const SCHEMES = ['light', 'dark'] as const;
const DIR = 'screenshots';

const FLEET_A = [
  { anchor: 11, vertical: false },
  { anchor: 46, vertical: true },
  { anchor: 72, vertical: false },
  { anchor: 33, vertical: true },
  { anchor: 98, vertical: false },
];
const FLEET_B = [
  { anchor: 2, vertical: false },
  { anchor: 30, vertical: true },
  { anchor: 57, vertical: false },
  { anchor: 85, vertical: false },
  { anchor: 19, vertical: true },
];

async function shot(p: Page, name: string): Promise<void> {
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

/** Scripted shots so the battle looks mid-game: [attacker A?, cell]. */
const SCRIPT = [44, 3, 4, 60, 58, 59, 88, 21, 86, 85, 5, 6, 87, 2];

for (const size of SIZES)
  for (const scheme of SCHEMES)
    test(`screens ${size.name} ${scheme}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const opts = { viewport: size.viewport, colorScheme: scheme, reducedMotion: 'reduce' as const };
      const A = await player(browser, opts);
      const B = await player(browser, opts);
      const tag = `${size.name}-${scheme}`;
      await A.goto('./');
      await shot(A, `01-home-${tag}`);
      await A.click('#create');
      await expect(A.locator('#room-code')).toHaveText(/^\d{4}$/);
      await A.getByRole('radio', { name: 'Items' }).click();
      await shot(A, `02-lobby-host-${tag}`);
      await B.goto('./#4821');
      await shot(B, `03-lobby-guest-${tag}`);
      await A.click('#use-direct');
      await expect(A.locator('#offer-link')).toBeVisible();
      await shot(A, `04-direct-host-${tag}`);
      const offer = (await A.locator('#offer-link').textContent())!;
      await B.goto('about:blank');
      await B.goto('http://' + offer);
      await expect(B.locator('#answer-code')).toBeVisible({ timeout: 15000 });
      await shot(B, `05-direct-guest-${tag}`);
      await A.fill('#paste', (await B.locator('#answer-code').textContent())!);
      await A.click('#connect');
      await expect(A.locator('.placement')).toBeVisible({ timeout: 20000 });
      await bs(A, 'setFleet', FLEET_A);
      await bs(B, 'setFleet', FLEET_B);
      await A.locator('.dock-ship').first().click();
      await shot(A, `06-placement-${tag}`);
      await readyBoth(A, B);
      // Make A start for a predictable picture.
      let p = await waitTurn(A, B);
      if (p === B) await targetCell(B, 0).click();
      for (const c of SCRIPT) {
        p = await waitTurn(A, B);
        const me = p!;
        if (me === A) await targetCell(A, c).click();
        else await targetCell(B, (c * 7 + 13) % 100).click();
        await expect.poll(() => me.evaluate(() => (window as any).__bs.state().match.phase)).not.toBe('awaitingAnswer');
      }
      // Bank energy for the items picture
      await A.evaluate(() => ((window as any).__bs.state().match.energy.me = 5));
      await B.evaluate(() => ((window as any).__bs.state().match.energy.them = 5));
      p = await waitTurn(A, B);
      if (p === B) {
        await targetCell(B, 99).click();
        await waitTurn(A, B);
      }
      await A.evaluate(() => (window as any).__bs.ctrl.emit());
      await A.getByRole('button', { name: /^Sonar/ }).click();
      await targetCell(A, 66).click();
      await expect.poll(() => A.evaluate(() => (window as any).__bs.state().match.phase)).toBe('theirTurn');
      await targetCell(B, 97).click();
      await waitTurn(A, B);
      await A.evaluate(() => ((window as any).__bs.state().match.energy.me = 6));
      await B.evaluate(() => ((window as any).__bs.state().match.energy.them = 6));
      await A.evaluate(() => (window as any).__bs.ctrl.emit());
      await A.getByRole('button', { name: /^Line strike/ }).click();
      await targetCell(A, 52).hover();
      await targetCell(A, 52).focus();
      await shot(A, `07-battle-items-${tag}`);
      await A.keyboard.press('Escape');
      await shot(B, `08-battle-waiting-${tag}`);
      await playOut(A, B, A);
      await expect(A.locator('#verdict')).toHaveText('Fleet verified');
      await expect(A.locator('#their-verdict')).toBeVisible();
      await shot(A, `09-end-won-${tag}`);
      await expect(B.locator('#verdict')).toHaveText('Fleet verified');
      await shot(B, `10-end-lost-${tag}`);
      await B.click('#leave');
      await expect(A.locator('#rematch-note')).toHaveText('Opponent left.');
      await A.click('#leave');
      const C = await player(browser, opts);
      await C.goto('./');
      await C.evaluate(() => (window as any).__bs.ctrl.retry());
      await C.evaluate(() => {
        const c = (window as any).__bs.ctrl;
        c.lastCode = 4821;
        c.notice('failed');
      });
      await shot(C, `11-notice-failed-${tag}`);
    });
