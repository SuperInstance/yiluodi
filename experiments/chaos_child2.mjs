// experiments/chaos_child2.mjs — the E-C2 VICTIM process (house pattern:
// quilt-arch/experiments/chaos_child.mjs). Runs the deterministic chaos
// script (chaos_world2.mjs, same seed as the parent's mirror) against a
// REAL yiluodi World and streams every journal event to a JSONL file
// through the TEST-ONLY adapter (chaos_persist2.mjs). The E-C2 parent
// SIGKILLs it at a randomized moment; whatever complete frames reached the
// file must recover as a byte-exact prefix of the intended stream.
//
// argv: --path <file> --actions <N> --seed <S> --mode fsync|buffer|torn
//       [--gap <ms>]   (torn mode: pause between the halves of each line)
//
// Prints one JSON line on clean exit: { ok, actions, events, tip }.
// The parent only trusts clean-exit facts when the child was ALIVE at kill
// time === false.

import fs from 'node:fs';
import { JournalFile2 } from './chaos_persist2.mjs';
import { buildChaosWorld, runScript, makeRng, TOTAL_ACTIONS } from './chaos_world2.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const path = arg('path', null);
const n = parseInt(arg('actions', String(TOTAL_ACTIONS)), 10);
const seed = parseInt(arg('seed', '1'), 10);
const mode = arg('mode', 'fsync');
const gapMs = parseInt(arg('gap', '2'), 10);

if (!path) {
  console.error('chaos_child2: --path required');
  process.exit(2);
}
try { fs.unlinkSync(path); } catch { /* first run */ }

const world = buildChaosWorld(seed);
const jf = new JournalFile2(path, { fsyncEvery: mode === 'fsync' ? 1 : 0 });

runScript(world, makeRng(seed), n, (i, a, before) => {
  if (mode === 'torn') {
    // torn arm: every event line of this action goes out in two chunks
    const evs = world.journal.events.slice(before);
    for (const ev of evs) jf.appendTornableLine(JSON.stringify(ev), gapMs);
  } else {
    jf.appendSince(world, before);
  }
});

jf.close();
console.log(JSON.stringify({
  ok: true,
  actions: n,
  events: world.journal.events.length,
  tip: world.journal.verify().tip,
}));
