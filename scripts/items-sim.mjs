// Item balance estimate (not shipped): `node scripts/items-sim.mjs [games]`, or ROWS='[["cross","cross",4]]' for chosen rows.
// A probability-density hunt/target shooter plays solo games on 10×10 (fleet 5 4 3 3 2)
// with one item at a time, used whenever affordable at the spot with the most expected ship
// cells (Sonar only while hunting). Energy +1 a turn, cap 6, as in the game. Prints shots
// to win, turns saved per energy spent, and ship cells found per use against a plain shot.
const N = 10;
const FLEET = [5, 4, 3, 3, 2];
const CAP = 6;
const GAMES = +process.argv[2] || 1500;

let seed = 12345;
const rnd = (n) => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) % n;
};
const cellsOf = (a, v, len) => Array.from({ length: len }, (_, k) => a + (v ? N * k : k));
const fits = (a, v, len) => (v ? (a - (a % N)) / N : a % N) + len <= N;

function placeFleet() {
  for (;;) {
    const occ = new Int8Array(N * N).fill(-1);
    let ok = true;
    for (let i = 0; i < FLEET.length && ok; i++) {
      let t = 0;
      for (; t < 200; t++) {
        const a = rnd(N * N), v = rnd(2) === 1;
        if (!fits(a, v, FLEET[i])) continue;
        const cs = cellsOf(a, v, FLEET[i]);
        if (cs.some((c) => occ[c] >= 0)) continue;
        cs.forEach((c) => (occ[c] = i));
        break;
      }
      ok = t < 200;
    }
    if (ok) return occ;
  }
}

/** Probability-ish map: expected ship cells per untargeted cell, from placements of afloat ships. */
function density(st) {
  const d = new Float64Array(N * N);
  for (let i = 0; i < FLEET.length; i++) {
    if (st.sunk[i]) continue;
    const len = FLEET[i];
    const w = new Float64Array(N * N);
    let tot = 0;
    for (let a = 0; a < N * N; a++)
      for (const v of [false, true]) {
        if (!fits(a, v, len)) continue;
        const cs = cellsOf(a, v, len);
        if (cs.some((c) => st.miss.has(c) || st.dead.has(c) || st.water.has(c))) continue;
        let x = 1;
        for (const c of cs) if (st.hit.has(c)) x *= 40;
        for (const s of st.sonar) {
          const o = cs.filter((c) => s.cells.includes(c) && !st.hit.has(c)).length;
          if (s.left > 0 && o) x *= 1 + 3 * Math.min(o, s.left);
        }
        tot += x;
        for (const c of cs) w[c] += x;
      }
    if (tot) for (let c = 0; c < N * N; c++) if (!st.shot.has(c)) d[c] += (w[c] / tot) * len;
  }
  return d;
}

const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const box = (a, R) => {
  const out = [];
  for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) if (inB(((a - (a % N)) / N) + dr, (a % N) + dc)) out.push(a + dr * N + dc);
  return out;
};
const cross = (a) => [a, ...[[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dr, dc]) => inB(((a - (a % N)) / N) + dr, (a % N) + dc)).map(([dr, dc]) => a + dr * N + dc)];
const p = (d, c) => Math.min(0.95, d[c]);

/** Items: best(st, d) -> { v, act(st) } expected value and the action. */
const ITEMS = {
  sonar: { hunt: true, best(st, d) {
    let bestA = -1, bv = -1;
    for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
      const a = r * N + c;
      const v = box(a, 1).reduce((s, x) => s + d[x], 0);
      if (v > bv) [bv, bestA] = [v, a];
    }
    return { v: 0, act: (st) => {
      const cells = box(bestA, 1);
      const left = cells.filter((x) => st.occ[x] >= 0 && !st.shot.has(x)).length;
      if (!left) cells.forEach((x) => st.shot.has(x) || st.water.add(x));
      else st.sonar.push({ cells, left });
      return [];
    } };
  } },
  torpedo: { best(st, d) {
    let bl = null, bv = -1;
    for (let k = 0; k < N; k++) for (const vert of [false, true]) for (const rev of [false, true]) {
      const line = Array.from({ length: N }, (_, i) => (vert ? (rev ? N - 1 - i : i) * N + k : k * N + (rev ? N - 1 - i : i))).filter((c) => !st.shot.has(c) && !st.water.has(c));
      const v = 1 - line.reduce((q, c) => q * (1 - p(d, c)), 1);
      if (v > bv) [bv, bl] = [v, line];
    }
    return { v: bv, act: (st) => {
      const all = bl;
      const i = all.findIndex((c) => st.occ[c] >= 0);
      const crossed = i < 0 ? all : all.slice(0, i);
      crossed.forEach((c) => st.water.add(c));
      return i < 0 ? [] : [all[i]];
    } };
  } },
  cross: { best(st, d) {
    let ba = 0, bv = -1;
    for (let a = 0; a < N * N; a++) {
      const v = cross(a).reduce((s, x) => s + d[x], 0);
      if (v > bv) [bv, ba] = [v, a];
    }
    return { v: bv, act: (st) => cross(ba).filter((x) => !st.shot.has(x)) };
  } },
  line: { best(st, d) {
    let bc = null, bv = -1;
    for (let a = 0; a < N * N; a++) for (const v of [false, true]) {
      if (!fits(a, v, 5)) continue;
      const cs = cellsOf(a, v, 5);
      const val = cs.reduce((s, x) => s + d[x], 0);
      if (val > bv) [bv, bc] = [val, cs];
    }
    return { v: bv, act: (st) => bc.filter((x) => !st.shot.has(x)) };
  } },
};
/** Airstrike: the chosen cell plus k random untargeted cells within radius R (1: 3×3, 2: 5×5). */
const air = (R, k) => ({ best(st, d) {
  let ba = 0, bv = -1;
  for (let a = 0; a < N * N; a++) {
    const near = box(a, R).filter((x) => x !== a && !st.shot.has(x));
    const v = d[a] + (near.length ? (Math.min(k, near.length) * near.reduce((s, x) => s + d[x], 0)) / near.length : 0);
    if (v > bv) [bv, ba] = [v, a];
  }
  return { v: bv, act: (st) => {
    const near = box(ba, R).filter((x) => x !== ba && !st.shot.has(x));
    const out = st.shot.has(ba) ? [] : [ba];
    for (let i = 0; i < k && near.length; i++) out.push(near.splice(rnd(near.length), 1)[0]);
    return out;
  } };
} });

function play(itemName, cost) {
  const item = itemName && (ITEMS[itemName] ?? itemName);
  const occ = placeFleet();
  const st = { occ, shot: new Set(), hit: new Set(), miss: new Set(), dead: new Set(), water: new Set(), sunk: FLEET.map(() => false), sonar: [] };
  let energy = 0, turns = 0, uses = 0, itemCells = 0, shots = 0, shotCells = 0, spent = 0;
  const resolve = (cells) => {
    let hits = 0;
    for (const c of cells) {
      st.shot.add(c);
      if (occ[c] < 0) { st.miss.add(c); continue; }
      hits++;
      st.hit.add(c);
      for (const s of st.sonar) if (s.cells.includes(c)) s.left--;
      const i = occ[c];
      if (!st.sunk[i] && [...occ.keys()].filter((x) => occ[x] === i).every((x) => st.hit.has(x))) {
        st.sunk[i] = true;
        occ.forEach((s, x) => s === i && (st.hit.delete(x), st.dead.add(x)));
      }
    }
    return hits;
  };
  while (st.sunk.some((s) => !s)) {
    turns++;
    energy = Math.min(CAP, energy + 1);
    const d = density(st);
    // Hunting: no open hits, and (for Sonar) no positive sonar reading left to follow up.
    const hunting = st.hit.size === 0 && (!item?.hunt || !st.sonar.some((x) => x.left > 0));
    const late = st.sunk.filter((x) => !x).length <= item?.late;
    if (item && energy >= cost && (!item.hunt || hunting) && (!item.late || late)) {
      energy -= cost;
      spent += cost;
      uses++;
      itemCells += resolve(item.best(st, d).act(st));
      continue;
    }
    let bc = -1, bv = -1;
    for (let c = 0; c < N * N; c++) if (!st.shot.has(c) && !st.water.has(c) && d[c] > bv) [bv, bc] = [d[c], c];
    if (bc < 0) bc = [...Array(N * N).keys()].find((c) => !st.shot.has(c));
    shots++;
    shotCells += resolve([bc]);
  }
  return { turns, uses, itemCells, shots, shotCells, spent };
}

function run(label, item, cost) {
  const t = { turns: 0, uses: 0, itemCells: 0, shots: 0, shotCells: 0, spent: 0 };
  for (let g = 0; g < GAMES; g++) {
    const r = play(item, cost);
    for (const k in t) t[k] += r[k];
  }
  for (const k in t) t[k] /= GAMES;
  return { label, cost, ...t };
}

const late = (k) => ({ ...ITEMS.sonar, late: k });
const base = run('no items', null, 0);
const rows = [base];
// Rows: [label, item, cost]. "sonar late k": only while hunting with at most k ships afloat.
for (const [label, item, cost] of JSON.parse(process.env.ROWS ?? 'null') ?? [
  ['sonar', 'sonar', 2], ['sonar late 2', 'late2', 1], ['sonar late 2', 'late2', 2], ['sonar late 3', 'late3', 2],
  ['torpedo', 'torpedo', 3], ['torpedo', 'torpedo', 4],
  ['cross', 'cross', 4], ['line', 'line', 4], ['line', 'line', 5],
  ['air 5x5 +3', 'air23', 3], ['air 5x5 +4', 'air24', 4], ['air 3x3 +4', 'air14', 4],
]) rows.push(run(label, { late2: late(2), late3: late(3), air23: air(2, 3), air24: air(2, 4), air14: air(1, 4) }[item] ?? item, cost));

const f = (x, d = 2) => x.toFixed(d).padStart(7);
console.log(`${GAMES} games each, 10×10, fleet ${FLEET.join(' ')}, energy +1/turn cap ${CAP}`);
console.log('item'.padEnd(12), 'cost', '  turns', '  saved', 'sav/en', '   uses', 'cells/use', 'shot hit%');
for (const r of rows) {
  const saved = base.turns - r.turns;
  console.log(
    r.label.padEnd(12), String(r.cost).padStart(4), f(r.turns, 1), f(saved, 1), f(r.spent ? saved / r.spent : 0),
    f(r.uses, 1), f(r.uses ? r.itemCells / r.uses : 0).padStart(9), f((100 * r.shotCells) / r.shots, 0).padStart(9),
  );
}
