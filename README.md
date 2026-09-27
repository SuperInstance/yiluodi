# 已落地

**yǐ luòdì — *has landed*.** The name is not translated. It is learned.

Open `index.html` in any browser. Six honest knowers stand around a hidden
animal. Each holds one part and answers the same question — a pillar, a
spear, a snake, a rope, a fan. They argue. Answers drift, find each other,
and when one holds still long enough with enough independent support, it
**lands**, with a receipt.

Watch that happen and you now know why this page has its name.

> 给中文读者：在这里，「落地」不再是幻灯片上的词。它刚刚在你的屏幕上真实地发生了——
> 并且带着收据。这个名字的反讽，是留给懂的人的。

This is the **hello-world application for SuperInstance**: a page where
knowing happens locally — no dependencies, no network calls, no build step,
no server. It works from a double-clicked file. Everything it claims, it can
prove to you in place.

---

## Run it

- **Any browser:** double-click `index.html`. That is the whole install.
- **A device or instance:** `git clone` this repo, open the file, done.
- **Cloudflare Pages:** fork → Pages → connect the repo → build command
  *(none)*, output directory `/`. Your fork is now a landing site.
- **Headless proof:** `npm test` (Node ≥ 18) — runs the receipted
  experiment ladder and the smoke gate. No packages to install; there are
  none.

## What is actually happening

- **q32 fixed point** — every belief, weight, and movement is an exact i64
  fixed-point value (raw / 2³²). No floats exist in the compute path.
  Inherited from `quilt-arch`'s normative Core Types.
- **Fractional influence** — trust between knowers follows measured
  agreement (`w ← w + (agreement − w)·epsNew`). Inherited from
  murmur-protocol v3.1.
- **Memoryless admission** — a new edge needs ≥ 2 already-connected
  *witnesses*, a pure function of the journaled graph. Cold start is solved
  by rule R9: *opening hands* — physical contact is the first evidence.
- **Conservation with refusal** — every commit charges total movement to a
  world ledger bounded by the exact `quilt-arch` boundary
  (`6806210843 ok / 6806210844 refuse`). Over-budget movement is refused,
  visibly, never silently clamped. Inherited from `quilt-dba`.
- **Exact rewind** — every event is journaled with its before/after values;
  the scrubber replays history bit-for-bit in **both** directions. No
  search, no re-simulation. Inherited from `quilt-raw`.
- **The carried name** — when the traveler (who met the whole animal)
  arrives, the knowers do not become elephants; they *carry the name* in
  their ledgers, and the whole lands supported by their carrying (rules
  R12/R13). This is the parable's actual epistemology, receipted.
- **Receipt chains** — every landing, rule, and verdict is sealed into an
  fnv1a64 chain compatible with `quilt-stone`, the fleet's canonical
  verifier.

## The toggles (further wow, honestly gated)

| toggle | what it does when on |
| --- | --- |
| **RAYS** | draws the influence field: who samples whom, and how hard |
| **WASM KERNEL** | instantiates a 104-byte hand-assembled WebAssembly module (no toolchain) and proves q32 mul bit-exact **in your browser** against the BigInt reference, then registers itself as a port kernel |
| **WEBGPU FIELD** | renders the relational field as a GPU heat inset (graceful, honest disable where unsupported) |
| **WEBNN** | detects WebNN; runs one matmul if present, otherwise reports the honest null |
| **PRUNED ROUTING** | answers agreement questions from a lookup table instead of arithmetic — the back-burner's "answers are in the routing", live |

## Fork and extend — the ports

The core never needs your code to touch it:

```js
EXO.ports.registerObserver('my-sensor', (world) => ({ ... }));
EXO.ports.registerKernel('my-fpga', { mul: (a, b) => ... });
EXO.ports.registerExporter('my-format', (world) => '...');
```

Hardware, APIs, and plugins attach at the seams. The browser is not the
point; the *array of knowers* is.

## Export — system-agnostic, five levels of abstraction

From the **Export** tab, all generated locally:

- **L0** `journal.jsonl` — every event (measure, commit, consume, admit,
  refuse, landing), self-chained
- **L1** `events.csv` — the journal as a flat table
- **L2** `cells.csv` — who believes what, where, in what state
- **L3** `influence.csv` — the trust matrix (who calls whom, at what weight)
- **L4** `story.md` — the parable with its receipts, ready to read
- **copy for Sheets/Docs** — tab-separated, paste straight into a
  spreadsheet; because underneath it all, this is a spreadsheet that knows
  what it is connected to

## The receipts (for the skeptic)

`npm test` seals and verifies the whole ladder:

| experiment | claim |
| --- | --- |
| `e_l1_core` | 100,196 mul pairs bit-exact against an independent floor-division identity; tamper caught at the exact chain index; scrub back/forward/replay hash-equal; the exact boundary honored; no floats in the engine |
| `e_l2_elephant` | the parable **emerges from arithmetic** (pillar/pillar/spear/snake/rope/fan); the traveler's answer computed from the measured coherence of the parts (0.704); all seven land with receipts; the name-carrier law holds 6/6 |
| `e_l3_routing` | the agreement structure decomposes into a 15-entry lookup with **zero** error and **zero** arithmetic per answer (vs 300,000 ops); pruning to coarser keys grows error — the price curve, measured |
| `e_l4_wasm` | the 104-byte hand-assembled module is bit-exact over 200,256 adversarial pairs, including i64 MIN/MAX and negative products |

## The name, one more time

已落地 is what Chinese business language says when a slide-deck idea finally
ships. The irony the name carries here: **the deck became the thing that
lands ideas** — a hello-world where "landed" is not a metaphor but a state
transition with a receipt. If you read Chinese, you smiled at this already.

## Lineage

murmur-protocol v3.1 · quilt-arch (q32) · quilt-raw (exact rewind) ·
quilt-dba (conservation) · exoj (observation discipline) · quilt-stone
(receipt chains) — this page is that record, rendered as a place you can
visit.

MIT license. No servers were harmed, or used.
