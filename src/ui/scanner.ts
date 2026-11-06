// SD Card Scanner page.
import { csvSource, POWERSHELL_LISTING_COMMAND, type FileSource } from '../core/scanner/source';
import { scan, type ScanReport } from '../core/scanner/scan';
import { plural, reportMarkdown } from '../core/report';
import type { Finding } from '../core/types';
import { badge, clear, copyText, download, h, SEVERITY_ICON } from './dom';
import { droppedFolderSource, hasDirectoryPicker, pickFolder } from './folder';
import { gameBananaPanel, loadLinks } from './gamebanana';

const NEEDS_LABEL: Record<string, string> = {
  '1.6.8': '1.6.8',
  '2.0.0': '2.0',
  either: 'either version',
  unreleased: 'unreleased Smashline!',
  unknown: 'unclear (clone_weapon)',
  none: 'no Smashline code',
  unchecked: 'not checked',
};

function findingEl(f: Finding): HTMLElement {
  return h(
    'li',
    { class: `finding sev-${f.severity}` },
    h('div', { class: 'f-head' }, h('span', { 'aria-hidden': 'true' }, SEVERITY_ICON[f.severity] + ' '), h('strong', {}, f.title), ' ', badge(f.confidence, `conf-${f.confidence}`)),
    h('p', {}, f.detail),
    f.fix ? h('p', { class: 'fixline' }, h('strong', {}, 'Fix: '), f.fix) : null,
  );
}

function renderReport(out: HTMLElement, r: ScanReport, rerun: () => void) {
  clear(out);
  const md = reportMarkdown(r);
  const copy = h('button', { type: 'button', class: 'ghost small' }, 'Copy report (Markdown)');
  copy.addEventListener('click', () => copyText(md, copy));
  const dl = h('button', { type: 'button', class: 'ghost small' }, 'Download .md');
  dl.addEventListener('click', () => download('smash-mod-doctor-report.md', md));

  out.append(
    h(
      'section',
      { class: `panel summary-card sev-${r.counts.error ? 'error' : r.counts.warning ? 'warning' : 'ok'}` },
      h('h2', {}, `${plural(r.counts.error, 'error')}, ${plural(r.counts.warning, 'warning')}, ${r.counts.modsOk} of ${plural(r.mods.length, 'mod')} OK`),
      r.skipped.length ? h('ul', { class: 'muted small' }, ...r.skipped.map((s) => h('li', {}, 'Not checked: ', s))) : null,
      h('div', { class: 'row' }, copy, dl),
    ),
  );

  if (r.base.items.length || r.base.gameVersion)
    out.append(
      h(
        'section',
        { class: 'panel' },
        h('h3', {}, 'Base setup'),
        h(
          'ul',
          { class: 'base' },
          ...r.base.items.map((i) =>
            h('li', {}, h('span', { 'aria-hidden': 'true' }, SEVERITY_ICON[i.status] + ' '), h('strong', {}, i.label), i.version ? ` ${i.version}` : '', i.detail ? h('span', { class: 'muted' }, ` · ${i.detail}`) : null),
          ),
          r.base.gameVersion ? h('li', {}, '🎮 ', h('strong', {}, 'Game version '), r.base.gameVersion, h('span', { class: 'muted' }, ' (from the ARCropolis cache)')) : null,
        ),
      ),
    );

  if (r.findings.length) out.append(h('section', { class: 'panel' }, h('h3', {}, 'Findings'), h('ul', { class: 'findings' }, ...r.findings.map(findingEl))));

  const m = r.matrix;
  if (m.versions.some((v) => v.works.length + v.breaks.length + v.unsure.length))
    out.append(
      h(
        'section',
        { class: 'panel' },
        h('h3', {}, 'Which Smashline should you run?'),
        h(
          'div',
          { class: 'matrix' },
          ...m.versions.map((v) =>
            h(
              'div',
              { class: `col ${m.recommend === v.version ? 'best' : ''}` },
              h('h4', {}, `Smashline ${v.version}`, m.recommend === v.version ? ' ⭐' : ''),
              h('p', {}, `✅ ${v.works.length} work`),
              v.breaks.length ? h('p', {}, `❌ ${v.breaks.length} break: ${v.breaks.join(', ')}`) : null,
              v.unsure.length ? h('p', {}, `❔ ${v.unsure.length} unclear: ${v.unsure.join(', ')}`) : null,
            ),
          ),
        ),
        h('p', {}, m.reason),
        h(
          'p',
          { class: 'small muted' },
          'Movesets that call clone_weapon are checked by reading how their code calls it (its arguments changed in 2.0 without a rename). Tap a verdict in the table to see why. "Unclear" ones couldn\u2019t be settled: link their GameBanana page below to use the update date as a hint.',
        ),
      ),
    );

  const table = h(
    'table',
    {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Mod'), h('th', {}, 'Fighter / slots'), h('th', {}, 'Smashline'), h('th', {}, 'Status'), h('th', {}, 'Issues'))),
    h(
      'tbody',
      {},
      ...r.mods.map((mod) =>
        h(
          'tr',
          { class: mod.disabled ? 'disabled' : undefined },
          h('td', { 'data-label': 'Mod' }, mod.name, mod.disabled ? h('span', { class: 'muted' }, ' (disabled)') : null),
          h('td', { 'data-label': 'Slots' }, mod.slots || '–'),
          h(
            'td',
            { 'data-label': 'Smashline' },
            mod.moveset
              ? h(
                  'details',
                  { class: 'why' },
                  h('summary', {}, NEEDS_LABEL[mod.moveset.needs] ?? mod.moveset.needs, ['1.6.8', '2.0.0', 'either', 'unreleased'].includes(mod.moveset.needs) ? badge(mod.moveset.needsConfidence, `conf-${mod.moveset.needsConfidence}`) : null),
                  h('span', { class: 'small muted' }, mod.moveset.needsReason),
                )
              : '–',
          ),
          h('td', { 'data-label': 'Status' }, SEVERITY_ICON[mod.status]),
          h('td', { 'data-label': 'Issues' }, mod.issues.map((i) => i.title).join('; ') || '–'),
        ),
      ),
    ),
  );
  out.append(h('section', { class: 'panel' }, h('h3', {}, `Mods (${r.mods.length})`), h('div', { class: 'table-wrap' }, table)));

  if (r.crashes.length) {
    const counts = new Map<string, number>();
    for (const c of r.crashes) counts.set(c.best.title, (counts.get(c.best.title) ?? 0) + 1);
    out.append(
      h(
        'section',
        { class: 'panel' },
        h('h3', {}, `Crash reports on the card (${r.crashes.length})`),
        h('ul', {}, ...[...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => h('li', {}, `${n} × ${t}`))),
        h('p', { class: 'small muted' }, 'Open the Crash Explainer and drop atmosphere/crash_reports for the full explanation of each.'),
      ),
    );
  }

  out.append(gameBananaPanel(r.mods.filter((x) => !x.disabled).map((x) => x.name), rerun, new Set(r.base.items.filter((i) => i.status !== "error" && i.product).map((i) => i.product!))));
}

export function renderScanner(root: HTMLElement) {
  const status = h('p', { class: 'status', 'aria-live': 'polite' });
  const out = h('div', { class: 'results' });
  let lastSource: FileSource | undefined;

  const run = async (source: FileSource) => {
    lastSource = source;
    status.textContent = 'Scanning…';
    try {
      const links = loadLinks();
      const lastUpdated: Record<string, Date> = {};
      for (const [mod, l] of Object.entries(links)) if (l.updated) lastUpdated[mod] = new Date(l.updated);
      const r = await scan(source, { lastUpdated, onProgress: (s) => (status.textContent = s + '…') });
      status.textContent = `Scanned ${r.source === 'csv' ? 'CSV listing' : 'folder'} at ${new Date().toLocaleTimeString()}.`;
      renderReport(out, r, () => lastSource && run(lastSource));
    } catch (e) {
      status.textContent = `Scan failed: ${(e as Error).message}`;
    }
  };

  const pick = h('button', { type: 'button', disabled: !hasDirectoryPicker() }, '📂 Choose SD card folder');
  pick.addEventListener('click', async () => {
    try {
      status.textContent = 'Reading folder…';
      const src = await pickFolder((n, p) => (status.textContent = `Found ${n} files… ${p}`));
      await run(src);
    } catch (e) {
      status.textContent = (e as Error).name === 'AbortError' ? '' : `Couldn't read the folder: ${(e as Error).message}`;
    }
  });

  const csvInput = h('input', { type: 'file', accept: '.csv', id: 'csvfile', class: 'sr-only' });
  csvInput.addEventListener('change', async () => {
    const f = csvInput.files?.[0];
    if (!f) return;
    try {
      await run(csvSource(await f.text()));
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });

  const drop = h('div', { class: 'drop', tabindex: '0' }, h('strong', {}, 'Or drop your SD card folder (or ultimate/mods) here'), h('span', {}, 'Works in every desktop browser. Read-only: nothing on the card is changed.'));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    const csv = [...dt.files].find((f) => f.name.toLowerCase().endsWith('.csv'));
    if (csv) return run(csvSource(await csv.text()));
    status.textContent = 'Reading folder…';
    const src = await droppedFolderSource(dt, (n, p) => (status.textContent = `Found ${n} files… ${p}`));
    if (src) await run(src);
    else status.textContent = 'Drop one folder (the SD card root, ultimate, or mods) or a .csv listing.';
  });

  const cmd = h('pre', { class: 'cmd' }, POWERSHELL_LISTING_COMMAND);
  const copyCmd = h('button', { type: 'button', class: 'ghost small' }, 'Copy command');
  copyCmd.addEventListener('click', () => copyText(POWERSHELL_LISTING_COMMAND, copyCmd));

  root.append(
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Check your SD card'),
      h('p', {}, 'Finds broken mod folders, plugin version problems, costume slot clashes and Smashline mismatches. Put the Switch in Hekate’s USB mass-storage mode (more reliable than MTP), then pick the SD card.'),
    ),
    h('div', { class: 'row' }, pick, hasDirectoryPicker() ? null : h('span', { class: 'muted small' }, 'Folder picking needs Chrome or Edge. Use drag-and-drop or a CSV listing instead.')),
    drop,
    h(
      'details',
      { class: 'panel' },
      h('summary', {}, 'No folder access? Use a CSV listing (Windows PowerShell)'),
      h('p', {}, 'Run this in PowerShell (change D: to your SD card’s drive letter). It saves modfiles.csv to your Desktop. Then choose that file below.'),
      cmd,
      h('div', { class: 'row' }, copyCmd, h('label', { class: 'button ghost small', for: 'csvfile' }, 'Choose modfiles.csv'), csvInput),
      h('p', { class: 'small muted' }, 'A CSV only lists names and sizes, so it can’t check plugin versions or read moveset code. Folder mode can.'),
    ),
    status,
    out,
  );
}
