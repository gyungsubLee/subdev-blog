#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = path.join(project, 'public/notion');
const manifest = JSON.parse(await fs.readFile(path.join(project, 'content/manifest.json'), 'utf8'));
const assetMap = {};
const results = [];
const assets = manifest.assetDetails.filter(asset => asset.path);
const eligible = /\.(png|jpe?g|gif)$/i;
const maxWidth = 1920;
let cursor = 0;

async function verifyGif(source, target) {
  const original = await fs.readFile(source);
  const width = original.readUInt16LE(6);
  const height = original.readUInt16LE(8);
  let marker = original.indexOf(Buffer.from('NETSCAPE2.0'));
  if (marker < 0) marker = original.indexOf(Buffer.from('ANIMEXTS1.0'));
  const storedLoop = marker < 0 ? null : original.readUInt16LE(marker + 13);
  const expectedLoop = storedLoop === null ? 1 : storedLoop === 0 ? 0 : storedLoop + 1;
  const decoded = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'frame=duration_time,pkt_duration_time', '-of', 'json', source,
  ], { maxBuffer: 10 * 1024 * 1024 });
  const durations = JSON.parse(decoded.stdout).frames.map(frame => Math.round(Number(frame.duration_time ?? frame.pkt_duration_time) * 1000));
  if (!durations.length || durations.some(duration => !Number.isFinite(duration) || duration < 0)) {
    throw new Error('GIF frame timing unavailable');
  }
  const inspected = await execFileAsync('webpmux', ['-info', target], { maxBuffer: 10 * 1024 * 1024 });
  const info = inspected.stdout;
  const canvas = info.match(/Canvas size:\s*(\d+) x (\d+)/i);
  if (!canvas || Number(canvas[1]) !== width || Number(canvas[2]) !== height) throw new Error('GIF canvas changed');
  if (durations.length > 1) {
    const frames = info.split('\n').filter(line => /^\s*\d+:/.test(line)).map(line => Number(line.trim().split(/\s+/)[6]));
    if (frames.length !== durations.length || frames.some((duration, index) => duration !== durations[index])) {
      throw new Error('GIF frame count or frame duration changed');
    }
    const loop = Number(info.match(/Loop Count\s*:\s*(\d+)/i)?.[1]);
    if (loop !== expectedLoop) throw new Error('GIF loop count changed');
  }
  return { preserved: true, width, height, frames: durations.length, durationMs: durations.reduce((sum, duration) => sum + duration, 0), loopCount: expectedLoop };
}

async function prepareAsset(asset) {
  if (!/^assets\/[a-f0-9]{16}\.[a-zA-Z0-9]{1,10}$/.test(asset.path)) {
    throw new Error('Unexpected generated asset path: ' + asset.path);
  }
  const source = path.join(manifest.archivePath, asset.path);
  const originalPublic = path.join(publicDirectory, asset.path);
  const originalStat = await fs.stat(source);
  const result = { path: asset.path, originalBytes: originalStat.size, webBytes: originalStat.size, status: 'original' };
  if (!eligible.test(asset.path)) {
    await fs.copyFile(source, originalPublic);
    results.push(result);
    return;
  }
  const convertedPath = asset.path.replace(eligible, '.webp');
  const target = path.join(publicDirectory, convertedPath);
  try {
    let cached;
    try { cached = await fs.stat(target); } catch {}
    if (!cached || cached.mtimeMs < originalStat.mtimeMs || cached.size >= originalStat.size) {
      if (/\.png$/i.test(asset.path)) {
        const handle = await fs.open(source);
        try {
          const header = Buffer.alloc(Math.min(65536, originalStat.size));
          await handle.read(header, 0, header.length, 0);
          if (header.includes(Buffer.from('acTL'))) {
            result.status = 'animation-preserved';
            await fs.copyFile(source, originalPublic);
            results.push(result);
            return;
          }
        } finally { await handle.close(); }
      }
      if (/\.gif$/i.test(asset.path)) {
        await execFileAsync('gif2webp', [
          '-quiet', '-mixed', '-q', '85', '-m', '4', '-metadata', 'icc,xmp',
          source, '-o', target + '.partial',
        ], { maxBuffer: 1024 * 1024 });
      } else {
        const args = [
          '-quiet', '-q', '85', '-m', '4', '-metadata', 'icc,exif',
          '-resize', String(maxWidth), '0', '-resize_mode', 'down_only',
          source, '-o', target + '.partial',
        ];
        await execFileAsync('cwebp', args, { maxBuffer: 1024 * 1024 });
      }
      await fs.rename(target + '.partial', target);
      cached = await fs.stat(target);
    }
    if (/\.gif$/i.test(asset.path)) result.animation = await verifyGif(source, target);
    if (cached.size < originalStat.size) {
      const previousUrl = '/notion/' + asset.path;
      const nextUrl = '/notion/' + convertedPath;
      assetMap[previousUrl] = nextUrl;
      result.status = 'webp';
      result.webBytes = cached.size;
      result.webPath = convertedPath;
      await fs.rm(originalPublic, { force: true });
    } else {
      await fs.rm(target, { force: true });
      await fs.copyFile(source, originalPublic);
    }
  } catch (error) {
    await fs.rm(target + '.partial', { force: true });
    await fs.rm(target, { force: true });
    await fs.copyFile(source, originalPublic);
    result.status = 'conversion-skipped';
    result.reason = error.stderr?.trim().slice(0, 300) || error.message;
  }
  const sourceAfter = await fs.stat(source);
  if (sourceAfter.size !== originalStat.size || sourceAfter.mtimeMs !== originalStat.mtimeMs) {
    throw new Error('Archive changed during web asset preparation: ' + asset.path);
  }
  results.push(result);
}

await fs.mkdir(path.join(publicDirectory, 'assets'), { recursive: true });
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < assets.length) {
    const index = cursor++;
    await prepareAsset(assets[index]);
    if (results.length % 50 === 0) console.log('WEB_ASSETS', results.length, '/', assets.length);
  }
}));
const orderedMap = Object.fromEntries(Object.entries(assetMap).sort(([a], [b]) => a.localeCompare(b)));
const summary = {
  generatedAt: new Date().toISOString(), quality: 85, maxWidth,
  files: results.length, animatedConverted: results.filter(result => result.status === 'webp' && result.animation).length, converted: results.filter(result => result.status === 'webp').length,
  skipped: results.filter(result => result.status === 'conversion-skipped'),
  originalBytes: results.reduce((total, result) => total + result.originalBytes, 0),
  webBytes: results.reduce((total, result) => total + result.webBytes, 0),
};
const mapFilename = path.join(publicDirectory, 'asset-map.json');
await fs.writeFile(mapFilename + '.tmp', JSON.stringify(orderedMap, null, 2));
await fs.rename(mapFilename + '.tmp', mapFilename);
await fs.writeFile(path.join(project, 'content/web-assets-report.json'), JSON.stringify({ ...summary, assets: results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
