import { expect, test, type Page } from '@playwright/test';
import { bs, overflow, player, targetCell, waitTurn, playOut } from './util';

const SIZES = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, minCell: 24 },
  // A phone on its side (iPhone 13/14 class): the board shrinks to fit the height.
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, minCell: 20 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, minCell: 24 },
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

// CI keeps the flow and its DOM audit but skips the throwaway images.
async function shot(p: Page, name: string): Promise<void> {
  if (process.env.CI) return;
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

/** Scripted shots so the battle looks mid-game: [attacker A?, cell]. */
const SCRIPT = [44, 3, 4, 60, 58, 59, 88, 21, 86, 85, 5, 6, 87, 2];

for (const size of SIZES)
  for (const scheme of SCHEMES)
    test(`screens ${size.name} ${scheme}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { name: _, minCell, ...dev } = size;
      const opts = { ...dev, colorScheme: scheme, reducedMotion: 'reduce' as const };
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
      await A.click('#ready');
      await expect(A.locator('#ready')).toHaveText('Waiting for opponent…');
      await shot(A, `06b-placement-waiting-${tag}`);
      await B.click('#ready');
      await expect(A.locator('.battle')).toBeVisible();
      await expect(B.locator('.battle')).toBeVisible();
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
      // Layout and anti-"AI look" checks on the live battle screen.
      const audit = await A.evaluate(() => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.boxShadow !== 'none') bad.push('box-shadow ' + el.className);
          if (cs.backdropFilter && cs.backdropFilter !== 'none') bad.push('backdrop-filter ' + el.className);
          if (/gradient/.test(cs.backgroundImage) && !el.closest('.sunk')) bad.push('gradient ' + el.className);
          for (const c of [cs.color, cs.backgroundColor, cs.borderTopColor]) {
            const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
            if (!m) continue;
            const [r, g, b] = [+m[1]! / 255, +m[2]! / 255, +m[3]! / 255];
            const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
            if (!d) continue;
            const sat = d / (1 - Math.abs(max + min - 1));
            let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            hue = (hue * 60 + 360) % 360;
            if (hue >= 230 && hue <= 300 && sat > 0.3) bad.push(`purple ${c} ${el.className}`);
          }
        }
        const cell = document.querySelector('.a-target .cell')!.getBoundingClientRect();
        return { bad, scroll: document.documentElement.scrollWidth - innerWidth, cell: cell.width };
      });
      expect(audit.bad).toEqual([]);
      expect(audit.scroll).toBeLessThanOrEqual(0);
      expect(audit.cell).toBeGreaterThanOrEqual(minCell);
      await A.keyboard.press('Escape');
      await shot(B, `08-battle-waiting-${tag}`);
      await B.click('#leave');
      await shot(B, `08b-leave-confirm-${tag}`);
      await B.click('#stay');
      // The link drops (the opponent switched apps): the notice sits in the header row.
      await B.evaluate(() => (window as any).__bs.ctrl.t.onstate(false));
      await shot(B, `08c-link-lost-${tag}`);
      await B.evaluate(() => (window as any).__bs.ctrl.t.onstate(true));
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


for (const [width, height] of [[320, 740], [360, 740], [750, 342], [863, 360]] as const)
  test(`no sideways scroll at ${width}x${height}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const opts = { viewport: { width, height }, reducedMotion: 'reduce' as const, hasTouch: true, isMobile: true };
    const A = await player(browser, opts);
    const B = await player(browser, opts);
    const fits = async (p: Page, what: string) => expect(await overflow(p), what).toEqual({ scroll: 0, out: [] });
    await A.goto('./');
    await fits(A, 'home');
    await A.click('#create');
    await A.getByRole('radio', { name: 'Items' }).click();
    await fits(A, 'lobby');
    await A.click('#use-direct');
    await expect(A.locator('#offer-link')).toBeVisible();
    await fits(A, 'direct host');
    const offer = (await A.locator('#offer-link').textContent())!;
    await B.goto('http://' + offer);
    await expect(B.locator('#answer-code')).toBeVisible({ timeout: 15000 });
    await fits(B, 'direct guest');
    await A.fill('#paste', (await B.locator('#answer-code').textContent())!);
    await A.click('#connect');
    await expect(A.locator('.placement')).toBeVisible({ timeout: 20000 });
    await fits(A, 'placement');
    await A.click('#ready');
    await B.click('#ready');
    await expect(A.locator('.battle')).toBeVisible();
    await A.evaluate(() => ((window as any).__bs.state().match.energy.me = 6));
    await A.evaluate(() => (window as any).__bs.ctrl.emit());
    await fits(A, 'battle');
    await playOut(A, B, A);
    await fits(A, 'end');
  });
