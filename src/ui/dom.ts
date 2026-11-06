// A tiny helper for building DOM nodes. Text always goes in via textContent,
// never innerHTML, so nothing from a log file can inject HTML into the page.
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const clear = (el: Element) => el.replaceChildren();

export async function copyText(text: string, button: HTMLButtonElement) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied ✓';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => (button.textContent = label), 1500);
}

export function download(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const badge = (text: string, cls: string) => h('span', { class: `badge ${cls}` }, text);

export const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Info', ok: 'OK' } as const;
export const SEVERITY_ICON = { error: '❌', warning: '⚠️', info: 'ℹ️', ok: '✅' } as const;
