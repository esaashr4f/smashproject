// Entry point: a tiny hash router (#/explain, #/scan, #/about). Hash routing
// works on any static host with no server config.
import './style.css';
import { renderExplainer } from './explainer';
import { renderScanner } from './scanner';
import { renderAbout } from './about';

const main = document.getElementById('main')!;
const routes: Record<string, (el: HTMLElement) => void> = { explain: renderExplainer, scan: renderScanner, about: renderAbout };
const pages = new Map<string, HTMLElement>(); // keep each page alive so results survive tab switches

function route() {
  const name = location.hash.replace(/^#\/?/, '') || 'explain';
  const key = routes[name] ? name : 'explain';
  let page = pages.get(key);
  if (!page) {
    page = document.createElement('div');
    routes[key]!(page);
    pages.set(key, page);
  }
  main.replaceChildren(page);
  document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset['route'] === key));
  document.title = `${{ explain: 'Crash Explainer', scan: 'SD Card Scanner', about: 'About' }[key]} · Smash Mod Doctor`;
}
window.addEventListener('hashchange', route);
route();

// Theme: follow the system by default; the button cycles light/dark and is remembered.
const btn = document.getElementById('theme')!;
const apply = (t: string | null) => (t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme'));
try {
  apply(localStorage.getItem('smd.theme'));
} catch {
  /* storage blocked */
}
btn.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  apply(next);
  try {
    localStorage.setItem('smd.theme', next);
  } catch {
    /* ignore */
  }
});
