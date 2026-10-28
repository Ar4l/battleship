import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

export type Fleet = { anchor: number; vertical: boolean }[];
const LENS = [5, 4, 3, 3, 2];
export const fleetCells = (f: Fleet): number[] => f.flatMap((s, i) => Array.from({ length: LENS[i]! }, (_, k) => s.anchor + (s.vertical ? k * 10 : k)));

export async function player(browser: Browser, opts: BrowserContextOptions = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bs:debug', '1');
      localStorage.setItem('bs:mute', '1');
    } catch {
      /* about:blank */
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // window.__bs arrives through an async import: every navigation waits for it.
  const goto = page.goto.bind(page);
  page.goto = async (url, o) => {
    const r = await goto(url, o);
    if (!url.startsWith('about:')) await debugReady(page);
    return r;
  };
  return page;
}

const debugReady = (page: Page) => page.waitForFunction(() => (window as unknown as { __bs?: unknown }).__bs);

export const bs = async <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> => {
  await debugReady(page);
  return page.evaluate(([fn, args]) => {
    const w = window as unknown as { __bs: Record<string, (...a: unknown[]) => unknown> };
    return w.__bs[fn as string]!(...(args as unknown[])) as T;
  }, [fn, args] as const);
};

export const stateKind = async (page: Page): Promise<string> => {
  await debugReady(page);
  return page.evaluate(() => (window as unknown as { __bs: { state(): { s: string } } }).__bs.state().s);
};

/** Host config is chosen in the lobby. */
export async function hostLobby(A: Page, mode: 'Classic' | 'Salvo' | 'Items' = 'Classic', extra: string[] = []): Promise<void> {
  await A.goto('./');
  await A.click('#create');
  await expect(A.locator('#room-code')).toHaveText(/^\d{4}$/);
  await A.getByRole('radio', { name: mode }).click();
  for (const t of extra) await A.getByText(t, { exact: true }).click();
}

/** Connect A (host) and B (guest) through the two-link direct fallback. */
export async function connectDirect(A: Page, B: Page, mode: 'Classic' | 'Salvo' | 'Items' = 'Classic', extra: string[] = [], gapMs = 0): Promise<void> {
  await hostLobby(A, mode, extra);
  await A.click('#use-direct');
  const offer = (await A.locator('#offer-link').textContent())!;
  expect(offer.length).toBeLessThan(220);
  await B.goto('http://' + offer);
  const code = (await B.locator('#answer-code').textContent({ timeout: 15000 }))!;
  // A human relaying the reply through a messenger.
  if (gapMs) {
    await A.waitForTimeout(gapMs);
    expect(await stateKind(B)).toBe('direct-guest');
  }
  await A.fill('#paste', code);
  await A.click('#connect');
  await expect(A.locator('.placement')).toBeVisible({ timeout: 20000 });
  await expect(B.locator('.placement')).toBeVisible({ timeout: 20000 });
}

export async function readyBoth(A: Page, B: Page): Promise<void> {
  await A.click('#ready');
  await B.click('#ready');
  await expect(A.locator('.battle')).toBeVisible();
  await expect(B.locator('.battle')).toBeVisible();
}

export const myTurn = (p: Page) => p.evaluate(() => (window as unknown as { __bs: { state(): { s: string; match?: { phase: string } } } }).__bs.state().match?.phase === 'myTurn');

export async function waitTurn(A: Page, B: Page): Promise<Page | null> {
  for (let i = 0; i < 400; i++) {
    if ((await stateKind(A)) === 'end' && (await stateKind(B)) === 'end') return null;
    if (await myTurn(A)) return A;
    if (await myTurn(B)) return B;
    await A.waitForTimeout(15);
  }
  throw new Error('no turn');
}

export const targetCell = (p: Page, i: number) => p.locator(`.a-target .cell[data-i="${i}"]`);

/** Play until the end: `winner` fires at the loser's ships, the loser fires at water. */
export async function playOut(A: Page, B: Page, winner: Page, mode: 'classic' | 'salvo' = 'classic'): Promise<void> {
  const fleets = new Map<Page, number[]>([
    [A, fleetCells(await bs<Fleet>(A, 'myFleet'))],
    [B, fleetCells(await bs<Fleet>(B, 'myFleet'))],
  ]);
  for (let guard = 0; guard < 200; guard++) {
    const p = await waitTurn(A, B);
    if (!p) return;
    const other = p === A ? B : A;
    const shot: number[] = await p.evaluate(() => [...(window as unknown as { __bs: { state(): { match: { target: { shot: Set<number> } } } } }).__bs.state().match.target.shot]);
    const ships = fleets.get(other)!.filter((c) => !shot.includes(c));
    const water = Array.from({ length: 100 }, (_, i) => i).filter((c) => !shot.includes(c) && !fleets.get(other)!.includes(c));
    const pool = p === winner ? [...ships, ...water] : [...water, ...ships];
    if (mode === 'salvo') {
      const n: number = await p.evaluate(() => {
        const s = (window as unknown as { __bs: { state(): { match: { own: { sunk: unknown[] }; target: { shot: Set<number> } } } } }).__bs.state().match;
        return Math.min(5 - s.own.sunk.filter(Boolean).length, 100 - s.target.shot.size);
      });
      for (const c of pool.slice(0, n)) await targetCell(p, c).click();
      await p.click('#fire');
    } else await targetCell(p, pool[0]!).click();
    await expect.poll(() => p.evaluate(() => (window as unknown as { __bs: { state(): { match?: { phase: string } } } }).__bs.state().match?.phase)).not.toBe('awaitingAnswer');
  }
}
