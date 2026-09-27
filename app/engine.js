// yiluodi/app/engine.js — the engine of 已落地.
//
// "已落地" (yǐ luòdì) — literally "has landed". The name is not translated;
// it is learned. In this engine a belief LANDS when it holds still long
// enough, with enough independent support. When you watch that happen, the
// name explains itself. (For Chinese readers: here 落地 is not a slide-deck
// word. It actually happens, on your screen, with a receipt.)
//
// LINEAGE — every piece inherited from a receipted sibling repo, no rewrites
// of semantics, only transcription:
//   q32 arithmetic ....... quilt-arch/arch/q32.mjs (normative Core Types:
//                          value = raw / 2^32, i64 raw, i128 product, floor
//                          shift, saturating add, truncating div, Newton sqrt).
//                          BigInt in the browser — exact, no floats anywhere.
//   receipt chain ........ quilt-stone fleet dialect (fnv1a64 over
//                          JSON.stringify([prev, rest]), genesis 'GENESIS',
//                          field row_hash, hash is the LAST write). Chosen so
//                          stone.mjs verifies yiluodi chains unmodified.
//   journal + exact rewind quilt-raw (append-only event log; rewind = apply
//                          stored inverse events, no search, no replay; the
//                          redo stack makes scrubbing exact in BOTH directions).
//   influence / admission   murmur-protocol v3.1 constants (epsNew, admitWindow,
//                          minEdgesIndep, capShare) — exact integer boundaries.
//   conservation / refusal  quilt-dba world law (gamma + eta <= C) with the
//                          quilt-arch exact boundary C = LOG2_3 raw
//                          (6806210843 ok / 6806210844 refuse).
//   observation discipline  exoj: an observation is an explicitly recorded
//                          local collapse, never a silent read.
//
// ZERO dependencies. ZERO network. Runs in any browser from file:// and in
// Node for the receipted experiments (UMD tail below).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EXO = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const EXO = {
    NAME: '已落地',
    NAME_ROMAN: 'yiluodi',
    NAME_MEANING_AT: 'the moment a belief lands, the name stops needing a translation',
    VERSION: '0.1.0',
  };

  // ==========================================================================
  // 1. Q32 — deterministic fixed point (lineage: quilt-arch, normative)
  //    value = raw / 2^32. raw is a signed i64 BigInt. NO FLOATS in the
  //    compute path. i128 product is exact (BigInt), >> is arithmetic/floor,
  //    division truncates toward zero (Rust `/`), add/sub saturate.
  // ==========================================================================

  const SHIFT = 32n;
  const MIN_I64 = -(2n ** 63n);
  const MAX_I64 = (2n ** 63n) - 1n;

  const asI64 = (x) => BigInt.asIntN(64, x);
  const satI64 = (x) => (x > MAX_I64 ? MAX_I64 : x < MIN_I64 ? MIN_I64 : x);

  class Q32 {
    constructor(raw) { this.r = asI64(raw); Object.freeze(this); }
    static fromRaw(x) { return new Q32(x); }
    static fromInt(v) { return new Q32(BigInt(v) << SHIFT); }
    /** Exact rational p/q -> q32 (floor). Constants are born here, receipted. */
    static fromRatio(p, q) { return new Q32((BigInt(p) << SHIFT) / BigInt(q)); }
    add(o) { return new Q32(satI64(this.r + o.r)); }
    sub(o) { return new Q32(satI64(this.r - o.r)); }
    /** checked_mul: exact i128 product, >> 32 (floor), as-i64 wrap. */
    mul(o) { return new Q32(asI64((this.r * o.r) >> SHIFT)); }
    /** checked_div: (a << 32) in i128, truncate toward zero, as-i64 wrap. */
    div(o) { if (o.r === 0n) return null; return new Q32(asI64((this.r << SHIFT) / o.r)); }
    sqrt() {
      const v = this.r;
      if (v < 0n) return null;
      const n = v << SHIFT;
      if (n < 2n) return new Q32(n);
      let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
      for (let it = 0; it < 32; it++) {
        const y = (x + n / x) >> 1n;
        if (y >= x) break;
        x = y;
      }
      return new Q32(asI64(x));
    }
    abs() { return this.r < 0n ? new Q32(asI64(-this.r)) : this; }
    cmp(o) { return this.r < o.r ? -1 : this.r > o.r ? 1 : 0; }
    eq(o) { return this.r === o.r; }
    /** Pure-integer decimal display, e.g. raw 6806210843 -> "1.584962500". */
    toString(fracDigits = 6) {
      const neg = this.r < 0n;
      const a = neg ? -this.r : this.r;
      const ip = a >> SHIFT;
      const scale = 10n ** BigInt(fracDigits);
      const fp = ((a & ((1n << SHIFT) - 1n)) * scale) >> SHIFT;
      const s = ip.toString() + '.' + fp.toString().padStart(fracDigits, '0');
      return neg ? '-' + s : s;
    }
  }

  const Q0 = new Q32(0n);
  const Q1 = new Q32(1n << SHIFT);
  const QHALF = new Q32(1n << 31n);

  EXO.Q32 = Q32; EXO.Q0 = Q0; EXO.Q1 = Q1; EXO.QHALF = QHALF;

  // ==========================================================================
  // 2. RECEIPT CHAIN — quilt-stone fleet dialect, byte-compatible.
  //    fnv1a64 over JSON.stringify([prev, rest]); rest = {i, kind, payload}
  //    in INSERTION order; row = {...rest, row_hash}; genesis 'GENESIS'.
  //    Hash is the LAST write to a row (STONE-SPEC checklist #7).
  //    All BigInts must be stringified by callers (JSON.stringify throws on
  //    BigInt) — journal/receipt payloads carry q32 as decimal STRINGS.
  // ==========================================================================

  function fnv1a64(input) {
    const s = typeof input === 'string' ? input : JSON.stringify(input);
    let h = 0xcbf29ce484222325n;
    const p = 0x100000001b3n, m = 0xffffffffffffffffn;
    for (let i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i));
      h = (h * p) & m;
    }
    return '0x' + h.toString(16).padStart(16, '0');
  }

  class Chain {
    constructor(genesis) { this.genesis = genesis || 'GENESIS'; this.rows = []; }
    seal(kind, payload) {
      const prev = this.rows.length ? this.rows[this.rows.length - 1].row_hash : this.genesis;
      const rest = { i: this.rows.length + 1, kind, payload };
      const row = Object.assign({}, rest, { row_hash: fnv1a64([prev, rest]) });
      this.rows.push(row);
      return row;
    }
    get tip() { return this.rows.length ? this.rows[this.rows.length - 1].row_hash : this.genesis; }
    verify() {
      let prev = this.genesis;
      for (let j = 0; j < this.rows.length; j++) {
        const r = this.rows[j];
        const { row_hash, ...rest } = r;
        if (fnv1a64([prev, rest]) !== row_hash) return { ok: false, firstBadIndex: j, why: 'hash mismatch' };
        if (rest.i !== j + 1) return { ok: false, firstBadIndex: j, why: 'seq break' };
        prev = row_hash;
      }
      return { ok: true, tip: this.tip, links: this.rows.length };
    }
  }

  EXO.fnv1a64 = fnv1a64;
  EXO.Chain = Chain;

  // ==========================================================================
  // 3. JOURNAL — append-only, self-chained, EXACT bidirectional rewind
  //    (lineage: quilt-raw). Every state mutation is recorded as
  //    {seq, tick, op, cell, field, before, after} with before/after as
  //    decimal strings. rewind(n) applies n stored inverses — no search,
  //    no replay-from-genesis. forward(n) re-applies from the redo stack.
  //    Scrubbing a slider back and forth is EXACT in both directions; the
  //    experiments prove 0 mismatches against a fresh replay.
  // ==========================================================================

  class Journal {
    constructor() { this.events = []; this.redo = []; }
    record(tick, op, cell, field, before, after) {
      const prev = this.events.length ? this.events[this.events.length - 1].hash : 'gen0';
      const seq = this.events.length + 1;
      const body = { seq, tick, op, cell, field, before, after };
      const hash = fnv1a64([prev, body]);
      const ev = Object.assign({}, body, { hash });
      this.events.push(ev);
      this.redo.length = 0;
      return ev;
    }
    verify() {
      let prev = 'gen0';
      for (let j = 0; j < this.events.length; j++) {
        const e = this.events[j];
        const { hash, ...body } = e;
        if (fnv1a64([prev, body]) !== hash) return { ok: false, firstBadIndex: j };
        prev = hash;
      }
      return { ok: true, tip: prev, links: this.events.length };
    }
    /** Apply stored inverse/forward. applier(ev, which) mutates the world. */
    rewind(n, applier) {
      let applied = 0;
      while (applied < n && this.events.length) {
        const ev = this.events.pop();
        applier(ev, 'before');
        this.redo.push(ev);
        applied++;
      }
      return applied;
    }
    forward(n, applier) {
      let applied = 0;
      while (applied < n && this.redo.length) {
        const ev = this.redo[this.redo.length - 1];
        applier(ev, 'after');
        this.events.push(ev);
        this.redo.pop();
        applied++;
      }
      return applied;
 }
    /** Exact scrub to a tick (the redo stack makes this bidirectional-exact). */
    scrubTo(targetTick, headTick, applier) {
      if (targetTick < headTick) {
        let n = 0;
        for (let i = this.events.length - 1; i >= 0; i--) { if (this.events[i].tick > targetTick) n++; else break; }
        this.rewind(n, applier);
      } else if (targetTick > headTick) {
        let n = 0;
        for (let i = this.redo.length - 1; i >= 0; i--) { if (this.redo[i].tick <= targetTick) n++; else break; }
        this.forward(n, applier);
      }
      return { events: this.events.length, redo: this.redo.length };
    }
  }

  EXO.Journal = Journal;

  // ==========================================================================
  // 4. WORLD CONSTANTS — every boundary an exact integer, receipted at setup.
  // ==========================================================================

  const CONSTS = {
    // murmur-protocol v3.1 admission constants (lineage: quilt-murmur).
    EPS_NEW: new Q32(644245094n),        // 0.15 * 2^32, floored (exact int)
    ADMIT_WINDOW: 40,                    // ticks a fresh edge may prove itself
    MIN_EDGES_INDEP: 2,                  // independent endorsements to admit
    CAP_SHARE_RAW: 429496729n,           // 0.10 * 2^32, floored (exact int)
    // landing rule (this repo's own, sealed by rule receipt BEFORE results):
    LANDED_STABLE_TICKS: 5,              // belief must hold still this many ticks
    VAR_EPS: new Q32(2097152n),          // 2^-11: max per-tick belief delta
    LANDED_MIN_INDEP: 2,                 // independent support edges required
    // anchored hands (rule R11): the commit target mixes own slant with the
    // neighborhood reading at this exact ratio (a knower's hands keep
    // talking). 2/3: the parable survives dialogue — receipted.
    ANCHOR: new Q32(2863311530n),        // floor(2/3 * 2^32) = 2863311530
    // conservation law (lineage: quilt-dba) with the quilt-arch exact boundary:
    //   gamma + eta <= C, C = LOG2_3 raw — receipted boundary:
    //   6806210843 ok / 6806210844 refuse.
    C_RAW: 6806210843n,
  };

  EXO.CONSTS = CONSTS;

  // ==========================================================================
  // 5. VECTOR HELPERS over q32 (beliefs are distributions over words).
  // ==========================================================================

  function vdot(a, b) {
    let s = Q0;
    for (let i = 0; i < a.length; i++) s = s.add(a[i].mul(b[i]));
    return s;
  }
  function vnorm(a) { return vdot(a, a).sqrt(); }
  /** q32 cosine, clamped to [0, 1]. Null only on a zero vector (honest). */
  function vcos(a, b) {
    const na = vnorm(a), nb = vnorm(b);
    if (na.r === 0n || nb.r === 0n) return null;
    const c = vdot(a, b).div(na.mul(nb));
    if (c === null) return null;
    if (c.cmp(Q0) < 0) return Q0;
    if (c.cmp(Q1) > 0) return Q1;
    return c;
  }
  function vDelta(a, b) { // max abs component delta
    let m = Q0;
    for (let i = 0; i < a.length; i++) { const d = a[i].sub(b[i]).abs(); if (d.cmp(m) > 0) m = d; }
    return m;
  }
  function vMove(a, b) { // TOTAL movement: sum of |delta| over components
    let s = 0n;
    for (let i = 0; i < a.length; i++) s += a[i].sub(b[i]).abs().r;
    return s;
  }
  EXO.vdot = vdot; EXO.vnorm = vnorm; EXO.vcos = vcos; EXO.vDelta = vDelta; EXO.vMove = vMove;

  // ==========================================================================
  // 6. WORLD — cells, edges, influence, admission, conservation, landing.
  //
  //    The per-tick loop (the whole machine, 7 ops — lineage: quilt-raw):
  //      measure  : a cell reads its neighborhood through its influence
  //                 weights (an explicit, journaled local collapse — exoj).
  //      commit   : the cell moves its belief toward the reading + its own
  //                 slant; the move is charged to the world ledger.
  //      consume  : influence weights follow measured agreement (fractional,
  //                 murmur-protocol); fresh edges must earn admission.
  //      landing  : still + independent => the belief lands, receipted.
  //
  //    Conservation: every commit's total movement is charged; gamma+eta
  //    over the exact boundary is REFUSED and the refusal is journaled
  //    (refusal is a first-class, visible event — never a silent clamp).
  // ==========================================================================

  class World {
    constructor(opts) {
      opts = opts || {};
      this.name = opts.name || 'sandbox';
      this.tick = 0;
      this.chain = new Chain(opts.genesis);
      this.journal = new Journal();
      this.cells = new Map();      // id -> cell
      this.order = [];             // stable cell order
      this.gamma = 0n;             // mass ever committed (charged movement)
      this.eta = 0n;               // mass ever retracted
      this.refusals = 0;
      this.log = [];               // ActiveLog lines (narration + events)
      this.landed = [];            // landing receipts (mirrored in chain)
      this.firstLandingTick = null;
      this.onEvent = opts.onEvent || null; // UI hook
    }

    emit(line, kind) {
      const entry = { tick: this.tick, line, kind: kind || 'event' };
      this.log.push(entry);
      if (this.onEvent) this.onEvent(entry);
      return entry;
    }

    addCell(id, opts) {
      const cell = {
        id,
        x: opts.x || 0, y: opts.y || 0,
        role: opts.role || 'knower',         // knower | traveler
        slant: opts.slant || null,           // 5-dim q32 feature reading
        belief: opts.belief,                 // W-dim q32 distribution
        // belief0 kept OUT of the journal path (immutably per tick via journal)
        words: opts.words || null,
        edges: new Map(),                    // otherId -> w (q32, both endpoints)
        stableFor: 0,
        lastBelief: opts.belief,
        state: 'floating',                   // floating | landing | landed
        landedTick: null,
        predAccum: new Q32(0n), predCount: 0, // ideation-phase prediction record
      };
      this.cells.set(id, cell);
      this.order.push(id);
      return cell;
    }

    /** Charge movement to the world ledger; REFUSE past the exact boundary.
     *  Movement is charged in 2^-11 q32 units (>> 22, the dba "x1000"
     *  scaling precedent) so a world-sized story fits inside the arch-exact
     *  boundary; the refuse semantics stay bit-honest at the scaling
     *  granularity (a charge smaller than one unit is free).
     *  Every accepted charge is JOURNALED as a 'ledger' event (the ledger is
     *  state — a rewind that forgot it would replay into a different world). */
    charge(movementRaw) {
      const units = movementRaw >> 22n;
      if (units === 0n) return true;
      const next = this.gamma + this.eta + units;
      if (next > CONSTS.C_RAW) {
        this.refusals++;
        this.journal.record(this.tick, 'refuse', 'world', 'ledger',
          'gamma+eta=' + (this.gamma + this.eta).toString(),
          'refused+' + units.toString() + ' boundary=' + CONSTS.C_RAW.toString());
        this.emit('refused: world ledger full at the exact boundary '
          + CONSTS.C_RAW.toString() + ' (movement ' + units.toString() + ' units)', 'refusal');
        return false;
      }
      const before = this.gamma;
      this.gamma += units; // eta reserved for retractions in future rounds
      this.journal.record(this.tick, 'ledger', 'world', 'gamma',
        before.toString(), this.gamma.toString());
      return true;
    }

    /**_neighbor read through influence weights: an explicit local collapse. */
    measure(cell) {
      let acc = null, wsum = Q0;
      for (const [oid, w] of cell.edges) {
        const o = this.cells.get(oid);
        if (!o) continue;
        acc = acc ? acc.map((v, i) => v.add(w.mul(o.belief[i])))
                  : o.belief.map((v) => w.mul(v));
        wsum = wsum.add(w);
      }
      if (!acc || wsum.r === 0n) return null;
      return acc.map((v) => (wsum.r === 0n ? Q0 : (v.div(wsum) || Q0)));
    }

    /** Commit: move belief toward reading blended with own slant. Returns
     *  movement charged. journaled before/after (exact rewind support). */
    commit(cell, reading, blend) {
      const before = cell.belief;
      const target = reading || cell.slantBelief || before;
      const after = before.map((v, i) => {
        const d = target[i].sub(v);
        return v.add(d.mul(blend));
      });
      const movement = vMove(before, after);
      if (!this.charge(movement)) return { refused: true };
      this.journal.record(this.tick, 'commit', cell.id, 'belief',
        before.map((v) => v.r.toString()), after.map((v) => v.r.toString()));
      cell.belief = after;
      return { refused: false, movedRaw: movement };
    }

    /** murmur-protocol fractional influence update + admission. */
    consume(cell) {
      const updates = [];
      for (const [oid, w] of cell.edges) {
        const o = this.cells.get(oid);
        const agree = vcos(cell.belief, o.belief);
        if (agree === null) continue;
        const nw = w.add(agree.sub(w).mul(CONSTS.EPS_NEW));
        updates.push([cell, oid, w, nw]);
      }
      for (const [c, oid, ow, nw] of updates) {
        this.journal.record(this.tick, 'consume', c.id, 'w:' + oid,
          ow.r.toString(), nw.r.toString());
        c.edges.set(oid, nw);
      }
      return updates.length;
    }

    /** R9 opening hands / physical-contact cold start: an edge opened on
     *  evidence of touch, journaled distinctly from endorsement admission. */
    openEdge(a, b, reason) {
      const w0 = QHALF;
      a.edges.set(b.id, w0); b.edges.set(a.id, w0);
      this.journal.record(this.tick, 'open', a.id, 'edge:' + b.id, 'none', w0.r.toString());
      this.emit('edge opened ' + a.id + '<->' + b.id + ' (' + reason + ')', 'admission');
      return true;
    }

    /** Memoryless admission law (murmur-protocol v3.1, made rewind-exact):
     *  a pair is admitted iff >= MIN_EDGES_INDEP already-connected neighbors
     *  stand behind it (witnesses of the debate) — a PURE function of the
     *  journaled graph, evaluated every tick. No pending state, no hidden
     *  counters: admission is derivable from the journal alone. */
    maybeAdmit(a, b) {
      if (a.edges.has(b.id) || b.edges.has(a.id)) return false;
      const witnesses = a.edges.size + b.edges.size;
      if (witnesses < CONSTS.MIN_EDGES_INDEP) return false;
      const w0 = QHALF; // admitted edges start at half trust, receipted
      a.edges.set(b.id, w0); b.edges.set(a.id, w0);
      this.journal.record(this.tick, 'admit', a.id, 'edge:' + b.id, 'none', w0.r.toString());
      this.emit('admitted edge ' + a.id + '<->' + b.id
        + ' (' + witnesses + ' witnesses)', 'admission');
      return true;
    }

    /** Landing check — the rule was receipted at setup; this applies it.
     *  Independence (support) is pluggable: worlds may receipt their own
     *  supportFn (rule R12: a whole is supported by parts that CARRY its
     *  answer); the default law is cosine > 1/2 per edge. */
    landingCheck() {
      for (const id of this.order) {
        const c = this.cells.get(id);
        if (c.state === 'landed') continue;
        const delta = vDelta(c.belief, c.lastBelief);
        c.lastBelief = c.belief;
        c.stableFor = delta.cmp(CONSTS.VAR_EPS) < 0 ? c.stableFor + 1 : 0;
        let indep = 0;
        for (const [oid] of c.edges) {
          const o = this.cells.get(oid);
          if (!o) continue;
          if (this.supportFn) { if (this.supportFn(c, o)) indep++; }
          else {
            const k = vcos(c.belief, o.belief);
            if (k && k.cmp(QHALF) > 0) indep++;
          }
        }
        if (c.stableFor >= CONSTS.LANDED_STABLE_TICKS && indep >= CONSTS.LANDED_MIN_INDEP) {
          c.state = 'landed';
          c.landedTick = this.tick;
          if (this.firstLandingTick === null) this.firstLandingTick = this.tick;
          const beliefHash = fnv1a64(c.belief.map((q) => q.toString()));
          const rec = this.chain.seal('landing', {
            cell: id, tick: this.tick, support: indep,
            stableFor: c.stableFor, beliefHash, role: c.role,
          });
          this.landed.push(rec.payload);
          this.emit('已落地 — ' + id + ' landed (support ' + indep
            + ', still ' + c.stableFor + ' ticks, receipt ' + rec.row_hash + ')', 'landing');
        }
      }
    }

    /** One full tick: measure -> commit -> consume -> landing.
     *  blendByCell: optional per-cell override (rule R10: the knower who met
     *  the whole moves at 1/8 on hearsay). */
    step(blend, blendByCell) {
      this.tick++;
      const bl = blend || QHALF;
      for (const id of this.order) {
        const c = this.cells.get(id);
        const reading = this.measure(c);
        this.journal.record(this.tick, 'measure', id, 'reading',
          '(unread)', reading ? reading.map((v) => v.r.toString()) : '(none)');
        c._reading = reading;
      }
      for (const id of this.order) {
        const use = (blendByCell && blendByCell[id]) || bl;
        const c = this.cells.get(id);
        let reading = c._reading;
        // R11 anchored hands: target = ANCHOR-weighted mix of own slant and
        // the reading, when both exist; the part never stops being felt.
        // (ANCHOR is the SLANT weight per the receipted rule — the original
        // implementation inverted it, and e_l2 refused to pass until fixed.)
        if (reading && c.slantBelief) {
          const a = CONSTS.ANCHOR;
          const na = Q1.sub(a);
          reading = reading.map((v, i) => {
            const s = c.slantBelief[i];
            return s.mul(a).add(v.mul(na));
          });
        }
        this.commit(c, reading, use);
      }
      for (const id of this.order) this.consume(this.cells.get(id));
      // optional world constraint (rule R13-style ratchets): applied THROUGH
      // the journal so rewind stays exact — a constrain is just a belief
      // event with op 'constrain'.
      if (this.constrainFn) {
        for (const id of this.order) {
          const c = this.cells.get(id);
          const nb = this.constrainFn(c, c.belief);
          if (nb) {
            this.journal.record(this.tick, 'constrain', id, 'belief',
              c.belief.map((v) => v.r.toString()), nb.map((v) => v.r.toString()));
            c.belief = nb;
          }
        }
      }
      this.landingCheck();
      return this.tick;
    }

    /** Exact state hash (for rewind proofs). q32 raws, canonical order. */
    stateHash() {
      const parts = [];
      for (const id of this.order) {
        const c = this.cells.get(id);
        parts.push([id, c.belief.map((q) => q.r.toString()),
          [...c.edges.entries()].map(([k, w]) => [k, w.r.toString()]), c.state]);
      }
      return fnv1a64([this.tick, parts, this.gamma.toString(), this.eta.toString()]);
    }

    /** Journal applier — event-aware. Edge events are PAIR-level
     *  (maybeAdmit/openEdge set both endpoints); consume weights are
     *  one-sided; 'ledger' events restore the world ledger; refusal and
     *  snapshot events carry no restorable state. */
    static applierFor(world) {
      return (ev, which) => {
        const value = ev[which];
        const cellId = ev.cell, field = ev.field, op = ev.op;
        if (op === 'refuse' || op === 'snapshot') return;
        if (op === 'ledger') { world.gamma = BigInt(value); return; }
        const c = world.cells.get(cellId);
        if (!c) return;
        if (field === 'belief') c.belief = value.map((s) => new Q32(BigInt(s)));
        else if (field.startsWith('edge:')) {
          // PAIR-level (admit/open): both endpoints move together
          const oid = field.slice(5);
          if (value === 'none') {
            c.edges.delete(oid);
            const o = world.cells.get(oid);
            if (o) o.edges.delete(cellId);
          } else {
            const w = new Q32(BigInt(value));
            c.edges.set(oid, w);
            const o = world.cells.get(oid);
            if (o) o.edges.set(cellId, w);
          }
        } else if (field.startsWith('w:')) {
          // ONE-sided (consume): influence weights are per-direction
          const oid = field.slice(2);
          if (value === 'none') c.edges.delete(oid);
          else c.edges.set(oid, new Q32(BigInt(value)));
        }
      };
    }

    rewindTicks(n) { this.rewindTicksN = this.journal.rewind(n, World.applierFor(this)); this.resyncAfterScrub(); return this.rewindTicksN; }
    forwardTicks(n) { const k = this.journal.forward(n, World.applierFor(this)); this.resyncAfterScrub(); return k; }
    scrubTo(targetTick) {
      this.journal.scrubTo(targetTick, this.tick, World.applierFor(this));
      this.tick = Math.max(targetTick, 0);
      this.resyncAfterScrub();
    }
    /** After a rewind, landing state is re-DERIVED from current beliefs and
     *  the receipt chain (receipts with tick > head are retracted). This keeps
     *  the visible state honest with the scrubbed timeline. */
    resyncAfterScrub() {
      for (const id of this.order) {
        const c = this.cells.get(id);
        c.state = 'floating'; c.stableFor = 0; c.landedTick = null;
        c.lastBelief = c.belief;
      }
      this.landed = this.chain.rows
        .filter((r) => r.kind === 'landing' && r.payload.tick <= this.tick)
        .map((r) => r.payload);
      for (const p of this.landed) {
        const c = this.cells.get(p.cell);
        if (c) { c.state = 'landed'; c.landedTick = p.tick; }
      }
      this.firstLandingTick = this.landed.length ? this.landed[0].tick : null;
      // scenario flags are DERIVED from the journal, never owned by closures
      if (this.deriveFlags) this.deriveFlags(this, this.journal.events.filter((e) => e.tick <= this.tick));
    }
  }

  EXO.World = World;

  // ==========================================================================
  // 7. PORTS — the plugin surface. This is the fork-and-extend seam:
  //    hardware, APIs, and plugins register here without touching the core.
  //    (registerObserver: extra senses; registerKernel: alternate arithmetic;
  //     registerExporter: new system-agnostic output shapes.)
  // ==========================================================================

  EXO.ports = {
    observers: [], kernels: { js: { mul: (a, b) => new Q32(asI64((BigInt(a) * BigInt(b)) >> SHIFT)) } },
    exporters: {},
    registerObserver(name, fn) { this.observers.push({ name, fn }); return this.observers.length; },
    registerKernel(name, impl) { this.kernels[name] = impl; return name; },
    registerExporter(name, fn) { this.exporters[name] = fn; return name; },
  };

  return EXO;
});
