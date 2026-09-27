// experiments/challenge_c3_02.mjs — CHAOS-SMITH'S MURMUR CHALLENGE (round 3).
// C3-chaos-smith-02: every byte of murmur's receipted learning chains is
// load-bearing — adversarial byte flips are ALL rejected by murmur's OWN
// verifier, with zero-flip controls clean.
//
// RUN FROM THE quilt-murmur REPO ROOT (fully read-only w.r.t. the target):
//   node ../yiluodi/experiments/challenge_c3_02.mjs
//
// Predictions (pre-registered in fleet-seeds/tavern/challenges/chaos-smith.jsonl):
//   P1 the e41 chain (6 rows, genesis GENESIS) verifies ok under
//      murmur/receipts.mjs verifyChain — the repo's own module
//   P2 200 deterministic single-bit flips: 200/200 rejected (parse error or
//      verifyChain ok:false)
//   P3 50 deterministic case flips INSIDE row_hash hex chars: 50/50 rejected
//   P4 zero-flip control copies: 0 false alarms
// Exit 0 iff P1-P4 all hold. Seeds stated (fnv1a64 PRNG, 'C3-chaos-smith-02').

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const chainPath = path.join(cwd, 'experiments', 'outputs', 'receipts_e41.jsonl');
const murmur = await import('file://' + path.join(cwd, 'murmur', 'receipts.mjs'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-murmur-'));
const out = {};

const raw = fs.readFileSync(chainPath);
const rows0 = raw.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));

// P1: the repo's own verifier says the head chain is clean
const vHead = murmur.verifyChain(rows0, 'GENESIS');
out.P1_headVerifies = { rows: rows0.length, ok: vHead.ok, links: vHead.links ?? null };

// deterministic PRNG (fnv1a64, seeds stated)
const prng = (s, i) => { let h = 0xcbf29ce484222325n; const str = `${s}:${i}`; for (const c of str) { h ^= BigInt(c.charCodeAt(0)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return Number(h & 0x7fffffffn); };
const flipped = fs.readFileSync(chainPath); // fresh copy per trial below

// P2: 200 single-bit flips at deterministic (pos, bit)
let rejected = 0, escapes = [];
for (let b = 0; b < 200; b++) {
  const pos = prng('C3-chaos-smith-02', b) % raw.length;
  const bad = Buffer.from(flipped);
  bad[pos] ^= 1 << (b % 8);
  const f = path.join(tmp, 'flip.jsonl');
  fs.writeFileSync(f, bad);
  let detected = false;
  try {
    const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    detected = !murmur.verifyChain(rows, 'GENESIS').ok;
  } catch { detected = true; } // parse error counts as rejection
  if (detected) rejected++; else escapes.push({ pos, bit: b % 8 });
}
out.P2_bitFlips = { trials: 200, rejected, escapes };

// P3: 50 case flips inside row_hash hex chars (the E-C1 aliasing probe)
let caseRejected = 0, caseEscapes = [];
const hashSpots = [];
{ // find byte offsets of every row_hash hex substring
  const text = raw.toString('utf8');
  const re = /"row_hash":"0x[0-9a-f]{16}"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (let k = 0; k < 16; k++) hashSpots.push(m.index + 13 + k); // inside the 16 hex chars
  }
}
for (let b = 0; b < 50; b++) {
  const pos = hashSpots[prng('C3-chaos-smith-02-case', b) % hashSpots.length];
  const bad = Buffer.from(flipped);
  bad[pos] ^= 0x20; // the ASCII case bit
  const f = path.join(tmp, 'case.jsonl');
  fs.writeFileSync(f, bad);
  let detected = false;
  try {
    const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    detected = !murmur.verifyChain(rows, 'GENESIS').ok;
  } catch { detected = true; }
  if (detected) caseRejected++; else caseEscapes.push({ pos });
}
out.P3_hashCaseFlips = { trials: 50, rejected: caseRejected, escapes: caseEscapes };

// P4: zero-flip controls
let falseAlarms = 0;
for (let c = 0; c < 3; c++) {
  const f = path.join(tmp, 'ctrl.jsonl');
  fs.writeFileSync(f, raw);
  const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  if (!murmur.verifyChain(rows, 'GENESIS').ok) falseAlarms++;
}
out.P4_controlClean = { controls: 3, falseAlarms };

fs.rmSync(tmp, { recursive: true, force: true });
const pass = out.P1_headVerifies.ok && rejected === 200 && caseRejected === 50 && falseAlarms === 0;
console.log(JSON.stringify({ challenge: 'C3-chaos-smith-02', verdict: pass ? 'HOLDS' : 'FALSIFIED', out }, null, 1));
process.exit(pass ? 0 : 1);
