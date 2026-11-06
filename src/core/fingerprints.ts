// Identify a mod (and its exact version) by the hash of its plugin.nro,
// using the database built by scripts/build-fingerprints.ts.
import db from '../data/fingerprints.json';

interface Fp {
  sha256: string;
  kind: string;
  cloneWeaponAbi?: string;
  modId: number;
  modName: string;
  fileId: number;
  fileName: string;
  fileDate: string;
}
const DB = db as unknown as { mods: Record<string, { name: string; latestFileId: number; latestFileDate: string }>; fingerprints: Fp[] };
const BY_HASH = new Map(DB.fingerprints.map((f) => [f.sha256, f]));

export interface FingerprintMatch {
  modId: number;
  modName: string;
  url: string;
  fileName: string;
  fileDate: string;
  /** A newer file exists on GameBanana. */
  newer?: { date: string };
}

export function lookupFingerprint(sha256: string | undefined): FingerprintMatch | undefined {
  const f = sha256 ? BY_HASH.get(sha256) : undefined;
  if (!f) return undefined;
  // Newer = a different plugin.nro from the same GameBanana page, added later.
  // (Pages often carry unrelated add-on files, so "latest file" alone isn't enough.)
  const newer = DB.fingerprints
    .filter((x) => x.modId === f.modId && x.kind === 'plugin.nro' && x.sha256 !== f.sha256 && x.fileDate > f.fileDate)
    .sort((a, b) => b.fileDate.localeCompare(a.fileDate))[0];
  return {
    modId: f.modId,
    modName: f.modName,
    url: `https://gamebanana.com/mods/${f.modId}`,
    fileName: f.fileName,
    fileDate: f.fileDate,
    newer: newer ? { date: newer.fileDate } : undefined,
  };
}

export const fingerprintCount = () => DB.fingerprints.length;
