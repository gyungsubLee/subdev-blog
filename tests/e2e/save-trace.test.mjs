import test from 'node:test';
import assert from 'node:assert/strict';
import { traceRequest, profileFetch, stage } from './save-trace.mjs';

test('diagnostic trace measures consumed bytes and sequential stages without persisting bodies or credentials', {timeout:2000}, async () => {
  const { result, trace } = await traceRequest(async () => {
    stage('load');
    const response = await profileFetch('https://example.test/data', {headers:{Authorization:'SECRET'}}, async () => new Response('body-only', {status:200}));
    assert.equal(await response.text(), 'body-only');
    stage('project');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(trace.calls.length, 1);
  assert.equal(trace.calls[0].responseBytes, 9);
  assert.equal(trace.calls[0].bodyComplete, true);
  assert.ok(Number.isFinite(trace.calls[0].endMs));
  assert.ok(trace.stages.every(row => row.endMs >= row.startMs));
  assert.ok(!JSON.stringify(trace).includes('SECRET'));
  assert.ok(!JSON.stringify(trace).includes('body-only'));
});
