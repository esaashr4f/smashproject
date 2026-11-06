// Real SD-card access in the browser, behind the same FileSource interface the
// tests use. Two ways in:
//  1. showDirectoryPicker() (Chrome/Edge): the File System Access API.
//  2. Drag-and-drop of a folder (works in Firefox and Safari too) via the
//     older webkitGetAsEntry() API.
// SD cards are slow, so we only walk the folders that matter and only read
// bytes when a check asks for them.

import type { FileEntry, FileSource } from '../core/scanner/source';

/** Folders we walk, relative to the SD root. Everything else is skipped. */
const WANTED = ['atmosphere/contents/01006a800016e000', 'atmosphere/crash_reports', 'ultimate'];
const wanted = (path: string) => {
  const p = path.toLowerCase();
  return WANTED.some((w) => w.startsWith(p) || p.startsWith(w));
};

export const hasDirectoryPicker = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

type Progress = (count: number, path: string) => void;

interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

/**
 * If the user picked a sub-folder (e.g. "ultimate" or "mods") instead of the
 * SD root, we prefix paths so they still look like SD-root paths.
 */
function rootPrefix(name: string, children: string[]): string {
  const lc = children.map((c) => c.toLowerCase());
  if (lc.includes('atmosphere') || lc.includes('ultimate')) return '';
  const n = name.toLowerCase();
  if (n === 'ultimate') return 'ultimate/';
  if (n === 'mods') return 'ultimate/mods/';
  if (n === 'crash_reports') return 'atmosphere/crash_reports/';
  return 'ultimate/mods/'; // assume a mods-like folder
}

export async function pickFolder(onProgress?: Progress): Promise<FileSource> {
  const root = (await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'read' })) as DirHandle;
  const top: string[] = [];
  for await (const c of root.values()) top.push(c.name);
  const prefix = rootPrefix(root.name, top);
  const files = new Map<string, { size: number; file: File }>();
  let count = 0;
  async function walk(dir: DirHandle, rel: string) {
    for await (const child of dir.values()) {
      const path = rel + child.name;
      if (!wanted(prefix + path)) continue;
      if (child.kind === 'directory') await walk(child, path + '/');
      else {
        const file = await child.getFile();
        files.set(prefix + path, { size: file.size, file });
        if (++count % 50 === 0) onProgress?.(count, path);
      }
    }
  }
  await walk(root, '');
  onProgress?.(count, '');
  return fileMapSource(files, prefix === '' ? 'sd-root' : 'mods-only');
}

function fileMapSource(files: Map<string, { size: number; file: File }>, scope: FileSource['scope']): FileSource {
  return {
    kind: 'folder',
    scope,
    canRead: true,
    files: async (): Promise<FileEntry[]> => [...files].map(([path, v]) => ({ path, size: v.size })),
    read: async (path, maxBytes) => {
      const f = files.get(path)?.file;
      if (!f) return null;
      const blob = maxBytes !== undefined ? f.slice(0, maxBytes) : f;
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

// ---- drag-and-drop (FileSystemEntry API) ----
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, err: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (e: FsEntry[]) => void, err: (e: unknown) => void): void };
}

async function readAll(dir: FsEntry): Promise<FsEntry[]> {
  const reader = dir.createReader!();
  const out: FsEntry[] = [];
  // readEntries returns results in batches until an empty batch.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
    if (!batch.length) return out;
    out.push(...batch);
  }
}

/** Files from a drop event, with their relative paths (folders are walked). */
export async function droppedFiles(dt: DataTransfer, filter?: (path: string) => boolean, onProgress?: Progress): Promise<{ path: string; file: File }[]> {
  const entries = [...dt.items]
    .map((i) => (i as unknown as { webkitGetAsEntry?(): FsEntry | null }).webkitGetAsEntry?.())
    .filter((e): e is FsEntry => !!e);
  if (!entries.length) return [...dt.files].map((f) => ({ path: f.name, file: f }));
  const out: { path: string; file: File }[] = [];
  async function walk(e: FsEntry, rel: string) {
    const path = rel + e.name;
    if (e.isFile) {
      if (filter && !filter(path)) return;
      out.push({ path, file: await new Promise<File>((ok, err) => e.file!(ok, err)) });
      if (out.length % 50 === 0) onProgress?.(out.length, path);
    } else if (e.isDirectory) for (const c of await readAll(e)) await walk(c, path + '/');
  }
  for (const e of entries) await walk(e, '');
  return out;
}

/** A dropped SD card / ultimate / mods folder as a FileSource. */
export async function droppedFolderSource(dt: DataTransfer, onProgress?: Progress): Promise<FileSource | null> {
  const entries = [...dt.items]
    .map((i) => (i as unknown as { webkitGetAsEntry?(): FsEntry | null }).webkitGetAsEntry?.())
    .filter((e): e is FsEntry => !!e && e.isDirectory);
  if (entries.length !== 1) return null;
  const root = entries[0]!;
  const top = (await readAll(root)).map((e) => e.name);
  const prefix = rootPrefix(root.name, top);
  const list = await droppedFiles(dt, (p) => wanted(prefix + p.slice(root.name.length + 1)), onProgress);
  const files = new Map<string, { size: number; file: File }>();
  for (const { path, file } of list) files.set(prefix + path.slice(root.name.length + 1), { size: file.size, file });
  return fileMapSource(files, prefix === '' ? 'sd-root' : 'mods-only');
}
