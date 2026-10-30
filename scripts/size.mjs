// Gzip (level 9) every dist asset, print a table, exit 1 when over budget.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1000;
// Budgets (gzip -9). The hard one is `session`: everything a code game downloads
// (html + entry + Trystero). It was "well under 40 KB"; board sizes, islands, Russian
// mode, Airstrike and prefire raised it to 44 KB, and round 5 (independent fleet / turns /
// items settings, simultaneous salvo) to 44.5 KB after trimming what it could, and round 6
// (item pickups, scattered airstrike, item prefire) to 45.5 KB, and round 7 (stats: series score,
// player id and name in HELLO, the game log) to 46 KB. PLAN.md §12 has the breakdown. The per-file numbers are guard rails with a little slack, so a small CSS
// change doesn't fail a deploy while the total still fits.
const BUDGET = { html: 6.0 * KB, entry: 25.1 * KB, trystero: 15.3 * KB, direct: 4.5 * KB, session: 46.0 * KB };

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk('dist');

const kindOf = (f) =>
  f.endsWith('.html') ? 'html'
  : /assets\/index-/.test(f) ? 'entry'
  : /assets\/dist-/.test(f) ? 'trystero'
  : /assets\/(direct|sdp|forward)-/.test(f) ? 'direct'
  : /assets\/debug-/.test(f) ? 'debug (tests only)'
  : /assets\/stats-/.test(f) ? 'stats (on opening it)'
  : /assets\/art-/.test(f) ? 'art (wide screens)'
  : 'other';

const sizes = {};
const fmt = (n) => (n / KB).toFixed(1).padStart(6) + ' KB';
console.log('asset'.padEnd(40), 'kind'.padEnd(20), 'raw'.padStart(9), 'gzip'.padStart(9));
for (const f of files.sort()) {
  const raw = readFileSync(f);
  const gz = gzipSync(raw, { level: 9 }).length;
  const kind = kindOf(f);
  sizes[kind] = (sizes[kind] ?? 0) + gz;
  console.log(f.padEnd(40), kind.padEnd(20), fmt(raw.length), fmt(gz));
}
const s = (k) => sizes[k] ?? 0;
const first = s('html') + s('entry');
const session = first + s('trystero');
const direct = first + s('direct');
console.log('-'.repeat(81));
console.log('first load, before any click (html + entry)'.padEnd(71), fmt(first));
console.log('code game via Trystero (first + trystero)'.padEnd(71), fmt(session));
console.log('direct-link game (first + direct)'.padEnd(71), fmt(direct));
console.log('everything a player can ever download'.padEnd(71), fmt(session + s('direct') + s('stats (on opening it)') + s('art (wide screens)')));

const breaches = [];
for (const k of ['html', 'entry', 'trystero', 'direct']) if (s(k) > BUDGET[k]) breaches.push(`${k} ${fmt(s(k))} > ${fmt(BUDGET[k])}`);
if (session > BUDGET.session) breaches.push(`session ${fmt(session)} > ${fmt(BUDGET.session)}`);
if (breaches.length) {
  console.error('Over budget:\n  ' + breaches.join('\n  '));
  process.exit(1);
}
console.log('Within budget.');
