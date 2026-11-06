// Smashline-requirement check against real moveset binaries.
// The binaries are private third-party files (gitignored), so this suite is
// skipped when they're not on disk (e.g. on CI or a fresh clone).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyseSmashline, classifyNames } from '../src/core/nro/smashline';
import { sha256Hex } from '../src/core/hash';

const DIR = 'fixtures/private_mod_binaries/';
const have = existsSync(DIR + 'EXPECTED.json');

// EXPECTED.json's verdicts mix name-scan results with outside knowledge (dates,
// crash evidence). The name scan alone can only produce these:
function scanVerdictFor(expected: string): string | null {
  if (expected.startsWith('either')) return 'either';
  if (expected.startsWith('needs_2.0 (confirmed by crash')) return 'abi_sensitive'; // Herobrine: names don't show it
  if (expected.startsWith('needs_2.0')) return 'needs_2.0';
  if (expected.startsWith('likely_1.6.8') || expected.startsWith('unknown')) return 'abi_sensitive';
  if (expected === 'unsupported') return 'needs_unreleased';
  return null; // BROKEN FOLDER: a folder problem, checked separately
}

describe.skipIf(!have)('Smashline check on private moveset binaries', () => {
  const exp = have
    ? (JSON.parse(readFileSync(DIR + 'EXPECTED.json', 'utf8')) as { expected: Record<string, { verdict: string }> }).expected
    : {};
  for (const [file, e] of Object.entries(exp)) {
    const want = scanVerdictFor(e.verdict);
    if (!want) continue;
    it(`${file}: ${e.verdict} -> ${want}`, () => {
      expect(analyseSmashline(new Uint8Array(readFileSync(DIR + file))).verdict).toBe(want);
    });
  }
  it('ultron_plugin.nro is byte-identical to shadow_plugin.nro', async () => {
    const a = await sha256Hex(new Uint8Array(readFileSync(DIR + 'ultron_plugin.nro')));
    const b = await sha256Hex(new Uint8Array(readFileSync(DIR + 'shadow_plugin.nro')));
    expect(a).toBe(b);
  });
});

describe('classifyNames', () => {
  it('ignores package names and flags unreleased API', () => {
    expect(classifyNames(['smashline_plugin', 'smashline_alucard', 'smashline_install_acmd_script']).verdict).toBe('either');
    expect(classifyNames(['smashline_install_lvd_edit_costume']).verdict).toBe('needs_unreleased');
    expect(classifyNames(['smashline_replace_fighter_vtable']).verdict).toBe('needs_2.0');
    expect(classifyNames(['smashline_clone_weapon']).verdict).toBe('abi_sensitive');
    expect(classifyNames(['smashline_clone_weaponHello']).verdict).toBe('abi_sensitive');
    expect(classifyNames(['smashline_install_symbol_hook']).verdict).toBe('either');
    expect(classifyNames([]).verdict).toBe('none');
  });
});

// Call-site analysis: settles the clone_weapon ABI from the code itself.
import { cloneWeaponAbi } from '../src/core/nro/callsite';
describe.skipIf(!have)('clone_weapon call-site analysis on private binaries', () => {
  const exp = have
    ? (JSON.parse(readFileSync(DIR + 'EXPECTED.json', 'utf8')) as { expected: Record<string, { verdict: string }> }).expected
    : {};
  const wantAbi = (v: string) =>
    v.startsWith('likely_1.6.8') ? 'old' : v.startsWith('needs_2.0') ? 'new' : null;
  for (const [file, e] of Object.entries(exp)) {
    const want = wantAbi(e.verdict);
    if (!want) continue;
    const bytes = new Uint8Array(readFileSync(DIR + file));
    if (!analyseSmashline(bytes).abiSensitive.includes('smashline_clone_weapon')) continue;
    it(`${file}: ${e.verdict} -> ${want} ABI`, () => expect(cloneWeaponAbi(bytes).abi).toBe(want));
  }
  it('Herobrine (no 2.0-only names, but crashed on 1.6.8) uses the new ABI', () => {
    expect(cloneWeaponAbi(new Uint8Array(readFileSync(DIR + 'herobrine_plugin.nro'))).abi).toBe('new');
  });
});

import { writtenRegs } from '../src/core/nro/callsite';
describe('AArch64 register-write decoding', () => {
  it('decodes the instructions the analysis relies on', () => {
    expect(writtenRegs(0x2a1303e2)).toEqual([2]); // mov w2, w19
    expect(writtenRegs(0x528002a4)).toEqual([4]); // mov w4, #0x15
    expect(writtenRegs(0x2a1f03e7)).toEqual([7]); // mov w7, wzr
    expect(writtenRegs(0xf90003e7)).toEqual([]); // str x7, [sp]  (a store writes nothing)
    expect(writtenRegs(0xa94007e0)).toEqual([0, 1]); // ldp x0, x1, [sp]
  });
});
