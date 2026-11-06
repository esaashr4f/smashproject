// Per-mod structure: wrapper folders, mods nested in mods, missing/empty key files.
import layout from '../../../data/sd_layout.json';
import type { Finding } from '../../types';
import { GAME_FOLDERS, findFile, type Mod, type SdModel } from '../model';

const MOD_MARKERS = ['config.json', 'plugin.nro', 'info.toml'];
const KEY_EXT = layout.keyFileExtensions;

/** Sub-folders (at any depth, outside game folders) that look like a whole mod. */
function nestedMods(mod: Mod): string[] {
  const found = new Set<string>();
  for (const f of mod.files) {
    const parts = f.rel.split('/');
    if (parts.length < 2) continue;
    if (GAME_FOLDERS.has(parts[0]!.toLowerCase())) continue;
    const file = parts[parts.length - 1]!.toLowerCase();
    const dirParts = parts.slice(0, -1);
    const isMarker = MOD_MARKERS.includes(file);
    const hasGameDir = parts.length > 2 && GAME_FOLDERS.has(parts[1]!.toLowerCase());
    if (isMarker || hasGameDir) found.add(isMarker ? dirParts.join('/') : parts[0]!);
  }
  return [...found];
}

export function structureChecks(m: SdModel): Finding[] {
  const out: Finding[] = [];
  for (const mod of m.mods) {
    const name = mod.name;
    const topDirs = [...mod.topDirs];
    const hasGameDirs = topDirs.some((d) => GAME_FOLDERS.has(d.toLowerCase()));

    // Extra wrapper folder: the mod contains just one folder, which holds the real content.
    if (!hasGameDirs && topDirs.length === 1 && mod.topFiles.size === 0) {
      const inner = topDirs[0]!;
      const innerHasGame = mod.files.some((f) => {
        const p = f.rel.split('/');
        return p[0] === inner && p.length > 2 && GAME_FOLDERS.has(p[1]!.toLowerCase());
      });
      if (innerHasGame) {
        out.push({
          id: 'wrapper_folder',
          severity: 'error',
          confidence: 'certain',
          mod: name,
          title: `"${name}" has an extra folder layer`,
          detail: `Everything is inside "${name}/${inner}/", so ARCropolis looks for "${name}/fighter/..." and finds nothing (or the wrong thing).`,
          fix: `Move the contents of "${name}/${inner}/" up one level into "${name}/", then delete the empty "${inner}" folder.`,
          paths: [`${layout.modsDir}/${name}/${inner}`],
        });
        continue;
      }
    }

    // A mod nested inside another mod (the Ultron / Shadow case).
    if (hasGameDirs || mod.topFiles.size) {
      for (const sub of nestedMods(mod)) {
        const subFiles = mod.files.filter((f) => f.rel.startsWith(sub + '/'));
        const hasPlugin = subFiles.some((f) => f.rel.toLowerCase().endsWith('/plugin.nro'));
        out.push({
          id: 'nested_mod',
          severity: 'error',
          confidence: 'certain',
          mod: name,
          title: `Another mod is nested inside "${name}"`,
          detail:
            `"${name}/${sub}/" looks like a complete mod of its own (${subFiles.length} files${hasPlugin ? ', including its own plugin.nro' : ''}). ` +
            'A mod inside a mod confuses ARCropolis and can make two movesets load the same code. A real case like this crashed ARCropolis in memcpy.',
          fix: `Move "${sub}" out of "${name}". If it's a copy of a mod you already have, delete it. Then check "${name}" still has its own files (especially plugin.nro if it's a moveset).`,
          paths: [`${layout.modsDir}/${name}/${sub}`],
        });
      }
    }

    // Empty key files. A few zero-byte files are normal placeholders, so only key files count.
    const emptyKey = mod.files.filter(
      (f) => f.size === 0 && (layout.keyFiles.includes(f.rel.toLowerCase()) || KEY_EXT.some((e) => f.rel.toLowerCase().endsWith(e))),
    );
    if (emptyKey.length)
      out.push({
        id: 'empty_key_file',
        severity: 'error',
        confidence: 'certain',
        mod: name,
        title: `"${name}" has empty key files`,
        detail: `These files are 0 bytes, which means a failed copy or download: ${emptyKey.map((f) => f.rel).slice(0, 5).join(', ')}`,
        fix: 'Re-download the mod and copy it again.',
        paths: emptyKey.map((f) => f.path),
      });

    // Looks like a moveset but has no plugin.nro.
    const looksMoveset =
      /moveset/i.test(name) ||
      (findFile(mod, 'config.json') !== undefined && nestedMods(mod).length > 0);
    if (looksMoveset && !findFile(mod, 'plugin.nro'))
      out.push({
        id: 'moveset_missing_plugin',
        severity: 'warning',
        confidence: 'possible',
        mod: name,
        title: `"${name}" may be a moveset with its code file missing`,
        detail: 'This folder looks like a moveset, but there is no plugin.nro at its top level. Without it the custom moves won\'t load and the fighter can crash.',
        fix: 'Re-download the mod and check that plugin.nro ends up directly inside the mod folder.',
      });
  }
  return out;
}
