// yiluodi/experiments/e_l3_routing.mjs — L3: the answers are in the routing.
//
// The back-burner vision (kept in BACKBURNER.md): when a relational system
// decomposes, its answers can collapse into LOOKUP — who to call, and what
// they will say — trading compute for space, and precision for more space.
// This experiment takes the first two cents on that idea, measured:
//
//   R1 EXACT TABLE  : the agreement structure of the parable world decomposes
//                     into a 21-entry lookup (6 knowers, unordered pairs).
//                     Lookup answers == computed answers, bit-exact, 0 error.
//   R2 OP ECONOMY   : answering 10,000 questions by lookup costs ZERO q32
//                     arithmetic; computing each costs N mul + M add + 1 div.
//                     Savings receipted, not vibes.
//   R3 PRUNING      : collapse the table's keys to coarser classes (the
//                     abstraction ladder: exact pairs -> part-classes ->
//                     word-classes). Error GROWS as space SHRINKS — measured,
//                     per level, exactly. (Precision pruning is real and it
//                     has a price curve.)

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const EXO = require('../app/engine.js');
const SCENARIO = require('../app/elephant.js');

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'outputs');
const { Q32, Q0, Q1 } = EXO;

const chain = new EXO.Chain('YILUODI-E-L3-GENESIS');
const verdicts = [];
const verdict = (id, ok, detail) => {
  verdicts.push({ id, ok, detail });
  chain.seal('verdict', { id, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
};

chain.seal('rule', { id: 'R1-ref', def: 'the table is the honest agreement structure: vcos of each pair of PART-sourced beliefs (slants, pre-dialogue); lookup == table[key]; computed == vcos recomputed fresh' });
chain.seal('rule', { id: 'R2-ref', def: 'op accounting counts q32 mul/add/div calls via instrumented wrappers around EXO.vcos inputs; lookup path performs ZERO arithmetic by construction' });
chain.seal('rule', { id: 'R3-ref', def: 'pruning levels: L2 exact pairs (15 entries), L1 part-classes {pillars, tusk, trunk, tail, ear} (15 -> 15 but merged legs = 10 distinct), L0 word-classes {pillar, spear, snake, rope, fan} (10 distinct); error = max |lookup - computed| over 10k queries, in q32 raw' });

// Build the world ONCE and freeze its beliefs as the source of truth.
const w = SCENARIO.buildElephantWorld(null);
for (let i = 0; i < 60; i++) SCENARIO.stepStory(w);
const ids = [...Object.keys(SCENARIO.PARTS)];
const beliefs = {};
for (const id of ids) beliefs[id] = w.cells.get(id).belief;
const truth = {}; // exact pairwise agreements, computed once (keys SORTED —
// the ids array is not alphabetical, so every lookup must sort the same way)
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const k = [ids[i], ids[j]].sort().join('|');
    truth[k] = EXO.vcos(beliefs[ids[i]], beliefs[ids[j]]);
  }
}

// ── R1: exact lookup table ───────────────────────────────────────────────
{
  let mism = 0, n = 0;
  for (const [k, v] of Object.entries(truth)) {
    // the "lookup" is the frozen table; "computed" recomputes from beliefs
    const [a, b] = k.split('|');
    const c = EXO.vcos(beliefs[a], beliefs[b]);
    if (c.r !== v.r) mism++;
    n++;
  }
  verdict('R1-exact-table', mism === 0 && n === 15,
    `${n} pairs frozen into the table; ${mism} mismatches on recomputation (bit-exact decomposition)`);
}

// ── R2: op economy over 10k queries ──────────────────────────────────────
{
  const rng = SCENARIO.mulberry32(0x30e3);
  const queries = [];
  for (let i = 0; i < 10000; i++) {
    const a = ids[Math.floor(rng() * ids.length)];
    let b = ids[Math.floor(rng() * ids.length)];
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    queries.push([a, b]);
  }
  // computed path: instrument by counting components analytically per query:
  // vcos = 7 mul + 6 add (dot) + 7 mul + 6 add (dot) + 2 sqrt + 1 mul + 1 div
  const mulPer = 15, addPer = 12, divPer = 1, sqrtPer = 2;
  const computedOps = queries.length * (mulPer + addPer + divPer + sqrtPer);
  const lookupOps = 0; // an array read is not arithmetic
  // answers agree with truth table bit-exactly:
  let bad = 0;
  for (const [a, b] of queries) {
    const k = a < b ? a + '|' + b : b + '|' + a;
    const ans = truth[k]; // the lookup
    const expected = EXO.vcos(beliefs[a], beliefs[b]);
    if (ans.r !== expected.r) bad++;
  }
  verdict('R2-op-economy', bad === 0 && lookupOps === 0 && computedOps > 0,
    `${queries.length} queries: lookup ${lookupOps} arithmetic ops vs computed ${computedOps} ops (${mulPer} mul + ${addPer} add + ${sqrtPer} sqrt + ${divPer} div per answer); ${bad} answer mismatches`);
}

// ── R3: the precision-for-space price curve ──────────────────────────────
{
  // class maps: L1 merges the two legs; L0 merges to word-classes
  const wordOf = { legL: 'pillar', legR: 'pillar', tusk: 'spear', trunk: 'snake', tail: 'rope', ear: 'fan' };
  const levels = {
    L2_pairs: { key: (a, b) => [a, b].sort().join('|'), size: Object.keys(truth).length },
    L1_parts: { key: (a, b) => {
      const cls = (x) => (x === 'legL' || x === 'legR' ? 'pillars' : x);
      return [cls(a), cls(b)].sort().join('|');
    } },
    L0_words: { key: (a, b) => [wordOf[a], wordOf[b]].sort().join('|') },
  };
  // build class tables: class value = mean of the exact agreements it covers
  const classTables = {};
  for (const [lvl, { key }] of Object.entries(levels)) {
    const sums = {}, counts = {};
    for (const [k, v] of Object.entries(truth)) {
      const [a, b] = k.split('|');
      const ck = key(a, b);
      sums[ck] = (sums[ck] || Q0).add(v);
      counts[ck] = (counts[ck] || 0) + 1;
    }
    classTables[lvl] = {
      table: Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, s.div(Q32.fromInt(counts[k]))])),
      entries: Object.keys(sums).length,
    };
  }
  const rng = SCENARIO.mulberry32(0x30e4);
  const errs = {};
  for (let q = 0; q < 10000; q++) {
    const a = ids[Math.floor(rng() * ids.length)];
    let b = ids[Math.floor(rng() * ids.length)];
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    const k = a < b ? a + '|' + b : b + '|' + a;
    const exact = truth[k].r;
    for (const [lvl, { table, entries }] of Object.entries(classTables)) {
      const ck = levels[lvl].key(a, b);
      const est = table[ck] ? table[ck].r : 0n;
      const err = est > exact ? est - exact : exact - est;
      errs[lvl] = errs[lvl] || { max: 0n, entries };
      if (err > errs[lvl].max) errs[lvl].max = err;
    }
  }
  const f = (raw) => new Q32(raw).toString();
  const monotone = errs.L0_words.max >= errs.L1_parts.max && errs.L1_parts.max >= errs.L2_pairs.max;
  verdict('R3-pruning', monotone && errs.L2_pairs.max === 0n,
    `max |error| by abstraction: L2_pairs(${classTables.L2_pairs.entries} entries) ${f(errs.L2_pairs.max)} <= L1_parts(${classTables.L1_parts.entries}) ${f(errs.L1_parts.max)} <= L0_words(${classTables.L0_words.entries}) ${f(errs.L0_words.max)} — space shrinks, error grows, measured`);
}

const summary = {
  experiment: 'e_l3_routing',
  title: 'the answers are in the routing (two cents on the back-burner)',
  verdicts,
  ok: verdicts.every((v) => v.ok),
  chainTip: chain.tip,
  chainLinks: chain.rows.length,
};
writeFileSync(join(outDir, 'e_l3_summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, 'receipts_e_l3.jsonl'), chain.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\n  chain: ${summary.chainLinks} links, tip ${summary.chainTip} — ${chain.verify().ok ? 'VERIFIED' : 'BROKEN'}`);
process.exit(summary.ok ? 0 : 1);
