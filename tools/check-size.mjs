// Fails the build if client/dist exceeds Bloxity's 12 MB asset budget.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
const LIMIT = 12 * 1024 * 1024;
let total = 0;
const rows = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else { total += st.size; rows.push([path.relative(dist, p), st.size]); }
  }
})(dist);
rows.sort((a, b) => b[1] - a[1]);
for (const [f, s] of rows) console.log(`${(s / 1024).toFixed(1).padStart(9)} KB  ${f}`);
console.log(`\nTotal: ${(total / 1024 / 1024).toFixed(2)} MB of ${(LIMIT / 1024 / 1024).toFixed(0)} MB budget`);
if (total > LIMIT) { console.error('BUILD TOO LARGE'); process.exit(1); }
