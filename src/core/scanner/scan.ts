// Runs every check and assembles the report the UI shows.
import type { Explanation, Finding, Severity } from '../types';
import { parseCrashLog } from '../crashlog/parse';
import { explain } from '../crashlog/match';
import { buildModel, type SdModel } from './model';
import type { FileSource } from './source';
import { hygieneChecks } from './checks/hygiene';
import { structureChecks } from './checks/structure';
import { slotChecks, modSlots, slotRanges, fighterName } from './checks/slots';
import { cskChecks } from './checks/csk';
import { baseChecks, type BaseReport } from './checks/plugins';
import { movesetChecks, compatMatrix, type CompatMatrix, type MovesetInfo, type MovesetOptions } from './checks/movesets';
import { crossReference } from './crossref';

export interface ModRow {
  name: string;
  disabled: boolean;
  fileCount: number;
  totalSize: number;
  slots: string;
  moveset?: MovesetInfo;
  status: Severity;
  issues: Finding[];
}

export interface ScanReport {
  source: FileSource['kind'];
  scope: FileSource['scope'];
  findings: Finding[];
  mods: ModRow[];
  base: BaseReport;
  matrix: CompatMatrix;
  crashes: Explanation[];
  /** What this scan could not check, in plain English. */
  skipped: string[];
  counts: { error: number; warning: number; info: number; modsOk: number };
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, ok: 3 };
export const bySeverity = (a: Finding, b: Finding) => RANK[a.severity] - RANK[b.severity];

export interface ScanOptions extends MovesetOptions {
  onProgress?: (stage: string) => void;
}

export async function scan(source: FileSource, opts: ScanOptions = {}): Promise<ScanReport> {
  opts.onProgress?.('Listing files');
  const files = await source.files();
  const model: SdModel = buildModel(files);

  opts.onProgress?.('Checking plugins');
  const base = await baseChecks(source, files);
  opts.onProgress?.('Checking mod folders');
  const findings: Finding[] = [
    ...base.findings,
    ...hygieneChecks(model),
    ...structureChecks(model),
    ...slotChecks(model),
    ...cskChecks(model, source.scope === 'sd-root' ? base.installed : undefined),
  ];
  opts.onProgress?.('Reading moveset code');
  const ms = await movesetChecks(source, model, opts);
  findings.push(...ms.findings);
  const matrix = compatMatrix(ms.movesets);

  // Crash reports on the card
  const crashes: Explanation[] = [];
  if (source.canRead) {
    const logs = files.filter((f) => /^atmosphere\/crash_reports\/[^/]+\.log$/i.test(f.path));
    if (logs.length) opts.onProgress?.(`Explaining ${logs.length} crash reports`);
    const smashlineVersion = base.installed.get('Smashline');
    for (const f of logs) {
      const bytes = await source.read(f.path);
      if (!bytes) continue;
      crashes.push(explain(parseCrashLog(new TextDecoder().decode(bytes), f.path.split('/').pop()), { smashlineVersion }));
    }
    crashes.sort((a, b) => (b.log.isCrashReport && b.log.timestamp ? +b.log.timestamp : 0) - (a.log.isCrashReport && a.log.timestamp ? +a.log.timestamp : 0));
    findings.push(...crossReference(crashes, ms.movesets, base.installed));
  }

  findings.sort(bySeverity);
  const mods: ModRow[] = model.mods.map((mod) => {
    const issues = findings.filter((f) => f.mod === mod.name);
    const status = issues.reduce<Severity>((s, f) => (RANK[f.severity] < RANK[s] ? f.severity : s), 'ok');
    return {
      name: mod.name,
      disabled: mod.disabled,
      fileCount: mod.files.length,
      totalSize: mod.files.reduce((n, f) => n + f.size, 0),
      slots: modSlots(mod).map((u) => `${fighterName(u.fighter)} ${slotRanges(u.slots)}`).join('; '),
      moveset: ms.movesets.find((x) => x.mod === mod.name),
      status,
      issues,
    };
  });

  const skipped: string[] = [];
  if (source.scope === 'mods-only')
    skipped.push('Plugins, Skyline and crash reports: a CSV listing only covers ultimate/mods/. Use folder mode in Chrome or Edge for the full check.');
  if (!source.canRead)
    skipped.push("Hashing and the Smashline-version check: these need to read the plugin.nro files, which a CSV listing can't do. Duplicate plugins are guessed from file sizes instead.");

  return {
    source: source.kind,
    scope: source.scope,
    findings,
    mods,
    base,
    matrix,
    crashes,
    skipped,
    counts: {
      error: findings.filter((f) => f.severity === 'error').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
      modsOk: mods.filter((m) => m.status === 'ok' || m.status === 'info').length,
    },
  };
}
