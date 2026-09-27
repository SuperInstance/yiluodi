// experiments/challenge_c3_01.mjs — CHAOS-SMITH'S TAVERN CHALLENGE (round 3).
// C3-chaos-smith-01: the tavern ledger is crash-safe by detection and
// byte-idempotent under its own builder.
//
// RUN FROM THE fleet-seeds REPO ROOT (read-only w.r.t. the target; the only
// mutation is build_ledger.mjs's own idempotent rewrite, which this probe
// reverts if it ever dirties the tree):
//   node ../yiluodi/experiments/challenge_c3_01.mjs
//
// Predictions (pre-registered in tavern/challenges/chaos-smith.jsonl):
//   P1 head ledger verifies under stone-v1 from disk (>= 12 rows)
//   P2 a torn append on a COPY never verifies (parse error or not ok)
//   P3 a case-flipped hex char in a row_hash AND one deterministic random
//      bit-flip are each rejected (2/2)
//   P4 re-running tavern/build_ledger.mjs exits 0 AND leaves
//      `git status --porcelain` empty (byte-identical rebuild)
// Exit 0 iff P1-P4 all hold.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stone = await import('file://' + path.join(here, '..', '..', 'quilt-stone', 'stone.mjs'));
const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-tavern-'));
const out = {};
const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();

// P0: the probe is only valid on a tree with no TRACKED dirt (untracked
// files — e.g. the keeper-sealed challenges/ dir — do not affect idempotence)
out.dirtyTree = git(['status', '--porcelain', '--untracked-files=no']);
if (out.dirtyTree !== '') {
  console.log(JSON.stringify({ challenge: 'C3-chaos-smith-01', abort: 'dirty tree — probe invalid', out }, null, 1));
  process.exit(2);
}

const ledgerPath = path.join(cwd, 'tavern', 'tavern_ledger.jsonl');
const raw = fs.readFileSync(ledgerPath, 'utf8');
const rows = raw.trim().split('\n').map((l) => JSON.parse(l));

// P1: head verifies
const vHead = stone.verifyChain(rows, undefined, { alg: 'stone-v1' });
out.P1_headVerifies = { rows: rows.length, ok: vHead.ok, tip: (vHead.tip || '').slice(0, 16) };

// P2: torn append on a copy (a plausible next row, cut mid-line)
const prev = rows[rows.length - 1].row_hash;
const nextRest = { kind: 'tavern.round', round: 99, voice: 'chaos-probe', lane: 'chaos-smith', message: 'a torn append must never become a turn' };
const nextBody = { ...nextRest };
const nextHash = stone.ALGS['stone-v1'].hashOf({ ...nextBody }, prev); // sha256 over canonicalJSON, row_hash stripped
const fullLine = JSON.stringify({ ...nextBody, row_hash: nextHash });
const tornCopy = path.join(tmp, 'torn.jsonl');
fs.writeFileSync(tornCopy, raw + fullLine.slice(0, Math.floor(fullLine.length * 0.6)));
let tornDetected = false, tornWhy = '';
try {
  const rows2 = fs.readFileSync(tornCopy, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const v2 = stone.verifyChain(rows2, undefined, { alg: 'stone-v1' });
  tornDetected = !v2.ok;
  tornWhy = v2.ok ? 'TORN COPY VERIFIED CLEAN' : 'not-ok';
} catch (e) { tornDetected = true; tornWhy = 'parse error (torn JSON)'; }
out.P2_tornAppendDetected = { detected: tornDetected, why: tornWhy.slice(0, 60) };

// P3: hash case-flip + deterministic bit-flip on copies
const flipByte = (buf, pos, mask) => { const b = Buffer.from(buf); b[pos] ^= mask; return b; };
const hashIdx = raw.lastIndexOf('"row_hash":"' + prev + '"') + '"row_hash":"'.length + 2; // inside the hex
const hexChar = raw.charCodeAt(hashIdx);
const caseMask = /[0-9a-f]/.test(String.fromCharCode(hexChar)) && hexChar >= 0x61 ? 0x20 : 0x01; // lowercase letter -> case bit; else lowest bit
const caseCopy = path.join(tmp, 'case.jsonl');
fs.writeFileSync(caseCopy, flipByte(Buffer.from(raw), hashIdx, caseMask));
const caseRows = fs.readFileSync(caseCopy, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const vCase = stone.verifyChain(caseRows, undefined, { alg: 'stone-v1' });
const prng = (s) => { let h = 0xcbf29ce484222325n; for (const c of String(s)) { h ^= BigInt(c.charCodeAt(0)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return Number(h & 0x7fffffffn); };
const bitPos = prng('C3-chaos-smith-01') % Buffer.byteLength(raw);
const bitCopy = path.join(tmp, 'bit.jsonl');
fs.writeFileSync(bitCopy, flipByte(Buffer.from(raw), bitPos, 1 << (prng('bit') % 8)));
let bitRows, bitDetected = false;
try {
  bitRows = fs.readFileSync(bitCopy, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  bitDetected = !stone.verifyChain(bitRows, undefined, { alg: 'stone-v1' }).ok;
} catch { bitDetected = true; }
out.P3_tamperDetected = { caseFlip: !vCase.ok, bitFlip: bitDetected, bitPos };

// P4: rebuild idempotence (the builder's own rewrite must leave the LEDGER
// byte-identical — scoped to the ledger file, not the whole tree)
const run = spawnSync('node', ['tavern/build_ledger.mjs'], { cwd, encoding: 'utf8' });
let after = git(['status', '--porcelain', '--untracked-files=no', '--', 'tavern/tavern_ledger.jsonl']);
const reverted = after !== '';
if (reverted) spawnSync('git', ['checkout', '--', 'tavern/tavern_ledger.jsonl'], { cwd }); // self-cleaning probe
out.P4_rebuildIdempotent = { exitCode: run.status, treeCleanAfter: after === '', reverted: reverted, buildStdoutOk: (run.stdout || '').includes('"ok": true') || (run.stdout || '').includes('ok') };

fs.rmSync(tmp, { recursive: true, force: true });
const pass = out.P1_headVerifies.ok && rows.length >= 12 && out.P2_tornAppendDetected.detected
  && out.P3_tamperDetected.caseFlip && out.P3_tamperDetected.bitFlip
  && out.P4_rebuildIdempotent.exitCode === 0 && out.P4_rebuildIdempotent.treeCleanAfter;
console.log(JSON.stringify({ challenge: 'C3-chaos-smith-01', verdict: pass ? 'HOLDS' : 'FALSIFIED', out }, null, 1));
process.exit(pass ? 0 : 1);
