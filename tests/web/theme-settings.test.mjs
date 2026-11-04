import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../support/load-component.mjs';

const themeModule = () => loadComponent('app/web/src/features/theme-settings/theme.ts');

test('theme preferences reject unknown or corrupt storage and tolerate blocked storage', async () => {
  const { readThemeSettings, saveThemeSettings, DEFAULT_SETTINGS } = await themeModule();
  for (const raw of [null, '{broken', 'null', '[]', '{"palette":"injected","accent":"red"}', '{"palette":"swiss","accent":"url(evil)"}']) {
    const settings = readThemeSettings({ getItem: () => raw });
    assert.deepEqual(settings, DEFAULT_SETTINGS);
  }
  assert.deepEqual(readThemeSettings({ getItem() { throw Error('denied'); } }), DEFAULT_SETTINGS);
  assert.equal(saveThemeSettings(DEFAULT_SETTINGS, { setItem() { throw Error('denied'); } }), false);
});

test('palette and accent persist independently and leave layout tokens untouched', async () => {
  const theme = await themeModule();
  const dom = new JSDOM('', { url: 'https://example.test' });
  try {
    const root = dom.window.document.documentElement;
    root.style.setProperty('--radius', '0');
    root.style.setProperty('--display', 'sans-serif');
    const settings = { palette: 'midnight', accent: 'red' };
    assert.equal(theme.saveThemeSettings(settings, dom.window.localStorage), true);
    assert.deepEqual(theme.readThemeSettings(dom.window.localStorage), settings);
    theme.applyThemeSettings(settings, root);
    assert.equal(root.style.getPropertyValue('--paper'), '#101923');
    assert.equal(root.style.getPropertyValue('--accent'), '#f08b86');
    assert.equal(root.style.getPropertyValue('--on-accent'), '#161616');
    assert.equal(root.style.getPropertyValue('--syntax-paper'), '#f1f1ee');
    assert.equal(root.style.getPropertyValue('--syntax-ink'), '#161616');
    assert.equal(root.style.getPropertyValue('--radius'), '0');
    assert.equal(root.style.getPropertyValue('--display'), 'sans-serif');
    theme.applyThemeSettings(theme.DEFAULT_SETTINGS, root);
    assert.equal(root.style.getPropertyValue('--paper'), '#ffffff');
    assert.equal(root.style.getPropertyValue('--accent'), '#b82927');
  } finally { dom.window.close(); }
});

function luminance(hex) {
  const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function ratio(first, second) {
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (high + .05) / (low + .05);
}

test('all offered palette/accent combinations retain readable text and buttons', async () => {
  const theme = await themeModule();
  const dom = new JSDOM('');
  try {
    const root = dom.window.document.documentElement;
    for (const palette of theme.palettes) {
      for (const accent of ['palette', ...theme.accents.map(value => value.id)]) {
        theme.applyThemeSettings({ palette: palette.id, accent }, root);
        const value = name => root.style.getPropertyValue(name);
        for (const [foreground, background] of [['--ink','--paper'], ['--muted','--paper'], ['--accent','--paper'], ['--on-accent','--accent'], ['--syntax-ink','--syntax-paper']]) {
          const contrast = ratio(value(foreground), value(background));
          assert.ok(contrast >= 4.5, `${palette.id}/${accent} ${foreground}/${background}: ${contrast.toFixed(2)}`);
        }
      }
    }
  } finally { dom.window.close(); }
});

test('shared trigger opens a native dialog, applies colors, reopens and resets without rerendering its parent', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test', pretendToBeVisual: true });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let root;
  let requests = 0;
  const originalFetch = globalThis.fetch;
  try {
    for (const name of globals) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] });
    globalThis.fetch = async () => { requests++; throw Error('Settings must not request content'); };
    let modalOpener;
    dom.window.HTMLDialogElement.prototype.showModal = function () { modalOpener = document.activeElement; this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; modalOpener?.focus(); };
    const { default: React, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { default: SettingsButton } = await loadComponent('app/web/src/features/theme-settings/SettingsButton.tsx');
    let renders = 0;
    function Parent() { renders++; return React.createElement(SettingsButton); }
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(Parent)));
    const trigger = document.querySelector('button');
    assert.equal(trigger.textContent.trim(), '');
    assert.equal(trigger.getAttribute('aria-label'), '설정');
    assert.ok(trigger.firstElementChild?.tagName.toLowerCase() === 'svg', 'Icon must remain visible');
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('dialog');
    assert.ok(dialog?.open === true, 'Settings uses showModal');
    const palette = document.querySelector('select');
    await act(async () => { palette.value = 'midnight'; palette.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const red = document.querySelector('input[value="red"]');
    await act(async () => red.click());
    assert.equal(document.documentElement.style.getPropertyValue('--paper'), '#101923');
    assert.equal(document.documentElement.style.getPropertyValue('--accent'), '#f08b86');
    assert.equal(renders, 1);
    assert.equal(requests, 0);
    await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
    assert.ok(document.querySelector('dialog') === null, 'Escape unmounts the modal');
    assert.ok(document.activeElement === trigger, 'Close restores opener focus');
    await act(async () => trigger.click());
    assert.equal(document.querySelector('select').value, 'midnight');
    assert.ok(document.querySelector('input[value="red"]').checked === true);
    const reset = [...document.querySelectorAll('button')].find(button => button.textContent === '기본값으로');
    await act(async () => reset.click());
    assert.equal(document.documentElement.style.getPropertyValue('--accent'), '#b82927');
    assert.equal(document.querySelector('select').value, 'swiss');
    assert.ok(document.querySelector('input[value="palette"]').checked === true);

    const originalSetItem = dom.window.Storage.prototype.setItem;
    try {
      dom.window.Storage.prototype.setItem = () => { throw Error('quota'); };
      const paletteAfterReset = document.querySelector('select');
      await act(async () => {
        paletteAfterReset.value = 'midnight';
        paletteAfterReset.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
      assert.ok(document.querySelector('[role="status"]') !== null, 'Failed persistence must be visible');
      await act(async () => document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
      await act(async () => trigger.click());
      assert.equal(document.querySelector('select').value, 'midnight', 'Reopening must reflect the active palette when storage is stale');
      assert.ok(document.querySelector('[role="status"]') !== null, 'Persistence failure must remain visible after reopening');
    } finally {
      dom.window.Storage.prototype.setItem = originalSetItem;
    }
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()); }
    globalThis.fetch = originalFetch;
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});


test('settings icon follows logout in the shared site header', async () => {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: SiteHeader } = await loadComponent('app/web/src/components/layout/SiteHeader.tsx');
  const markup = renderToStaticMarkup(React.createElement(SiteHeader, {
    onWrite() {}, management: { session: { state: 'ready' }, logout() {} },
  }));
  const dom = new JSDOM(markup);
  try {
    const settings = dom.window.document.querySelector('.header-actions .settings-trigger');
    assert.ok(settings !== null, 'Shared settings button must be present');
    assert.equal(settings.previousElementSibling?.textContent.trim(), '로그아웃');
    assert.ok(settings.nextElementSibling === null, 'Settings must be the last header action');
  } finally { dom.window.close(); }
});
