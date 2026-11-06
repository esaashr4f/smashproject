// Base setup: Skyline exefs, the plugins folder, and identifying each plugin by hash.
import known from '../../../data/known_plugins.json';
import compat from '../../../data/compat.json';
import layout from '../../../data/sd_layout.json';
import { sha256Hex } from '../../hash';
import type { Finding, Severity } from '../../types';
import type { FileEntry, FileSource } from '../source';

export interface KnownFile {
  name: string;
  product: string;
  version: string;
  size: number;
  sha256: string;
  notes?: string;
}
export const KNOWN: KnownFile[] = (known as { files: KnownFile[] }).files;

/** Which product a plugin file name usually belongs to (used only when the hash is unknown). */
const PRODUCT_BY_FILENAME: Record<string, string> = {
  'libarcropolis.nro': 'ARCropolis',
  'libnro_hook.nro': 'NRO Hook',
  ...Object.fromEntries(KNOWN.map((k) => [k.name.toLowerCase(), k.product])),
};

export interface BaseItem {
  label: string;
  path: string;
  status: Severity;
  product?: string;
  version?: string;
  detail: string;
  size?: number;
  sha256?: string;
}

export interface BaseReport {
  items: BaseItem[];
  findings: Finding[];
  /** Product -> identified version (or "unrecognised build"). */
  installed: Map<string, string>;
  gameVersion?: string;
}

const lower = (s: string) => s.toLowerCase();

export async function identify(source: FileSource, f: FileEntry): Promise<{ known?: KnownFile; sha256?: string }> {
  if (!source.canRead) return {};
  // Size first: cheap, and avoids reading big files that can't match anything.
  const candidates = KNOWN.filter((k) => k.size === f.size);
  const bytes = await source.read(f.path);
  if (!bytes) return {};
  const sha256 = await sha256Hex(bytes);
  return { known: candidates.find((k) => k.sha256 === sha256) ?? KNOWN.find((k) => k.sha256 === sha256), sha256 };
}

export async function baseChecks(source: FileSource, files: FileEntry[]): Promise<BaseReport> {
  const report: BaseReport = { items: [], findings: [], installed: new Map() };
  if (source.scope !== 'sd-root') return report;

  const title = lower(layout.smashTitle) + '/';
  const inTitle = files.filter((f) => lower(f.path).startsWith(title));
  const exefs = inTitle.filter((f) => lower(f.path).startsWith(title + 'exefs/'));
  const pluginsPrefix = title + lower(layout.pluginsDir) + '/';
  const plugins = inTitle.filter((f) => lower(f.path).startsWith(pluginsPrefix));

  // Game version: ARCropolis caches offsets per game version in ultimate/arcropolis/cache/<version>/
  const cache = files.map((f) => /^ultimate\/arcropolis\/cache\/(\d+\.\d+\.\d+)\//i.exec(f.path)?.[1]).filter(Boolean) as string[];
  if (cache.length) report.gameVersion = cache.sort().at(-1);

  // --- Skyline (exefs) ---
  const subsdk = exefs.find((f) => lower(f.path).endsWith('/exefs/subsdk9'));
  const npdm = exefs.find((f) => lower(f.path).endsWith('/exefs/main.npdm'));
  if (!subsdk || !npdm) {
    report.items.push({
      label: 'Skyline',
      path: title + 'exefs/',
      status: 'error',
      detail: `Missing ${[!subsdk && 'subsdk9', !npdm && 'main.npdm'].filter(Boolean).join(' and ')}. ARCropolis and every other plugin need Skyline to load.`,
    });
  } else {
    const id = await identify(source, subsdk);
    if (id.known) report.installed.set('Skyline', id.known.version);
    report.items.push({
      label: 'Skyline',
      path: subsdk.path,
      status: id.known ? 'ok' : source.canRead ? 'warning' : 'info',
      product: 'Skyline',
      version: id.known?.version ?? (source.canRead ? 'unrecognised build' : undefined),
      detail: id.known ? id.known.notes ?? '' : `subsdk9 is ${subsdk.size} bytes; we don't recognise this build.`,
      size: subsdk.size,
      sha256: id.sha256,
    });
  }
  const extraExefs = exefs.filter((f) => !layout.exefsAllowed.includes(lower(f.path.split('/').pop()!)));
  if (extraExefs.length)
    report.findings.push({
      id: 'exefs_extra_files',
      severity: 'error',
      confidence: 'certain',
      title: 'Unexpected files in Smash\'s exefs folder',
      detail: `Only main.npdm and subsdk9 belong there. Found: ${extraExefs.map((f) => f.path.split('/').pop()).join(', ')}. Extra exefs files (e.g. from Ozone or another code mod) can stop the game booting.`,
      fix: 'Move the extra files out, unless you deliberately installed something like Ozone (which replaces Skyline; don\'t mix the two).',
      paths: extraExefs.map((f) => f.path),
    });

  // --- Plugins ---
  const byProduct = new Map<string, string[]>();
  for (const f of plugins) {
    const fileName = f.path.slice(pluginsPrefix.length);
    if (fileName.includes('/')) {
      report.findings.push({
        id: 'plugin_subfolder',
        severity: 'warning',
        confidence: 'likely',
        title: `Sub-folder inside the plugins folder: ${fileName.split('/')[0]}`,
        detail: 'Skyline only loads .nro files directly inside romfs/skyline/plugins/.',
        fix: 'Move plugin .nro files up into plugins/, and move anything else out.',
        paths: [f.path],
      });
      continue;
    }
    if (!lower(fileName).endsWith('.nro')) {
      report.findings.push({
        id: 'non_nro_in_plugins',
        severity: lower(fileName).includes('.nro') ? 'warning' : 'info',
        confidence: 'likely',
        title: `"${fileName}" isn't a plugin`,
        detail: lower(fileName).includes('.nro')
          ? 'Renamed backups like ".nro.off" can still confuse Skyline, and they make it unclear which version is active.'
          : 'Only .nro plugins belong in this folder.',
        fix: 'Move backups and other files to a folder outside plugins/, e.g. on your PC.',
        paths: [f.path],
      });
      continue;
    }
    const id = await identify(source, f);
    const product = id.known?.product ?? PRODUCT_BY_FILENAME[lower(fileName)];
    const version = id.known?.version ?? (source.canRead ? 'unrecognised build' : undefined);
    if (product) {
      byProduct.set(product, [...(byProduct.get(product) ?? []), fileName]);
      if (version) report.installed.set(product, version);
    }
    const advice = !id.known && product ? (compat.unknownBuildAdvice as Record<string, string>)[product] : undefined;
    report.items.push({
      label: product ?? fileName,
      path: f.path,
      status: id.known ? 'ok' : product && advice ? 'warning' : 'info',
      product,
      version,
      detail: id.known
        ? id.known.notes ?? ''
        : `${fileName}, ${f.size.toLocaleString('en')} bytes. ${source.canRead ? "We don't recognise this exact build." : ''} ${advice ?? ''}`.trim(),
      size: f.size,
      sha256: id.sha256,
    });
  }
  for (const [product, names] of byProduct)
    if (names.length > 1)
      report.findings.push({
        id: 'duplicate_plugin',
        severity: 'error',
        confidence: 'likely',
        title: `${product} is installed ${names.length} times`,
        detail: `Files: ${names.join(', ')}. Two copies of the same plugin load twice and conflict.`,
        fix: 'Keep exactly one and move the others out of the plugins folder.',
      });

  const dev = inTitle.find((f) => lower(f.path) === title + lower(layout.devPlugin));
  if (dev)
    report.findings.push({
      id: 'smashline_dev_plugin',
      severity: 'warning',
      confidence: 'certain',
      title: 'A Smashline development plugin is installed',
      detail: 'romfs/smashline/development.nro is for moveset authors testing their own code. It is loaded on top of your movesets.',
      fix: "Delete it unless you're developing a moveset.",
      paths: [dev.path],
    });

  // --- Known incompatibilities ---
  for (const issue of compat.issues) {
    if (report.installed.get(issue.product) !== issue.version) continue;
    if (issue.when?.installed && !report.installed.has(issue.when.installed)) continue;
    report.findings.push({
      id: 'compat_' + issue.product.toLowerCase().replace(/\W+/g, '_'),
      severity: issue.severity as Severity,
      confidence: issue.confidence as Finding['confidence'],
      title: issue.title,
      detail: issue.detail,
      fix: issue.fix,
    });
  }
  if (!report.items.some((i) => i.product === 'ARCropolis'))
    report.items.push({ label: 'ARCropolis', path: pluginsPrefix + 'libarcropolis.nro', status: 'error', detail: 'Not found. Mods in ultimate/mods/ won\'t load without ARCropolis.' });
  return report;
}
