// GameBanana API (public, no key). Tested 2026-11-06: responses carry
// "access-control-allow-origin: *", so the browser can call it directly and
// we don't need a proxy. Smash Ultimate's game ID is 6498.
import milestones from '../data/milestones.json';

export const GB_GAME_ID = 6498;
const API = 'https://gamebanana.com/apiv11';
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GbFile {
  id: number;
  name: string;
  added: Date;
  size: number;
  description: string;
  downloadUrl: string;
}
export interface GbMod {
  id: number;
  name: string;
  version: string;
  url: string;
  updated?: Date;
  files: GbFile[];
  requirements: { name: string; url: string }[];
}
export interface GbPost {
  text: string;
  added: Date;
}

const ts = (n: unknown) => (typeof n === 'number' && n > 0 ? new Date(n * 1000) : undefined);

/** Accepts "https://gamebanana.com/mods/559266", "gamebanana.com/mods/559266/..." or "559266". */
export function parseModId(input: string): number | undefined {
  const m = /(?:gamebanana\.com\/mods\/)?(\d{3,9})/.exec(input.trim());
  return m ? Number(m[1]) : undefined;
}

async function get(fetchFn: Fetch, path: string): Promise<Record<string, unknown>> {
  const r = await fetchFn(API + path);
  if (!r.ok) throw new Error(`GameBanana returned ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

export async function fetchMod(id: number, fetchFn: Fetch = fetch): Promise<GbMod> {
  const d = await get(fetchFn, `/Mod/${id}/ProfilePage`);
  const files = ((d['_aFiles'] as Record<string, unknown>[]) ?? []).map((f) => ({
    id: Number(f['_idRow']),
    name: String(f['_sFile'] ?? ''),
    added: ts(f['_tsDateAdded']) ?? new Date(0),
    size: Number(f['_nFilesize'] ?? 0),
    description: String(f['_sDescription'] ?? ''),
    downloadUrl: String(f['_sDownloadUrl'] ?? `https://gamebanana.com/dl/${f['_idRow']}`),
  }));
  const updated = ts(d['_tsDateUpdated']) ?? ts(d['_tsDateModified']) ?? files.map((f) => f.added).sort((a, b) => +b - +a)[0];
  return {
    id,
    name: String(d['_sName'] ?? `Mod ${id}`),
    version: String(d['_sVersion'] ?? ''),
    url: String(d['_sProfileUrl'] ?? `https://gamebanana.com/mods/${id}`),
    updated,
    files,
    requirements: ((d['_aRequirements'] as [string, string][]) ?? []).map(([name, url]) => ({ name, url })),
  };
}

export async function searchMods(q: string, fetchFn: Fetch = fetch): Promise<{ id: number; name: string; url: string; modified?: Date }[]> {
  const d = await get(fetchFn, `/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_idGameRow=${GB_GAME_ID}&_sSearchString=${encodeURIComponent(q)}`);
  return ((d['_aRecords'] as Record<string, unknown>[]) ?? []).slice(0, 5).map((r) => ({
    id: Number(r['_idRow']),
    name: String(r['_sName']),
    url: String(r['_sProfileUrl']),
    modified: ts(r['_tsDateModified']),
  }));
}

const PROBLEM_RE = /\b(crash(es|ed|ing)?|freez(e|es|ing)|broke(n)?|13\.0\.5|black screen|doesn'?t work|not working)\b/i;
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Recent comments that mention crashes, freezes, 13.0.5... Unverified community reports. */
export async function problemReports(id: number, fetchFn: Fetch = fetch): Promise<GbPost[]> {
  const d = await get(fetchFn, `/Mod/${id}/Posts?_nPage=1&_nPerpage=30&_sSort=newest`);
  return ((d['_aRecords'] as Record<string, unknown>[]) ?? [])
    .map((p) => ({ text: stripHtml(String(p['_sText'] ?? '')), added: ts(p['_tsDateAdded']) ?? new Date(0) }))
    .filter((p) => PROBLEM_RE.test(p.text))
    .slice(0, 5);
}

/** Flags like "Last updated before Smashline 2.0.0". */
export function milestoneFlags(updated: Date | undefined): { label: string; means: string }[] {
  if (!updated) return [];
  return milestones.milestones.filter((m) => updated < new Date(m.date)).map((m) => ({ label: `before ${m.label}`, means: m.beforeMeans }));
}

/** Map a GameBanana requirement name to an installed product name, loosely. */
const REQ_ALIASES: [RegExp, string][] = [
  [/skyline/i, 'Skyline'],
  [/arcropolis/i, 'ARCropolis'],
  [/smashline/i, 'Smashline'],
  [/param.?config/i, 'Param Config'],
  [/one.?slot/i, 'One Slot Effects'],
  [/csk/i, 'The CSK Collection'],
  [/stage.?config/i, 'Stage Config'],
  [/nro.?hook/i, 'NRO Hook'],
  [/ozone/i, 'Ozone'],
];
export const requirementProduct = (name: string) => REQ_ALIASES.find(([re]) => re.test(name))?.[1];
