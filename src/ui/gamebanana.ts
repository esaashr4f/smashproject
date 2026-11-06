// Per-mod GameBanana info. The user links each mod folder to its GameBanana
// page once (we suggest matches by name); links are remembered in localStorage.
import { fetchMod, milestoneFlags, parseModId, problemReports, requirementProduct, searchMods } from '../core/gamebanana';
import { h } from './dom';

const KEY = 'smd.gamebanana.links';
export interface Link {
  id: number;
  name?: string;
  updated?: string;
}

export function loadLinks(): Record<string, Link> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Link>;
  } catch {
    return {};
  }
}
function saveLink(mod: string, link: Link | null) {
  const all = loadLinks();
  if (link) all[mod] = link;
  else delete all[mod];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode: links just won't persist */
  }
}

const fmt = (d?: Date) => (d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'unknown');

function modRow(mod: string, installed: Set<string>, onChange: () => void): HTMLElement {
  const row = h('li', { class: 'gb-row' });
  const draw = async () => {
    row.replaceChildren(h('strong', {}, mod));
    const link = loadLinks()[mod];
    if (!link) {
      const input = h('input', { type: 'url', placeholder: 'Paste GameBanana link', 'aria-label': `GameBanana link for ${mod}` });
      const save = h('button', { type: 'button', class: 'ghost small' }, 'Link');
      const suggest = h('button', { type: 'button', class: 'ghost small' }, 'Find by name');
      const out = h('div', { class: 'small' });
      save.addEventListener('click', () => {
        const id = parseModId(input.value);
        if (id) {
          saveLink(mod, { id });
          draw();
        }
      });
      suggest.addEventListener('click', async () => {
        out.textContent = 'Searching…';
        try {
          const res = await searchMods(mod.replace(/[{}\[\]_]/g, ' '));
          out.replaceChildren(
            res.length ? 'Is it one of these? (a guess; please check) ' : 'No matches.',
            ...res.map((r) => {
              const b = h('button', { type: 'button', class: 'link small' }, r.name);
              b.addEventListener('click', () => {
                saveLink(mod, { id: r.id });
                draw();
              });
              return b;
            }),
          );
        } catch (e) {
          out.textContent = `Search failed: ${(e as Error).message}`;
        }
      });
      row.append(h('div', { class: 'row' }, input, save, suggest), out);
      return;
    }
    row.append(h('span', { class: 'muted small' }, ' loading…'));
    try {
      const [m, reports] = await Promise.all([fetchMod(link.id), problemReports(link.id).catch(() => [])]);
      const firstTime = !link.updated;
      saveLink(mod, { id: link.id, name: m.name, updated: m.updated?.toISOString() });
      const flags = milestoneFlags(m.updated);
      const missing = m.requirements.map((r) => ({ r, p: requirementProduct(r.name) })).filter((x) => x.p && installed.size && !installed.has(x.p));
      const unlink = h('button', { type: 'button', class: 'link small' }, 'unlink');
      unlink.addEventListener('click', () => {
        saveLink(mod, null);
        draw();
        onChange();
      });
      row.replaceChildren(
        h(
        'div',
        {},
        h('strong', {}, mod),
        ' → ',
        h('a', { href: m.url, target: '_blank', rel: 'noopener' }, m.name),
        m.version ? h('span', { class: 'muted' }, ` v${m.version}`) : null,
        ' ',
        unlink,
        h('div', { class: 'small' }, 'Last updated: ', fmt(m.updated), ...flags.map((f) => h('span', { class: 'badge conf-possible', title: f.means }, f.label))),
        m.requirements.length ? h('div', { class: 'small' }, 'Requires: ', m.requirements.map((r) => r.name).join(', ')) : null,
        missing.length ? h('div', { class: 'small sev-text-error' }, '❌ Not installed: ', missing.map((x) => x.r.name).join(', ')) : null,
        m.files[0]?.description ? h('div', { class: 'small muted' }, `Latest file: ${m.files[0].name}: ${m.files[0].description}`) : null,
        reports.length
          ? h(
              'details',
              { class: 'small' },
              h('summary', {}, `💬 ${reports.length} recent comment${reports.length > 1 ? 's' : ''} mention problems (unverified)`),
              h('ul', {}, ...reports.map((p) => h('li', {}, `${fmt(p.added)}: ${p.text.slice(0, 300)}`))),
            )
          : null,
      ));
      if (firstTime && m.updated) onChange(); // re-run scan so the date feeds the Smashline verdict
    } catch (e) {
      row.append(h('span', { class: 'small' }, ` Couldn't load: ${(e as Error).message}`));
    }
  };
  draw();
  return row;
}

export function gameBananaPanel(mods: string[], rerun: () => void, installed: Set<string> = new Set()): HTMLElement {
  const list = h('ul', { class: 'gb-list' });
  const body = h('div', {}, h('p', { class: 'small muted' }, 'Link each mod to its GameBanana page once to see when it was last updated, what it requires and recent problem reports. Links are saved in this browser only. Requests go straight from your browser to GameBanana.'), list);
  let loaded = false;
  const panel = h('details', { class: 'panel' }, h('summary', {}, 'GameBanana info per mod'), body);
  panel.addEventListener('toggle', () => {
    if (!loaded && (panel as HTMLDetailsElement).open) {
      loaded = true;
      for (const m of mods) list.append(modRow(m, installed, rerun));
    }
  });
  // Already linked some mods before? Open it straight away (this fires 'toggle').
  if (Object.keys(loadLinks()).some((k) => mods.includes(k))) (panel as HTMLDetailsElement).open = true;
  return panel;
}
