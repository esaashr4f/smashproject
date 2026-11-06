// Decide which Smashline version a moveset needs from the names its plugin.nro uses.

import api from '../../data/smashline_api.json';
import names168 from '../../data/smashline_1.6.8_names.txt?raw';
import names200 from '../../data/smashline_2.0.0_names.txt?raw';
import type { Confidence } from '../types';
import { extractSmashlineNames } from './strings';

const toSet = (t: string) => new Set(t.split(/\s+/).filter(Boolean));
const RELEASE_NAMES: Record<string, Set<string>> = { '1.6.8': toSet(names168), '2.0.0': toSet(names200) };
const OLD = RELEASE_NAMES['1.6.8']!;
const NEW = RELEASE_NAMES['2.0.0']!;
const ALL_KNOWN = new Set([...OLD, ...NEW]);
export const TWO_POINT_OH_ONLY = new Set([...NEW].filter((n) => !OLD.has(n)));
const ABI = new Set(api.abiSensitive);
const INFO_ONLY = new Set(api.infoOnly);
const NOT_API = new Set(api.notApi);
const VERB_RE = new RegExp(`^smashline_(${api.apiVerbs.join('|')})(_|$)`);

export type SmashlineVerdict =
  | 'none' // doesn't use Smashline at all
  | 'either' // uses Smashline, but nothing that changed in 2.0
  | 'needs_2.0' // uses names that only exist in 2.0
  | 'needs_unreleased' // uses names in no public release
  | 'abi_sensitive'; // uses functions whose arguments changed in 2.0; version can't be told from names

export interface SmashlineAnalysis {
  verdict: SmashlineVerdict;
  confidence: Confidence;
  /** API names the moveset uses (package/module names filtered out). */
  apiNames: string[];
  twoPointOhOnly: string[];
  unreleased: string[];
  abiSensitive: string[];
  infoOnly: string[];
  reason: string;
}

/** Map a raw string to a known name if it's a known name glued to a following literal. */
function normalise(raw: string): string {
  if (ALL_KNOWN.has(raw)) return raw;
  // e.g. "smashline_clone_weaponFoo": a known name followed by another literal starting with a non-underscore.
  let best = '';
  for (const k of ALL_KNOWN) if (raw.startsWith(k) && raw[k.length] !== '_' && k.length > best.length) best = k;
  return best || raw;
}

export function classifyNames(rawNames: Iterable<string>): SmashlineAnalysis {
  const names = new Set([...rawNames].map(normalise));
  const apiNames = [...names]
    .filter((n) => !NOT_API.has(n) && (ALL_KNOWN.has(n) || INFO_ONLY.has(n) || VERB_RE.test(n)))
    .sort();
  const twoPointOhOnly = apiNames.filter((n) => TWO_POINT_OH_ONLY.has(n));
  const unreleased = apiNames.filter((n) => !ALL_KNOWN.has(n) && !INFO_ONLY.has(n));
  const abiSensitive = apiNames.filter((n) => ABI.has(n));
  const infoOnly = apiNames.filter((n) => INFO_ONLY.has(n));
  const base = { apiNames, twoPointOhOnly, unreleased, abiSensitive, infoOnly };

  if (unreleased.length)
    return { ...base, verdict: 'needs_unreleased', confidence: 'certain', reason: `Uses ${unreleased.join(', ')}, which no public Smashline release provides.` };
  if (twoPointOhOnly.length)
    return { ...base, verdict: 'needs_2.0', confidence: 'certain', reason: `Uses ${twoPointOhOnly.join(', ')}, which only exist in Smashline 2.0.` };
  if (abiSensitive.length)
    return {
      ...base,
      verdict: 'abi_sensitive',
      confidence: 'possible',
      reason: `Uses ${abiSensitive.join(', ')}, whose arguments changed in Smashline 2.0 without a rename, so the names alone can't tell which version it was built for.`,
    };
  if (apiNames.length)
    return { ...base, verdict: 'either', confidence: 'likely', reason: 'Only uses Smashline functions that work the same in 1.6.8 and 2.0.' };
  return { ...base, verdict: 'none', confidence: 'likely', reason: 'No Smashline function names found.' };
}

export const analyseSmashline = (bytes: Uint8Array) => classifyNames(extractSmashlineNames(bytes));

/**
 * For abi_sensitive movesets, use the last-updated date (e.g. from GameBanana)
 * as a hint. It is only a hint: Herobrine was updated after 2.0 but still had
 * no 2.0-only names, and it needed 2.0.
 */
export function abiHintFromDate(lastUpdated: Date | undefined): { likely: '1.6.8' | 'unknown'; confidence: Confidence; reason: string } {
  const release = api.releases.find((r) => r.abi === 'new');
  const cutoff = release?.date ? new Date(release.date) : undefined;
  if (!lastUpdated || !cutoff) return { likely: 'unknown', confidence: 'possible', reason: 'No update date known.' };
  if (lastUpdated < cutoff)
    return { likely: '1.6.8', confidence: 'likely', reason: `Last updated ${lastUpdated.toISOString().slice(0, 10)}, before Smashline 2.0 came out, so it was most likely built for 1.6.8.` };
  return { likely: 'unknown', confidence: 'possible', reason: `Updated ${lastUpdated.toISOString().slice(0, 10)}, after Smashline 2.0 came out: it may use the new layout (like Herobrine did).` };
}

export const SMASHLINE_RELEASES = api.releases;
