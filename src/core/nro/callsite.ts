// Call-site analysis: which Smashline clone_weapon ABI does a moveset use?
//
// Smashline 2.0 changed clone_weapon's arguments without renaming it:
//   old (<= 1.6.8): (name ptr x0, len x1, kind w2, str x3/x4, str x5/x6, bool w7)
//   new (2.0):      (str x0/x1, str x2/x3, kind w4, bool w5)
// Movesets look the function up by name (a NUL-terminated string literal),
// cache the pointer and call it with BLR. So we:
//   1. find the "smashline_clone_weapon\0" string,
//   2. find code that computes its address (ADR, or ADRP + ADD),
//   3. follow to the next BLR (the call through the looked-up pointer),
//   4. look at which argument registers are written between the previous
//      BL/BLR and that BLR. Writing x6/x7 means the old layout; writing w4 and
//      w5 but nothing above means the new one.
// This needs only a handful of AArch64 encodings, so it's a tiny hand-written
// decoder rather than a full disassembler.

import type { Confidence } from '../types';

export type CloneAbi = 'old' | 'new' | 'unknown';

export interface CallSiteResult {
  abi: CloneAbi;
  confidence: Confidence;
  /** One entry per call site found: which ABI it looked like, and where. */
  sites: { at: number; abi: CloneAbi; argRegs: number[] }[];
  reason: string;
}

const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

interface NroSegments {
  textOff: number;
  textSize: number;
}

export function nroSegments(b: Uint8Array): NroSegments | null {
  if (b.length < 0x40 || String.fromCharCode(b[0x10]!, b[0x11]!, b[0x12]!, b[0x13]!) !== 'NRO0') return null;
  return { textOff: u32(b, 0x20), textSize: u32(b, 0x24) };
}

const isIdent = (c: number | undefined) =>
  c !== undefined && ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f);

/** Offsets of `name\0` where the name isn't the tail of a longer identifier. */
function findCString(b: Uint8Array, name: string): number[] {
  const pat = [...name].map((c) => c.charCodeAt(0));
  pat.push(0);
  const out: number[] = [];
  outer: for (let i = 1; i <= b.length - pat.length; i++) {
    for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    if (!isIdent(b[i - 1])) out.push(i);
  }
  return out;
}

const signExtend = (v: number, bits: number) => (v & (1 << (bits - 1)) ? v - (1 << bits) : v);

const isBL = (w: number) => (w & 0xfc000000) >>> 0 === 0x94000000;
const isBLR = (w: number) => (w & 0xfffffc1f) >>> 0 === 0xd63f0000;
const isRET = (w: number) => (w & 0xfffffc1f) >>> 0 === 0xd65f0000;

/** Registers (0-30) an instruction writes. Only the classes we need; others return []. */
export function writtenRegs(w: number): number[] {
  const op0 = (w >>> 25) & 0xf;
  const rd = w & 0x1f;
  // Data processing, immediate (100x) and register (x101): Rd in bits 4:0
  if ((op0 & 0b1110) === 0b1000 || (op0 & 0b0111) === 0b0101) return rd === 31 ? [] : [rd];
  // Loads and stores (x1x0)
  if ((op0 & 0b0101) === 0b0100) {
    const b2927 = (w >>> 27) & 0b111;
    if (b2927 === 0b011 && ((w >>> 24) & 1) === 0) return [rd]; // LDR (literal)
    if (b2927 === 0b101) {
      // LDP/STP: L = bit 22, Rt2 = bits 14:10
      if (((w >>> 26) & 1) === 1) return []; // SIMD pair
      return (w >>> 22) & 1 ? [rd, (w >>> 10) & 0x1f].filter((r) => r !== 31) : [];
    }
    if (b2927 === 0b111) {
      if (((w >>> 26) & 1) === 1) return []; // SIMD/FP
      const opc = (w >>> 22) & 0b11;
      return opc !== 0 && rd !== 31 ? [rd] : []; // opc 00 = store
    }
    if (((w >>> 24) & 0x3f) === 0b001000) return (w >>> 22) & 1 && rd !== 31 ? [rd] : []; // LDAR/LDXR...
  }
  return [];
}

function analyseSite(b: Uint8Array, seg: NroSegments, refAt: number): { abi: CloneAbi; argRegs: number[]; at: number } | null {
  const end = seg.textOff + seg.textSize;
  let lastCall = refAt;
  for (let pc = refAt + 4, n = 0; pc < end && n < 96; pc += 4, n++) {
    const w = u32(b, pc);
    if (isRET(w)) return null;
    if (isBL(w)) lastCall = pc;
    else if (isBLR(w)) {
      const written = new Set<number>();
      for (let p = lastCall + 4; p < pc; p += 4) for (const r of writtenRegs(u32(b, p))) written.add(r);
      const blrReg = (w >>> 5) & 0x1f;
      const argRegs = [...written].filter((r) => r <= 7 && r !== blrReg).sort((a, c) => a - c);
      let abi: CloneAbi = 'unknown';
      if (written.has(6) || written.has(7)) abi = 'old';
      else if (written.has(4) && written.has(5)) abi = 'new';
      return { abi, argRegs, at: pc };
    }
  }
  return null;
}

export function cloneWeaponAbi(bytes: Uint8Array, name = 'smashline_clone_weapon'): CallSiteResult {
  const seg = nroSegments(bytes);
  if (!seg) return { abi: 'unknown', confidence: 'possible', sites: [], reason: 'Not an NRO file.' };
  const targets = new Set(findCString(bytes, name));
  if (!targets.size) return { abi: 'unknown', confidence: 'possible', sites: [], reason: `No "${name}" lookup found.` };

  const refs: number[] = [];
  const adrp = new Map<number, { page: number; at: number }>();
  const end = seg.textOff + seg.textSize;
  for (let pc = seg.textOff; pc < end; pc += 4) {
    const w = u32(bytes, pc);
    if ((w & 0x9f000000) >>> 0 === 0x10000000) {
      // ADR
      const imm = signExtend((((w >>> 5) & 0x7ffff) << 2) | ((w >>> 29) & 3), 21);
      if (targets.has(pc + imm)) refs.push(pc);
    } else if ((w & 0x9f000000) >>> 0 === 0x90000000) {
      // ADRP
      const imm = signExtend((((w >>> 5) & 0x7ffff) << 2) | ((w >>> 29) & 3), 21);
      adrp.set(w & 0x1f, { page: (pc & ~0xfff) + imm * 4096, at: pc });
    } else if ((w & 0xff800000) >>> 0 === 0x91000000) {
      // ADD Xd, Xn, #imm (64-bit)
      const rn = (w >>> 5) & 0x1f;
      const a = adrp.get(rn);
      if (a && pc - a.at < 64) {
        const imm = ((w >>> 10) & 0xfff) << ((w >>> 22) & 1 ? 12 : 0);
        if (targets.has(a.page + imm)) refs.push(pc);
      }
    }
  }

  const sites = refs.map((r) => analyseSite(bytes, seg, r)).filter((s): s is NonNullable<typeof s> => !!s);
  const votes = new Set(sites.map((s) => s.abi).filter((a) => a !== 'unknown'));
  if (votes.size === 1) {
    const abi = [...votes][0]!;
    const n = sites.filter((s) => s.abi === abi).length;
    return {
      abi,
      confidence: 'likely',
      sites,
      reason:
        abi === 'old'
          ? `Its clone_weapon call${n > 1 ? 's' : ''} pass${n > 1 ? '' : 'es'} arguments up to register x7 (the Smashline 1.6.8 layout).`
          : `Its clone_weapon call${n > 1 ? 's' : ''} pass${n > 1 ? '' : 'es'} the weapon kind in w4 and stop at w5 (the Smashline 2.0 layout).`,
    };
  }
  return {
    abi: 'unknown',
    confidence: 'possible',
    sites,
    reason: votes.size > 1 ? 'Its clone_weapon calls disagree, so the layout is unclear.' : "Couldn't find a clear clone_weapon call in its code.",
  };
}
