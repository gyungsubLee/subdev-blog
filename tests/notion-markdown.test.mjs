import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { JSDOM } from 'jsdom';
import * as exporter from '../scripts/export-notion.mjs';
import { loadComponent } from './support/load-component.mjs';

const { default: MarkdownContent } = await loadComponent('src/features/post-reader/MarkdownContent.tsx');

const schema = { ...defaultSchema, tagNames: [...defaultSchema.tagNames, 'u'] };
function rendered(markdown) {
  return new JSDOM(renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm], rehypePlugins: [rehypeRaw, [rehypeSanitize, schema]],
  }, markdown))).window.document.body;
}

// These cases fail if annotations return Markdown delimiters instead of semantic markup.
for (const [name, source, selector, expected, allText] of [
  ['bold underline before a Korean suffix', [['강조', [['b'], ['_']]], ['입니다']], 'strong u, u strong', '강조', '강조입니다'],
  ['bold beside parentheses', [['(', []], ['text', [['b']]], [')', []]], 'strong', 'text', '(text)'],
  ['bold retains surrounding whitespace', [[' padded ', [['b']]], ['suffix']], 'strong', ' padded ', ' padded suffix'],
  ['adjacent bold and highlight runs', [['a', [['b']]], ['b', [['h', 'yellow']]], ['c', [['b']]]], 'strong', 'a', 'abc'],
  ['intraword italic code', [['pre'], ['a_b', [['i'], ['c']]], ['post']], 'em code, code em', 'a_b', 'prea_bpost'],
  ['inline code with multiple backticks', [['a``b```c', [['c']]]], 'code', 'a``b```c', 'a``b```c'],
  ['adjacent styled code runs', [['one', [['b'], ['c']]], ['two', [['c']]]], 'strong code, code strong', 'one', 'onetwo'],
]) {
  test(name, () => {
    const body = rendered(exporter.richText(source));
    assert.equal(body.querySelector(selector)?.textContent, expected);
    assert.equal(body.textContent.trimEnd(), allText);
  });
}

test('adjacent simple code runs differing only by highlight render as one code element', () => {
  const source = [
    ['List<', [['c']]],
    ['T', [['c'], ['h', 'red']]],
    ['>', [['c']]],
  ];
  const snapshot = structuredClone(source);
  const body = rendered(exporter.richText(source));
  assert.equal(body.querySelectorAll('code').length, 1);
  assert.equal(body.querySelector('code').textContent, 'List<T>');
  assert.deepEqual(source, snapshot);
});

test('math annotation code remains separate from adjacent plain code', () => {
  const body = rendered(exporter.richText([
    ['‣', [['e', 'x_1']]], ['tail', [['c']]],
  ]));
  const codes = [...body.querySelectorAll('code')];
  assert.equal(codes.length, 2);
  assert.equal(codes[0].className, 'language-math');
  assert.equal(codes[0].textContent, 'x_1');
  assert.equal(codes[1].textContent, 'tail');
});

test('Notion text keeps literal Markdown punctuation and HTML', () => {
  const text = '**literal** _text_ \\* <script> &amp; [x](https://example.com)';
  const body = rendered(exporter.richText([[text]]));
  assert.equal(body.textContent.trimEnd(), text);
  assert.equal(body.querySelector('strong, em, script'), null);
});

test('inline formulas keep escaped LaTeX in semantic math code', () => {
  const body = rendered(exporter.richText([['‣', [['e', 'x_1 < y & z']]]]));
  assert.equal(body.querySelector('code.language-math')?.textContent, 'x_1 < y & z');
});

test('unannotated Notion dollar formulas stay literal in the actual math-enabled reader', () => {
  const text = '$\\sigma(x)$ and $x_1$';
  const markdown = exporter.richText([[text]]);
  const body = new JSDOM(renderToStaticMarkup(React.createElement(MarkdownContent, {
    body: markdown, post: { id: 'literal-math', path: 'Main/index.md' }, posts: [],
  }))).window.document.body;
  assert.equal(body.textContent.trimEnd(), text);
  assert.equal(body.querySelector('.katex, .katex-error'), null);
});

test('Notion math annotations and equation blocks still render as math', () => {
  const markdown = exporter.richText([['‣', [['e', '\\sigma(x)']]]]) + '\n\n$$\nx_1\n$$';
  const body = new JSDOM(renderToStaticMarkup(React.createElement(MarkdownContent, {
    body: markdown, post: { id: 'actual-math', path: 'Main/index.md' }, posts: [],
  }))).window.document.body;
  assert.equal(body.querySelectorAll('.katex').length, 2);
  assert.equal(body.querySelectorAll('.katex-display').length, 1);
  assert.equal(body.querySelector('.katex-error'), null);
});

test('links encode attributes without admitting unsafe URLs', () => {
  const url = 'https://example.com/?q=" onmouseover="bad&x=1';
  const body = rendered(exporter.richText([
    ['<img src=x onerror=bad>', [['a', url], ['b']]],
    ['unsafe', [['a', 'javascript:alert(1)']]],
    ['control', [['a', 'java\nscript:alert(1)']]],
  ]));
  assert.equal(body.querySelector('img, script, [onmouseover], [onerror]'), null);
  assert.equal(body.querySelector('a').getAttribute('href'), url);
  assert.equal(body.querySelectorAll('a[href^="javascript:"]').length, 0);
  assert.equal(body.querySelector('strong').textContent, '<img src=x onerror=bad>');
});

const pageId = '00000000-0000-0000-0000-000000000001';
const otherId = '00000000-0000-0000-0000-000000000002';
function fixture() {
  const post = { id: pageId, path: 'Main/topic/index.md', title: 'Saved', parentId: null,
    breadcrumbs: [{ id: pageId, title: 'Saved' }], markdown: 'old', excerpt: 'old',
    cover: '/notion/assets/cover.png', updatedAt: '2020-01-01', extra: { retained: true } };
  return {
    posts: [post, { ...post, id: otherId, path: 'Main/other/index.md', title: 'Other' }],
    records: { block: {
      [pageId]: { id: pageId, type: 'page', content: ['toggle', 'table', 'image1', 'image2', 'failed', 'link', 'database'] },
      [otherId]: { id: otherId, type: 'page', properties: { title: [['Other']] } },
      toggle: { id: 'toggle', type: 'toggle', properties: { title: [['bold', [['b']]], [' link', [['a', 'https://example.com']]], [' under', [['_']]]] }, content: ['inside'] },
      inside: { id: 'inside', type: 'text', properties: { title: [['inside']] } },
      table: { id: 'table', type: 'table', content: ['row'], format: { table_block_column_order: ['a'], table_block_column_header: true } },
      row: { id: 'row', type: 'table_row', properties: { a: [['one\ntwo', [['c']]]] } },
      image1: { id: 'image1', type: 'image', properties: { source: [['attachment:shared']] } },
      image2: { id: 'image2', type: 'image', properties: { source: [['attachment:shared']] } },
      failed: { id: 'failed', type: 'file', properties: { source: [['attachment:missing']] } },
      link: { id: 'link', type: 'text', properties: { title: [['Other', [['p', otherId]]]] } },
      database: { id: 'database', type: 'collection_view' },
    } },
    manifest: { collectionRows: [{ id: 'database', rowIds: [otherId] }], assetDetails: [
      { source: 'attachment:shared', blockId: 'image1', path: 'assets/original.png', status: 'cached' },
      { source: 'attachment:missing', blockId: 'failed', status: 'failed' },
    ] },
  };
}

test('offline rendering reuses blocks, metadata, collection rows and all asset source references', () => {
  assert.equal(typeof exporter.renderArchivedPosts, 'function');
  const input = fixture();
  const snapshot = structuredClone(input);
  const result = exporter.renderArchivedPosts(input.records, input.posts, input.manifest);
  assert.deepEqual(input, snapshot, 'offline rendering does not mutate its inputs');
  assert.deepEqual(result, exporter.renderArchivedPosts(input.records, input.posts, input.manifest));
  const { markdown, excerpt, ...metadata } = result[0];
  const { markdown: oldMarkdown, excerpt: oldExcerpt, ...oldMetadata } = input.posts[0];
  assert.deepEqual(metadata, oldMetadata);
  const body = rendered(markdown);
  assert.equal(body.querySelector('summary strong')?.textContent, 'bold');
  assert.equal(body.querySelector('summary a')?.getAttribute('href'), 'https://example.com');
  assert.equal(body.querySelector('summary u')?.textContent, ' under');
  assert.equal(body.querySelector('summary').textContent, 'bold link under');
  assert.equal(body.querySelector('table code')?.textContent, 'onetwo');
  assert.ok(body.querySelector('table code br'), 'multiline code uses a real line break element');
  assert.equal(body.querySelectorAll('img[src="/notion/assets/original.png"]').length, 2);
  assert.ok(body.querySelector('a[href="https://beautiful-college-c84.notion.site/failed"]'));
  assert.equal(body.querySelectorAll('a[href="../other/index.md"]').length, 2);
  assert.match(excerpt, /bold link under/);
});

test('offline excerpts decode generated entities while preserving source punctuation', () => {
  const input = fixture();
  const source = 'a_b: [test] & <T> #hash - text. &#35;';
  input.records.block[pageId].content = ['excerpt'];
  input.records.block.excerpt = { id: 'excerpt', type: 'text', properties: { title: [[source]] } };
  const [post] = exporter.renderArchivedPosts(input.records, input.posts, input.manifest);
  assert.equal(post.excerpt, 'a_b: [test] & <T> #hash - text. &#35;');
});

test('plain and styled Notion source line breaks remain visible in the actual reader', () => {
  const markdown = exporter.richText([['first\n'], ['bold\nline', [['b']]], ['last\r\nend']]);
  const body = new JSDOM(renderToStaticMarkup(React.createElement(MarkdownContent, {
    body: markdown, post: { id: 'multiline', path: 'Main/index.md' }, posts: [],
  }))).window.document.body;
  assert.equal(body.querySelectorAll('p > br').length, 2);
  assert.equal(body.querySelectorAll('strong > br').length, 1);
  assert.equal(body.querySelector('p').textContent, 'firstboldlinelastend');
});

test('line break conversion covers summaries, lists, table code and captions while preserving fenced and math source', () => {
  const input = fixture();
  input.records.block[pageId].content = ['toggle', 'list', 'table', 'fence', 'math'];
  input.records.block.toggle.properties.title = [['summary\nnext', [['b']]]];
  input.records.block.list = { id: 'list', type: 'bulleted_list', properties: { title: [['item\nnext']] } };
  input.records.block.fence = { id: 'fence', type: 'code', properties: {
    title: [['line1\nline2']], caption: [['caption\nnext']], language: [['javascript']],
  } };
  input.records.block.math = { id: 'math', type: 'text', properties: { title: [['‣', [['e', 'x_1\n+x_2']]]] } };
  const [post] = exporter.renderArchivedPosts(input.records, input.posts, input.manifest);
  const body = rendered(post.markdown);
  assert.equal(body.querySelectorAll('summary strong br').length, 1);
  assert.equal(body.querySelectorAll('li br').length, 1);
  assert.equal(body.querySelectorAll('table code br').length, 1);
  assert.equal(body.querySelector('pre code')?.textContent, 'line1\nline2\n');
  assert.ok([...body.querySelectorAll('p')].some(paragraph => paragraph.textContent === 'captionnext' && paragraph.querySelector('br')));
  assert.equal(body.querySelector('code.language-math')?.textContent, 'x_1\n+x_2');
  assert.equal(body.querySelector('code.language-math br'), null);
});

test('multiline math annotation source in a table retains formula newlines without break elements', () => {
  const input = fixture();
  input.records.block[pageId].content = ['table'];
  input.records.block.row.properties.a = [['‣', [['e', 'x_1\n+x_2']]]];
  const [post] = exporter.renderArchivedPosts(input.records, input.posts, input.manifest);
  const body = rendered(post.markdown);
  assert.equal(body.querySelector('table code.language-math')?.textContent, 'x_1\n+x_2');
  assert.equal(body.querySelector('table code.language-math br'), null);
});

test('fenced code invalid numeric entities survive excerpts without aborting archived rendering', () => {
  const input = fixture();
  input.records.block[pageId].content = ['invalid-entities'];
  input.records.block['invalid-entities'] = { id: 'invalid-entities', type: 'code', properties: {
    title: [['const invalidHtml = "&#1114112; &#0; &#55296;";']],
  } };
  const [post] = exporter.renderArchivedPosts(input.records, input.posts, input.manifest);
  assert.equal(post.excerpt, 'const invalidHtml = "&#1114112; &#0; &#55296;";');
});

test('web paths normalize asset destinations without changing page links or literal code examples', () => {
  const source = '[a](assets/a.png) ![b](../../assets/b.png) <img src="../assets/c.png"> <a href="assets/d.pdf">d</a> [page](../page/index.md)\n\n`[code](../assets/example.png)`\n\n```md\n[x](../assets/fence.png)\n```\n\n<code>[html](../assets/html.png)</code>';
  assert.equal(exporter.webMarkdown(source), '[a](/notion/assets/a.png) ![b](/notion/assets/b.png) <img src="/notion/assets/c.png"> <a href="/notion/assets/d.pdf">d</a> [page](../page/index.md)\n\n`[code](../assets/example.png)`\n\n```md\n[x](../assets/fence.png)\n```\n\n<code>[html](../assets/html.png)</code>');
});
