// yiluodi/experiments/e_l4_wasm.mjs — L4: the kernel in the metal.
//
// The WASM module in app/wasmq32.js is hand-assembled from bytes (no
// toolchain, no dependencies). This experiment admits it to the fleet:
//
//   R1 MODULE        : the bytes instantiate as valid WASM, export qmul,
//                      and the module size is receipted (bytes ARE the artifact).
//   R2 BIT-EXACTNESS : qmul(a,b) == Q32.checkedMul(a,b) over corners
//                      (16x16 grid including i64 MIN/MAX, the arch boundary
//                      constants) + 200,000 random i64 pairs — 0 mismatches.
//   R3 TIMING        : honest wall-clock comparison on the same machine,
//                      same inputs (BigInt reference vs WASM kernel).

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const EXO = require('../app/engine.js');
const SCENARIO = require('../app/elephant.js');
const WASMQ32 = require('../app/wasmq32.js');

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'outputs');

const chain = new EXO.Chain('YILUODI-E-L4-GENESIS');
const verdicts = [];
const verdict = (id, ok, detail) => {
  verdicts.push({ id, ok, detail });
  chain.seal('verdict', { id, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
};

chain.seal('rule', { id: 'R1-ref', def: 'the module bytes are the artifact; size and hash receipted' });
chain.seal('rule', { id: 'R2-ref', def: 'reference = Q32.checkedMul (exact i128 product, floor shift, as-i64 wrap); corners include i64 MIN/MAX and the arch boundary constants' });
chain.seal('rule', { id: 'R3-ref', def: 'timing = wall clock over identical input sets, same process, reported honestly (not a gate)' });

// ── R1: the bytes are the artifact ───────────────────────────────────────
const inst = WASMQ32.instantiate();
{
  const bytes = inst.bytes;
  const hash = EXO.fnv1a64(Array.from(bytes).join(','));
  const ok = !inst.error && typeof inst.qmul === 'function' && bytes.length > 0;
  verdict('R1-module', ok, ok
    ? `${bytes.length} bytes, fnv ${hash}, exports qmul(i64,i64)->i64`
    : `instantiate failed: ${inst.error}`);
}

// ── R2: bit-exactness vs the reference ───────────────────────────────────
if (!inst.error) {
  const qmul = inst.qmul;
  const MIN = -(2n ** 63n), MAX = (2n ** 63n) - 1n;
  const corners = [0n, 1n, -1n, 2n, -2n, 1n << 32n, (1n << 32n) - 1n, -(1n << 32n),
    1n << 31n, -(1n << 31n), MAX, MIN, 6806210843n, 6806210844n, 2863311530n, 4294967295n];
  let mism = 0, n = 0;
  const check = (a, b) => {
    const got = qmul(a, b);
    const want = EXO.Q32.fromRaw(a).mul(EXO.Q32.fromRaw(b)).r;
    if (got !== want) { mism++; if (mism <= 3) console.log(`    qmul mismatch at ${a}*${b}: got ${got} want ${want}`); }
    n++;
  };
  for (const a of corners) for (const b of corners) check(a, b);
  const rng = SCENARIO.mulberry32(0x40e4);
  for (let i = 0; i < 200000; i++) {
    const a = BigInt.asIntN(64, (BigInt(Math.floor(rng() * 4294967296)) << 32n) | BigInt(Math.floor(rng() * 4294967296)));
    const b = BigInt.asIntN(64, (BigInt(Math.floor(rng() * 4294967296)) << 32n) | BigInt(Math.floor(rng() * 4294967296)));
    check(a, b);
  }
  verdict('R2-bit-exact', mism === 0,
    `${n} pairs (16x16 corners + 200k random) vs checkedMul, ${mism} mismatches — the no-i128 identity holds`);
} else {
  verdict('R2-bit-exact', false, 'skipped: no module');
}

// ── R3: honest timing ────────────────────────────────────────────────────
if (!inst.error) {
  const qmul = inst.qmul;
  const rng = SCENARIO.mulberry32(0x40e5);
  const inputs = [];
  for (let i = 0; i < 200000; i++) {
    inputs.push([
      BigInt.asIntN(64, BigInt(Math.floor(rng() * 4294967296))),
      BigInt.asIntN(64, BigInt(Math.floor(rng() * 4294967296))),
    ]);
  }
  const time = (fn) => {
    const t0 = process.hrtime.bigint();
    let sink = 0n;
    for (const [a, b] of inputs) sink ^= fn(a, b);
    const t1 = process.hrtime.bigint();
    return { ms: Number(t1 - t0) / 1e6, sink: sink !== 0n };
  };
  const js = time((a, b) => EXO.Q32.fromRaw(a).mul(EXO.Q32.fromRaw(b)).r);
  const wasm = time(qmul);
  verdict('R3-timing', true, // reported, not gated — honest telemetry
    `200k mul: BigInt reference ${js.ms.toFixed(1)}ms, WASM kernel ${wasm.ms.toFixed(1)}ms (${(js.ms / wasm.ms).toFixed(2)}x) — both consumed identical inputs, sinks sane: js=${js.sink} wasm=${wasm.sink}`);
}

const summary = {
  experiment: 'e_l4_wasm',
  title: 'the kernel in the metal',
  verdicts,
  ok: verdicts.every((v) => v.ok),
  moduleBytes: inst.bytes ? inst.bytes.length : 0,
  chainTip: chain.tip,
  chainLinks: chain.rows.length,
};
writeFileSync(join(outDir, 'e_l4_summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, 'receipts_e_l4.jsonl'), chain.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\n  chain: ${summary.chainLinks} links, tip ${summary.chainTip} — ${chain.verify().ok ? 'VERIFIED' : 'BROKEN'}`);
process.exit(summary.ok ? 0 : 1);
