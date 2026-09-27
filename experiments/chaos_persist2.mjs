// experiments/chaos_persist2.mjs — TEST-ONLY FILE ADAPTER for the yiluodi
// journal. E-C2 (Task 30-a, chaos-smith lane).
//
// HONEST TARGET SELECTION (receipted): yiluodi's journal lives in browser
// memory / IndexedDB; Node cannot SIGKILL a browser. But the engine is UMD
// and runs headless in Node (`require('../app/engine.js')` — the L-ladder
// precedent), and its journal events are PLAIN JSON-SAFE OBJECTS:
//   { seq, tick, op, cell, field, before, after, hash }
// with before/after as decimal STRINGS (JSON.stringify throws on BigInt, so
// the engine already stringifies every value — engine.js §2). The honest
// Node-testable surface is therefore the journal event log + rewind logic
// exercised through THIS file adapter: one JSON.stringify(event) per line,
// '\n'-terminated. app/engine.js is UNTOUCHED — this module owns only the
// persisted-format law, exactly as quilt-arch/persist.mjs owns arch's.
//
// FORMAT LAW (canonical, E-C1 R4 lesson ported — arch found that Node's hex
// decoder is case-insensitive and aliases case-flipped hex; the yiluodi path
// has NO hex decode (hashes stay strings end-to-end) but BigInt() itself
// accepts '+5', ' 5', '5 ', '007', '-0' and '0x10' — so every numeric string
// is pinned to CANONICAL DECIMAL at the format layer; the hash chain
// legitimately covers strings as-written and cannot catch aliases alone).
//
//   L1 canonical JSON    : JSON.stringify(JSON.parse(line)) === line
//   L2 canonical key order: exactly seq,tick,op,cell,field,before,after,hash
//                           (the hash covers [prev, body] STRINGIFIED in
//                           insertion order — key order is load-bearing, so
//                           the file pins it)
//   L3 shape law         : per-op regexes below (ops are the engine's own 8)
//   L4 seq law           : ev.seq === line index + 1
//   L5 chain law         : fnv1a64([prev, body]) === ev.hash, genesis 'gen0'
//   L6 torn tail         : bytes after the last newline are tornBytes —
//                           reported, never silently accepted
//
// Zero dependencies (node:fs + the engine's own fnv1a64). Recovery is a pure
// function of (file bytes, world seed) — the caller supplies the world.

import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EXO = require('../app/engine.js');

/** Event -> file line. The engine's events are insertion-ordered and
 *  JSON-safe already; JSON.stringify is canonical by construction. */
export const encEvent = (ev) => JSON.stringify(ev);

const DEC = /^-?(0|[1-9][0-9]*)$/;
const isDec = (s) => typeof s === 'string' && DEC.test(s) && s !== '-0';
const decArr = (a) => Array.isArray(a) && a.length > 0 && a.every(isDec);
const ID = /^.+$/; // cell / other-id: any non-empty string (world-agnostic)

const BODY_KEYS = 'seq,tick,op,cell,field,before,after,hash';

/** The persisted-format law. Throws on ANY violation (recovery treats the
 *  frame as bad and stops there — the prefix before it stays valid). */
function validateEventShape(ev, expectSeq) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw new Error('BadFrame:object');
  if (Object.keys(ev).join(',') !== BODY_KEYS) throw new Error('NonCanonical:keys');
  if (ev.seq !== expectSeq) throw new Error('SeqBreak:' + ev.seq + '!=' + expectSeq);
  if (!Number.isInteger(ev.tick) || ev.tick < 0) throw new Error('BadTick');
  if (typeof ev.cell !== 'string' || !ID.test(ev.cell)) throw new Error('BadCell');
  if (typeof ev.field !== 'string' || !ID.test(ev.field)) throw new Error('BadField');
  if (typeof ev.hash !== 'string' || !/^0x[0-9a-f]{16}$/.test(ev.hash)) throw new Error('NonCanonical:hash');
  switch (ev.op) {
    case 'measure': // before '(unread)'; after = decimal vector or '(none)'
      if (ev.field !== 'reading') throw new Error('BadField:measure');
      if (ev.before !== '(unread)') throw new Error('NonCanonical:measure.before');
      if (ev.after !== '(none)' && !decArr(ev.after)) throw new Error('NonCanonical:measure.after');
      return;
    case 'commit': // belief vectors, decimal strings
    case 'constrain':
      if (ev.field !== 'belief') throw new Error('BadField:' + ev.op);
      if (!decArr(ev.before) || !decArr(ev.after)) throw new Error('NonCanonical:belief');
      return;
    case 'consume': // one-sided influence weight
      if (!/^w:.+$/.test(ev.field)) throw new Error('BadField:consume');
      if (!isDec(ev.before) || !isDec(ev.after)) throw new Error('NonCanonical:weight');
      return;
    case 'open': // pair-level edge open: before is the literal 'none'
    case 'admit':
      if (!/^edge:.+$/.test(ev.field)) throw new Error('BadField:' + ev.op);
      if (ev.before !== 'none' || !isDec(ev.after)) throw new Error('NonCanonical:edge');
      return;
    case 'ledger': // world ledger: gamma before/after
      if (ev.field !== 'gamma') throw new Error('BadField:ledger');
      if (!isDec(ev.before) || !isDec(ev.after)) throw new Error('NonCanonical:gamma');
      return;
    case 'refuse': // refusal receipt; carries no restorable state
      if (ev.field !== 'ledger') throw new Error('BadField:refuse');
      if (!/^gamma\+eta=[0-9]+$/.test(ev.before)) throw new Error('NonCanonical:refuse.before');
      if (!/^refused\+[0-9]+ boundary=[0-9]+$/.test(ev.after)) throw new Error('NonCanonical:refuse.after');
      return;
    case 'snapshot': // scenario snapshots carry opaque JSON strings
      if (typeof ev.before !== 'string' || typeof ev.after !== 'string') throw new Error('BadSnapshot');
      return;
    default:
      throw new Error('BadOp:' + ev.op);
  }
}

/** Line -> event under the full L1-L4 law. Throws on violation. */
export function decEvent(line, expectSeq) {
  let ev;
  try { ev = JSON.parse(line); } catch { throw new Error('JsonParse'); }
  if (JSON.stringify(ev) !== line) throw new Error('NonCanonical:json');
  validateEventShape(ev, expectSeq);
  return ev;
}

/** L5 chain law over an event array (mirror of engine Journal.verify, but
 *  from RAW body reconstruction — belt and braces against key-order drift).
 *  Never throws; returns { ok, firstBadIndex, tip, links }. */
export function verifyEventChain(events) {
  let prev = 'gen0';
  for (let j = 0; j < events.length; j++) {
    const ev = events[j];
    const body = { seq: ev.seq, tick: ev.tick, op: ev.op, cell: ev.cell,
      field: ev.field, before: ev.before, after: ev.after };
    if (EXO.fnv1a64([prev, body]) !== ev.hash) return { ok: false, firstBadIndex: j, tip: prev, links: events.length };
    prev = ev.hash;
  }
  return { ok: true, firstBadIndex: null, tip: prev, links: events.length };
}

/**
 * Torn-write-tolerant recovery (house pattern: arch/persist.mjs recoverFrom).
 * Every COMPLETE newline-terminated line is decoded under L1-L4 and
 * chain-verified under L5; the walk stops at the first bad frame. A
 * non-newline-terminated tail is tornBytes — reported, excluded, never
 * merged. Never throws for a corrupt file; returns the verdict.
 */
export function recoverFrom(path) {
  const raw = fs.readFileSync(path);
  let end = raw.length;
  let tornBytes = 0;
  if (end > 0 && raw[end - 1] !== 0x0a) {
    const lastNl = raw.lastIndexOf(0x0a);
    tornBytes = end - (lastNl + 1);
    end = lastNl + 1;
  }
  const text = raw.subarray(0, end).toString('utf8');
  const lines = text.length ? text.split('\n').filter((s) => s.length > 0) : [];
  const events = [];
  let frames = 0, goodBytes = 0, firstBad = null, prev = 'gen0';
  for (const line of lines) {
    try {
      const ev = decEvent(line, frames + 1);
      const body = { seq: ev.seq, tick: ev.tick, op: ev.op, cell: ev.cell,
        field: ev.field, before: ev.before, after: ev.after };
      if (EXO.fnv1a64([prev, body]) !== ev.hash) throw new Error('HashMismatch');
      prev = ev.hash;
      events.push(ev);
    } catch (err) {
      firstBad = { index: frames, why: String(err?.message ?? err).slice(0, 120) };
      break;
    }
    frames++;
    goodBytes += Buffer.byteLength(line, 'utf8') + 1; // + newline separator
  }
  const chain = verifyEventChain(events);
  return {
    events, frames, lines: lines.length, tornBytes, goodBytes, firstBad, chain,
    complete: firstBad === null && tornBytes === 0 && frames === lines.length,
  };
}

/** Strict whole-file verdict: any bad frame or torn tail => ok:false. */
export function verifyJournalFile(path) {
  const r = recoverFrom(path);
  return {
    ok: r.complete && r.chain.ok,
    frames: r.frames, lines: r.lines, tornBytes: r.tornBytes,
    firstBad: r.firstBad, chainTip: r.chain.tip,
  };
}

/**
 * The file-backed journal writer. The WORLD owns the engine Journal; this
 * wrapper only streams NEW events (since a given length watermark) to disk
 * as canonical lines. fsyncEvery=1 fdatasyncs per batch (the paired-arm
 * knob); 0 = buffered page-cache writes.
 */
export class JournalFile2 {
  constructor(path, { fsyncEvery = 1 } = {}) {
    this.path = path;
    this.fsyncEvery = fsyncEvery;
    this.writes = 0;
    this.fd = null;
  }
  #ensureOpen() {
    if (this.fd === null) this.fd = fs.openSync(this.path, 'a');
    return this.fd;
  }
  /** Append all journal events from index `from` (the watermark taken before
   *  an action) as one batch write. Returns the number of lines written. */
  appendSince(world, from) {
    const evs = world.journal.events;
    if (evs.length <= from) return 0;
    const buf = Buffer.from(evs.slice(from).map(encEvent).join('\n') + '\n', 'utf8');
    const fd = this.#ensureOpen();
    fs.writeSync(fd, buf);
    if (this.fsyncEvery > 0 && this.writes % this.fsyncEvery === 0) fs.fdatasyncSync(fd);
    this.writes++;
    return evs.length - from;
  }
  /** E-C1's torn-write window, ported: one raw line in TWO chunks with a
   *  timed gap — SIGKILL inside the gap leaves a torn frame on disk. */
  appendTornableLine(line, gapMs = 2) {
    const fd = this.#ensureOpen();
    const buf = Buffer.from(line + '\n', 'utf8');
    const half = buf.length >> 1;
    fs.writeSync(fd, buf.subarray(0, half));
    if (gapMs > 0) {
      const shared = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(shared, 0, 0, gapMs); // sync sleep; setTimeout cannot block
    }
    fs.writeSync(fd, buf.subarray(half));
    if (this.fsyncEvery > 0) fs.fdatasyncSync(fd);
    this.writes++;
  }
  flush() { if (this.fd !== null) fs.fdatasyncSync(this.fd); }
  close() {
    if (this.fd !== null) {
      try { fs.fdatasyncSync(this.fd); } catch { /* closed by the OS */ }
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

/**
 * CRASH-SAFE REOPEN (E-C1 R5's law, receipted): recovery alone is not
 * liveness — a torn tail left in place MERGES with the next appended line.
 * Truncate to the last good boundary, THEN continue. Returns the recovered
 * verdict; the caller rebuilds the world (chaos_world2.replayWorld) and
 * keeps writing through a fresh JournalFile2.
 */
export function truncateToGood(path) {
  const rec = recoverFrom(path);
  if (fs.existsSync(path) && fs.statSync(path).size > rec.goodBytes) {
    fs.truncateSync(path, rec.goodBytes);
  }
  return rec;
}
