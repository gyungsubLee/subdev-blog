import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { richText, relativePageLink, webMarkdown, validateAssetUrl, writeMarkdown, ROOT_ID } from '../scripts/export-notion.mjs';

assert.equal(richText([['strong', [['b']]], [' ', []], ['link', [['a', 'https://example.com']]]]), '**strong** [link](https://example.com)');
assert.equal(richText([['a`b', [['c']]]]), '``a`b``');
assert.equal(richText([['reference', [['p', ROOT_ID]]]], url => url.replace('https://beautiful-college-c84.notion.site', 'local:')), '[reference](local:/' + ROOT_ID.replaceAll('-', '') + ')');
assert.equal(relativePageLink('Main/부모/index.md', 'Main/자식 (제목)/index.md'), '../%EC%9E%90%EC%8B%9D%20%28%EC%A0%9C%EB%AA%A9%29/index.md');
assert.equal(webMarkdown('![a](../../assets/a.png)'), '![a](/notion/assets/a.png)');
assert.equal(relativePageLink('Main/index.md', 'Main/index.md', 'aa-bb'), 'index.md#aabb');

for (const url of ['file:///etc/passwd', 'http://127.0.0.1/a', 'http://localhost/a', 'http://10.0.0.1/a', 'http://169.254.169.254/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'https://user:password@example.com/a']) {
  assert.throws(() => validateAssetUrl(url));
}
assert.equal(validateAssetUrl('https://file.notion.so/a.png').hostname, 'file.notion.so');

const historyRoot = await fs.mkdtemp(path.resolve(import.meta.dirname, '../.export-history-check-'));
try {
  await writeMarkdown('topic/note.md', 'user original', historyRoot);
  await fs.chmod(path.join(historyRoot, 'topic/note.md'), 0o600);
  await writeMarkdown('topic/note.md', 'new export', historyRoot);
  assert.equal(await fs.readFile(path.join(historyRoot, 'topic/note.md'), 'utf8'), 'new export');
  const versions = await fs.readdir(path.join(historyRoot, '.history'));
  assert.equal(versions.length, 1);
  assert.equal(await fs.readFile(path.join(historyRoot, '.history', versions[0], 'topic/note.md'), 'utf8'), 'user original');
  assert.equal((await fs.stat(path.join(historyRoot, 'topic/note.md'))).mode & 0o777, 0o600);
  await writeMarkdown('topic/note.md', 'new export', historyRoot);
  assert.equal((await fs.readdir(path.join(historyRoot, '.history'))).length, 1);
} finally { await fs.rm(historyRoot, { recursive: true, force: true }); }

const posts = JSON.parse(await fs.readFile(new URL('../content/posts.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await fs.readFile(new URL('../content/manifest.json', import.meta.url), 'utf8'));
assert(posts.length > 0, 'Export contains no pages');
assert.equal(posts.length, manifest.pageCount);
assert.equal(new Set(posts.map(post => post.id)).size, posts.length);
assert(posts.some(post => post.id === ROOT_ID));
const ids = new Set(posts.map(post => post.id));
let checkedLinks = 0;
const brokenLinks = [];
for (const post of posts) {
  assert(post.parentId === null || ids.has(post.parentId), 'Unknown parent: ' + post.id);
  const filename = path.join(manifest.archivePath, post.path);
  const stored = await fs.readFile(filename, 'utf8');
  assert(stored.includes('notion_id: "' + post.id + '"'));
  assert(webMarkdown(stored).endsWith(post.markdown));
  const body = stored.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:|^\//i.test(target)) continue;
    if (!target.endsWith('/index.md') && !target.includes('assets/')) continue;
    checkedLinks++;
    try { await fs.access(path.resolve(path.dirname(filename), decodeURIComponent(target))); }
    catch { brokenLinks.push({ page: post.path, target }); }
  }
}
assert.deepEqual(brokenLinks, [], 'Broken local Markdown links');
for (const asset of manifest.assetDetails.filter(asset => asset.path)) {
  const stat = await fs.stat(path.join(manifest.archivePath, asset.path));
  assert(stat.size > 0, 'Empty asset: ' + asset.path);
}
console.log(JSON.stringify({ pages: posts.length, localLinks: checkedLinks, assets: manifest.assets, unavailableBlocks: manifest.unavailable.length, warningCount: manifest.warnings.length, warningSummary: manifest.warnings.reduce((summary, warning) => { const kind = warning.split(':')[0]; summary[kind] = (summary[kind] ?? 0) + 1; return summary; }, {}) }, null, 2));
