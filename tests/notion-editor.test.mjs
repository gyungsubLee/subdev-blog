import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});

for (const name of [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'HTMLDivElement', 'HTMLParagraphElement', 'HTMLInputElement',
  'MutationObserver', 'DOMParser', 'DOMRect', 'KeyboardEvent',
]) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
Object.defineProperty(navigator, 'platform', { value: process.env.NOTION_TEST_PLATFORM || 'MacIntel' });
const modKey = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true };
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const domErrors = [];
dom.window.addEventListener('error', (event) => {
  event.preventDefault();
  domErrors.push(event.error);
});

const { BlockNoteEditor } = await import('@blocknote/core');
const { notionExtension } = await import('../src/features/post-editor/notion-extension.ts');

function createEditor(t, initialContent = [{ type: 'paragraph' }], schema) {
  const editor = BlockNoteEditor.create({
    initialContent,
    ...(schema ? { schema } : {}),
    extensions: [notionExtension],
  });
  const container = document.createElement('div');
  document.body.append(container);
  editor.mount(container);
  editor.setTextCursorPosition(editor.document[0], 'end');
  t.after(() => {
    editor.unmount();
    editor._tiptapEditor.destroy();
    container.remove();
  });
  return editor;
}

function typeText(editor, text) {
  const view = editor.prosemirrorView;
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

function key(editor, key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  editor.prosemirrorView.dom.dispatchEvent(event);
  if (domErrors.length) throw domErrors.shift();
  return event;
}

test('Notion input rules change real BlockNote blocks and preserve the native rules', async (t) => {
  for (const [input, expectedType] of [
    ['> ', 'toggleListItem'],
    ['" ', 'quote'],
    ['[] ', 'checkListItem'],
    ['a. ', 'numberedListItem'],
    ['i. ', 'numberedListItem'],
    ['## ', 'heading'],
    ['- ', 'bulletListItem'],
    ['1. ', 'numberedListItem'],
    ['\`\`\`js ', 'codeBlock'],
  ]) {
    await t.test(JSON.stringify(input), (t) => {
      const editor = createEditor(t);
      typeText(editor, input);
      assert.equal(editor.document[0].type, expectedType);
      assert.deepEqual(editor.document[0].content, []);
    });
  }
});

test('Notion block shortcuts use Cmd+Option and Ctrl+Shift with the same digit contract', async (t) => {
  const expected = [
    'paragraph', 'heading', 'heading', 'heading', 'checkListItem',
    'bulletListItem', 'numberedListItem', 'toggleListItem', 'codeBlock',
  ];
  for (const modifiers of [{ metaKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }]) {
    for (const [digit, type] of expected.entries()) {
      await t.test(`${JSON.stringify(modifiers)} ${digit}`, (t) => {
        const editor = createEditor(t, [{ type: 'paragraph', content: 'kept' }]);
        const event = key(editor, String(digit), { keyCode: 48 + digit, ...modifiers });
        assert.equal(event.defaultPrevented, true);
        assert.equal(editor.document[0].type, type);
        assert.equal(editor.document[0].content.map((part) => part.text).join(''), 'kept');
        if (type === 'heading') assert.equal(editor.document[0].props.level, digit);
      });
    }
  }
});

test('Cmd/Ctrl+E applies inline code and preserves text', (t) => {
  const editor = createEditor(t, [{ type: 'paragraph', content: 'code' }]);
  editor.setTextCursorPosition(editor.document[0], 'start');
  const from = editor.prosemirrorState.selection.from;
  editor._tiptapEditor.commands.setTextSelection({ from, to: from + 4 });
  const event = key(editor, 'e', { ...modKey, keyCode: 69 });
  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.document[0].content[0].text, 'code');
  assert.equal(editor.document[0].content[0].styles.code, true);
});

test('composition key events do not convert the current block', (t) => {
  const editor = createEditor(t, [{ type: 'paragraph', content: '한글' }]);
  key(editor, '8', { metaKey: true, altKey: true, keyCode: 229, isComposing: true });
  assert.equal(editor.document[0].type, 'paragraph');
  assert.equal(editor.document[0].content[0].text, '한글');
});

test('native code blocks keep Markdown markers as code text', (t) => {
  const editor = createEditor(t, [{ type: 'codeBlock' }]);
  typeText(editor, '> ');
  assert.equal(editor.document[0].type, 'codeBlock');
  assert.equal(editor.document[0].content[0].text.trimEnd(), '>');
});

test('native undo reverses a Notion input conversion', (t) => {
  const editor = createEditor(t);
  typeText(editor, '> ');
  assert.equal(editor.document[0].type, 'toggleListItem');
  key(editor, 'Backspace', { keyCode: 8 });
  assert.equal(editor.document[0].type, 'paragraph');
  assert.equal(editor.document[0].content[0].text.trimEnd(), '>');
});

test('Cmd/Ctrl+D duplicates a block and nested children with fresh IDs', (t) => {
  const editor = createEditor(t, [{
    id: 'original',
    type: 'toggleListItem',
    content: 'Parent',
    children: [{
      id: 'child',
      type: 'paragraph',
      content: [{ type: 'text', text: 'Nested', styles: { bold: true } }],
    }],
  }]);
  const original = structuredClone(editor.document[0]);
  key(editor, 'd', { ...modKey, keyCode: 68 });
  const [before, copy] = editor.document;
  assert.equal(copy.type, 'toggleListItem');
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.children[0].id, original.children[0].id);
  assert.deepEqual(copy.content, original.content);
  assert.deepEqual(copy.children[0].content, original.children[0].content);
  assert.deepEqual(before, original);
});

test('Cmd/Ctrl+D duplicates all selected blocks once', (t) => {
  const editor = createEditor(t, [
    { id: 'first', type: 'paragraph', content: 'First' },
    { id: 'second', type: 'paragraph', content: 'Second' },
  ]);
  editor.setSelection('first', 'second');
  key(editor, 'd', { ...modKey, keyCode: 68 });
  const ids = editor.document.map((block) => block.id);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(editor.document.map((block) => block.content[0].text), [
    'First', 'Second', 'First', 'Second',
  ]);
});

test('native Cmd/Ctrl+Shift+Arrow moves the current block', (t) => {
  const editor = createEditor(t, [
    { id: 'first', type: 'paragraph', content: 'First' },
    { id: 'second', type: 'paragraph', content: 'Second' },
  ]);
  editor.setTextCursorPosition('second', 'end');
  key(editor, 'ArrowUp', { ...modKey, shiftKey: true, keyCode: 38 });
  assert.deepEqual(editor.document.map((block) => block.id), ['second', 'first']);
});

test('custom code blocks retain language, caption and wrapping in JSON', async (t) => {
  const { editorSchema } = await import('../src/features/post-editor/code-block.ts');
  const editor = createEditor(t, [{
    type: 'codeBlock',
    props: { language: 'typescript', caption: 'A typed example', wrap: true },
    content: 'const count: number = 1;',
  }], editorSchema);
  const saved = JSON.parse(JSON.stringify(editor.document));
  const reloaded = createEditor(t, saved, editorSchema);
  assert.deepEqual(reloaded.document[0].props, editor.document[0].props);
  assert.equal(reloaded.document[0].content[0].text, 'const count: number = 1;');
  const markdown = editor.blocksToMarkdownLossy();
  assert.match(markdown, /typescript/);
  assert.match(markdown, /const count: number = 1;/);
  assert.match(markdown, /A typed example/);
});

test('Cmd+Option+0 turns code back into a paragraph without losing code text', (t) => {
  const editor = createEditor(t, [{ type: 'codeBlock', content: 'const answer = 42;' }]);
  key(editor, '0', { metaKey: true, altKey: true, keyCode: 48 });
  assert.equal(editor.document[0].type, 'paragraph');
  assert.equal(editor.document[0].content[0].text, 'const answer = 42;');
});

test('block conversion leaves image blocks intact', (t) => {
  const editor = createEditor(t, [{
    type: 'image', props: { url: 'https://example.com/photo.png' },
  }]);
  key(editor, '0', { metaKey: true, altKey: true, keyCode: 48 });
  assert.equal(editor.document[0].type, 'image');
  assert.equal(editor.document[0].props.url, 'https://example.com/photo.png');
});

test('Mac Option digit symbols still use the Notion shortcut mapping', (t) => {
  const editor = createEditor(t);
  key(editor, '¶', { metaKey: true, altKey: true, keyCode: 55 });
  assert.equal(editor.document[0].type, 'toggleListItem');
});

test('typing a code caption updates saved props before blur and keeps the focused input', async (t) => {
  const { editorSchema } = await import('../src/features/post-editor/code-block.ts');
  const editor = createEditor(t, [{
    type: 'codeBlock',
    props: { caption: 'Before', language: 'javascript' },
    content: 'console.log(1);',
  }], editorSchema);
  let changes = 0;
  const unsubscribe = editor.onChange(() => { changes += 1; });
  t.after(unsubscribe);
  const caption = editor.prosemirrorView.dom.querySelector('.notion-code-caption');
  caption.focus();
  caption.value = '한글 caption';
  caption.setSelectionRange(2, 2);
  caption.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  assert.equal(editor.document[0].props.caption, '한글 caption');
  assert.equal(editor.prosemirrorView.dom.querySelector('.notion-code-caption'), caption);
  assert.equal(document.activeElement, caption);
  assert.equal(caption.selectionStart, 2);
  assert.ok(changes > 0, 'caption input must trigger the editor change event used by autosave');
  const backspace = new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
  caption.dispatchEvent(backspace);
  if (domErrors.length) throw domErrors.shift();
  assert.equal(backspace.defaultPrevented, false);
  assert.equal(editor.document[0].content[0].text, 'console.log(1);');
});

test('the same wrap button toggles code wrapping on and off', async (t) => {
  const { editorSchema } = await import('../src/features/post-editor/code-block.ts');
  const editor = createEditor(t, [{ type: 'codeBlock', content: 'one long line' }], editorSchema);
  const code = editor.prosemirrorView.dom.querySelector('.notion-code');
  const wrap = [...code.querySelectorAll('button')].find((button) => button.textContent === '줄바꿈');
  wrap.click();
  assert.equal(editor.document[0].props.wrap, true);
  assert.equal(code.dataset.wrap, 'true');
  assert.equal(wrap.getAttribute('aria-pressed'), 'true');
  wrap.click();
  assert.equal(editor.document[0].props.wrap, false);
  assert.equal(code.dataset.wrap, 'false');
  assert.equal(wrap.getAttribute('aria-pressed'), 'false');
  assert.equal(editor.prosemirrorView.dom.querySelector('.notion-code'), code);
  if (domErrors.length) throw domErrors.shift();
});

test('undo synchronizes the native language picker with persisted code props', async (t) => {
  const { editorSchema } = await import('../src/features/post-editor/code-block.ts');
  const editor = createEditor(t, [{
    type: 'codeBlock', props: { language: 'javascript' }, content: 'print(1)',
  }], editorSchema);
  const select = editor.prosemirrorView.dom.querySelector('select');
  select.value = 'python';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(editor.document[0].props.language, 'python');
  assert.equal(select.value, 'python');
  assert.equal(editor.undo(), true);
  assert.equal(editor.document[0].props.language, 'javascript');
  assert.equal(select.value, 'javascript');
  assert.equal(editor.prosemirrorView.dom.querySelector('select'), select);
  if (domErrors.length) throw domErrors.shift();
});
