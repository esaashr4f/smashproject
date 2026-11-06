// Crash Log Explainer page.
import { parseCrashLog } from '../core/crashlog/parse';
import { explain, moduleDisplay } from '../core/crashlog/match';
import { explanationMarkdown } from '../core/report';
import type { Explanation } from '../core/types';
import { badge, clear, copyText, h, SEVERITY_ICON, SEVERITY_LABEL } from './dom';
import { droppedFiles } from './folder';

const REPO = 'https://github.com/esaashr4f/smashproject';
interface Item {
  x: Explanation;
  text: string;
}

const KEY_LINE = /^\s*(Result|Process Name|Program ID|Type|Address|Break Reason|LR|PC|ReturnAddress\[\d+\]):/;

/** The handful of log lines that the diagnosis is based on. */
function keyLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^Module Info:/.test(line)) break;
    if (KEY_LINE.test(line) && !/:\s+0{16}\s*$/.test(line)) out.push(line.trimEnd());
  }
  return out.slice(0, 30);
}

function highlight(line: string, evidence: string[]): HTMLElement {
  // A line is "hot" if an evidence line mentions its annotation, e.g. "Skyline + 0x4c58".
  const annos = [...line.matchAll(/\(([^()]+ \+ 0x[0-9a-f]+)\)/gi)].map((m) => m[1]!);
  const hot = annos.some((a) => evidence.some((e) => e.includes(a))) || /^\s*(Result|Type):/.test(line);
  return h('div', { class: hot ? 'hot' : undefined }, line);
}

function localTime(d: Date) {
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function feedbackUrl(x: Explanation, right: boolean) {
  const title = `${right ? 'Correct' : 'Wrong'} diagnosis: ${x.best.ruleId}`;
  const body = `**Was the diagnosis right?** ${right ? 'Yes' : 'No'}\n\n${right ? '' : 'What actually caused it:\n\n'}<details><summary>Report</summary>\n\n${explanationMarkdown(x)}\n\n</details>\n\nPlease attach the .log file if you're happy to share it (crash logs contain no personal data beyond what's shown above).`;
  return `${REPO}/issues/new?labels=diagnosis-feedback&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function card({ x, text }: Item, open: boolean): HTMLElement {
  const d = x.best;
  const l = x.log;
  const meta: (string | HTMLElement)[] = [];
  if (l.isCrashReport) {
    if (l.timestamp) meta.push(h('span', {}, '🕑 ', localTime(l.timestamp)));
    meta.push(h('span', {}, 'Game version: ', l.gameVersion ?? 'not in this log'));
    if (l.programId) meta.push(h('span', {}, l.programId === '01006a800016e000' ? 'Smash Ultimate' : l.processName ?? l.programId));
  }
  const copy = h('button', { type: 'button', class: 'ghost small' }, 'Copy as text');
  copy.addEventListener('click', () => copyText(explanationMarkdown(x), copy));

  return h(
    'details',
    { class: `card sev-${d.severity}`, open },
    h(
      'summary',
      {},
      h('span', { class: 'sev-icon', 'aria-hidden': 'true' }, SEVERITY_ICON[d.severity]),
      h('span', { class: 'card-title' }, d.title),
      h('span', { class: 'sr-only' }, ` (${SEVERITY_LABEL[d.severity]})`),
      badge(d.confidence, `conf-${d.confidence}`),
      h('span', { class: 'file' }, l.fileName ?? 'pasted text'),
    ),
    h('div', { class: 'meta' }, ...meta),
    h('p', { class: 'summary' }, d.summary),
    h('h4', {}, 'How to fix it'),
    h('ol', { class: 'fix' }, ...d.fix.map((f) => h('li', {}, f))),
    d.learnMore ? h('p', {}, h('a', { href: d.learnMore, rel: 'noopener', target: '_blank' }, 'Learn more ↗')) : null,
    x.loadedPlugins.length ? h('p', { class: 'plugins' }, h('strong', {}, 'Loaded when it crashed: '), x.loadedPlugins.map(moduleDisplay).join(' · ')) : null,
    x.alsoPossible.length
      ? h('p', { class: 'also' }, h('strong', {}, 'Also possible: '), x.alsoPossible.map((a) => `${a.title} (${a.confidence})`).join('; '))
      : null,
    h(
      'details',
      { class: 'evidence' },
      h('summary', {}, 'Why we think this (evidence)'),
      h('ul', {}, ...d.evidence.map((e) => h('li', {}, h('code', {}, e)))),
      l.isCrashReport ? h('pre', { class: 'log' }, ...keyLines(text).map((line) => highlight(line, d.evidence))) : null,
      l.isCrashReport && l.dumpStrings.length
        ? h('p', { class: 'small muted' }, 'Text found in memory dumps: ', l.dumpStrings.slice(0, 12).join(' · '))
        : null,
    ),
    h(
      'div',
      { class: 'actions' },
      copy,
      h('span', { class: 'muted small' }, 'Was this right? '),
      h('a', { class: 'small', href: feedbackUrl(x, true), target: '_blank', rel: 'noopener' }, '👍 Yes'),
      h('a', { class: 'small', href: feedbackUrl(x, false), target: '_blank', rel: 'noopener' }, '👎 No, tell us'),
    ),
  );
}

function timeline(items: Item[]): HTMLElement {
  const groups = new Map<string, { title: string; sev: string; items: Item[] }>();
  for (const it of items) {
    const g = groups.get(it.x.best.ruleId) ?? { title: it.x.best.title, sev: it.x.best.severity, items: [] };
    g.items.push(it);
    groups.set(it.x.best.ruleId, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  const crashCount = items.filter((i) => i.x.log.isCrashReport).length;
  const times = items.map((i) => (i.x.log.isCrashReport ? i.x.log.timestamp : undefined)).filter((t): t is Date => !!t);
  const span =
    times.length > 1
      ? ` between ${localTime(new Date(Math.min(...times.map(Number))))} and ${localTime(new Date(Math.max(...times.map(Number))))}`
      : '';
  return h(
    'section',
    { class: 'panel' },
    h('h3', {}, `${crashCount} crash${crashCount === 1 ? '' : 'es'}${span}`),
    h('ul', { class: 'groups' }, ...sorted.map((g) => h('li', { class: `sev-${g.sev}` }, h('strong', {}, `${g.items.length} × `), g.title))),
    times.length > 1 ? timelineBar(items, times) : null,
  );
}

function timelineBar(items: Item[], times: Date[]): HTMLElement {
  const min = Math.min(...times.map(Number));
  const max = Math.max(...times.map(Number));
  const bar = h('div', { class: 'timeline', role: 'img', 'aria-label': 'Timeline of crashes' });
  for (const it of items) {
    if (!it.x.log.isCrashReport || !it.x.log.timestamp) continue;
    const left = max === min ? 50 : ((+it.x.log.timestamp - min) / (max - min)) * 100;
    bar.append(h('span', { class: `dot sev-${it.x.best.severity}`, style: `left:${left}%`, title: `${localTime(it.x.log.timestamp)}: ${it.x.best.title}` }));
  }
  return bar;
}

export function renderExplainer(root: HTMLElement) {
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const items: Item[] = [];

  const render = () => {
    clear(results);
    if (!items.length) return;
    // Newest first, non-crash files last
    items.sort((a, b) => {
      const ta = a.x.log.isCrashReport ? +(a.x.log.timestamp ?? 0) : -1;
      const tb = b.x.log.isCrashReport ? +(b.x.log.timestamp ?? 0) : -1;
      return tb - ta;
    });
    if (items.length > 1) results.append(timeline(items));
    const clearBtn = h('button', { type: 'button', class: 'ghost small' }, 'Clear');
    clearBtn.addEventListener('click', () => {
      items.length = 0;
      render();
    });
    results.append(h('div', { class: 'row' }, clearBtn));
    items.forEach((it, i) => results.append(card(it, i < 3 || items.length < 6)));
  };

  const add = (text: string, name?: string) => items.push({ x: explain(parseCrashLog(text, name)), text });
  const addFiles = async (files: { path: string; file: File }[]) => {
    for (const { path, file } of files) add(await file.text(), path.split('/').pop());
    render();
  };

  const input = h('input', { type: 'file', accept: '.log,.txt', multiple: true, id: 'logfiles', class: 'sr-only' });
  input.addEventListener('change', () => addFiles([...(input.files ?? [])].map((f) => ({ path: f.name, file: f }))));
  const drop = h(
    'label',
    { class: 'drop', for: 'logfiles', tabindex: '0' },
    h('strong', {}, 'Drop crash logs here'),
    h('span', {}, 'or tap to choose files. You can drop the whole atmosphere/crash_reports folder.'),
    input,
  );
  drop.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const dt = (e as DragEvent).dataTransfer;
    if (dt) await addFiles(await droppedFiles(dt, (p) => /\.(log|txt)$/i.test(p)));
  });

  const ta = h('textarea', { rows: '6', placeholder: 'Or paste the contents of a crash log here…', 'aria-label': 'Paste crash log text' });
  const go = h('button', { type: 'button' }, 'Explain pasted log');
  go.addEventListener('click', () => {
    if (!ta.value.trim()) return;
    add(ta.value);
    ta.value = '';
    render();
  });

  root.append(
    h('section', { class: 'hero' }, h('h1', {}, 'Why did Smash crash?'), h('p', {}, 'Drop the crash report from ', h('code', {}, 'atmosphere/crash_reports/'), ' and get a plain-English answer and a fix. It all runs on your device; nothing is uploaded.')),
    drop,
    h('div', { class: 'paste' }, ta, go),
    results,
  );
}
