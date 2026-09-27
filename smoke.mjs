// yiluodi/smoke.mjs — 3 checks, the fleet's gate. Exit 0 or die.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EXO = require('./app/engine.js');
const SCENARIO = require('./app/elephant.js');
const WASMQ32 = require('./app/wasmq32.js');

let fails = 0;
const check = (id, ok, detail) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) fails++;
};

// 1. engine boots, q32 exact on corners, chain seals and verifies
{
  const { Q32, Chain } = EXO;
  const c = new Chain('SMOKE');
  for (let i = 0; i < 5; i++) c.seal('row', { i });
  const ok = c.verify().ok
    && Q32.fromInt(3).div(Q32.fromInt(2)).r === Q32.fromRatio(3, 2).r   // 3.0/2.0 = 1.5
    && Q32.fromRaw(-1n).div(Q32.fromRaw(2n)).r === -(2n ** 31n)         // -0.5 q32
    && Q32.fromInt(2).mul(Q32.fromInt(4)).r === Q32.fromInt(8).r;       // 2×4 = 8
  check('smoke-1-engine', ok, 'require + q32 corners + chain seal/verify');
}

// 2. the parable emerges and the traveler answers 'elephant'
{
  const said = {};
  for (const [pid, part] of Object.entries(SCENARIO.PARTS)) {
    said[pid] = SCENARIO.say(SCENARIO.affinityBelief(part.v));
  }
  const tb = SCENARIO.travelerBelief();
  const ok = said.legL === 'pillar' && said.legR === 'pillar' && said.tusk === 'spear'
    && said.trunk === 'snake' && said.tail === 'rope' && said.ear === 'fan'
    && SCENARIO.say(tb.belief) === 'elephant';
  check('smoke-2-parable', ok, 'six part-words + the whole (coherence ' + tb.coherence.toString() + ')');
}

// 3. the story runs, lands all seven, and rewinds exactly
{
  const w = SCENARIO.buildElephantWorld(null);
  for (let i = 0; i < 60; i++) SCENARIO.stepStory(w);
  const h60 = w.stateHash();
  const landed = w.order.filter((id) => w.cells.get(id).state === 'landed').length;
  w.scrubTo(20);
  w.scrubTo(60);
  const ok = w.stateHash() === h60 && landed === 7 && w.chain.verify().ok && w.journal.verify().ok;
  check('smoke-3-rewind-landing', ok, `7/7 landed; scrub 60->20->60 hash-equal; chain + journal verify`);
}

process.exit(fails ? 1 : 0);
