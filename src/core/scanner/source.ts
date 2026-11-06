// File access abstraction. The checks never touch the browser's File System
// Access API or Node's fs directly; they talk to a FileSource. That lets the
// same checks run on a real SD card (browser), a CSV listing (any browser),
// or a fake in-memory tree (tests).

export interface FileEntry {
  /** Forward-slash path relative to the SD card root, e.g. "ultimate/mods/blaze/plugin.nro". */
  path: string;
  size: number;
}

export interface FileSource {
  kind: 'folder' | 'csv' | 'memory';
  /** What part of the SD card this source covers. A CSV listing only covers ultimate/mods/. */
  scope: 'sd-root' | 'mods-only';
  /** Can we read file contents (needed for hashing and Smashline checks)? */
  canRead: boolean;
  files(): Promise<FileEntry[]>;
  /** Read up to maxBytes of a file. Returns null if contents are unavailable. */
  read(path: string, maxBytes?: number): Promise<Uint8Array | null>;
}

export const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

/** In-memory tree, for tests and for re-scanning data we already have. */
export function memorySource(
  entries: { path: string; size?: number; bytes?: Uint8Array | string }[],
  scope: FileSource['scope'] = 'sd-root',
): FileSource {
  const map = new Map<string, { size: number; bytes?: Uint8Array }>();
  for (const e of entries) {
    const bytes = typeof e.bytes === 'string' ? new TextEncoder().encode(e.bytes) : e.bytes;
    map.set(normPath(e.path), { size: e.size ?? bytes?.length ?? 0, bytes });
  }
  return {
    kind: 'memory',
    scope,
    canRead: true,
    files: async () => [...map].map(([path, v]) => ({ path, size: v.size })),
    read: async (path, maxBytes) => {
      const b = map.get(normPath(path))?.bytes;
      if (!b) return null;
      return maxBytes !== undefined ? b.slice(0, maxBytes) : b;
    },
  };
}

/** Minimal CSV parser: handles quoted fields with "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/**
 * The PowerShell listing: columns Mod,Path,Size, with Path relative to
 * ultimate/mods/ (e.g. "blaze\plugin.nro"). Header names are matched loosely.
 */
export function csvSource(text: string): FileSource {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const pathCol = header.indexOf('path');
  const sizeCol = header.findIndex((h) => h === 'size' || h === 'length');
  if (pathCol < 0 || sizeCol < 0) throw new Error('CSV needs "Path" and "Size" columns (see the PowerShell command on the page).');
  const files: FileEntry[] = rows
    .filter((r) => r[pathCol])
    .map((r) => {
      let p = normPath(r[pathCol]!);
      // Accept full paths too ("D:\ultimate\mods\x\y" or "ultimate/mods/x/y")
      const at = p.toLowerCase().indexOf('ultimate/mods/');
      p = at >= 0 ? p.slice(at + 'ultimate/mods/'.length) : p.replace(/^[A-Za-z]:\//, '');
      return { path: 'ultimate/mods/' + p, size: Number(r[sizeCol]) || 0 };
    });
  return {
    kind: 'csv',
    scope: 'mods-only',
    canRead: false,
    files: async () => files,
    read: async () => null,
  };
}

/** The PowerShell one-liner users run when their browser has no folder picker. */
export const POWERSHELL_LISTING_COMMAND =
  `$m='D:\\ultimate\\mods'; Get-ChildItem $m -Recurse -File | ForEach-Object { [pscustomobject]@{ Mod = $_.FullName.Substring($m.Length+1).Split('\\')[0]; Path = $_.FullName.Substring($m.Length+1); Size = $_.Length } } | Export-Csv "$env:USERPROFILE\\Desktop\\modfiles.csv" -NoTypeInformation -Encoding UTF8`;
