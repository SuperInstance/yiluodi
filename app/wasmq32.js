// yiluodi/app/wasmq32.js — the WebAssembly kernel, hand-assembled from bytes.
//
// There is no toolchain here: the module below is emitted by a tiny assembler
// in this file, byte by byte, and verified bit-exact against the BigInt
// reference (Q32.checkedMul) over adversarial inputs by e_l4_wasm.mjs before
// it is allowed to ship in the toggle.
//
// WHAT THE KERNEL COMPUTES
//   qmul(a, b) = (a * b) >> 32  as a wrapping i64 — exactly the normative
//   Q32.checkedMul contract (quilt-arch Core Types: exact i128 product, floor
//   shift, as-i64 wrap). WASM has no i128, so the kernel splits each operand
//   as  a = a_hi·2^32 + a_lo  where a_hi is the ARITHMETIC (sign-extended)
//   shift and a_lo is the unsigned low 32 bits — an identity that holds for
//   negatives too (e.g. -1 = -1·2^32 + 0xFFFFFFFF). Then:
//
//     a·b = a_hi·b_hi·2^64 + (a_hi·b_lo + a_lo·b_hi)·2^32 + a_lo·b_lo
//
//   and, shifting by 32 (every other term is a multiple of 2^32, so the
//   floor split is EXACT), keeping the low 64 bits (the `as i64` wrap):
//
//     result = ( (p0 >>u 32) + a_hi·b_lo + a_lo·b_hi + (a_hi·b_hi << 32) )
//              mod 2^64
//
//   with p0 = a_lo·b_lo < 2^64 (unsigned-safe in an i64), |a_hi·b_lo| < 2^63
//   (signed-safe), and the i64 wrapping adds performing the mod for free.
//   The first version of this kernel used unsigned high halves and was WRONG
//   on every negative product (150k mismatches) — e_l4 caught it; this
//   signed-high identity is the one that survives 200k adversarial pairs.
//   e_l4 proves it against BigInt over corners + random inputs.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WASMQ32 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ── minimal WASM assembler (just enough for one honest kernel) ──────────
  function uleb(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; }
  function sleb64(xn) { // BigInt -> signed LEB128
    const out = []; let more = true;
    while (more) {
      let byte = Number(xn & 0x7fn);
      xn >>= 7n;
      if ((xn === 0n && (byte & 0x40) === 0) || (xn === -1n && (byte & 0x40) !== 0)) more = false;
      else byte |= 0x80;
      out.push(byte);
    }
    return out;
  }
  function section(id, payload) { return [id, ...uleb(payload.length), ...payload]; }

  // opcodes
  const OP = {
    local_get: 0x20, local_set: 0x21, i64_const: 0x42, i64_mul: 0x7e,
    i64_add: 0x7c, i64_and: 0x83, i64_shl: 0x86, i64_shr_s: 0x87, i64_shr_u: 0x88,
    end: 0x0b,
  };
  const U32MASK = 0xffffffffn;

  /** Build the module bytes for qmul(i64 a, i64 b) -> i64. */
  function buildModuleBytes() {
    const bytes = [];
    const emit = (...xs) => bytes.push(...xs);
    const i64c = (v) => [OP.i64_const, ...sleb64(v)];

    // locals: params a(0), b(1); locals a_lo(2), a_hi(3), b_lo(4), b_hi(5)
    const body = [];
    const e = (...xs) => body.push(...xs);
    const get = (i) => [OP.local_get, i];
    const set = (i) => [OP.local_set, i];

    // a_lo = a & 0xffffffff (unsigned low half)
    e(...get(0), ...i64c(U32MASK), OP.i64_and, ...set(2));
    // a_hi = a >>s 32 (ARITHMETIC — sign-extended; this is where the sign lives)
    e(...get(0), ...i64c(32n), OP.i64_shr_s, ...set(3));
    // b_lo, b_hi likewise
    e(...get(1), ...i64c(U32MASK), OP.i64_and, ...set(4));
    e(...get(1), ...i64c(32n), OP.i64_shr_s, ...set(5));

    // t0 = (a_lo·b_lo) >>u 32
    e(...get(2), ...get(4), OP.i64_mul, ...i64c(32n), OP.i64_shr_u);
    // t1 += a_lo·b_hi
    e(...get(2), ...get(5), OP.i64_mul, OP.i64_add);
    // t1 += a_hi·b_lo
    e(...get(3), ...get(4), OP.i64_mul, OP.i64_add);
    // t2 += (a_hi·b_hi) << 32
    e(...get(3), ...get(5), OP.i64_mul, ...i64c(32n), OP.i64_shl, OP.i64_add);
    e(OP.end);

    const typeSec = section(1, [0x01, 0x60, 0x02, 0x7e, 0x7e, 0x01, 0x7e]); // (i64,i64)->i64
    const funcSec = section(3, [0x01, 0x00]);
    const exportSec = section(7, [0x01, 0x04, 0x71, 0x6d, 0x75, 0x6c, 0x00, 0x00]); // "qmul" func 0
    // code entry: locals vector = ONE group of 6 i64 locals => 0x01 0x06 0x7e
    const codeSec = section(10, [0x01, ...uleb(body.length + 3), 0x01, 0x06, 0x7e, ...body]);

    emit(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
    emit(...typeSec, ...funcSec, ...exportSec, ...codeSec);
    return new Uint8Array(bytes);
  }

  /** Instantiate synchronously (Node + modern browsers both allow sync compile
   *  of small modules). Returns {qmul, bytes} or {error} honestly. */
  function instantiate() {
    try {
      const bytes = buildModuleBytes();
      const mod = new WebAssembly.Module(bytes);
      const inst = new WebAssembly.Instance(mod, {});
      return { qmul: inst.exports.qmul, bytes };
    } catch (err) {
      return { error: String(err && err.message || err) };
    }
  }

  return { buildModuleBytes, instantiate, OP };
});
