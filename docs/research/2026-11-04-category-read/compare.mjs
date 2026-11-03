import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { handleRequest as improved } from '../../../server/handler.mjs';
import { createManagementCategoryFixture } from '../../../tests/support/management-category-fixture.mjs';

// The baseline is an unchanged local snapshot, captured before implementation.
const { handleRequest: baseline } = await import('../../../.tmp/category-read-before/server/handler.mjs');
const root = new URL('../../../', import.meta.url);
const categories = JSON.parse(readFileSync(new URL('content/categories.json', root)));
const recursiveEntries = execFileSync('git', ['-C', 'content', 'ls-tree', '-rz', 'HEAD'], {
  cwd: root, timeout: 10000, maxBuffer: 8 * 1024 * 1024,
}).toString().split('\0').filter(Boolean).map(line => {
  const [metadata, path] = line.split('\t');
  const [mode, type, sha] = metadata.split(' ');
  return { path, mode, type, sha };
}).filter(entry => entry.path !== 'categories.json');
const latencyMs = 20;
const results = [];
for (const [implementation, handler] of [['baseline', baseline], ['improved', improved]]) {
  for (let sample = 0; sample < 3; sample++) {
    const f = createManagementCategoryFixture({ latencyMs, categories, recursiveEntries });
    for (const phase of ['cold', 'warm']) {
      f.reset();
      const start = performance.now();
      const response = await handler(f.request(), f);
      const bytes = await response.text();
      const durationMs = performance.now() - start;
      const value = JSON.parse(bytes);
      assert.equal(response.status, 200);
      assert.equal(value.categories.length, 48);
      assert.equal(value.contentCommit, 'a'.repeat(40));
      results.push({
        implementation, sample, phase, durationMs: Number(durationMs.toFixed(2)),
        githubRequests: f.calls.length, maxConcurrent: f.maxActive,
        recursiveTree: f.calls.some(call => call.path.includes('recursive=1')),
        responseSha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
assert.equal(new Set(results.map(result => result.responseSha256)).size, 1, 'Response bytes must stay identical');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = [];
for (const implementation of ['baseline', 'improved']) {
  for (const phase of ['cold', 'warm']) {
    const samples = results.filter(result => result.implementation === implementation && result.phase === phase);
    summary.push({ implementation, phase, medianMs: median(samples.map(sample => sample.durationMs)),
      githubRequests: samples[0].githubRequests, maxConcurrent: samples[0].maxConcurrent });
  }
}
console.log(JSON.stringify({
  mode: 'Actual before/after handlers; identical simulated GitHub latency, no live production timing',
  latencyMs, categoryCount: categories.length, recursiveTreeEntries: recursiveEntries.length + 1,
  node: process.version, summary, results,
}, null, 2));
