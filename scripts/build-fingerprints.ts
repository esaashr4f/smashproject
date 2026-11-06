// Offline fingerprint builder: for each GameBanana mod ID, download every file
// version, hash the plugin.nro (and config.json) inside, and record
// { sha256 -> mod, file, date }. Only hashes are stored, never the binaries.
//
// Usage:  npm run fingerprints -- 559266 549058 ...
//         npm run fingerprints -- --search "moveset" --pages 2
// Output: src/data/fingerprints.json (merged with what's already there)
//
// Only .zip archives are read (7z/rar are skipped and reported). Be polite:
// one download at a time with a pause between requests.
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { fetchMod, GB_GAME_ID } from '../src/core/gamebanana';
import { sha256Hex } from '../src/core/hash';
import { analyseSmashline } from '../src/core/nro/smashline';

const OUT = 'src/data/fingerprints.json';
const UA = 'smash-mod-doctor-fingerprints/0.1 (+https://github.com/esaashr4f/smashproject)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gbFetch = (url: string) => fetch(url, { headers: { 'User-Agent': UA } });

interface Fingerprint {
  sha256: string;
  kind: 'plugin.nro' | 'config.json';
  size: number;
  modId: number;
  modName: string;
  fileId: number;
  fileName: string;
  fileDate: string;
  pathInArchive: string;
  smashline?: string;
}
type Db = { _about: string; generated: string; mods: Record<string, { name: string; latestFileId: number; latestFileDate: string }>; fingerprints: Fingerprint[] };

const load = (): Db => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8')) as Db;
  } catch {
    return { _about: '', generated: '', mods: {}, fingerprints: [] };
  }
};

async function searchIds(q: string, pages: number): Promise<number[]> {
  const ids: number[] = [];
  for (let p = 1; p <= pages; p++) {
    const r = await gbFetch(`https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_idGameRow=${GB_GAME_ID}&_sSearchString=${encodeURIComponent(q)}&_nPage=${p}`);
    const d = (await r.json()) as { _aRecords?: { _idRow: number }[] };
    ids.push(...(d._aRecords ?? []).map((x) => x._idRow));
    await sleep(1000);
  }
  return ids;
}

async function main() {
  const args = process.argv.slice(2);
  let ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const si = args.indexOf('--search');
  if (si >= 0) ids.push(...(await searchIds(args[si + 1] ?? 'moveset', Number(args[args.indexOf('--pages') + 1]) || 1)));
  ids = [...new Set(ids)];
  if (!ids.length) {
    console.log('Give GameBanana mod IDs or --search "<terms>"');
    return;
  }
  const db = load();
  const known = new Set(db.fingerprints.map((f) => `${f.fileId}:${f.pathInArchive}`));
  for (const id of ids) {
    const mod = await fetchMod(id, gbFetch);
    console.log(`\n${id} ${mod.name} (${mod.files.length} files)`);
    const latest = [...mod.files].sort((a, b) => +b.added - +a.added)[0];
    if (latest) db.mods[id] = { name: mod.name, latestFileId: latest.id, latestFileDate: latest.added.toISOString().slice(0, 10) };
    for (const f of mod.files) {
      if (!f.name.toLowerCase().endsWith('.zip')) {
        console.log(`  skip ${f.name} (only .zip is supported)`);
        continue;
      }
      if (f.size > 400e6) {
        console.log(`  skip ${f.name} (too big)`);
        continue;
      }
      if ([...known].some((k) => k.startsWith(`${f.id}:`))) {
        console.log(`  already have ${f.name}`);
        continue;
      }
      await sleep(1500);
      const res = await gbFetch(f.downloadUrl);
      if (!res.ok) {
        console.log(`  ${f.name}: HTTP ${res.status}`);
        continue;
      }
      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(new Uint8Array(await res.arrayBuffer()), {
          filter: (e) => /(^|\/)(plugin\.nro|config\.json)$/i.test(e.name),
        });
      } catch (e) {
        console.log(`  ${f.name}: not a readable zip (${(e as Error).message})`);
        continue;
      }
      for (const [path, bytes] of Object.entries(files)) {
        const kind = path.toLowerCase().endsWith('plugin.nro') ? 'plugin.nro' : 'config.json';
        const fp: Fingerprint = {
          sha256: await sha256Hex(bytes),
          kind,
          size: bytes.length,
          modId: id,
          modName: mod.name,
          fileId: f.id,
          fileName: f.name,
          fileDate: f.added.toISOString().slice(0, 10),
          pathInArchive: path,
          smashline: kind === 'plugin.nro' ? analyseSmashline(bytes).verdict : undefined,
        };
        db.fingerprints.push(fp);
        known.add(`${f.id}:${path}`);
        console.log(`  ${f.name} ${path} ${fp.sha256.slice(0, 12)}… ${fp.smashline ?? ''}`);
      }
    }
  }
  db._about = 'Hashes of plugin.nro / config.json files from GameBanana mod downloads, built by scripts/build-fingerprints.ts. Lets the scanner identify a mod and its exact version. Hashes only; no mod files are stored.';
  db.generated = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
  console.log(`\nSaved ${db.fingerprints.length} fingerprints for ${Object.keys(db.mods).length} mods to ${OUT}`);
}
main();
