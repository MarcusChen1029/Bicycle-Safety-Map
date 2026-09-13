/**
 * UI language (zh / en). Browser global + Node-requirable.
 * Static markup: data-i18n (text), data-i18n-html, data-i18n-placeholder,
 * data-i18n-title, data-i18n-aria-label (+ optional data-i18n-params JSON).
 * Dynamic text: I18N.setText(el, key, params) so a later switch re-translates it.
 * Google Maps stays zh-TW; only our own UI text lives here.
 */
const I18N = (() => {
  const STORAGE_KEY = 'bike_map_lang';
  const LANGS = ['zh', 'en'];
  const HTML_LANG = { zh: 'zh-Hant', en: 'en' };

  const STRINGS = {
    zh: {
      // Language toggle — the label names the language you switch TO
      'lang.toggle': 'EN',
      'lang.toggleAria': '切換為英文',
    },
    en: {
      // Language toggle — the label names the language you switch TO
      'lang.toggle': '中文',
      'lang.toggleAria': 'Switch to Chinese',
    }
  };

  const ATTR_WRITERS = [
    ['data-i18n', (el, s) => { el.textContent = s; }],
    ['data-i18n-html', (el, s) => { el.innerHTML = s; }],
    ['data-i18n-placeholder', (el, s) => { el.placeholder = s; }],
    ['data-i18n-title', (el, s) => { el.title = s; }],
    ['data-i18n-aria-label', (el, s) => { el.setAttribute('aria-label', s); }]
  ];

  let lang = 'zh';
  const warned = new Set();

  function t(key, params) {
    let s = STRINGS[lang][key];
    if (s === undefined) s = STRINGS.zh[key];
    if (s === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`i18n: missing string "${key}"`);
      }
      return key;
    }
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }
    return s;
  }

  function getLang() {
    return lang;
  }

  function paramsOf(el) {
    const raw = el.getAttribute('data-i18n-params');
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }

  function apply(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const [attr, write] of ATTR_WRITERS) {
      root.querySelectorAll(`[${attr}]`).forEach(el => write(el, t(el.getAttribute(attr), paramsOf(el))));
    }
  }

  function setText(el, key, params) {
    if (!el) return;
    el.setAttribute('data-i18n', key);
    if (params) {
      el.setAttribute('data-i18n-params', JSON.stringify(params));
    } else {
      el.removeAttribute('data-i18n-params');
    }
    el.textContent = t(key, params);
  }

  function syncDocument() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = HTML_LANG[lang];
    apply(document);
  }

  function setLang(next) {
    if (!LANGS.includes(next)) return false;
    lang = next;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      // Storage blocked (private mode etc.): still switch for this page view.
    }
    syncDocument();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: next } }));
    }
    return true;
  }

  function init() {
    let saved = null;
    try {
      if (typeof localStorage !== 'undefined') saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      saved = null;
    }
    lang = LANGS.includes(saved) ? saved : 'zh';
    if (typeof document === 'undefined') return;

    // Translate what is already parsed right away, then again once the rest
    // of the page (elements after this script tag) exists.
    syncDocument();
    const ready = () => {
      syncDocument();
      const toggleBtn = document.getElementById('lang-toggle-btn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      ready();
    }
  }

  init();

  return { STRINGS, LANGS, t, getLang, setLang, apply, setText };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { I18N };
}
