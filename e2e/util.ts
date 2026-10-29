import { execSync } from 'node:child_process';
import { expect, type Browser, type BrowserContextOptions, type BrowserServer, type Page } from '@playwright/test';

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

/** Play until the end: `winner` fires at the loser's ships, the loser fires at water. `tap`: touch taps, not clicks. */
export async function playOut(A: Page, B: Page, winner: Page, mode: 'classic' | 'salvo' = 'classic', tap = false): Promise<void> {
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
      for (const c of pool.slice(0, n)) await (tap ? targetCell(p, c).tap() : targetCell(p, c).click());
      await (tap ? p.locator('#fire').tap() : p.click('#fire'));
    } else await (tap ? targetCell(p, pool[0]!).tap() : targetCell(p, pool[0]!).click());
    await expect.poll(() => p.evaluate(() => (window as unknown as { __bs: { state(): { match?: { phase: string } } } }).__bs.state().match?.phase)).not.toBe('awaitingAnswer');
  }
}

/** Pixels the page scrolls sideways, plus any element poking past the right edge. */
export const overflow = (p: Page) =>
  p.evaluate(() => {
    const out = [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5)
      .map((e) => `${e.tagName.toLowerCase()}.${e.className}`)
      .slice(0, 5);
    return { scroll: document.documentElement.scrollWidth - innerWidth, out };
  });

/**
 * Record what the page asks of the platform: wake lock requests and releases in
 * window.__wl, and an AudioContext that, like iOS Safari, only starts when resume()
 * runs inside touchend, pointerup, click or keydown (window.__ac).
 */
export const stubPlatform = (p: Page) =>
  p.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const wl: string[] = (w.__wl = []);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: async () => (wl.push('request'), { release: async () => void wl.push('release') }) },
    });
    const node = () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n, start() {}, stop() {} });
    class FakeAudio {
      state = 'suspended';
      onstatechange: (() => void) | null = null;
      currentTime = 0;
      sampleRate = 8000;
      destination = {};
      resumedIn: string[] = [];
      ran = false;
      constructor() {
        w.__ac = this;
      }
      to(s: string) {
        this.state = s;
        this.ran ||= s === 'running';
        this.onstatechange?.();
      }
      resume() {
        const ev = window.event?.type ?? 'none';
        this.resumedIn.push(ev);
        if (['touchend', 'pointerup', 'click', 'keydown'].includes(ev) && this.state !== 'running') this.to('running');
        return Promise.resolve();
      }
      suspend() {
        this.to('suspended');
        return Promise.resolve();
      }
      createGain = node;
      createOscillator = node;
      createBiquadFilter = node;
      createBufferSource = node;
      createBuffer = () => ({ getChannelData: () => new Float32Array(1) });
    }
    w.AudioContext = FakeAudio;
  });

/** Pretend the page went to the background (or came back): document.hidden plus the event. */
export const setHidden = (p: Page, hidden: boolean) =>
  p.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

/**
 * Freeze a whole browser (SIGSTOP on its process tree) the way iOS suspends a page in
 * the background, run `during`, then let it go. Linux only.
 */
export async function frozen(server: BrowserServer, during: () => Promise<void>): Promise<void> {
  const tree = execSync('ps -eo pid=,ppid=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const all = [server.process().pid!];
  for (let i = 0; i < all.length; i++) for (const [c, pp] of tree) if (pp === all[i]) all.push(c!);
  execSync(`kill -STOP ${all.join(' ')}`);
  try {
    await during();
  } finally {
    execSync(`kill -CONT ${all.join(' ')}`);
  }
}
