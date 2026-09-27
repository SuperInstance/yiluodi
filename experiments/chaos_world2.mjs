// experiments/chaos_world2.mjs — the deterministic CHAOS WORLD + event
// script shared by the E-C2 parent (ground-truth mirror) and the SIGKILL
// child. TEST-ONLY: app/engine.js is untouched; this module drives the
// engine's PUBLIC API only (addCell / openEdge / maybeAdmit / step / charge)
// and rebuilds worlds from recovered event prefixes through the engine's own
// World.applierFor — the same applier the UI's exact scrubber uses.
//
// Same seed => byte-identical event sequence in any process (mulberry32 for
// every random draw — the E41 receipted substitution for Math.random). The
// parent replays the script against its own mirror world; every frame the
// child managed to write must be a byte-exact PREFIX of the mirror's lines.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EXO = require('../app/engine.js');
const SCENARIO = require('../app/elephant.js');

const { Q32, World } = EXO;
const WORDS = SCENARIO.WORDS; // 7 words (the elephant parable's vocabulary)
const q = SCENARIO.q;         // exact rational -> q32 (the scenario's helper)
const mulberry32 = SCENARIO.mulberry32; // deterministic, receipted in R7

export const N_CELLS = 8;

/** The chaos world: 8 knowers in a ring layout; slant = initial belief
 *  (the sandbox pattern); edges are NOT pre-wired — the script opens them,
 *  so the journal carries the full social history. */
export function buildChaosWorld(seed, onEvent) {
  const w = new World({ name: 'chaos', genesis: 'YILUODI-E-C2-CHAOS-' + seed, onEvent });
  w.chain.seal('rule', {
    id: 'E-C2-script-law',
    def: 'deterministic chaos script (mulberry32); the journal is the whole truth; '
       + 'recovery = canonical JSONL prefix + engine applier replay; engine untouched',
    seed,
  });
  const rng = mulberry32(seed);
  for (let i = 0; i < N_CELLS; i++) {
    const belief = WORDS.map(() => q(1 + Math.floor(rng() * 100), 700));
    const c = w.addCell('k' + i, {
      x: i % 4, y: (i / 4) | 0, role: 'knower', belief, words: WORDS,
    });
    c.slantBelief = belief;
  }
  return w;
}

// ── the scripted action grammar ──────────────────────────────────────────────
// Every action is a pure function of (action index, seeded stream, world).
// Actions that cannot legally fire (open across self, admit over an existing
// edge) fire as deterministic NO-OPs (zero journal events) — child and
// parent stay in lockstep by construction.

const BLENDS = [[1, 2], [1, 4], [3, 4], [1, 1], [1, 8]];

export const REFUSE_AT = 42; // one scripted over-boundary charge: the exact
// conservation boundary (6806210843 ok / 6806210844 refuse) is exercised
// ONCE, mid-stream, so 'refuse' events are in the persisted story.

export function planAction(world, rnd, i) {
  if (i === REFUSE_AT) return { t: 'refuseProbe' };
  const roll = rnd();
  if (roll < 0.50) return { t: 'step', b: Math.floor(rnd() * BLENDS.length) };
  if (roll < 0.64) return { t: 'open', a: Math.floor(rnd() * N_CELLS), b: Math.floor(rnd() * N_CELLS) };
  if (roll < 0.80) return { t: 'admit', a: Math.floor(rnd() * N_CELLS), b: Math.floor(rnd() * N_CELLS) };
  if (roll < 0.90) return { t: 'charge', units: 1 + Math.floor(rnd() * 40) };
  return { t: 'step8', b: Math.floor(rnd() * BLENDS.length), cell: Math.floor(rnd() * N_CELLS) };
}

export function applyAction(world, a) {
  if (a.t === 'step') {
    world.step(Q32.fromRatio(BLENDS[a.b][0], BLENDS[a.b][1]));
  } else if (a.t === 'step8') {
    world.step(Q32.fromRatio(BLENDS[a.b][0], BLENDS[a.b][1]),
      { ['k' + a.cell]: Q32.fromRatio(1, 8) });
  } else if (a.t === 'open') {
    if (a.a === a.b) return;
    const ca = world.cells.get('k' + a.a), cb = world.cells.get('k' + a.b);
    if (!ca || !cb || ca.edges.has(cb.id)) return;
    world.openEdge(ca, cb, 'chaos-contact');
  } else if (a.t === 'admit') {
    if (a.a === a.b) return;
    const ca = world.cells.get('k' + a.a), cb = world.cells.get('k' + a.b);
    if (!ca || !cb) return;
    world.maybeAdmit(ca, cb); // false = deterministic no-op, no event
  } else if (a.t === 'charge') {
    world.charge(BigInt(a.units) << 22n);
  } else if (a.t === 'refuseProbe') {
    // charge exactly one unit PAST the boundary: refused + journaled,
    // gamma untouched — the script continues normally afterwards.
    const C = EXO.CONSTS.C_RAW;
    world.charge((C - (world.gamma + world.eta) + 1n) << 22n);
  }
}

/** Total actions in the scripted run (chosen so the kill grid has a wide
 *  mid-stream window; ~35 steps over 8 wired cells => ~1000+ events). */
export const TOTAL_ACTIONS = 60;

/** The script's seeded stream — exported so parent and child LITERALLY
 *  share one implementation (duplicated mulberry32 callsites are how
 *  "deterministic" mirrors silently diverge). Decoupled from the builder
 *  stream by a fixed xor mask. */
export function makeRng(seed) {
  return mulberry32((seed ^ 0x9e3779b9) >>> 0);
}

/** Run the full script; used by the mirror and (per-action) by the child. */
export function runScript(world, rnd, nActions, onAction) {
  for (let i = 0; i < nActions; i++) {
    const a = planAction(world, rnd, i);
    const before = world.journal.events.length;
    applyAction(world, a);
    if (onAction) onAction(i, a, before);
  }
}

// ── recovery-side replay helpers ─────────────────────────────────────────────
// Recovery rebuilds a world from an event prefix by applying each event's
// 'after' through the engine's own applier (the EXACT machinery the UI
// scrubber uses) and setting tick from the event. This is a PURE function of
// (builder seed, events[0..k)) — the mirror and the recovery path share it,
// so every hash comparison below is procedure-symmetric.

export function applyEventTo(world, ev) {
  World.applierFor(world)(ev, 'after');
  world.tick = ev.tick;
}

/** Fresh world + first k events applied. k=0 is the genesis state. */
export function replayWorld(seed, events, k) {
  const w = buildChaosWorld(seed);
  for (let i = 0; i < k; i++) applyEventTo(w, events[i]);
  return w;
}

/** Genesis state hash (k=0 anchor for rewind-to-genesis equality). */
export function genesisHash(seed) {
  return buildChaosWorld(seed).stateHash();
}

/** Attach a recovered event array to a replayed world as its LIVE journal
 *  (redo empty: this is head state), so rewind/forward/scrub all work. */
export function attachRecoveredJournal(world, events) {
  const j = new EXO.Journal();
  j.events = events.slice();
  j.redo = [];
  world.journal = j;
  return j;
}
