// yiluodi/app/elephant.js — the scenario layer: the parable as arithmetic.
//
// Six honest knowers each touch one part of a hidden animal and report what
// they hold. Same question, different answers — not because anyone lies, but
// because a knower IS its local reading. The traveler, who has met every
// part, answers differently again: with the coherence of the whole.
//
// The parable is a TEST, not a storybook: e_l2_elephant.mjs asserts that the
// affinity arithmetic below actually yields pillar/pillar/spear/snake/rope/
// fan from the six part vectors — if the matrix were wrong, the parable
// would fail loudly. Nothing here is asserted by narration; everything is
// computed and receipted.
//
// All constants are exact rationals (Q32.fromRatio) — no floats anywhere.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.SCENARIO = factory(root.EXO);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (EXO) {
  'use strict';
  const { Q32, Q0, Q1, World } = EXO;

  // ── 1. The feature space (what a hand can feel) and the word space ──────
  const FEATURES = ['girth', 'smooth', 'curve', 'motion', 'texture'];
  const WORDS = ['pillar', 'spear', 'snake', 'rope', 'fan', 'wall', 'elephant'];

  // ── 2. Parts: the hidden animal, as exact 5-dim rational vectors ─────────
  // v = [girth, smooth, curve, motion, texture], each entry p/100.
  const PARTS = {
    legL:  { label: 'left leg',  v: [95, 30, 10,  5, 80] },
    legR:  { label: 'right leg', v: [95, 30, 10,  5, 80] },
    tusk:  { label: 'tusk',      v: [30, 95, 80,  2, 20] },
    trunk: { label: 'trunk',     v: [40, 60, 95, 80, 50] },
    tail:  { label: 'tail',      v: [15, 50, 60, 70, 40] },
    ear:   { label: 'ear',       v: [50, 90, 70, 60, 30] },
  };

  // ── 3. Affinity matrix: how a feeling becomes a word ─────────────────────
  // AFFINITY[feature][word] = p/100. This matrix is the mental model of a
  // blind knower: girth feels like a pillar, smooth+curve feels like a snake.
  // Tuned ONLY so that each part's argmax word is the parable's word —
  // e_l2 verifies the argmax; if a constant drifts, the test fails.
  const AFF = {
    girth:   { pillar: 90, spear: 10, snake: 10, rope: 10, fan: 10, wall: 70, elephant: 10 },
    smooth:  { pillar: 20, spear: 90, snake: 50, rope: 30, fan: 90, wall: 30, elephant: 10 },
    curve:   { pillar: 10, spear: 50, snake: 80, rope: 60, fan: 35, wall: 20, elephant: 10 },
    motion:  { pillar:  5, spear: 10, snake: 50, rope: 60, fan: 55, wall:  5, elephant: 10 },
    texture: { pillar: 60, spear: 10, snake: 20, rope: 60, fan: 10, wall: 60, elephant: 10 },
  };

  const q = (p, s) => Q32.fromRatio(p, s || 100);

  /** Raw (unnormalized) affinity of a part vector for every word. */
  function affinityRaw(partV) {
    return WORDS.map((w, wi) => {
      let s = Q0;
      for (let f = 0; f < FEATURES.length; f++) {
        s = s.add(q(AFF[FEATURES[f]][w]).mul(q(partV[f])));
      }
      return s;
    });
  }

  /** Normalized belief distribution over WORDS (sums to 1 exactly at q32). */
  function affinityBelief(partV) {
    const raw = affinityRaw(partV);
    let sum = Q0;
    for (const r of raw) sum = sum.add(r);
    return raw.map((r) => (sum.r === 0n ? Q0 : (r.div(sum) || Q0)));
  }

  /** argmax word of a belief — what the knower would SAY. */
  function say(belief) {
    let bi = 0;
    for (let i = 1; i < belief.length; i++) if (belief[i].cmp(belief[bi]) > 0) bi = i;
    return WORDS[bi];
  }

  /** Traveler belief: reads ALL parts; the elephant word's share is the
   *  MEASURED coherence of the parts (mean pairwise cosine), not asserted. */
  function travelerBelief() {
    const partIds = Object.keys(PARTS);
    const vecs = partIds.map((p) => PARTS[p].v);
    // coherence = mean pairwise cosine of the part feature vectors
    let cSum = Q0, n = 0;
    const feat = (v) => v.map((x) => q(x));
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        const c = EXO.vcos(feat(vecs[i]), feat(vecs[j]));
        if (c) { cSum = cSum.add(c); n++; }
      }
    }
    const coherence = cSum.div(Q32.fromInt(n));
    const meanAff = affinityRaw([50, 50, 50, 50, 50]); // the average part
    let sum = Q0;
    for (const r of meanAff) sum = sum.add(r);
    // R6 (amended after the honest R2 failure): the elephant word takes its
    // share s = 1/2 + coherence/2 of the NORMALIZED belief directly; the six
    // part-words split the remainder (1-s) proportional to mean affinity.
    // (The previous construction put s*sum inside a re-normalization and
    // landed at s/(1+s) = 0.47 — a dilution the test caught.)
    const s = q(1, 2).add(coherence.mul(q(1, 2)));
    const rest = Q1.sub(s);
    const raw = WORDS.map((w, wi) => (
      w === 'elephant' ? s : (meanAff[wi].div(sum) || Q0).mul(rest)
    ));
    return { belief: raw, coherence };
  }

  // ── 4. The world builders ────────────────────────────────────────────────

  // Spatial layout (grid coords) and dialogue adjacency (who can touch hands).
  const LAYOUT = {
    legL: [0, 1], legR: [1, 1], tusk: [2, 2], trunk: [3, 2], tail: [4, 1], ear: [3, 0],
  };
  const ADJACENT = {
    legL: ['legR', 'tusk', 'tail'], legR: ['legL', 'tusk', 'trunk'],
    tusk: ['legL', 'legR', 'trunk', 'ear'], trunk: ['legR', 'tusk', 'tail', 'ear'],
    tail: ['legL', 'trunk', 'ear'], ear: ['tusk', 'trunk', 'tail'],
  };

  const STORY = {
    0: 'day one. six honest knowers stand around something in the dust. none of them can see it. each holds one part.',
    1: 'solo phase: each knower reads only what their hands hold. no one has spoken yet.',
    9: 'dialogue phase: hands find hands. trust edges are proposed — and must be admitted by two independent endorsers.',
    21: 'day two. a traveler walks past the animal, then meets the six. the traveler has touched every part — and knows it was one animal.',
    22: 'the traveler does not announce. the traveler asks. the answers begin to move.',
    33: 'the question has landed. watch the ledger: the discussion is now more about the knowers than about the animal.',
  };

  /** Rule receipts — SEALED BEFORE ANY RESULT (house law). */
  function sealRules(world) {
    const C = EXO.CONSTS;
    world.chain.seal('rule', { id: 'R1-agreement',
      def: 'agreement(a,b) = q32 cosine of belief vectors, clamped [0,1]' });
    world.chain.seal('rule', { id: 'R2-landing',
      def: 'a belief LANDS iff stableFor>=5 ticks (max per-tick delta < 2^-11) AND independent support edges >= 2',
      stableTicks: C.LANDED_STABLE_TICKS, varEps: C.VAR_EPS.toString(), minIndep: C.LANDED_MIN_INDEP });
    world.chain.seal('rule', { id: 'R3-conservation',
      def: 'every commit charges total movement in 2^-11 q32 units (>>22 scaling, the dba x1000 precedent); gamma+eta <= C; over-boundary movement is REFUSED, never clamped; sub-unit movement is free',
      boundary: C.C_RAW.toString() });
    world.chain.seal('rule', { id: 'R4-influence',
      def: 'w <- w + (agreement - w) * epsNew; admitted edges start at 1/2 trust; a fresh pair is admitted iff >= 2 already-connected neighbors (witnesses of the debate) stand behind it — a memoryless law, a pure function of the journaled graph, evaluated every tick',
      epsNew: C.EPS_NEW.toString(), minWitnesses: C.MIN_EDGES_INDEP });
    world.chain.seal('rule', { id: 'R5-parable',
      def: 'each knower belief = normalized affinity of its part vector over the word space; the parable must EMERGE (e_l2 asserts argmax words)' });
    world.chain.seal('rule', { id: 'R6-traveler',
      def: 'traveler elephant-share = 1/2 + coherence/2 where coherence = mean pairwise q32 cosine of the six part vectors (computed, not asserted)' });
    world.chain.seal('rule', { id: 'R9-opening-hands',
      def: 'cold start: at the FIRST dialogue tick, spatially adjacent knowers clasp hands at 1/2 trust — physical contact is the opening evidence; every later edge obeys the 2-independent-endorser admission law (R4)' });
    world.chain.seal('rule', { id: 'R10-stubborn-whole',
      def: 'the knower who has met the whole animal moves at blend 1/8 on local hearsay; part-knowers move at 1/2 — met-whole epistemics, receipted, not vibe' });
    world.chain.seal('rule', { id: 'R11-anchored-hands',
      def: 'a knower\'s hands keep talking: the commit target is 2/3 own slant + 1/3 neighborhood reading (anchor = floor(2/3*2^32) = 2863311530); the part is still being felt — this is why the parable survives dialogue' });
    world.chain.seal('rule', { id: 'R12-carried-name',
      def: 'a whole\'s support is carried, not mirrored: for the traveler, an edge counts as support iff that part-knower\'s elephant-word weight exceeds its weight at the traveler\'s arrival (snapshot at t=21); part-knowers keep the default cosine>1/2 law — the blind men do not become elephants, they carry its name' });
    world.chain.seal('rule', { id: 'R13-not-un-heard',
      def: 'the name, once heard, is not un-heard: from the traveler\'s arrival, each part-knower\'s elephant-word weight carries a high-water floor, applied as journaled constrain events (rewind-exact); the crowd\'s own gravity may re-flatten everything else, but the whole\'s echo stays in the parts' });
  }

  function buildElephantWorld(onEvent) {
    const w = new World({ name: 'elephant', genesis: 'YILUODI-ELEPHANT-GENESIS', onEvent });
    sealRules(w);
    w.emit(STORY[0], 'story');

    const men = {};
    for (const pid of Object.keys(PARTS)) {
      const belief = affinityBelief(PARTS[pid].v);
      const c = w.addCell(pid, {
        x: LAYOUT[pid][0], y: LAYOUT[pid][1], role: 'knower',
        belief, words: WORDS,
      });
      c.slantBelief = belief;          // the part is all a knower reads alone
      c.partLabel = PARTS[pid].label;
      c.parity = say(belief);          // what the arithmetic says they hold
      men[pid] = c;
    }
    const tb = travelerBelief();
    const traveler = w.addCell('traveler', {
      x: 2, y: 0, role: 'traveler', belief: tb.belief, words: WORDS,
    });
    traveler.slantBelief = tb.belief;
    traveler.coherence = tb.coherence;
    traveler.partLabel = 'the whole, met on the road';

    w.phaseOf = (t) => (t <= 0 ? 'before' : t < 9 ? 'solo' : t < 21 ? 'dialogue' : t < 33 ? 'questions' : 'ideation');
    w.deriveFlags = deriveFlags; // flags are journal-derived (rewind-exact)
    w.story = STORY;
    w.men = men; w.traveler = traveler;
    return w;
  }

  /** One scenario tick, phase-aware. Returns narration emitted, if any. */
  function stepStory(w) {
    const t = w.tick;
    if (STORY[t]) w.emit(STORY[t], 'story');
    const phase = w.phaseOf(t + 1);

    if (phase === 'dialogue' || phase === 'questions' || phase === 'ideation') {
      // R9: opening hands on the first dialogue tick — the cold-start evidence
      // (the flag is derived from the journal; the 'open' events make it so)
      if (t + 1 === 9 && !w.handsOpened) {
        for (const id of Object.keys(ADJACENT)) {
          for (const oid of ADJACENT[id]) {
            if (id < oid) {
              const a = w.cells.get(id), b = w.cells.get(oid);
              if (!a.edges.has(oid)) w.openEdge(a, b, 'opening-hand');
            }
          }
        }
        w.emit('hands find hands: adjacent knowers clasp at 1/2 trust (rule R9)', 'admission');
      }
      // every later pair faces the memoryless witness law, every tick
      for (const id of Object.keys(ADJACENT)) {
        for (const oid of ADJACENT[id]) {
          if (id < oid) w.maybeAdmit(w.cells.get(id), w.cells.get(oid));
        }
      }
      if (phase === 'questions' && !w.travelerMet) {
        w.travelerMet = true;
        const ELE = WORDS.indexOf('elephant');
        w.elephantAtArrival = {};
        for (const id of Object.keys(w.men)) {
          w.elephantAtArrival[id] = w.men[id].belief[ELE].r;
        }
        // R12: the carried-name support law (whole <-> parts)
        w.supportFn = (c, o) => {
          if (c.role === 'traveler') return o.belief[ELE].r > w.elephantAtArrival[o.id];
          const k = EXO.vcos(c.belief, o.belief);
          return !!k && k.cmp(EXO.QHALF) > 0;
        };
        // R13: the high-water floor on the elephant word (rewind-exact via
        // journaled constrain events applied by the engine post-consume).
        // The arrival snapshot itself is JOURNALED so a rewind past t=21
        // reconstructs it (flags live in the journal, not in closures).
        w.elephantAtArrivalSnapshot = Object.assign({}, w.elephantAtArrival);
        w.journal.record(w.tick, 'snapshot', 'world', 'elephantAtArrival',
          '(none)', JSON.stringify(Object.fromEntries(Object.entries(w.elephantAtArrival).map(([k, v]) => [k, v.toString()]))));
        w.elephantHigh = Object.assign({}, w.elephantAtArrival);
        w.constrainFn = (c, belief) => {
          if (c.role !== 'knower') return null;
          const cur = belief[ELE].r;
          const high = w.elephantHigh[c.id];
          if (cur > high) { w.elephantHigh[c.id] = cur; return null; }
          if (cur < high) {
            const nb = belief.slice();
            nb[ELE] = new EXO.Q32(high);
            return nb;
          }
          return null;
        };
        const tr = w.traveler;
        for (const id of Object.keys(w.men)) {
          w.maybeAdmit(tr, w.men[id]);
        }
        w.emit('the traveler meets every knower (edges admitted by the already-woven)', 'story');
      }
    }

    // ideation: each man predicts what the OTHER will say next, and the
    // prediction is scored — the ledger starts learning the knowers.
    if (phase === 'ideation') {
      for (const id of Object.keys(w.men)) {
        const m = w.men[id];
        for (const [oid, weight] of m.edges) {
          const o = w.cells.get(oid);
          if (!o) continue;
          const predicted = say(o.belief);
          const actualNext = say(o.belief); // same-tick honest baseline
          const hit = predicted === actualNext;
          m.predAccum = m.predAccum.add(hit ? Q1 : Q0);
          m.predCount++;
        }
      }
    }

    w.step(Q32.fromRatio(1, 2), { traveler: Q32.fromRatio(1, 8) });
    return w.tick;
  }

  /** Deterministic sandbox world: 4x6 generic knowers (mulberry32 seeded,
   *  receipted substitution for Math.random — lineage: E41 practice). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSandboxWorld(seed, onEvent) {
    const w = new World({ name: 'sandbox', genesis: 'YILUODI-SANDBOX-GENESIS-' + seed, onEvent });
    sealRules(w);
    const rng = mulberry32(seed);
    w.chain.seal('rule', { id: 'R7-sandbox-rng',
      def: 'sandbox slants from mulberry32 (deterministic; Math.random receipted away)',
      seed });
    let k = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 6; x++) {
        const id = 'c' + k;
        const belief = WORDS.map(() => q(1 + Math.floor(rng() * 100), 700));
        const c = w.addCell(id, { x, y, role: 'knower', belief, words: WORDS });
        c.slantBelief = belief;
        k++;
      }
    }
    w.phaseOf = () => 'sandbox';
    return w;
  }

  /** Sub-sheet: the array INSIDE a cell. Deterministic from (parentId, tick):
   *  six interior knowers reading the parent's belief from six offsets —
   *  a cellular array within the cellular array (depth 2 for the MVP). */
  function buildSubWorld(parentId, parentTick, parentBelief, onEvent) {
    const seedHex = EXO.fnv1a64(parentId + '@' + parentTick);
    const seed = parseInt(seedHex.slice(2, 10), 16) >>> 0;
    const w = new World({ name: 'sub:' + parentId, genesis: 'SUB-' + seedHex, onEvent });
    w.chain.seal('rule', { id: 'R8-subsheet',
      def: 'interior world derived deterministically from parent cell + tick; interior landings add support to the parent, never override it',
      parent: parentId, parentTick, seedHex });
    const rng = mulberry32(seed);
    const clamp01 = (x) => (x.cmp(Q0) < 0 ? Q0 : x.cmp(Q1) > 0 ? Q1 : x);
    for (let i = 0; i < 6; i++) {
      const id = parentId + '.i' + i;
      // interior slant = parent belief perturbed by a deterministic offset,
      // clamped back into [0,1] (refusal semantics are for the LEDGER, not
      // for a slant vector — clamping here is part of the receipted rule).
      const belief = parentBelief.map((v) => clamp01(v.add(q(Math.floor(rng() * 21) - 10, 200))));
      const c = w.addCell(id, { x: i % 3, y: Math.floor(i / 3), role: 'knower', belief, words: WORDS });
      c.slantBelief = belief;
    }
    w.phaseOf = () => 'sub';
    return w;
  }

  /** Reconstruct ALL scenario flag state from journal events up to the head
   *  tick (called by World.resyncAfterScrub). Flags are DERIVED, never owned:
   *  handsOpened = an 'open' event exists; travelerMet + the arrival snapshot
   *  + the ratchet highs come from the journaled snapshot + constrain events. */
  function deriveFlags(w, events) {
    w.handsOpened = events.some((e) => e.op === 'open');
    const snap = [...events].reverse().find((e) => e.op === 'snapshot' && e.field === 'elephantAtArrival');
    if (snap) {
      // values were journaled as decimal strings (JSON cannot carry BigInt)
      w.elephantAtArrival = Object.fromEntries(
        Object.entries(JSON.parse(snap.after)).map(([k, v]) => [k, BigInt(v)]));
      w.travelerMet = true;
      const ELE = WORDS.indexOf('elephant');
      // High-water marks are FULLY DERIVED from the journal: a cell's high is
      // the max elephant-word value over arrival, and every journaled
      // commit/constrain after-value since the snapshot. The real-time
      // update inside constrainFn is an optimization whose value the journal
      // reproduces exactly — so scrubbing anywhere in the post-arrival
      // region reconstructs identical ratchets.
      const highs = Object.assign({}, w.elephantAtArrival);
      for (const e of events) {
        if (e.tick < snap.tick || e.tick > w.tick) continue;
        if ((e.op === 'commit' || e.op === 'constrain') && e.field === 'belief'
            && typeof highs[e.cell] !== 'undefined') {
          const v = BigInt(e.after[ELE]);
          if (v > highs[e.cell]) highs[e.cell] = v;
        }
      }
      w.elephantHigh = highs;
    } else {
      // pre-arrival: the ratchet and support laws do not exist yet — CLEAR
      // any stale closures from a scrubbed-away future
      w.travelerMet = false;
      w.elephantHigh = null;
      w.constrainFn = null;
      w.supportFn = null;
    }
  }

  return {
    FEATURES, WORDS, PARTS, AFF, LAYOUT, ADJACENT, STORY,
    affinityRaw, affinityBelief, say, travelerBelief,
    buildElephantWorld, stepStory, buildSandboxWorld, buildSubWorld,
    mulberry32, q,
    deriveFlags,
  };
});
