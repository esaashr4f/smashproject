// Mods-folder hygiene: things in ultimate/mods/ that confuse plugins.
import layout from '../../../data/sd_layout.json';
import type { Finding } from '../../types';
import type { SdModel } from '../model';

export function hygieneChecks(m: SdModel): Finding[] {
  const out: Finding[] = [];
  const disabled = m.mods.filter((x) => x.disabled);
  if (disabled.length)
    out.push({
      id: 'dot_folders_in_mods',
      severity: 'warning',
      confidence: 'certain',
      title: `${disabled.length} disabled (dot-prefixed) mod folder${disabled.length > 1 ? 's' : ''} inside mods/`,
      detail: `ARCropolis skips folders whose name starts with '.', but Param Config and other plugins may still scan them. This caused real "2002-4802" crashes. Folders: ${disabled.map((d) => d.name).join(', ')}.`,
      fix: `Move them out of ultimate/mods/ into a separate folder such as ${layout.inactiveDirSuggestion}/.`,
      paths: disabled.map((d) => layout.modsDir + '/' + d.name),
    });

  for (const f of m.looseModsFiles)
    out.push({
      id: 'file_in_mods_root',
      severity: 'error',
      confidence: 'certain',
      title: `"${f.path.split('/').pop()}" is a file, not a mod folder`,
      detail: 'Every entry directly inside ultimate/mods/ should be a folder. A file here usually means a mod was copied or extracted wrongly (a corrupted entry like this caused a real crash).',
      fix: 'Delete it, or re-extract the mod so it becomes a folder.',
      paths: [f.path],
    });

  for (const mod of m.mods) {
    if (/[{}\[\]]/.test(mod.name))
      out.push({
        id: 'name_brackets',
        severity: 'info',
        confidence: 'certain',
        mod: mod.name,
        title: `Folder name "${mod.name}" contains brackets`,
        detail: 'Brackets usually work, but they make paths harder to type and some tools handle them badly.',
        fix: 'Optional: rename it to something simple, e.g. letters, numbers and spaces only.',
      });
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(mod.name))
      out.push({
        id: 'name_non_ascii',
        severity: 'warning',
        confidence: 'possible',
        mod: mod.name,
        title: `Folder name "${mod.name}" has non-ASCII characters`,
        detail: 'Some plugins and tools mishandle accented letters, emoji or other non-ASCII characters in paths.',
        fix: 'Rename the folder using plain letters and numbers.',
      });
    const long = mod.files.filter((f) => f.path.length > layout.maxPathLength);
    if (long.length)
      out.push({
        id: 'long_paths',
        severity: 'warning',
        confidence: 'possible',
        mod: mod.name,
        title: `${long.length} very long path${long.length > 1 ? 's' : ''} in "${mod.name}"`,
        detail: `Paths longer than ${layout.maxPathLength} characters can fail to open. Longest: ${long.sort((a, b) => b.path.length - a.path.length)[0]!.path}`,
        fix: 'Shorten the mod folder name.',
        paths: long.slice(0, 5).map((f) => f.path),
      });
  }
  return out;
}
