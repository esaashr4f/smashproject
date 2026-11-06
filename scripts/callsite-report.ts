// Dev helper: run the clone_weapon call-site analysis on a folder of plugin.nro files.
// Usage: npm run callsites -- fixtures/private_mod_binaries
import { readdirSync, readFileSync } from 'node:fs';
import { cloneWeaponAbi } from '../src/core/nro/callsite';
import { analyseSmashline } from '../src/core/nro/smashline';

const dir = (process.argv[2] ?? 'fixtures/private_mod_binaries').replace(/\/?$/, '/');
let exp: Record<string, { verdict: string }> = {};
try {
  exp = JSON.parse(readFileSync(dir + 'EXPECTED.json', 'utf8')).expected;
} catch {
  /* no expectations */
}
for (const f of readdirSync(dir).filter((x) => x.endsWith('.nro')).sort()) {
  const b = new Uint8Array(readFileSync(dir + f));
  const names = analyseSmashline(b);
  if (!names.abiSensitive.includes('smashline_clone_weapon')) continue;
  const r = cloneWeaponAbi(b);
  console.log(f.padEnd(36), r.abi.padEnd(8), r.sites.map((s) => `${s.abi}[${s.argRegs.join(',')}]`).join(' '), '|', exp[f]?.verdict ?? '');
}
