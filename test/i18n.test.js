const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { I18N } = require('../js/i18n.js');

const PARAM = /\{(\w+)\}/g;
const paramsOf = s => [...s.matchAll(PARAM)].map(m => m[1]).sort();

// Minimal stand-ins for DOM elements — enough for apply()/setText().
function fakeEl(attrs = {}) {
  return {
    attrs: { ...attrs },
    textContent: '',
    innerHTML: '',
    placeholder: '',
    title: '',
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; }
  };
}
function fakeRoot(els) {
  return { querySelectorAll: sel => els.filter(el => sel.slice(1, -1) in el.attrs) };
}

afterEach(() => I18N.setLang('zh'));

test('defaults to zh when no stored preference', () => {
  assert.strictEqual(I18N.getLang(), 'zh');
});

test('t returns the current language string', () => {
  assert.strictEqual(I18N.t('lang.toggle'), 'EN');
  I18N.setLang('en');
  assert.strictEqual(I18N.t('lang.toggle'), '中文');
});

test('t substitutes {params} and leaves unknown params untouched', () => {
  I18N.STRINGS.zh['test.param'] = '共 {count} 條,{missing}';
  I18N.STRINGS.en['test.param'] = '{count} total, {missing}';
  try {
    assert.strictEqual(I18N.t('test.param', { count: 3 }), '共 3 條,{missing}');
    I18N.setLang('en');
    assert.strictEqual(I18N.t('test.param', { count: 0 }), '0 total, {missing}');
  } finally {
    delete I18N.STRINGS.zh['test.param'];
    delete I18N.STRINGS.en['test.param'];
  }
});

test('missing en string falls back to zh; missing everywhere returns the key', () => {
  I18N.STRINGS.zh['test.onlyZh'] = '只有中文';
  try {
    I18N.setLang('en');
    assert.strictEqual(I18N.t('test.onlyZh'), '只有中文');
    assert.strictEqual(I18N.t('test.nowhere'), 'test.nowhere');
  } finally {
    delete I18N.STRINGS.zh['test.onlyZh'];
  }
});

test('setLang rejects unsupported languages', () => {
  assert.strictEqual(I18N.setLang('fr'), false);
  assert.strictEqual(I18N.getLang(), 'zh');
  assert.strictEqual(I18N.setLang('en'), true);
  assert.strictEqual(I18N.getLang(), 'en');
});

test('apply writes text, html, placeholder, title and aria-label from attributes', () => {
  const text = fakeEl({ 'data-i18n': 'lang.toggle' });
  const html = fakeEl({ 'data-i18n-html': 'lang.toggle' });
  const input = fakeEl({ 'data-i18n-placeholder': 'lang.toggleAria' });
  const btn = fakeEl({ 'data-i18n-title': 'lang.toggleAria', 'data-i18n-aria-label': 'lang.toggleAria' });
  I18N.setLang('en');
  I18N.apply(fakeRoot([text, html, input, btn]));
  assert.strictEqual(text.textContent, '中文');
  assert.strictEqual(html.innerHTML, '中文');
  assert.strictEqual(input.placeholder, 'Switch to Chinese');
  assert.strictEqual(btn.title, 'Switch to Chinese');
  assert.strictEqual(btn.attrs['aria-label'], 'Switch to Chinese');
});

test('setText remembers key and params so apply re-translates after a switch', () => {
  I18N.STRINGS.zh['test.count'] = '共 {n} 條';
  I18N.STRINGS.en['test.count'] = '{n} total';
  try {
    const el = fakeEl();
    I18N.setText(el, 'test.count', { n: 4 });
    assert.strictEqual(el.textContent, '共 4 條');
    I18N.setLang('en');
    I18N.apply(fakeRoot([el]));
    assert.strictEqual(el.textContent, '4 total');

    I18N.setText(el, 'lang.toggle');
    assert.strictEqual(el.getAttribute('data-i18n-params'), null);
  } finally {
    delete I18N.STRINGS.zh['test.count'];
    delete I18N.STRINGS.en['test.count'];
  }
});

test('zh and en dictionaries have exactly the same keys', () => {
  const zh = Object.keys(I18N.STRINGS.zh).sort();
  const en = Object.keys(I18N.STRINGS.en).sort();
  assert.deepStrictEqual(zh.filter(k => !en.includes(k)), [], 'keys missing in en');
  assert.deepStrictEqual(en.filter(k => !zh.includes(k)), [], 'keys missing in zh');
});

test('every string is non-empty and uses the same {params} in both languages', () => {
  for (const key of Object.keys(I18N.STRINGS.zh)) {
    const zh = I18N.STRINGS.zh[key];
    const en = I18N.STRINGS.en[key];
    assert.ok(zh && zh.trim(), `zh "${key}" is empty`);
    assert.ok(en && en.trim(), `en "${key}" is empty`);
    assert.deepStrictEqual(paramsOf(en), paramsOf(zh), `params differ for "${key}"`);
  }
});
