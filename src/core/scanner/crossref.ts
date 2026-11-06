// Crash reports x scan results: turn "a moveset is too old" into "it's probably Blaze".
import type { Explanation, Finding } from '../types';
import type { MovesetInfo } from './checks/movesets';

export function crossReference(crashes: Explanation[], movesets: MovesetInfo[], installed: Map<string, string>): Finding[] {
  const out: Finding[] = [];
  const active = movesets.filter((m) => !m.disabled);
  const usesClone = (m: MovesetInfo) => m.plugins.some((p) => p.smashline?.abiSensitive.includes('smashline_clone_weapon'));
  const seen = new Set<string>();
  const latest = (id: string) => crashes.find((c) => c.best.ruleId === id);

  const old = latest('smashline2_old_clone_weapon_abi');
  if (old && !seen.has(old.best.ruleId)) {
    seen.add(old.best.ruleId);
    const suspects = active.filter((m) => usesClone(m) && m.needs !== '2.0.0');
    const strong = suspects.filter((m) => m.needs === '1.6.8');
    const unreleased = active.filter((m) => m.needs === 'unreleased');
    const list = [...new Set([...unreleased, ...strong, ...suspects].map((m) => m.mod))];
    if (list.length)
      out.push({
        id: 'xref_smashline2_culprits',
        severity: 'error',
        confidence: list.length === 1 ? 'likely' : 'possible',
        title: `Likely cause of your Smashline 2.0 crash: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` (+${list.length - 3} more)` : ''}`,
        detail:
          'Your crash reports show an old-Smashline moveset crashing in Smashline 2.0\'s clone_weapon. These active movesets call clone_weapon and have no 2.0-only code' +
          (unreleased.length ? `; ${unreleased.map((m) => m.mod).join(', ')} also need${unreleased.length === 1 ? 's' : ''} an unreleased Smashline` : '') + '.',
        fix: 'Move these out of mods/ one at a time, launching once after each, to find the culprit. Or switch to Smashline 1.6.8.',
      });
  }
  const neu = latest('smashline168_new_clone_weapon_abi');
  if (neu) {
    const suspects = active.filter((m) => usesClone(m) && m.needs !== '1.6.8');
    if (suspects.length)
      out.push({
        id: 'xref_smashline168_culprits',
        severity: 'error',
        confidence: suspects.length === 1 ? 'likely' : 'possible',
        title: `Likely cause of your Smashline 1.6.8 crash: ${suspects.map((m) => m.mod).slice(0, 3).join(', ')}`,
        detail: 'Your crash reports show a 2.0-built moveset crashing in Smashline 1.6.8. These active movesets call clone_weapon and may be built for 2.0 (recently updated, or 2.0-only code).',
        fix: 'Use Smashline 2.0.0 for these, or move them out of mods/.',
      });
  }
  const sky = latest('skyline_page_boundary_verify');
  if (sky && installed.get('Skyline') === 'latest official release')
    out.push({
      id: 'xref_skyline_bug',
      severity: 'error',
      confidence: 'certain',
      title: 'Your crashes match the Skyline page-boundary bug, and you have the affected subsdk9',
      detail: 'The scanner identified your exefs/subsdk9 by hash as the official build with the bug.',
      fix: 'Replace subsdk9 with the patched build.',
    });
  return out;
}
