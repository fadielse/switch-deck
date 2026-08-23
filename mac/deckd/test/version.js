// Satu angka versi yang ditulis di dua tempat akan berbeda cepat atau lambat,
// dan yang salah adalah yang dilihat orang (layar) — bukan yang dibaca alat.
// Jadi keduanya dicocokkan di sini, bukan diserahkan ke kedisiplinan.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { c ? pass++ : fail++;
  console.log((c ? '[PASS] ' : '[FAIL] ') + m + (d ? ' — ' + d : '')); };

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const page = readFileSync(join(root, 'web', 'index.html'), 'utf8');
const m = page.match(/var VERSION = '([^']+)'/);

ok(!!m, 'client punya VERSION');
ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package.json versi semver', pkg.version);
ok(m && m[1] === pkg.version,
   'versi di client sama dengan package.json',
   m ? `client ${m[1]} vs package ${pkg.version}` : 'client tidak punya');

// Angka yang tidak pernah tampil sama tidak bergunanya dengan tidak ada.
ok(page.includes("el('v-version').textContent = VERSION"),
   'versi benar-benar digambar ke layar');

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
