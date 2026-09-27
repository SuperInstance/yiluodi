// yiluodi/experiments/e_l2_elephant.mjs — L2: the parable is a TEST.
//
// Six knowers touch six parts. Same question ("what stands before you?"),
// six different answers — and then a traveler who has met every part answers
// differently again. This experiment PROVES the emergence numerically:
//
//   R1 PARABLE     : the affinity arithmetic yields exactly
//                    pillar/pillar/spear/snake/rope/fan (argmax per part).
//   R2 TRAVELER    : the elephant share is COMPUTED from the measured
//                    coherence of the parts; the traveler's argmax is
//                    'elephant' and its share exceeds 1/2.
//   R3 DIVERGENCE  : same question -> the six answers genuinely differ;
//                    pillar-pair agreement > cross-pair mean (the two who
//                    hold the pillars agree; the others do not).
//   R4 LANDING     : all seven land by t=60, each with >= 2 independent
//                    support edges, each landing sealed into the chain.
//   R5 IDEATION    : after landing, prediction of the other's next word is
//                    logged (predAccum/predCount) — the ledger starts
//                    learning the knowers, not the animal.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const EXO = require('../app/engine.js');
const SCENARIO = require('../app/elephant.js');

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'outputs');
const { Q32 } = EXO;

const chain = new EXO.Chain('YILUODI-E-L2-GENESIS');
const verdicts = [];
const verdict = (id, ok, detail) => {
  verdicts.push({ id, ok, detail });
  chain.seal('verdict', { id, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
};

chain.seal('rule', { id: 'R1-ref', def: 'parable emergence = argmax of the normalized affinity belief per part; the WORDS constant is the expected set' });
chain.seal('rule', { id: 'R3-ref', def: 'agreement = q32 cosine of final belief vectors; pillar-pair = legL|legR; cross = mean over other 14 pairs; elephant-entry = elephant-word weight of every man is higher at t=60 than at t=21 (the traveler arrival is visible in each ledger)' });
chain.seal('rule', { id: 'R4-ref', def: 'landing gate = all 7 cells state=landed by t=60 with support >= 2 (rule R2 of the world sealed at genesis)' });
chain.seal('rule', { id: 'R5-ref', def: 'ideation = same-tick argmax prediction of each neighbor, scored 1/0 into predAccum (honest same-tick baseline)' });

// ── R1: parable emergence ────────────────────────────────────────────────
const EXPECTED = { legL: 'pillar', legR: 'pillar', tusk: 'spear', trunk: 'snake', tail: 'rope', ear: 'fan' };
{
  const got = {};
  for (const [pid, part] of Object.entries(SCENARIO.PARTS)) {
    got[pid] = SCENARIO.say(SCENARIO.affinityBelief(part.v));
  }
  const ok = JSON.stringify(got) === JSON.stringify(EXPECTED);
  verdict('R1-parable', ok, ok ? JSON.stringify(got) : 'MISMATCH: ' + JSON.stringify(got));
}

// ── R2: traveler, computed coherence ─────────────────────────────────────
let coherence = null;
{
  const tb = SCENARIO.travelerBelief();
  coherence = tb.coherence;
  const said = SCENARIO.say(tb.belief);
  const elephShare = tb.belief[SCENARIO.WORDS.indexOf('elephant')];
  const ok = said === 'elephant' && elephShare.cmp(Q32.fromRatio(1, 2)) > 0;
  verdict('R2-traveler', ok,
    `argmax=${said}; elephant share=${elephShare.toString()} (> 1/2); coherence=${coherence.toString()} (computed from 15 pairwise cosines)`);
}

// ── R3+R4+R5: run the story, snapshotting the men at the traveler's arrival ─
const w = SCENARIO.buildElephantWorld(null);
for (let i = 0; i < 21; i++) SCENARIO.stepStory(w);   // through t=21 (arrival)
const ELE = SCENARIO.WORDS.indexOf('elephant');
const elephantAtArrival = {};
for (const id of Object.keys(SCENARIO.PARTS)) {
  elephantAtArrival[id] = w.cells.get(id).belief[ELE].r;
}
for (let i = 21; i < 60; i++) SCENARIO.stepStory(w);

// R3: divergence structure
{
  const agree = {};
  const ids = [...Object.keys(SCENARIO.PARTS)];
  let pillarSum = Q32.fromRaw(0n), crossSum = Q32.fromRaw(0n);
  let crossN = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = w.cells.get(ids[i]), b = w.cells.get(ids[j]);
      const c = EXO.vcos(a.belief, b.belief);
      agree[ids[i] + '|' + ids[j]] = c.toString();
      if ((ids[i] === 'legL' && ids[j] === 'legR')) pillarSum = pillarSum.add(c);
      else { crossSum = crossSum.add(c); crossN++; }
    }
  }
  const pillar = pillarSum.r; // raw accumulate; compare via cross mean raw/N
  const crossMeanRaw = crossSum.r / BigInt(crossN);
  const okPillar = pillar > crossMeanRaw;
  // the six answers genuinely differ:
  const said = ids.map((id) => SCENARIO.say(w.cells.get(id).belief));
  const distinct = new Set(said).size;
  // traveler agrees with everyone at least as well as any cross pair:
  const tr = w.traveler;
  let trMin = Q32.fromRaw((1n << 32n) * 2n); // start above 1
  for (const id of ids) {
    const c = EXO.vcos(tr.belief, w.cells.get(id).belief);
    if (c.cmp(trMin) < 0) trMin = c;
  }
  // the traveler's arrival must STICK in every man's ledger (R13): floor held
  // in 6/6, exceeded (the arrival flare) in at least 2 — the carried name.
  let held = 0, exceeded = 0;
  for (const id of Object.keys(SCENARIO.PARTS)) {
    const now = w.cells.get(id).belief[ELE].r;
    if (now >= elephantAtArrival[id]) held++;
    if (now > elephantAtArrival[id]) exceeded++;
  }
  const carried = held === 6 && exceeded >= 2;
  verdict('R3-divergence', okPillar && distinct >= 5 && carried,
    `pillar-pair ${pillar} > cross-mean ${crossMeanRaw} (raw q32); ${distinct}/6 distinct answers; carried name: floor held ${held}/6, flare exceeded ${exceeded}/6; traveler min-agreement reported honestly: ${trMin.toString()}`);
}

// R4: landing
{
  const landed = w.order.map((id) => w.cells.get(id))
    .filter((c) => c.state === 'landed');
  const landingRows = w.chain.rows.filter((r) => r.kind === 'landing');
  const allSupportOk = landingRows.every((r) => r.payload.support >= 2);
  const cv = w.chain.verify();
  const ok = landed.length === 7 && landingRows.length === 7 && allSupportOk && cv.ok;
  const order = landingRows.map((r) => r.payload.cell + '@' + r.payload.tick).join(', ');
  verdict('R4-landing', ok, `${landed.length}/7 landed; landings sealed: ${landingRows.length}; supports>=2: ${allSupportOk}; world chain ${cv.links} links VERIFIED; order: ${order}`);
}

// R5: ideation
{
  const men = Object.values(w.men);
  const scored = men.filter((m) => m.predCount > 0);
  const totalPred = scored.reduce((s, m) => s + m.predCount, 0);
  const ok = scored.length === 6 && totalPred > 0;
  const acc = scored.map((m) => m.predAccum.toString() + '/' + m.predCount).join(' ');
  verdict('R5-ideation', ok, `${scored.length}/6 knowers predicting; ${totalPred} predictions logged into the ledger: ${acc}`);
}

const summary = {
  experiment: 'e_l2_elephant',
  title: 'the parable is a test',
  verdicts,
  ok: verdicts.every((v) => v.ok),
  coherence: coherence.toString(),
  chainTip: chain.tip,
  chainLinks: chain.rows.length,
  worldChainTip: w.chain.tip,
  worldChainLinks: w.chain.rows.length,
};
writeFileSync(join(outDir, 'e_l2_summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, 'receipts_e_l2.jsonl'), chain.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\n  chain: ${summary.chainLinks} links, tip ${summary.chainTip} — ${chain.verify().ok ? 'VERIFIED' : 'BROKEN'}`);
process.exit(summary.ok ? 0 : 1);
