// yiluodi/experiments/run_all.mjs — the L-ladder, in order, with receipts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const experiments = ['e_l1_core.mjs', 'e_l2_elephant.mjs', 'e_l3_routing.mjs', 'e_l4_wasm.mjs'];

let fails = 0;
for (const exp of experiments) {
  console.log(`\n=== ${exp} ===`);
  const r = spawnSync(process.execPath, [join(here, exp)], { stdio: 'inherit' });
  if (r.status !== 0) { console.log(`*** ${exp} FAILED (exit ${r.status})`); fails++; }
}
console.log(`\n=== L-ladder: ${experiments.length - fails}/${experiments.length} green ===`);
process.exit(fails ? 1 : 0);
