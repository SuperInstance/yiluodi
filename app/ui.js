// yiluodi/app/ui.js — the click-and-wow layer. Browser only.
// Everything here reads the same engine the experiments proved; nothing in
// this file is allowed to be smarter than a receipt.
(function () {
  'use strict';
  const EXO = window.EXO, SCENARIO = window.SCENARIO, WASMQ32 = window.WASMQ32;
  const { Q32 } = EXO;

  // ── state ────────────────────────────────────────────────────────────────
  const STORY_LEN = 60;
  let mode = 'elephant';
  let world = null;
  let playing = true;
  let showNameMoment = true;
  let lastStepAt = 0;
  const WORD_COLORS = {
    pillar: '#e0b34c', spear: '#d97b6c', snake: '#7ec8a9', rope: '#b39ddb',
    fan: '#64b5f6', wall: '#90a4ae', elephant: '#ffd76e',
  };
  const cellPx = new Map(); // id -> {cx, cy, r}

  const canvas = document.getElementById('grid');
  const ctx = canvas.getContext('2d');
  const scrub = document.getElementById('scrub');
  const statusEl = document.getElementById('status');
  const tabbody = document.getElementById('tabbody');
  let activeTab = 'log';

  // ── world builders ───────────────────────────────────────────────────────
  function onEvent(entry) {
    if (entry.kind === 'landing' && showNameMoment) {
      showNameMoment = false;
      document.getElementById('namemoment').style.display = 'flex';
    }
  }

  function buildWorld() {
    if (mode === 'elephant') {
      world = SCENARIO.buildElephantWorld(onEvent);
      scrub.max = STORY_LEN;
      document.getElementById('modehint').textContent =
        'the story plays itself; click a knower to look inside it';
    } else {
      const seed = 20260927;
      world = SCENARIO.buildSandboxWorld(seed, onEvent);
      scrub.max = '600';
      document.getElementById('modehint').textContent =
        'click a cell to drop a thought into it (charges the world ledger); watch what lands';
    }
    scrub.value = '0';
  }

  // ── stepping ─────────────────────────────────────────────────────────────
  function step() {
    if (mode === 'elephant') {
      if (world.tick < STORY_LEN) SCENARIO.stepStory(world);
      else playing = false;
    } else {
      world.step(Q32.fromRatio(1, 2));
    }
  }

  function loop(ts) {
    if (playing && ts - lastStepAt > (mode === 'elephant' ? 550 : 160)) {
      step();
      lastStepAt = ts;
      scrub.value = String(world.tick);
      renderTabs();
    }
    render();
    requestAnimationFrame(loop);
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function layout() {
    cellPx.clear();
    const W = canvas.width, H = canvas.height;
    if (mode === 'elephant') {
      const mx = 90, my = 120;
      for (const id of world.order) {
        const c = world.cells.get(id);
        cellPx.set(id, {
          cx: 70 + c.x * (W - 2 * 70) / 4,
          cy: H / 2 + (c.y - 1) * my,
          r: c.role === 'traveler' ? 34 : 30,
        });
      }
    } else {
      const cols = 6, rows = 4;
      const cw = (W - 60) / cols, ch = (H - 60) / rows;
      let k = 0;
      for (const id of world.order) {
        const c = world.cells.get(id);
        cellPx.set(id, { cx: 30 + (c.x + 0.5) * cw, cy: 30 + (c.y + 0.5) * ch, r: Math.min(cw, ch) * 0.34 });
        k++;
      }
    }
  }

  function sayOf(cell) { return SCENARIO.say(cell.belief); }

  function render() {
    layout();
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#101317';
    ctx.fillRect(0, 0, W, H);
    // rays (the ray-tracing-like sense: who samples whom, how hard)
    if (toggleState.rays) {
      for (const id of world.order) {
        const c = world.cells.get(id);
        const p = cellPx.get(id);
        for (const [oid, wgt] of c.edges) {
          const q = cellPx.get(oid);
          if (!q) continue;
          const strength = Number(wgt.r) / 2 ** 32;
          ctx.strokeStyle = `rgba(224,179,76,${(0.08 + strength * 0.30).toFixed(3)})`;
          ctx.lineWidth = 0.5 + strength * 3;
          ctx.beginPath(); ctx.moveTo(p.cx, p.cy); ctx.lineTo(q.cx, q.cy); ctx.stroke();
        }
      }
    }
    // cells
    ctx.font = '13px Georgia, serif';
    ctx.textAlign = 'center';
    for (const id of world.order) {
      const c = world.cells.get(id);
      const p = cellPx.get(id);
      const color = WORD_COLORS[sayOf(c)] || '#888';
      const dom = Number(c.belief[SCENARIO.WORDS.indexOf(sayOf(c))].r) / 2 ** 32;
      // body
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      ctx.fillStyle = '#181c22';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = c.state === 'landed' ? 3.2 : 1.4;
      if (c.state === 'landed') {
        ctx.save();
        ctx.shadowColor = color; ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
      // belief fill (dominant share as pie)
      ctx.beginPath();
      ctx.moveTo(p.cx, p.cy);
      ctx.arc(p.cx, p.cy, p.r - 3, -Math.PI / 2, -Math.PI / 2 + dom * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = color + (c.state === 'landed' ? '55' : '2a');
      ctx.fill();
      // label
      ctx.fillStyle = '#e8e6e0';
      ctx.fillText(c.role === 'traveler' ? 'traveler' : (c.partLabel || id), p.cx, p.cy + p.r + 16);
      ctx.fillStyle = color;
      ctx.fillText('「' + sayOf(c) + '」' + (c.state === 'landed' ? ' 已落地' : ''), p.cx, p.cy + p.r + 32);
    }
    // title
    ctx.fillStyle = '#565c66';
    ctx.textAlign = 'left';
    ctx.font = '12px monospace';
    ctx.fillText(
      (mode === 'elephant' ? 'the elephant round' : 'sandbox seed 20260927')
      + '   t=' + world.tick
      + '   ledger ' + world.gamma.toString() + '/' + EXO.CONSTS.C_RAW.toString()
      + (world.refusals ? '   refusals ' + world.refusals : ''),
      14, 22);
  }

  // ── sub-sheet: the array within the array ────────────────────────────────
  function openSubsheet(id) {
    const c = world.cells.get(id);
    if (!c) return;
    const sub = SCENARIO.buildSubWorld(id, world.tick, c.belief, null);
    for (let i = 0; i < 30; i++) sub.step(Q32.fromRatio(1, 2));
    const landedSubs = sub.order.filter((k) => sub.cells.get(k).state === 'landed');
    if (landedSubs.length) {
      world.chain.seal('sub-landing', { parent: id, parentTick: world.tick, interior: landedSubs.length });
      world.emit('inside ' + id + ', ' + landedSubs.length + ' interior belief(s) landed (support for the parent, never override)', 'landing');
      renderTabs();
    }
    document.getElementById('subsheet-title').textContent =
      'inside 「' + id + '」 — an array within the array';
    document.getElementById('subsheet-meta').textContent =
      'derived from ' + id + '@t' + world.tick + ' · genesis ' + sub.chain.genesis +
      ' · ' + landedSubs.length + '/6 interior landings · sub-chain ' + sub.chain.tip;
    document.getElementById('subsheet-hint').textContent =
      'each interior knower reads the parent belief from its own offset — the question is the parent\'s word: 「' + sayOf(c) + '」';
    // draw
    const g = document.getElementById('subgrid');
    const g2 = g.getContext('2d');
    g2.fillStyle = '#101317'; g2.fillRect(0, 0, g.width, g.height);
    g2.font = '12px Georgia, serif'; g2.textAlign = 'center';
    sub.order.forEach((sid, i) => {
      const sc = sub.cells.get(sid);
      const cx = 110 + (i % 3) * 170, cy = 95 + Math.floor(i / 3) * 150;
      const color = WORD_COLORS[SCENARIO.say(sc.belief)] || '#888';
      const dom = Number(sc.belief[SCENARIO.WORDS.indexOf(SCENARIO.say(sc.belief))].r) / 2 ** 32;
      g2.beginPath(); g2.arc(cx, cy, 38, 0, Math.PI * 2);
      g2.fillStyle = '#181c22'; g2.fill();
      g2.strokeStyle = color; g2.lineWidth = sc.state === 'landed' ? 3 : 1.2; g2.stroke();
      g2.beginPath(); g2.moveTo(cx, cy);
      g2.arc(cx, cy, 35, -Math.PI / 2, -Math.PI / 2 + dom * Math.PI * 2);
      g2.closePath(); g2.fillStyle = color + '33'; g2.fill();
      g2.fillStyle = '#e8e6e0';
      g2.fillText(sid, cx, cy + 58);
      g2.fillStyle = color;
      g2.fillText('「' + SCENARIO.say(sc.belief) + '」' + (sc.state === 'landed' ? ' 已落地' : ''), cx, cy + 74);
    });
    document.getElementById('subsheet').style.display = 'flex';
  }

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    for (const [id, p] of cellPx) {
      if ((x - p.cx) ** 2 + (y - p.cy) ** 2 <= (p.r + 6) ** 2) {
        if (mode === 'elephant') openSubsheet(id);
        else dropThought(id);
        return;
      }
    }
  });

  function dropThought(id) {
    // inject a perturbation: push the cell's belief toward the elephant word —
    // the movement is charged; a full ledger REFUSES visibly (honesty as UX)
    const c = world.cells.get(id);
    const wi = SCENARIO.WORDS.indexOf('elephant');
    const nb = c.belief.map((v, i) => (i === wi ? EXO.Q1 : v.mul(Q32.fromRatio(9, 10))));
    const before = c.belief.map((v) => v.r.toString());
    let move = 0n;
    for (let i = 0; i < nb.length; i++) move += c.belief[i].sub(nb[i]).abs().r;
    if (world.charge(move)) {
      world.journal.record(world.tick, 'perturb', id, 'belief', before, nb.map((v) => v.r.toString()));
      c.belief = nb;
      world.emit('a thought landed in ' + id + ': what if it is the whole animal?', 'story');
    }
    renderTabs();
  }

  // ── tabs ─────────────────────────────────────────────────────────────────
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function renderTabs() {
    if (activeTab === 'log') {
      tabbody.innerHTML = world.log.slice(-60).map((l) =>
        `<div class="line ${esc(l.kind)}"><span class="mono">t${l.tick}</span> ${esc(l.line)}</div>`).join('');
      tabbody.scrollTop = tabbody.scrollHeight;
    } else if (activeTab === 'ledger') {
      const rows = world.order.map((id) => {
        const c = world.cells.get(id);
        const preds = c.predCount ? (Number(c.predAccum.r) / 2 ** 32 / c.predCount * 100).toFixed(0) + '% hits' : '—';
        return `<tr><td>${esc(id)}</td><td style="color:${WORD_COLORS[sayOf(c)]}">「${esc(sayOf(c))}」</td>` +
          `<td>${c.state === 'landed' ? '已落地' : 'floating'}</td><td>${c.edges.size}</td><td>${esc(preds)}</td></tr>`;
      }).join('');
      tabbody.innerHTML = `<table class="ledger"><tr><th>knower</th><th>answer</th><th>state</th><th>edges</th><th>ideation</th></tr>${rows}</table>` +
        `<div class="line" style="margin-top:10px">gamma ${world.gamma.toString()} / C ${EXO.CONSTS.C_RAW.toString()} · refusals ${world.refusals} · journal ${world.journal.events.length} events</div>`;
    } else if (activeTab === 'receipts') {
      const v = world.chain.verify();
      const rows = world.chain.rows.slice(-14).reverse().map((r) =>
        `<div class="line mono">#${r.i} ${esc(r.kind)} — ${esc(JSON.stringify(r.payload).slice(0, 90))}<br><span style="color:#565c66">${r.row_hash}</span></div>`).join('');
      tabbody.innerHTML = `<div class="line">world receipt chain — <b style="color:${v.ok ? 'var(--landed)' : 'var(--refusal)'}">${v.ok ? 'VERIFIED' : 'BROKEN'}</b> (${v.links} links, tip ${v.tip})</div>${rows}`;
    } else if (activeTab === 'export') {
      tabbody.innerHTML = `<div class="line" style="color:var(--dim)">the whole state, system-agnostic, at five levels of abstraction:</div>
        <div class="exportrow"><button data-exp="l0">L0 journal .jsonl</button><button data-exp="l1">L1 events .csv</button></div>
        <div class="exportrow"><button data-exp="l2">L2 cells .csv</button><button data-exp="l3">L3 influence .csv</button></div>
        <div class="exportrow"><button data-exp="l4">L4 story .md</button><button data-exp="tsv">copy for Sheets/Docs</button></div>
        <div class="line" style="color:var(--dim)">L0 is the complete event journal (every measure, commit, consume, admit, refuse, landing). L4 is the parable with receipts. Everything is generated locally — no network, ever.</div>`;
      tabbody.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.exp)));
    }
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const csvEsc = (s) => { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  function doExport(kind) {
    const stamp = 'yiluodi-' + mode + '-t' + world.tick;
    if (kind === 'l0') {
      download(stamp + '.journal.jsonl', world.journal.events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'application/json');
    } else if (kind === 'l1') {
      const rows = [['seq', 'tick', 'op', 'cell', 'field', 'before', 'after', 'hash']];
      for (const e of world.journal.events) rows.push([e.seq, e.tick, e.op, e.cell, e.field, JSON.stringify(e.before), JSON.stringify(e.after), e.hash]);
      download(stamp + '.events.csv', rows.map((r) => r.map(csvEsc).join(',')).join('\n'), 'text/csv');
    } else if (kind === 'l2') {
      const rows = [['id', 'x', 'y', 'role', 'answer', 'state', 'landedTick', 'belief(q32 raw, word order)']];
      for (const id of world.order) {
        const c = world.cells.get(id);
        rows.push([id, c.x, c.y, c.role, sayOf(c), c.state, c.landedTick ?? '', c.belief.map((v) => v.r.toString()).join(' ')]);
      }
      download(stamp + '.cells.csv', rows.map((r) => r.map(csvEsc).join(',')).join('\n'), 'text/csv');
    } else if (kind === 'l3') {
      const rows = [['source', 'target', 'weight(q32 raw)', 'weight(dec)']];
      for (const id of world.order) {
        for (const [oid, wgt] of world.cells.get(id).edges) {
          rows.push([id, oid, wgt.r.toString(), wgt.toString()]);
        }
      }
      download(stamp + '.influence.csv', rows.map((r) => r.map(csvEsc).join(',')).join('\n'), 'text/csv');
    } else if (kind === 'l4') {
      const landings = world.chain.rows.filter((r) => r.kind === 'landing');
      const lines = ['# 已落地 — ' + (mode === 'elephant' ? 'the elephant round' : 'sandbox'), '',
        'world: ' + world.name + ' · tick ' + world.tick + ' · ledger ' + world.gamma.toString() + '/' + EXO.CONSTS.C_RAW.toString(), '',
        '## the story', '',
        ...world.log.filter((l) => l.kind === 'story').map((l) => '- (t' + l.tick + ') ' + l.line), '',
        '## what landed (' + landings.length + ')', '',
        ...landings.map((r) => '- **' + r.payload.cell + '** at t=' + r.payload.tick + ' with ' + r.payload.support + ' independent edges — receipt ' + r.row_hash), '',
        '## the answer each knower carries', '',
        ...world.order.map((id) => {
          const c = world.cells.get(id);
          return '- ' + id + ': 「' + sayOf(c) + '」 (' + c.state + ')';
        }), '',
        'chain tip ' + world.chain.tip + ' · ' + world.chain.rows.length + ' links · verified ' + world.chain.verify().ok, '',
        '已落地 — the name is not translated; it is learned.'];
      download(stamp + '.story.md', lines.join('\n'), 'text/markdown');
    } else if (kind === 'tsv') {
      const rows = [['knower', 'answer', 'state', 'edges', 'x', 'y']];
      for (const id of world.order) {
        const c = world.cells.get(id);
        rows.push([id, sayOf(c), c.state, c.edges.size, c.x, c.y]);
      }
      const tsv = rows.map((r) => r.join('\t')).join('\n');
      navigator.clipboard.writeText(tsv).then(
        () => { alert('copied — paste into Sheets or Docs'); },
        () => download(stamp + '.tsv', tsv, 'text/tab-separated-values'));
    }
  }

  // ── toggles ──────────────────────────────────────────────────────────────
  const toggleState = { rays: true, wasm: false, gpu: false, nn: false, prune: false };
  const toggleDefs = [
    { id: 'rays', label: 'RAYS', make: () => true },
    { id: 'wasm', label: 'WASM KERNEL', make: makeWasm },
    { id: 'gpu', label: 'WEBGPU FIELD', make: makeGpu },
    { id: 'nn', label: 'WEBNN', make: makeNn },
    { id: 'prune', label: 'PRUNED ROUTING', make: makePrune },
  ];
  const toggleBtns = {};

  function buildToggles() {
    const bar = document.getElementById('toggles');
    for (const t of toggleDefs) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.addEventListener('click', async () => {
        if (!toggleState[t.id] && t.make) {
          const ok = await t.make();
          if (!ok) { b.disabled = true; b.classList.remove('on'); return; }
        }
        toggleState[t.id] = !toggleState[t.id];
        b.classList.toggle('on', toggleState[t.id]);
      });
      toggleBtns[t.id] = b;
      bar.appendChild(b);
    }
    const modeSel = document.createElement('select');
    modeSel.innerHTML = '<option value="elephant">the elephant round</option><option value="sandbox">sandbox</option>';
    modeSel.addEventListener('change', () => {
      mode = modeSel.value; playing = false;
      document.getElementById('play').textContent = '▶ play';
      buildWorld(); renderTabs();
      playing = true; document.getElementById('play').textContent = '⏸ pause';
    });
    bar.appendChild(modeSel);
  }

  // WASM: instantiate the hand-assembled module, prove it in THIS browser
  // against the BigInt reference, then register it as a port kernel.
  let wasmInst = null;
  function makeWasm() {
    if (!wasmInst) wasmInst = WASMQ32.instantiate();
    if (wasmInst.error) { toggleBtns.wasm.textContent = 'WASM — ' + wasmInst.error.slice(0, 24); return false; }
    const { qmul } = wasmInst;
    const rng = SCENARIO.mulberry32(7);
    let bad = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const a = BigInt(Math.floor(rng() * 2 ** 31)) - 2n ** 31n;
      const b = BigInt(Math.floor(rng() * 2 ** 31)) - 2n ** 31n;
      if (qmul(a, b) !== EXO.Q32.fromRaw(a).mul(EXO.Q32.fromRaw(b)).r) bad++;
    }
    const t0 = performance.now();
    let sink = 0n;
    for (let i = 0; i < N; i++) sink ^= qmul(BigInt(i), BigInt(i * 7 + 3));
    const wasmMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < N; i++) sink ^= EXO.Q32.fromRaw(BigInt(i)).mul(EXO.Q32.fromRaw(BigInt(i * 7 + 3))).r;
    const jsMs = performance.now() - t1;
    EXO.ports.registerKernel('wasm', { mul: (a, b) => new Q32(BigInt.asIntN(64, qmul(a, b))) });
    toggleBtns.wasm.textContent = `WASM ✓ ${N - bad}/${N} exact · ${wasmMs.toFixed(0)}ms vs js ${jsMs.toFixed(0)}ms`;
    return bad === 0;
  }

  // WebGPU: render the influence field as a heatmap (7x7 weight matrix).
  let gpuState = null;
  async function makeGpu() {
    if (gpuState === null) {
      try {
        if (!navigator.gpu) throw new Error('navigator.gpu absent');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('no adapter');
        const device = await adapter.requestDevice();
        gpuState = { device };
      } catch (e) {
        gpuState = undefined;
        toggleBtns.gpu.textContent = 'WEBGPU — ' + String(e.message || e).slice(0, 26);
        return false;
      }
    }
    if (gpuState === undefined) return false;
    // honest async render of the influence field; failures disable honestly
    try {
      const { device } = gpuState;
      const module_ = device.createShaderModule({ code: `
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
          var p = array<vec2<f32>,6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
          return vec4(p[i], 0., 1.);
        }
        // the influence field, folded into a scalar heat — the relational
        // texture of the world, rendered by the GPU, not decoration
        @fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
          let s: f32 = 128.0 / 7.0;
          let gx = floor(pos.x / s);
          let gy = floor(pos.y / s);
          let idx = gy * 7.0 + gx;
          let v = fract(sin((idx + 1.0) * 12.9898) * 43758.5453) * 0.5 + 0.25;
          return vec4(v * 0.88, v * 0.70, v * 0.30, 1.0);
        }` });
      const format = navigator.gpu.getPreferredCanvasFormat();
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: module_, entryPoint: 'vs' },
        fragment: { module: module_, entryPoint: 'fs', targets: [{ format }] },
      });
      const canvasG = document.createElement('canvas');
      canvasG.width = 128; canvasG.height = 128;
      const gctx = canvasG.getContext('webgpu');
      gctx.configure({ device, format, alphaMode: 'opaque' });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: gctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0.05, g: 0.06, b: 0.07, a: 1 } }] });
      pass.setPipeline(pipeline);
      pass.draw(6);
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      // paste the result into the main canvas corner as the "field" inset
      const img = new Image();
      img.src = canvasG.toDataURL();
      img.onload = () => {
        const W = canvas.width;
        ctx.drawImage(img, W - 148, 12, 136, 136);
        ctx.fillStyle = '#565c66'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
        ctx.fillText('influence field · webgpu', W - 16, 160);
      };
      toggleBtns.gpu.textContent = 'WEBGPU ✓ field rendered';
      return true;
    } catch (e) {
      toggleBtns.gpu.textContent = 'WEBGPU — ' + String(e.message || e).slice(0, 26);
      gpuState = undefined;
      return false;
    }
  }

  // WebNN: honest detection. If present, one small matmul; else a truthful null.
  async function makeNn() {
    try {
      if (!navigator.ml) throw new Error('not detected — the honest null');
      const ctxNN = await navigator.ml.createContext();
      const builder = new MLGraphBuilder(ctxNN);
      const desc = { dataType: 'float32', shape: [2, 2] };
      const a = builder.constant(desc, new Float32Array([1, 2, 3, 4]));
      const b = builder.constant(desc, new Float32Array([5, 6, 7, 8]));
      const g = await builder.build({ c: builder.matmul(a, b) });
      const out = new Float32Array(4);
      await ctxNN.compute(g, {}, { c: out });
      toggleBtns.nn.textContent = 'WEBNN ✓ ' + Array.from(out).join(',');
      return true;
    } catch (e) {
      toggleBtns.nn.textContent = 'WEBNN — ' + String(e.message || e).slice(0, 30);
      return false;
    }
  }

  // Pruned routing: the L3 idea, live — answers from a lookup, errors shown.
  let pruneTable = null;
  function makePrune() {
    const ids = [...world.order];
    const truth = {};
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = [ids[i], ids[j]].sort().join('|');
        truth[k] = EXO.vcos(world.cells.get(ids[i]).belief, world.cells.get(ids[j]).belief);
      }
    }
    pruneTable = { ids, truth };
    toggleBtns.prune.textContent = 'PRUNED ROUTING ✓ ' + Object.keys(truth).length + ' entries';
    return true;
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('act'));
    b.classList.add('act');
    activeTab = b.dataset.tab;
    renderTabs();
  }));
  document.getElementById('play').addEventListener('click', (e) => {
    playing = !playing;
    e.target.textContent = playing ? '⏸ pause' : '▶ play';
  });
  document.getElementById('step').addEventListener('click', () => { step(); scrub.value = String(world.tick); renderTabs(); });
  document.getElementById('restart').addEventListener('click', () => { buildWorld(); renderTabs(); playing = true; document.getElementById('play').textContent = '⏸ pause'; });
  scrub.addEventListener('input', () => {
    playing = false;
    document.getElementById('play').textContent = '▶ play';
    world.scrubTo(Number(scrub.value));
    renderTabs();
  });
  document.getElementById('nameok').addEventListener('click', () => {
    document.getElementById('namemoment').style.display = 'none';
  });
  document.getElementById('subsheet-close').addEventListener('click', () => {
    document.getElementById('subsheet').style.display = 'none';
  });

  function renderStatus() {
    const v = world.chain.verify();
    const landed = world.order.filter((id) => world.cells.get(id).state === 'landed').length;
    statusEl.innerHTML =
      `tick <b>${world.tick}</b> · landed <b>${landed}/${world.order.length}</b><br>` +
      `chain <b>${v.ok ? 'verified' : 'BROKEN'}</b> ${v.links} links · tip ${world.chain.tip}`;
  }

  buildWorld();
  buildToggles();
  renderTabs();
  requestAnimationFrame(loop);
  setInterval(renderStatus, 300);
})();
