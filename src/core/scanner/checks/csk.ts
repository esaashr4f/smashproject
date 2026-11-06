// The CSK Collection's optional "extras" folders need the CSK plugin.
import layout from '../../../data/sd_layout.json';
import type { Finding } from '../../types';
import { activeMods, type SdModel } from '../model';

export function cskChecks(m: SdModel, installed: Map<string, string> | undefined): Finding[] {
  const extras = activeMods(m).filter((mod) => mod.files.some((f) => layout.cskExtras.markers.some((p) => f.rel.toLowerCase().startsWith(p))));
  if (!extras.length) return [];
  const names = extras.map((x) => `"${x.name}"`).join(', ');
  if (!installed)
    return [
      {
        id: 'csk_extras',
        severity: 'info',
        confidence: 'likely',
        title: `${names} ${extras.length > 1 ? 'are' : 'is'} The CSK Collection extra${extras.length > 1 ? 's' : ''}`,
        detail: `${layout.cskExtras.note} This scan can't see your plugins folder, so check that ${layout.cskExtras.plugin} is installed.`,
        fix: `Make sure ${layout.cskExtras.plugin} (6.0.0 or newer for game 13.0.5) is in romfs/skyline/plugins/, or move these folders out of mods/.`,
      },
    ];
  if (installed.has('The CSK Collection')) return [];
  return [
    {
      id: 'csk_extras_without_plugin',
      severity: 'error',
      confidence: 'likely',
      title: `CSK extras are active but The CSK Collection plugin isn't installed`,
      detail: `${names}: ${layout.cskExtras.note} Without the plugin, ARCropolis can fail to open these files (a real "2002-4802" crash).`,
      fix: `Install ${layout.cskExtras.plugin} or move ${names} out of ultimate/mods/.`,
    },
  ];
}
