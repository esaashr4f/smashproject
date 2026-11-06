// Turns a flat file list into the structure the checks reason about.

import layout from '../../data/sd_layout.json';
import type { FileEntry } from './source';

export interface ModFile {
  /** Path inside the mod folder, e.g. "fighter/sonic/model/body/c80/model.numshb". */
  rel: string;
  /** Full SD path. */
  path: string;
  size: number;
}

export interface Mod {
  name: string;
  /** Folder name starts with '.', so ARCropolis skips it. */
  disabled: boolean;
  files: ModFile[];
  /** Top-level child names (folders and files) inside the mod folder. */
  topDirs: Set<string>;
  topFiles: Set<string>;
}

export interface SdModel {
  all: FileEntry[];
  mods: Mod[];
  /** Files sitting directly in ultimate/mods/ instead of in a mod folder. */
  looseModsFiles: FileEntry[];
}

export const GAME_FOLDERS = new Set(layout.gameFolders);
export const MODS_DIR = layout.modsDir + '/';

export function buildModel(files: FileEntry[]): SdModel {
  const byMod = new Map<string, Mod>();
  const loose: FileEntry[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().startsWith(MODS_DIR)) continue;
    const rest = f.path.slice(MODS_DIR.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      loose.push(f);
      continue;
    }
    const name = rest.slice(0, slash);
    const rel = rest.slice(slash + 1);
    let mod = byMod.get(name);
    if (!mod) {
      mod = { name, disabled: name.startsWith('.'), files: [], topDirs: new Set(), topFiles: new Set() };
      byMod.set(name, mod);
    }
    mod.files.push({ rel, path: f.path, size: f.size });
    const s = rel.indexOf('/');
    if (s < 0) mod.topFiles.add(rel);
    else mod.topDirs.add(rel.slice(0, s));
  }
  return {
    all: files,
    mods: [...byMod.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    looseModsFiles: loose,
  };
}

export const activeMods = (m: SdModel) => m.mods.filter((x) => !x.disabled);
export const findFile = (mod: Mod, rel: string) => mod.files.find((f) => f.rel.toLowerCase() === rel.toLowerCase());
