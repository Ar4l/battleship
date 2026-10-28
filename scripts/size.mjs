// Gzip every dist asset, print a table, exit 1 when over budget.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGET = { html: 4.5 * KB, app: 16 * KB, net: 23 * KB, total: 40 * KB, first: 20 * KB };
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk('dist');
let total = 0;
const rows = [];
const sizes = { html: 0, app: 0, net: 0 };
for (const f of files) {
  const raw = readFileSync(f);
  const gz = gzipSync(raw, { level: 9 }).length;
  total += gz;
  const kind = f.endsWith('.html') ? 'html' : /assets\/index-/.test(f) ? 'app' : /\.js$/.test(f) ? 'net' : 'other';
  if (kind in sizes) sizes[kind] += gz;
  rows.push([f, raw.length, gz, kind]);
}
const fmt = (n) => (n / KB).toFixed(2).padStart(7) + ' KB';
console.log('asset'.padEnd(44), 'raw'.padStart(10), 'gzip'.padStart(10));
for (const [f, raw, gz] of rows) console.log(f.padEnd(44), fmt(raw), fmt(gz));
const first = sizes.html + sizes.app;
console.log('-'.repeat(66));
console.log('first load (html + app)'.padEnd(44), ''.padStart(10), fmt(first));
console.log('total'.padEnd(44), ''.padStart(10), fmt(total));
const breaches = [];
for (const k of ['html', 'app', 'net']) if (sizes[k] > BUDGET[k]) breaches.push(`${k} ${fmt(sizes[k])} > ${fmt(BUDGET[k])}`);
if (total > BUDGET.total) breaches.push(`total ${fmt(total)} > ${fmt(BUDGET.total)}`);
if (first > BUDGET.first) breaches.push(`first load ${fmt(first)} > ${fmt(BUDGET.first)}`);
if (breaches.length) {
  console.error('Over budget:\n  ' + breaches.join('\n  '));
  process.exit(1);
}
console.log('Within budget.');
