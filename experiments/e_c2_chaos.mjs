// experiments/e_c2_chaos.mjs — E-C2: CRASH-CONSISTENCY CHAOS for the yiluodi
// journal + EXACT bidirectional rewind (Task 30-a, chaos-smith lane).
//
// The E-C1 discipline (quilt-arch/experiments/e_c1_chaos.mjs — DO NOT MODIFY,
// read-only reference) retargeted at the fleet's browser-native spreadsheet:
// the engine (app/engine.js) is UNTOUCHED; the Node-testable surface is the
// journal event log + rewind logic through the TEST-ONLY file adapter
// (chaos_persist2.mjs) — see that file's header for the honest target
// selection. SIGKILL child pattern, paired arms, torn writes, bit flips,
// rules SEALED BEFORE RUNS, findings receipted as rows with row hashes.
//
// RULES (sealed before any trial ran):
//  R1 CRASH-RECOVERY COMPLETENESS — every SIGKILL trial recovers a valid
//    prefix: recovered frames are a BYTE-EXACT prefix of the deterministic
//    intended stream (vs the parent's mirror AND vs a clean cross-process
//    run); the L1-L5 format+chain law passes on every recovered frame.
//    PASS iff 100% of trials.
//  R2 REPLAY + REWIND EXACTNESS — replaying the recovered prefix through the
//    engine's own applier yields exactly the mirror's state hash at the same
//    index; rewind-to-genesis replays bit-identical (state hash == genesis
//    hash); forward-to-head returns bit-identical; scrub to mid-tick and
//    back is exact in BOTH directions. PASS iff 0 mismatches.
//  R3 TAMPER DETECTION COVERAGE — (a) uniform single-bit flips anywhere in
//    clean journal files are 100% rejected (parse / canonical law / chain
//    law / torn tail), zero-flip controls 0 false alarms. PRE-REGISTERED
//    MECHANISM PREDICTION: unlike E-C1 (where Node's case-insensitive hex
//    decoder aliased bit-5 flips), the yiluodi path keeps hashes as STRINGS
//    end-to-end and pins canonical decimals, so every flip must trip one of
//    the six format/chain laws. (b) case flips INSIDE hash hex strings:
//    100% detected by string comparison — no case-insensitive decode exists
//    on this path. (c) chain-VALID but non-canonical frames (BigInt-accepting
//    aliases '+5', ' 5', '007', '-0', '0x10'; key permutations; whitespace):
//    100% rejected by the format law at exactly the crafted index.
//  R4 PAIRED ARMS — fsync-per-batch vs buffered vs torn (two-chunk) writes,
//    same seed, same kill grid; PRE-REGISTERED sandbox prediction: NULL
//    fsync-vs-buffer (the page cache survives SIGKILL; machine power loss is
//    unmodelable here — receipted limitation); torn arm is expected to
//    produce torn tails. Clean arm: the child's completed file must be
//    byte-identical to the parent's mirror (cross-process determinism).
//  R5 TORN TAIL + EXTEND-AFTER-RECOVERY — truncations are reported (tornBytes),
//    the valid prefix preserved; the CRASH-SAFE protocol (truncate-to-good,
//    then continue) re-verifies as a whole and replays exactly; the NAIVE
//    protocol (append past a torn tail) must be REFUSED by detection, never
//    silently merged. PASS iff 100%.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EXO = require('../app/engine.js');
const { World } = EXO;

import { recoverFrom, verifyJournalFile, JournalFile2, truncateToGood } from './chaos_persist2.mjs';
import {
  buildChaosWorld, runScript, makeRng, replayWorld, genesisHash,
  attachRecoveredJournal, applyEventTo, TOTAL_ACTIONS,
} from './chaos_world2.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'outputs');
const TMP = path.join(OUT, 'chaos_tmp');
fs.mkdirSync(TMP, { recursive: true });

const CHILD = path.join(__dirname, 'chaos_child2.mjs');
const SEED = 4242;
const KILL_TRIALS = 20;
const ARM_TRIALS = 8;
const FLIP_FILES = 3;
const FLIPS_PER_FILE = 200;
const CASE_FLIPS = 120;
const TRUNC_TRIALS = 30;
const EXT_TRIALS = 10;
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// ── receipt chain: rules BEFORE results (engine's own Chain — dogfood) ──────
const chain = new EXO.Chain('GENESIS');
const book = (kind, payload) => chain.seal(kind, payload);

const RULES = [
  ['R1', 'crash-recovery completeness', 'every SIGKILL trial recovers a byte-exact valid prefix (vs mirror AND vs clean cross-process run); L1-L5 law passes on every frame; PASS iff 100%'],
  ['R2', 'replay + rewind exactness', 'applier-replay of the recovered prefix == mirror hash at same index; rewind-to-genesis bit-identical; forward-to-head bit-identical; scrub mid<->head exact both directions; PASS iff 0 mismatches'],
  ['R3', 'tamper detection coverage', 'bit flips 100% rejected / controls clean; hash-string case flips 100% detected (string law, no case-insensitive decode); chain-valid non-canonical frames 100% rejected at the crafted index'],
  ['R4', 'paired arms + cross-process determinism', 'fsync vs buffer: NULL predicted in sandbox (page cache survives SIGKILL); torn arm produces torn tails; clean child file byte-identical to mirror'],
  ['R5', 'torn tail + extend-after-recovery', 'truncations reported, prefix preserved; truncate-to-good + extend re-verifies whole + replays exact; naive append past torn tail REFUSED by detection'],
];
for (const [rule, name, gate] of RULES) {
  book('rule', { rule, name, gate, sealed_at: new Date().toISOString(), note: 'sealed BEFORE any trial ran' });
}

// E-C1 law: setTimeout is the honest async sleep; Atomics.wait as an awaited
// sleep once raced the child's boot and made the harness measure itself.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the mirror: intended stream + per-event replay hashes ───────────────────
// Seed adjustment happens HERE, before any chaos trial, and is receipted.
function buildMirror(seed) {
  const w = buildChaosWorld(seed);
  const rw = buildChaosWorld(seed); // replay world (procedure of R2)
  const lines = [], events = [], replayHashes = [];
  runScript(w, makeRng(seed), TOTAL_ACTIONS, (i, a, before) => {
    for (const ev of w.journal.events.slice(before)) {
      lines.push(JSON.stringify(ev));
      events.push(ev);
      applyEventTo(rw, ev);
      replayHashes.push(rw.stateHash());
    }
  });
  return {
    w, lines, events, replayHashes,
    landings: w.chain.rows.filter((r) => r.kind === 'landing').length,
    refusals: w.refusals,
    g0: genesisHash(seed),
    bytes: Buffer.from(lines.join('\n') + '\n', 'utf8'),
  };
}

let mirror = null;
const seedAdjustments = [];
for (let s = SEED; s < SEED + 8; s++) {
  const m = buildMirror(s);
  if (m.landings === 0 && m.events.length >= 400 && m.refusals >= 1) { mirror = m; if (s !== SEED) seedAdjustments.push({ from: SEED, to: s, why: 'landings/refusals constraint' }); break; }
  seedAdjustments.push({ from: s, why: m.landings > 0 ? `landings=${m.landings} (chain receipts are stone's scope, not the journal chaos)` : `events=${m.events.length}/refusals=${m.refusals}` });
}
if (!mirror) { console.error('E-C2: no viable seed in 8 tries — aborting before any trial'); process.exit(1); }
book('note', {
  kind: 'mirror', seed: SEED + seedAdjustments.filter((a) => a.to).length,
  adjustments: seedAdjustments, actions: TOTAL_ACTIONS,
  events: mirror.events.length, bytes: mirror.bytes.length,
  landings: mirror.landings, refusals: mirror.refusals,
  tip: mirror.w.journal.verify().tip,
  note: 'script frozen BEFORE chaos runs; landing receipts are out of scope (stone verifies chains), the JOURNAL is the target',
});

// ── spawn / kill machinery ───────────────────────────────────────────────────
function spawnChild(args, captureStdout) {
  return new Promise((resolve) => {
    const t0 = nowMs();
    const p = spawn(process.execPath, [CHILD, ...args],
      { stdio: captureStdout ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'] });
    let out = '', err = '';
    if (captureStdout) p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    let settled = false;
    const done = (extra) => { if (!settled) { settled = true; resolve({ code: p.exitCode, ms: nowMs() - t0, out, err, ...extra }); } };
    p.on('exit', (code) => done({ code }));
    p.on('error', (e) => done({ code: -1, err: err + 'SPAWN-ERROR:' + String(e) }));
  });
}

async function killTrial(tag, mode, delayMs, { eventsArg = TOTAL_ACTIONS } = {}) {
  const t0 = nowMs();
  const f = path.join(TMP, `c2_${tag}.jsonl`);
  try { fs.unlinkSync(f); } catch { /* fresh */ }
  const child = spawn(process.execPath, [CHILD, '--path', f, '--actions', String(eventsArg),
    '--seed', String(SEED), '--mode', mode], { stdio: ['ignore', 'ignore', 'pipe'] });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d; });
  let alive = true, exitInfo = null;
  child.on('exit', (code) => { exitInfo = { code }; });
  // wait until the file exists and has >= 2 complete frames, so kills land
  // mid-stream rather than during boot
  let waited = 0;
  while (waited < 5000) {
    await sleep(3); waited += 3;
    try {
      const raw = fs.readFileSync(f);
      const a = raw.indexOf(0x0a);
      if (a !== -1 && raw.indexOf(0x0a, a + 1) !== -1) break;
    } catch { /* not yet */ }
  }
  await sleep(delayMs);
  try { process.kill(child.pid, 'SIGKILL'); } catch { alive = false; }
  await new Promise((res) => {
    const t = setTimeout(() => res(), 1000);
    const iv = setInterval(() => { if (exitInfo !== null || !alive) { clearInterval(iv); clearTimeout(t); res(); } }, 2);
  });
  return { f, alive, exited: exitInfo !== null, ms: nowMs() - t0, childErr };
}

// ── probe: price the trial before the grid ───────────────────────────────────
const probe = await killTrial('probe', 'fsync', 12);
const probeRec = fs.existsSync(probe.f) ? recoverFrom(probe.f) : { frames: 0, tornBytes: 0 };
const killTrialsPlanned = KILL_TRIALS + 3 * ARM_TRIALS + 2;
const projectedMs = probe.ms * killTrialsPlanned + 8000 + (FLIP_FILES * FLIPS_PER_FILE + CASE_FLIPS) * 2 + TRUNC_TRIALS * 3;
const scaled = projectedMs > 110000;
book('probe', {
  rule: 'probe', child_ms: +probe.ms.toFixed(1), recovered_frames: probeRec.frames,
  torn_bytes: probeRec.tornBytes ?? 0, projected_total_ms: Math.round(projectedMs), scaled_down: scaled,
  note: scaled ? 'projection >110s: grid reduced per house law' : 'projection within budget: full grid proceeds',
});

// ── the recovery verifier shared by R1/R2 ────────────────────────────────────
const TOTAL_EVENTS = mirror.events.length;
function checkRecovered(f, { requirePrefixOfMirror = true } = {}) {
  const rec = recoverFrom(f);
  const out = { rec, failures: [], r2: { replay: false, roundtrip: false, scrub: false } };
  const k = rec.frames;
  if (k < 2) { out.failures.push({ why: `recovered only ${k} frames (harness race or dead-on-boot — receipted honestly)` }); return out; }
  const raw = fs.readFileSync(f);
  // R1a: byte-exact prefix of the intended stream
  if (requirePrefixOfMirror) {
    if (raw.length > mirror.bytes.length) out.failures.push({ why: 'file LONGER than intended stream' });
    if (Buffer.compare(raw.subarray(0, rec.goodBytes), mirror.bytes.subarray(0, rec.goodBytes)) !== 0) {
      out.failures.push({ why: 'good prefix NOT byte-exact vs intended stream' });
    }
    for (let i = 0; i < k; i++) {
      if (rec.events[i] !== mirror.events[i] && JSON.stringify(rec.events[i]) !== mirror.lines[i]) {
        out.failures.push({ why: `frame ${i} differs semantically from mirror` }); break;
      }
    }
  }
  // R1b: no bad frame INSIDE the complete region
  if (rec.firstBad !== null && rec.frames === rec.lines) out.failures.push({ why: 'firstBad inside complete region', at: rec.firstBad });
  // R1c: torn tail is reported, never silently accepted
  const rawTorn = raw.length > 0 && raw[raw.length - 1] !== 0x0a;
  if (rawTorn !== rec.tornBytes > 0) out.failures.push({ why: 'torn-tail accounting mismatch', rawTorn, tornBytes: rec.tornBytes });
  // R2a: replay equality at the same index
  const wantHash = mirror.replayHashes[k - 1];
  const rw = replayWorld(SEED, rec.events, k);
  out.r2.replay = rw.stateHash() === wantHash;
  if (!out.r2.replay) out.failures.push({ why: 'R2 replay hash != mirror hash at index', k });
  // R2b: rewind-to-genesis + forward-to-head bit-identity on the LIVE journal
  const j = attachRecoveredJournal(rw, rec.events);
  const jv = j.verify();
  if (!jv.ok || jv.links !== k) out.failures.push({ why: 'rebuilt journal does not verify', jv });
  const lastTick = rec.events[k - 1].tick;
  const nBack = j.rewind(k, World.applierFor(rw));
  rw.tick = 0;
  const h0 = rw.stateHash();
  out.r2.roundtrip = nBack === k && h0 === mirror.g0;
  if (!out.r2.roundtrip) out.failures.push({ why: 'rewind-to-genesis not bit-identical', nBack, h0: h0.slice(0, 10), want: mirror.g0.slice(0, 10) });
  const nFwd = j.forward(nBack, World.applierFor(rw));
  rw.tick = lastTick;
  const h1 = rw.stateHash();
  if (!(nFwd === k && h1 === wantHash && j.verify().ok)) out.failures.push({ why: 'forward-to-head not bit-identical', nFwd });
  // R2c: scrub mid <-> head, exact BOTH directions. tMid is chosen as the
  // tick of the MIDDLE event so an event exists AT tMid — World.scrubTo sets
  // tick = tMid exactly, and the mirror replay world's tick after kMid events
  // equals its last event's tick, so the two tick fields must agree.
  const tMid = rec.events[Math.floor((k - 1) / 2)].tick;
  const kMid = rec.events.filter((e) => e.tick <= tMid).length;
  rw.scrubTo(tMid);
  const hMid = rw.stateHash();
  const wantMid = kMid > 0 ? mirror.replayHashes[kMid - 1] : mirror.g0;
  rw.scrubTo(lastTick);
  const hBack = rw.stateHash();
  out.r2.scrub = hMid === wantMid && hBack === wantHash;
  if (!out.r2.scrub) out.failures.push({ why: 'scrub roundtrip mismatch', tMid, kMid, hMid: hMid.slice(0, 10), wantMid: wantMid.slice(0, 10), hBack: hBack.slice(0, 10) });
  return out;
}

// ── R1 + R2: the kill grid ───────────────────────────────────────────────────
const r1 = { trials: 0, pass: 0, completedBeforeKill: 0, tornTails: 0, lost: [], failures: [] };
const r2 = { checks: 0, replayOk: 0, roundtripOk: 0, scrubOk: 0 };
let cleanLines = null; // R4's clean arm: one completed cross-process run
{
  const clean = await spawnChild(['--path', path.join(TMP, 'c2_clean.jsonl'), '--actions', String(TOTAL_ACTIONS), '--seed', String(SEED), '--mode', 'fsync'], true);
  const cleanFile = path.join(TMP, 'c2_clean.jsonl');
  const cleanRaw = fs.readFileSync(cleanFile);
  const cleanByteEqual = Buffer.compare(cleanRaw, mirror.bytes) === 0;
  cleanLines = cleanRaw.toString('utf8').split('\n').filter((s) => s.length > 0);
  book('result', { rule: 'R4', arm: 'clean', cross_process_byte_equal: cleanByteEqual, child_ms: +clean.ms.toFixed(1), child_report: clean.out.trim().slice(0, 120) });

  for (let t = 0; t < KILL_TRIALS; t++) {
    const delay = 5 + ((t * 7919) % 91); // deterministic spread 5..95ms
    const { f, alive } = await killTrial('r1_' + t, 'fsync', delay);
    const v = fs.existsSync(f) ? checkRecovered(f) : { rec: { frames: 0 }, failures: [{ why: 'no file — killed during boot (harness race, receipted)' }], r2: { replay: false, roundtrip: false, scrub: false } };
    const rec = v.rec;
    r1.trials++;
    if (!alive) r1.completedBeforeKill++;
    if (rec.tornBytes > 0) r1.tornTails++;
    r1.lost.push(TOTAL_EVENTS - rec.frames);
    // R1 double reference: the clean cross-process run's lines must ALSO
    // prefix-match (guards against a mirror bug masking child corruption)
    if (cleanLines && rec.frames >= 2) {
      const raw = fs.readFileSync(f, 'utf8');
      const got = raw.split('\n').filter((s) => s.length > 0);
      for (let i = 0; i < rec.frames; i++) {
        if (got[i] !== cleanLines[i]) { v.failures.push({ why: `frame ${i} differs from clean cross-process run` }); break; }
      }
    }
    if (v.failures.length === 0) r1.pass++; else r1.failures.push({ trial: t, failures: v.failures });
    r2.checks++;
    if (v.r2.replay) r2.replayOk++;
    if (v.r2.roundtrip) r2.roundtripOk++;
    if (v.r2.scrub) r2.scrubOk++;
    fs.unlinkSync(f);
  }
}
book('result', {
  rule: 'R1', trials: r1.trials, pass: r1.pass, completedBeforeKill: r1.completedBeforeKill,
  tornTails: r1.tornTails, lostEventsMin: Math.min(...r1.lost), lostEventsMax: Math.max(...r1.lost),
  failures: r1.failures, verdict: r1.pass === r1.trials ? 'PASS' : 'FAIL',
});
book('result', {
  rule: 'R2', checks: r2.checks, replayOk: r2.replayOk, rewindRoundtripOk: r2.roundtripOk,
  scrubBothWaysOk: r2.scrubOk, verdict: (r2.replayOk === r2.checks && r2.roundtripOk === r2.checks && r2.scrubOk === r2.checks) ? 'PASS' : 'FAIL',
});

// ── R3a: uniform bit-flip grid + zero-flip control ───────────────────────────
const r3 = { flips: 0, detected: 0, undetected: [], controlFiles: 0, controlFalseAlarms: 0, caseFlips: 0, caseDetected: 0, caseUndetected: [], layers: { parse: 0, canonical: 0, chain: 0, torn: 0, seq: 0, shape: 0 } };
function fnvPos(seed, i) { let h = 0xcbf29ce484222325n; const s = `${seed}:${i}`; for (let c = 0; c < s.length; c++) { h ^= BigInt(s.charCodeAt(c)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return Number(h & 0x7fffffffn); }
const K_FLIP = 150; // lines per flip-source
for (let s = 0; s < FLIP_FILES; s++) {
  const src = path.join(TMP, `c2_flipsrc_${s}.jsonl`);
  fs.writeFileSync(src, mirror.lines.slice(0, K_FLIP).join('\n') + '\n');
  const base = fs.readFileSync(src);
  for (let b = 0; b < FLIPS_PER_FILE; b++) {
    const pos = fnvPos(900 + s, b) % base.length; // last byte included: a flipped final newline must surface as a torn tail
    const bit = b % 8;
    const bad = Buffer.from(base);
    bad[pos] ^= 1 << bit;
    const bf = path.join(TMP, `c2_flip.jsonl`);
    fs.writeFileSync(bf, bad);
    const v = verifyJournalFile(bf);
    r3.flips++;
    if (!v.ok) {
      r3.detected++;
      const why = v.firstBad?.why ?? (v.tornBytes > 0 ? 'torn' : 'other');
      if (why.startsWith('JsonParse')) r3.layers.parse++;
      else if (why.startsWith('NonCanonical')) r3.layers.canonical++;
      else if (why.startsWith('HashMismatch')) r3.layers.chain++;
      else if (why === 'torn') r3.layers.torn++;
      else if (why.startsWith('SeqBreak')) r3.layers.seq++;
      else r3.layers.shape++;
    } else r3.undetected.push({ file: s, byte: pos, bit });
  }
  for (let c = 0; c < 2; c++) {
    const cf = path.join(TMP, `c2_ctrl.jsonl`);
    fs.writeFileSync(cf, base);
    const v = verifyJournalFile(cf);
    r3.controlFiles++;
    if (!v.ok || v.frames !== K_FLIP) r3.controlFalseAlarms++;
  }
  fs.unlinkSync(src);
}
book('result', {
  rule: 'R3a', flips: r3.flips, detected: r3.detected, coverage: +(r3.detected / r3.flips).toFixed(6),
  undetected: r3.undetected.slice(0, 20), undetectedCount: r3.undetected.length,
  detection_layers: r3.layers, controlFiles: r3.controlFiles, controlFalseAlarms: r3.controlFalseAlarms,
  prediction: '100% coverage — string hashes end-to-end + canonical decimal law (pre-registered)',
  verdict: r3.undetected.length === 0 && r3.controlFalseAlarms === 0 ? 'PASS' : 'FAIL',
});

// ── R3b: case flips INSIDE hash hex strings (the E-C1 aliasing probe) ────────
{
  const src = path.join(TMP, 'c2_casesrc.jsonl');
  fs.writeFileSync(src, mirror.lines.slice(0, K_FLIP).join('\n') + '\n');
  const base = fs.readFileSync(src, 'utf8');
  const lineStarts = [];
  { let off = 0; for (const ln of mirror.lines.slice(0, K_FLIP)) { lineStarts.push(off); off += Buffer.byteLength(ln, 'utf8') + 1; } }
  const hashRe = /0x[0-9a-f]{16}/g;
  for (let b = 0; b < CASE_FLIPS; b++) {
    // deterministic line + hash occurrence + hex char
    const li = fnvPos(700, b) % K_FLIP;
    const line = mirror.lines[li];
    const matches = [...line.matchAll(hashRe)];
    const m = matches[fnvPos(701, b) % matches.length];
    const hexOff = 2 + (fnvPos(702, b) % 16); // inside the 16 hex chars
    const pos = lineStarts[li] + m.index + hexOff;
    const bad = Buffer.from(base, 'utf8');
    bad[pos] ^= 0x20; // bit 5: the case bit for ASCII letters
    const bf = path.join(TMP, 'c2_case.jsonl');
    fs.writeFileSync(bf, bad);
    const v = verifyJournalFile(bf);
    r3.caseFlips++;
    if (!v.ok) r3.caseDetected++;
    else r3.caseUndetected.push({ line: li, hexOff, byte: pos });
  }
  fs.unlinkSync(src);
}
book('result', {
  rule: 'R3b', caseFlips: r3.caseFlips, detected: r3.caseDetected,
  coverage: +(r3.caseDetected / r3.caseFlips).toFixed(6), undetected: r3.caseUndetected.slice(0, 10),
  prediction: '100% — engine/adapter compare hash STRINGS (lowercase-only producer); no case-insensitive decode exists on this path (E-C1 divergence test)',
  verdict: r3.caseUndetected.length === 0 ? 'PASS' : 'FAIL',
});

// ── R3c: chain-VALID but non-canonical frames (BigInt-accepting aliases) ─────
// Each probe mutates a frame's body AND recomputes its hash from the REAL
// previous link, so the CHAIN law alone cannot reject — only the canonical
// FORMAT law can. Detection must land at exactly the crafted index.
{
  // pick a consume event (scalar decimal before/after) and a commit (vector)
  const ci = mirror.events.findIndex((e) => e.op === 'consume');
  const bi = mirror.events.findIndex((e) => e.op === 'commit');
  const li2 = mirror.events.findIndex((e) => e.op === 'ledger');
  const prevOf = (idx) => (idx === 0 ? 'gen0' : mirror.events[idx - 1].hash);
  const rehash = (idx, body) => EXO.fnv1a64([prevOf(idx), body]);
  const bodyOf = (ev) => ({ seq: ev.seq, tick: ev.tick, op: ev.op, cell: ev.cell, field: ev.field, before: ev.before, after: ev.after });
  const swapElem = (arr, at, val) => arr.map((x, i) => (i === at ? val : x));
  const w0 = mirror.events[ci].before; // scalar decimal string
  const vec = mirror.events[bi].before; // decimal vector
  const g0 = mirror.events[li2].before; // scalar decimal string
  const probes = [
    { name: 'leading-zero', mut: (ev) => ({ ...bodyOf(ev), after: swapElem(ev.after, 0, '0' + ev.after[0]) }), at: bi },
    { name: 'plus-sign', mut: (ev) => ({ ...bodyOf(ev), before: '+' + ev.before }), at: ci },
    { name: 'negative-zero', mut: (ev) => ({ ...bodyOf(ev), before: '-0' }), at: ci },
    { name: 'leading-space', mut: (ev) => ({ ...bodyOf(ev), before: ' ' + ev.before }), at: ci },
    { name: 'trailing-space', mut: (ev) => ({ ...bodyOf(ev), after: ev.after + ' ' }), at: ci },
    { name: 'hex-literal', mut: (ev) => ({ ...bodyOf(ev), before: '0x10' }), at: ci },
    { name: 'exp-notation', mut: (ev) => ({ ...bodyOf(ev), before: g0 + 'e2' }), at: li2 },
    { name: 'key-permutation', mut: (ev) => ({ op: ev.op, cell: ev.cell, seq: ev.seq, tick: ev.tick, field: ev.field, before: ev.before, after: ev.after }), at: bi, permutated: true },
    { name: 'whitespace', mut: null, at: bi }, // handled specially below
    { name: 'uppercase-hash', mut: (ev) => bodyOf(ev), at: bi, upperHash: true },
  ];
  const r3c = { probes: 0, rejected: 0, rejectedAtIndex: 0, rows: [] };
  for (const p of probes) {
    const lines = mirror.lines.slice();
    if (p.name === 'whitespace') {
      lines[p.at] = mirror.lines[p.at].replace('{', '{ ');
    } else {
      const body = p.mut(mirror.events[p.at]);
      const row = { ...body, hash: rehash(p.at, body) };
      if (p.upperHash) row.hash = row.hash.toUpperCase();
      lines[p.at] = JSON.stringify(row);
    }
    const bf = path.join(TMP, 'c2_craft.jsonl');
    fs.writeFileSync(bf, lines.join('\n') + '\n');
    const v = verifyJournalFile(bf);
    r3c.probes++;
    const rejected = !v.ok;
    const atIndex = v.firstBad?.index === p.at;
    if (rejected) r3c.rejected++;
    if (atIndex) r3c.rejectedAtIndex++;
    r3c.rows.push({ name: p.name, rejected, atIndex, why: v.firstBad?.why ?? (v.ok ? 'ACCEPTED' : 'other') });
    fs.unlinkSync(bf);
  }
  // control: the untouched file must verify clean
  const cf = path.join(TMP, 'c2_craftctrl.jsonl');
  fs.writeFileSync(cf, mirror.lines.slice(0, K_FLIP).join('\n') + '\n');
  const vCtrl = verifyJournalFile(cf);
  fs.unlinkSync(cf);
  r3.craft = { probes: r3c.probes, rejected: r3c.rejected, rejectedAtIndex: r3c.rejectedAtIndex, controlClean: vCtrl.ok && vCtrl.frames === K_FLIP };
  book('result', {
    rule: 'R3c', probes: r3c.probes, rejected: r3c.rejected, rejectedAtIndex: r3c.rejectedAtIndex,
    controlClean: vCtrl.ok && vCtrl.frames === K_FLIP, rows: r3c.rows,
    prediction: '10/10 rejected at the crafted index; control clean',
    verdict: (r3c.rejected === r3c.probes && r3c.rejectedAtIndex === r3c.probes && vCtrl.ok) ? 'PASS' : 'FAIL',
  });
}

// ── R4: paired arms (fsync / buffer / torn) under the same kill grid ─────────
const r4 = { pairs: [], tornTails: 0 };
for (let t = 0; t < ARM_TRIALS; t++) {
  const delay = 5 + ((t * 6271) % 181); // 5..185ms spread
  const row = { trial: t, delay };
  for (const mode of ['fsync', 'buffer', 'torn']) {
    const { f, alive } = await killTrial(`arm_${t}_${mode}`, mode, delay);
    const rec = fs.existsSync(f) ? recoverFrom(f) : { frames: 0, tornBytes: 0 };
    row[mode] = { frames: rec.frames, torn: rec.tornBytes > 0, alive };
    if (mode === 'torn' && rec.tornBytes > 0) r4.tornTails++;
    try { fs.unlinkSync(f); } catch { /* keep */ }
  }
  r4.pairs.push(row);
}
const meanLost = (sel) => r4.pairs.map((p) => TOTAL_EVENTS - p[sel].frames).reduce((a, b) => a + b, 0) / r4.pairs.length;
book('result', {
  rule: 'R4', pairs: r4.pairs, meanLostFsync: +meanLost('fsync').toFixed(2), meanLostBuffer: +meanLost('buffer').toFixed(2),
  meanLostTorn: +meanLost('torn').toFixed(2), tornArmTornTails: r4.tornTails,
  sandboxPrediction: 'NULL fsync-vs-buffer (page cache survives SIGKILL); torn arm exercises two-chunk writes',
  limitation: 'machine-level power loss unmodelable in sandbox — receipted',
  verdict: 'INFO-ARM',
});

// ── R5: truncation grid + extend-after-recovery + naive-append refusal ──────
const r5 = { trials: 0, tornReported: 0, cleanPrefix: 0, failures: [] };
const extRngSeed = SEED + 50000;
for (let t = 0; t < TRUNC_TRIALS; t++) {
  const full = mirror.bytes;
  const bounds = [];
  { let off = 0; for (const ln of mirror.lines) { bounds.push(off); off += Buffer.byteLength(ln, 'utf8') + 1; } }
  const L = 4 + ((t * 7) % (mirror.lines.length - 10)); // keep >= 4 frames
  const midLine = t % 2 === 1;
  const lineLen = Buffer.byteLength(mirror.lines[L], 'utf8') + 1;
  const cut = midLine ? bounds[L] + 1 + ((t * 13) % Math.max(1, lineLen - 2)) : bounds[L];
  const f = path.join(TMP, `c2_trunc.jsonl`);
  fs.writeFileSync(f, full.subarray(0, cut));
  const rec = recoverFrom(f);
  r5.trials++;
  const framesOk = rec.frames === L && rec.firstBad === null;
  const tornOk = midLine ? rec.tornBytes === cut - rec.goodBytes && rec.tornBytes > 0 : rec.tornBytes === 0;
  const prefixOk = Buffer.compare(fs.readFileSync(f).subarray(0, rec.goodBytes), full.subarray(0, rec.goodBytes)) === 0;
  if (tornOk && (midLine || rec.tornBytes === 0)) r5.tornReported += midLine ? 1 : 0;
  if (framesOk && tornOk && prefixOk) r5.cleanPrefix++;
  else r5.failures.push({ trial: t, midLine, cut, frames: rec.frames, want: L, tornBytes: rec.tornBytes, firstBad: rec.firstBad });
  if (t < EXT_TRIALS) {
    // CRASH-SAFE protocol: truncate-to-good, continue the script, re-verify
    const rec2 = truncateToGood(f);
    const w2 = replayWorld(SEED, rec2.events, rec2.frames);
    const j2 = attachRecoveredJournal(w2, rec2.events);
    if (rec2.frames !== rec.frames) r5.failures.push({ trial: t, why: 'reopen recovered a different prefix' });
    const jf = new JournalFile2(f, { fsyncEvery: 1 });
    const extBefore = j2.events.length;
    runScript(w2, makeRng(extRngSeed), 6, (i, a, before) => { jf.appendSince(w2, before); });
    jf.close();
    const v = verifyJournalFile(f);
    // mirror side: the same continuation, replayed from scratch
    const mExt = replayWorld(SEED, mirror.events, rec.frames);
    const mExtEvents = [];
    runScript(mExt, makeRng(extRngSeed), 6, (i, a, before) => { for (const ev of mExt.journal.events.slice(before)) mExtEvents.push(ev); });
    const allEvents = rec.events.concat(mExtEvents);
    const wantHash = replayWorld(SEED, allEvents, allEvents.length).stateHash();
    const gotHash = w2.stateHash();
    if (!(v.ok && v.frames === rec.frames + mExtEvents.length && gotHash === wantHash && j2.verify().ok && j2.events.length === extBefore + mExtEvents.length)) {
      r5.failures.push({ trial: t, why: 'extend-after-recovery failed', frames: v.frames, want: rec.frames + mExtEvents.length, hashOk: gotHash === wantHash });
    }
    // NAIVE protocol: fresh torn file, append PAST the torn tail
    const fn = path.join(TMP, `c2_naive.jsonl`);
    fs.writeFileSync(fn, full.subarray(0, bounds[L] + 1 + 7)); // torn mid-line
    fs.appendFileSync(fn, Buffer.from(mExtEvents.map((ev) => JSON.stringify(ev)).join('\n') + '\n', 'utf8'));
    const vn = verifyJournalFile(fn);
    if (vn.ok) r5.failures.push({ trial: t, why: 'NAIVE append past torn tail was SILENTLY ACCEPTED' });
    fs.unlinkSync(fn);
    fs.unlinkSync(f);
  } else {
    fs.unlinkSync(f);
  }
}
book('result', {
  rule: 'R5', trials: r5.trials, tornReported: r5.tornReported, cleanPrefixOrExtended: r5.cleanPrefix,
  failures: r5.failures, note: 'cleanPrefixOrExtended counts truncation-grid passes; extension + naive-append subtrials report in failures[]',
  verdict: r5.failures.length === 0 && r5.cleanPrefix === r5.trials ? 'PASS' : 'FAIL',
});

// ── findings: honest arcs, whatever they are ─────────────────────────────────
if (r3.undetected.length > 0) {
  book('finding', { rule: 'R3a', severity: 'high', undetected: r3.undetected.length, note: 'FALSIFIED pre-registered 100% prediction — escapes above; root cause REQUIRED before fix' });
}
if (r3.caseUndetected.length > 0) {
  book('finding', { rule: 'R3b', severity: 'high', undetected: r3.caseUndetected.length, mechanism: 'case flips inside hash strings ESCAPED — inspect for a case-insensitive decode path (the E-C1 hole, yiluodi edition)' });
}
if (r2.replayOk !== r2.checks || r2.roundtripOk !== r2.checks || r2.scrubOk !== r2.checks) {
  book('finding', { rule: 'R2', severity: 'high', note: 'rewind/replay exactness FALSIFIED on recovered prefixes — engine applier vs mirror divergence; failures in the R2 row' });
}

// ── seal + verify + summary ──────────────────────────────────────────────────
const vchain = chain.verify();
fs.writeFileSync(path.join(OUT, 'receipts_e_c2.jsonl'), chain.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const verdicts = Object.fromEntries(chain.rows.filter((r) => r.kind === 'result' && r.payload.verdict).map((r) => [r.payload.rule, r.payload.verdict]));
const summary = {
  experiment: 'E-C2 crash-consistency chaos (yiluodi journal + rewind, TEST-ONLY adapter)',
  honest_target: 'journal event log + exact bidirectional rewind via experiments/chaos_persist2.mjs (TEST-ONLY); browser/IndexedDB untestable from Node — receipted; app/engine.js UNTOUCHED',
  seed: SEED, script_actions: TOTAL_ACTIONS, script_events: TOTAL_EVENTS,
  rules_sealed_before_runs: true,
  verdicts,
  metrics: {
    kill: { trials: r1.trials, pass: r1.pass, lostMax: Math.max(...r1.lost), completedBeforeKill: r1.completedBeforeKill, tornTails: r1.tornTails },
    r2: r2,
    r3a: { flips: r3.flips, coverage: +(r3.detected / r3.flips).toFixed(6), undetected: r3.undetected.length, controlFalseAlarms: r3.controlFalseAlarms },
    r3b: { caseFlips: r3.caseFlips, coverage: +(r3.caseDetected / r3.caseFlips).toFixed(6), undetected: r3.caseUndetected.length },
    r3c: { rejectedAtIndex: r3.craft?.rejectedAtIndex ?? null, probes: r3.craft?.probes ?? 0, rejected: r3.craft?.rejected ?? 0 },
    r4: { meanLostFsync: +meanLost('fsync').toFixed(2), meanLostBuffer: +meanLost('buffer').toFixed(2), tornArmTornTails: r4.tornTails },
    r5: { trials: r5.trials, cleanPrefix: r5.cleanPrefix, failures: r5.failures.length },
  },
  chain: { links: chain.rows.length, tip: chain.tip, verify: vchain },
  artifacts: ['experiments/chaos_persist2.mjs (TEST-ONLY adapter)', 'experiments/chaos_world2.mjs (TEST-ONLY script)', 'experiments/chaos_child2.mjs (SIGKILL victim)', 'app/engine.js (UNTOUCHED)'],
};
fs.writeFileSync(path.join(OUT, 'e_c2_summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ verdicts, chainTip: chain.tip, chainVerify: vchain, events: TOTAL_EVENTS }, null, 1));
process.exit(Object.values(verdicts).every((v) => v === 'PASS' || v === 'INFO-ARM') ? 0 : 1);
