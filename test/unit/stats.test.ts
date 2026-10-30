import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY, load, save, type Game } from '../../src/app/stats';
import { summarize } from '../../src/app/summary';

/** A working localStorage backed by a Map. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const DAY = 86400000;

afterEach(() => vi.unstubAllGlobals());

describe('stats storage', () => {
  it('a first visit gets an 8-character id that is saved and kept', () => {
    const ls = memory();
    vi.stubGlobal('localStorage', ls);
    const p = load();
    expect(p.id).toMatch(/^[\w+/]{8}$/);
    expect(p).toMatchObject({ name: '', log: [] });
    expect(JSON.parse(ls.m.get(KEY)!).id).toBe(p.id);
    expect(load().id).toBe(p.id);
  });

  it('saves the name and log', () => {
    vi.stubGlobal('localStorage', memory());
    const p = load();
    p.name = 'Sam';
    p.log.push([1, 'me', 'Ab+/9xYz', 'Kim', 10, 20, 0]);
    save(p);
    expect(load()).toEqual(p);
  });

  it('corrupt data starts over with a new id', () => {
    const ls = memory();
    ls.setItem(KEY, '{not json');
    vi.stubGlobal('localStorage', ls);
    expect(load().id).toMatch(/^[\w+/]{8}$/);
  });

  it.each([
    ['no localStorage at all', undefined],
    ['a localStorage that throws on every call (private mode)', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } }],
  ])('storage blocked (%s): stats live in memory, nothing throws', (_, ls) => {
    vi.stubGlobal('localStorage', ls);
    const p = load();
    expect(p.id).toMatch(/^[\w+/]{8}$/);
    p.log.push([1, 'me', null, null, 0, 0, 1]);
    expect(() => save(p)).not.toThrow();
    // Reloading falls back to the copy in memory: same id, same games.
    expect(load(p)).toEqual(p);
  });
});

describe('summarize', () => {
  it('is all zeros for no games', () => {
    expect(summarize([])).toEqual({ games: 0, me: 0, them: 0, draw: 0, forfeits: 0, streak: 0, best: 0, accuracy: null, opponents: [] });
  });

  it('counts results, forfeits, streaks, mean accuracy and head-to-head records', () => {
    const log: Game[] = [
      [1 * DAY, 'me', 'aaaaaaaa', 'Sam', 17, 34, 0],
      [2 * DAY, 'me', 'aaaaaaaa', 'Sam', 10, 40, 0],
      [3 * DAY, 'me', 'bbbbbbbb', '', 0, 0, 1], // they left before I fired: no accuracy
      [4 * DAY, 'them', 'aaaaaaaa', 'Sammy', 5, 50, 0],
      [5 * DAY, 'draw', 'bbbbbbbb', 'Kim', 17, 17, 0],
      [6 * DAY, 'me', null, null, 17, 68, 0], // an opponent without an id counts overall only
    ];
    const s = summarize(log);
    expect(s).toMatchObject({ games: 6, me: 4, them: 1, draw: 1, forfeits: 1, streak: 1, best: 3 });
    expect(s.accuracy).toBeCloseTo((0.5 + 0.25 + 0.1 + 1 + 0.25) / 5);
    // Most recent first, with the latest name.
    expect(s.opponents).toEqual([
      { name: 'Kim', last: 5 * DAY, me: 1, them: 0, draw: 1 },
      { name: 'Sammy', last: 4 * DAY, me: 2, them: 1, draw: 0 },
    ]);
  });
});
