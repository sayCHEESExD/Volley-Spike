// `npm run check`: parse every server / shared / tools module with `node --check`
// (the repo has no TypeScript project to typecheck; the client is checked by `vite build`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = [];
for (const dir of ['server', 'shared', 'tools']) {
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'data' && f.name !== 'node_modules') walk(p); }
      else if (/\.(m?js)$/.test(f.name)) files.push(p);
    }
  })(dir);
}
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`✗ ${f}\n${String(e.stderr || e.message)}`); }
}
console.log(`${files.length - bad}/${files.length} files parse`);
process.exit(bad ? 1 : 0);
