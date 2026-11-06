// Moveset plugin.nro files: Smashline requirement + the same plugin copied into two mods.
import { analyseSmashline, abiHintFromDate, type SmashlineAnalysis } from '../../nro/smashline';
import { cloneWeaponAbi, type CallSiteResult } from '../../nro/callsite';
import { lookupFingerprint, type FingerprintMatch } from '../../fingerprints';
import { sha256Hex } from '../../hash';
import type { Confidence, Finding } from '../../types';
import type { FileSource } from '../source';
import type { SdModel } from '../model';

export type Needs = '1.6.8' | '2.0.0' | 'either' | 'unreleased' | 'unknown' | 'none' | 'unchecked';

export interface MovesetInfo {
  mod: string;
  disabled: boolean;
  /** Plugin path relative to the mod (normally "plugin.nro"; nested copies included). */
  plugins: { rel: string; path: string; size: number; sha256?: string; smashline?: SmashlineAnalysis; callSite?: CallSiteResult }[];
  /** Exact GameBanana mod/version, if the plugin's hash is in the fingerprint database. */
  identified?: FingerprintMatch;
  needs: Needs;
  needsConfidence: Confidence;
  needsReason: string;
}

export interface MovesetOptions {
  /** mod folder name -> last updated date (e.g. from GameBanana). */
  lastUpdated?: Record<string, Date>;
}

export async function movesetChecks(source: FileSource, m: SdModel, opts: MovesetOptions = {}): Promise<{ movesets: MovesetInfo[]; findings: Finding[] }> {
  const findings: Finding[] = [];
  const movesets: MovesetInfo[] = [];
  for (const mod of m.mods) {
    const nros = mod.files.filter((f) => f.rel.toLowerCase().endsWith('plugin.nro'));
    if (!nros.length) continue;
    const info: MovesetInfo = { mod: mod.name, disabled: mod.disabled, plugins: [], needs: 'unknown', needsConfidence: 'possible', needsReason: '' };
    for (const f of nros) {
      const bytes = source.canRead ? await source.read(f.path) : null;
      info.plugins.push({
        rel: f.rel,
        path: f.path,
        size: f.size,
        sha256: bytes ? await sha256Hex(bytes) : undefined,
        smashline: bytes ? analyseSmashline(bytes) : undefined,
        callSite: bytes ? cloneWeaponAbi(bytes) : undefined,
      });
    }
    const main = info.plugins.find((p) => p.rel.toLowerCase() === 'plugin.nro') ?? info.plugins[0]!;
    const a = main.smashline;
    info.identified = lookupFingerprint(main.sha256);
    if (info.identified?.newer)
      findings.push({
        id: 'mod_update_available',
        severity: 'info',
        confidence: 'certain',
        mod: mod.name,
        title: `"${mod.name}" has a newer version on GameBanana`,
        detail: `Your plugin.nro matches ${info.identified.modName} (${info.identified.fileName}, ${info.identified.fileDate}). A newer file was added on ${info.identified.newer.date}.`,
        fix: `Check ${info.identified.url} for the update (read its changelog first: a new version may need a different Smashline).`,
      });
    if (!a) {
      info.needs = 'unchecked';
      info.needsReason = "Can't read the plugin in this mode (CSV listing), so the Smashline version is unknown.";
    } else {
      switch (a.verdict) {
        case 'none': info.needs = 'none'; info.needsConfidence = 'likely'; break;
        case 'either': info.needs = 'either'; info.needsConfidence = 'likely'; break;
        case 'needs_2.0': info.needs = '2.0.0'; info.needsConfidence = 'certain'; break;
        case 'needs_unreleased': info.needs = 'unreleased'; info.needsConfidence = 'certain'; break;
        case 'abi_sensitive': {
          // Best evidence: how its code actually calls clone_weapon. Date is a fallback hint.
          const cs = main.callSite;
          const hint = abiHintFromDate(opts.lastUpdated?.[mod.name]);
          if (cs && cs.abi !== 'unknown') {
            info.needs = cs.abi === 'old' ? '1.6.8' : '2.0.0';
            info.needsConfidence = cs.confidence;
            const disagree = hint.likely === '1.6.8' && cs.abi === 'new';
            info.needsReason = `${cs.reason}${disagree ? ` (Its update date suggested 1.6.8, but the code says otherwise.)` : ''}`;
          } else {
            info.needs = hint.likely === '1.6.8' ? '1.6.8' : 'unknown';
            info.needsConfidence = hint.confidence;
            info.needsReason = `${a.reason} ${cs?.reason ?? ''} ${hint.reason}`.replace(/\s+/g, ' ').trim();
          }
          break;
        }
      }
      if (!info.needsReason) info.needsReason = a.reason;
      if (a.verdict === 'needs_unreleased')
        findings.push({
          id: 'needs_unreleased_smashline',
          severity: mod.disabled ? 'info' : 'error',
          confidence: 'certain',
          mod: mod.name,
          title: `"${mod.name}" needs a Smashline version that hasn't been released`,
          detail: a.reason + ' It will crash with every public Smashline.',
          fix: 'Move it out of mods/ until its author releases a version that works with public Smashline, or ask them which Smashline build it needs.',
        });
    }
    movesets.push(info);
  }

  // Same plugin.nro bytes (or, without bytes, same name+size) in two different places.
  const groups = new Map<string, { mod: string; path: string }[]>();
  for (const ms of movesets)
    for (const p of ms.plugins) {
      const key = p.sha256 ?? `size:${p.size}`;
      groups.set(key, [...(groups.get(key) ?? []), { mod: ms.mod, path: p.path }]);
    }
  for (const [key, where] of groups) {
    if (where.length < 2) continue;
    const exact = !key.startsWith('size:');
    findings.push({
      id: 'duplicate_moveset_plugin',
      severity: exact ? 'error' : 'warning',
      confidence: exact ? 'certain' : 'possible',
      mod: where[0]!.mod,
      title: exact ? 'The same moveset code is in two places' : 'Two plugin.nro files have exactly the same size',
      detail:
        `${where.map((w) => w.path).join('  and  ')} ${exact ? 'are byte-for-byte identical' : 'are the same size, which usually means they are the same file'}. ` +
        "One mod's code has been copied into another mod, so the same moveset loads twice and the other mod's own code may be missing.",
      fix: 'Delete the copy that sits in the wrong mod folder, then re-download the mod that lost its own plugin.nro.',
      paths: where.map((w) => w.path),
    });
  }
  return { movesets, findings };
}

export interface CompatMatrix {
  versions: { version: '1.6.8' | '2.0.0'; works: string[]; breaks: string[]; unsure: string[] }[];
  recommend?: '1.6.8' | '2.0.0';
  reason: string;
}

/** "With Smashline 1.6.8: N mods work, M need 2.0. With 2.0: ..." over active movesets. */
export function compatMatrix(movesets: MovesetInfo[]): CompatMatrix {
  const active = movesets.filter((m) => !m.disabled && m.needs !== 'none' && m.needs !== 'unchecked');
  const versions = (['1.6.8', '2.0.0'] as const).map((version) => {
    const row = { version, works: [] as string[], breaks: [] as string[], unsure: [] as string[] };
    for (const m of active) {
      if (m.needs === 'either' || m.needs === version) row.works.push(m.mod);
      else if (m.needs === 'unknown') row.unsure.push(m.mod);
      else row.breaks.push(m.mod);
    }
    return row;
  });
  const [a, b] = versions as [(typeof versions)[0], (typeof versions)[0]];
  let recommend: CompatMatrix['recommend'];
  let reason: string;
  if (!active.length) reason = movesets.some((m) => m.needs === 'unchecked') ? "Smashline versions weren't checked (the plugin files couldn't be read)." : 'No active movesets with Smashline code found.';
  else if (a.works.length === b.works.length && a.breaks.length === b.breaks.length) reason = 'Both versions run the same number of your movesets.';
  else {
    recommend = a.works.length > b.works.length ? '1.6.8' : '2.0.0';
    const w = recommend === '1.6.8' ? a : b;
    reason = `Smashline ${recommend} runs ${w.works.length} of your ${active.length} active movesets${w.breaks.length ? `; move these out: ${w.breaks.join(', ')}` : ''}.`;
  }
  return { versions, recommend, reason };
}
