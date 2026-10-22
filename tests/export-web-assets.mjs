import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(project, 'content/manifest.json'), 'utf8'));
const mapping = JSON.parse(await fs.readFile(path.join(project, 'public/notion/asset-map.json'), 'utf8'));
const originals = new Map(manifest.assetDetails.filter(asset => asset.path).map(asset => ['/notion/' + asset.path, asset]));
let webBytes = 0;
for (const [url, asset] of originals) {
  const targetUrl = mapping[url] ?? url;
  assert(targetUrl.startsWith('/notion/assets/'));
  const target = path.join(project, 'public', targetUrl.slice(1));
  const [originalStat, targetStat] = await Promise.all([
    fs.stat(path.join(manifest.archivePath, asset.path)),
    fs.stat(target),
  ]);
  assert(targetStat.size > 0, 'Empty public asset: ' + targetUrl);
  if (mapping[url]) {
    assert(/\.(png|jpe?g|gif)$/i.test(url));
    assert(targetUrl.endsWith('.webp'));
    assert(targetStat.size < originalStat.size, 'WebP must be smaller: ' + url);
    const originalPublicExists = await fs.access(path.join(project, 'public', url.slice(1))).then(() => true, () => false);
    assert(!originalPublicExists, 'Replaced public original remains: ' + url);
  } else {
    assert.equal(targetStat.size, originalStat.size, 'Unconverted asset changed: ' + url);
  }
  webBytes += targetStat.size;
}
assert(Object.keys(mapping).every(url => originals.has(url)), 'Map contains an unknown source asset');
console.log(JSON.stringify({ files: originals.size, converted: Object.keys(mapping).length, webBytes }, null, 2));
