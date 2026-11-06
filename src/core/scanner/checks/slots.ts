// Costume slot clashes and same-file replacements between mods.
import layout from '../../../data/sd_layout.json';
import type { Finding } from '../../types';
import { FIGHTERS } from '../../crashlog/match';
import { activeMods, type Mod, type SdModel } from '../model';

export interface SlotUse {
  fighter: string;
  slots: number[];
}

/** (fighter, slots) used by a mod, from fighter/<name>/.../cNN/... paths. Nested mods are ignored. */
export function modSlots(mod: Mod): SlotUse[] {
  const map = new Map<string, Set<number>>();
  for (const f of mod.files) {
    const p = f.rel.split('/');
    if (p[0]?.toLowerCase() !== 'fighter' || p.length < 4) continue;
    const fighter = p[1]!.toLowerCase();
    for (const seg of p.slice(2, -1)) {
      const m = /^c(\d{2,3})$/i.exec(seg);
      if (m) {
        if (!map.has(fighter)) map.set(fighter, new Set());
        map.get(fighter)!.add(Number(m[1]));
      }
    }
  }
  return [...map].map(([fighter, s]) => ({ fighter, slots: [...s].sort((a, b) => a - b) }));
}

/** "c80–91" style summary of a slot list. */
export function slotRanges(slots: number[]): string {
  const out: string[] = [];
  let start = slots[0];
  let prev = start;
  for (const s of [...slots.slice(1), undefined]) {
    if (s !== undefined && prev !== undefined && s === prev + 1) {
      prev = s;
      continue;
    }
    if (start !== undefined) out.push(start === prev ? `c${String(start).padStart(2, '0')}` : `c${String(start).padStart(2, '0')}–${prev}`);
    start = prev = s;
  }
  return out.join(', ');
}

export const fighterName = (internal: string) => FIGHTERS[internal] ?? internal;

const isPatch = (rel: string) => layout.patchExtensions.some((e) => rel.toLowerCase().endsWith(e));
const isModMeta = (rel: string) => !rel.includes('/');

export function slotChecks(m: SdModel): Finding[] {
  const out: Finding[] = [];
  const mods = activeMods(m);

  // Slot clashes
  const owners = new Map<string, string[]>(); // "sonic:80" -> mods
  for (const mod of mods)
    for (const u of modSlots(mod))
      for (const s of u.slots) {
        const k = `${u.fighter}:${s}`;
        owners.set(k, [...(owners.get(k) ?? []), mod.name]);
      }
  const clashes = new Map<string, { fighter: string; mods: string[]; slots: number[] }>();
  for (const [k, ms] of owners) {
    if (ms.length < 2) continue;
    const [fighter, slot] = k.split(':') as [string, string];
    const key = fighter + '|' + ms.join('|');
    const c = clashes.get(key) ?? { fighter, mods: ms, slots: [] };
    c.slots.push(Number(slot));
    clashes.set(key, c);
  }
  for (const c of clashes.values())
    out.push({
      id: 'slot_clash',
      severity: 'error',
      confidence: 'certain',
      title: `${c.mods.join(' and ')} fight over ${fighterName(c.fighter)} ${slotRanges(c.slots.sort((a, b) => a - b))}`,
      detail: 'Two active mods use the same costume slot, so only one of them (or a broken mix) will show up.',
      fix: "Move one of them to a free slot (most mods' GameBanana pages explain how, or use a reslotter tool), or disable one.",
    });

  // Same non-patch file replaced by two mods. xmsbt/prcxml patches are merged by ARCropolis, so they're fine.
  const fileOwners = new Map<string, string[]>();
  for (const mod of mods)
    for (const f of mod.files) {
      if (isModMeta(f.rel) || isPatch(f.rel) || f.size === 0) continue;
      const k = f.rel.toLowerCase();
      fileOwners.set(k, [...(fileOwners.get(k) ?? []), mod.name]);
    }
  const byPair = new Map<string, string[]>();
  for (const [rel, ms] of fileOwners) {
    if (ms.length < 2) continue;
    const k = ms.join(' and ');
    byPair.set(k, [...(byPair.get(k) ?? []), rel]);
  }
  for (const [pair, rels] of byPair)
    out.push({
      id: 'file_conflict',
      severity: 'warning',
      confidence: 'likely',
      title: `${pair} replace the same ${rels.length} file${rels.length > 1 ? 's' : ''}`,
      detail: `Only one version of each file can win. Example: ${rels[0]}`,
      fix: 'Keep only one of these mods active, unless one is meant to override the other.',
      paths: rels.slice(0, 10),
    });
  return out;
}
