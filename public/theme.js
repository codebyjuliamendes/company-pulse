'use strict';

// Loaded without defer in <head>: applies the theme before first paint (CSP forbids inline scripts).
(() => {
  const KEY = 'company-pulse.theme';
  const MODES = ['auto', 'dark', 'light'];
  const LABELS = { auto: 'Theme: follow system', dark: 'Theme: dark', light: 'Theme: light' };
  // Static, trusted SVG markup (Unicode glyphs vary between fonts).
  const ICONS = {
    auto: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    light:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  };
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const read = () => {
    try {
      const stored = localStorage.getItem(KEY);
      return MODES.includes(stored) ? stored : 'auto';
    } catch {
      return 'auto';
    }
  };

  function apply(mode) {
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = mode;
    const dark = mode === 'dark' || (mode === 'auto' && media.matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1519' : '#f3f5f6');
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.innerHTML = ICONS[mode];
      button.setAttribute('aria-label', `${LABELS[mode]} (change)`);
      button.title = LABELS[mode];
    }
  }

  let mode = read();
  apply(mode);
  media.addEventListener('change', () => apply(mode));
  document.addEventListener('DOMContentLoaded', () => {
    apply(mode);
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        /* preference lasts for this page only */
      }
      apply(mode);
    });
  });
})();
