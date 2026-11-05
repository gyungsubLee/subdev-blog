import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicE2EServer } from '../support/public-e2e-server.mjs';
import { ID } from '../support/public-repository.mjs';
import { runPublicPublication } from '../../app/content/scripts/publish-public-content.mjs';

test('atomic HTTP save uses one GitHub mutation and recovers a lost browser reply read-only', { timeout: 30000 }, async t => {
  const app = await createPublicE2EServer();
  t.after(() => app.close());
  const login = await fetch(app.origin + '/__e2e/login', {
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function call(path, payload, reconcile = false) {
    const response = await fetch(app.origin + '/api/' + path, {
      method: payload ? 'POST' : 'GET',
      headers: {
        cookie, Origin: app.origin, 'x-csrf-token': 'e2e-csrf',
        'Content-Type': 'application/json',
        ...(reconcile ? { 'X-Content-Reconcile': '1' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, data: await response.json() };
  }
  const original = await call('content?kind=post&id=' + ID);
  assert.equal(original.status, 200);
  const payload = {
    saveMode: 'atomic', requestId: 'atomic-' + crypto.randomUUID(),
    baseCommit: original.data.contentCommit,
    operations: [{
      type: 'post.update', id: ID, baseRevision: original.data.revision,
      changes: { title: 'One mutation HTTP' },
    }],
  };
  const saved = await call('content', payload);
  assert.equal(saved.status, 200, saved.data.error);
  const row = app.apiRows.filter(item => item.method === 'POST' && item.path === '/api/content').at(-1);
  assert.equal(row.githubFixtureCalls, 1);
  assert.equal(row.githubFixtureWrites, 1);
  assert.equal(saved.data.sourceOnly, true);
  assert.equal(saved.data.receipt.requestId, payload.requestId);

  // Simulate a browser losing the accepted reply: persisted dispatch intent
  // asks the server to reconcile before any second mutation is attempted.
  const recovered = await call('content', payload, true);
  assert.equal(recovered.status, 200, recovered.data.error);
  assert.equal(recovered.data.contentCommit, saved.data.contentCommit);
  const recoveryRow=app.apiRows.filter(item=>item.method==='POST'&&item.path==='/api/content').at(-1);
  assert.equal(recoveryRow.githubFixtureWrites,0,'Accepted browser retry must not attempt another mutation');
  assert.equal([...app.f.commits.values()].filter(record => record.message?.startsWith('cms-request:')).length, 1);
  const beforePublic = await call('public?kind=index&after=' + saved.data.contentCommit);
  assert.equal(beforePublic.status, 200);
  assert.equal(beforePublic.data.contentCommit, original.data.contentCommit);
  await runPublicPublication(['--commit', saved.data.contentCommit, '--publish'], { env: {}, fetcher: app.gateway });
  const status = await call('publish?sourceCommit=' + saved.data.contentCommit);
  assert.equal(status.status, 200);
  assert.equal(status.data.state, 'published');
  const publicIndex = await call('public?kind=index&after=' + saved.data.contentCommit);
  assert.equal(publicIndex.data.posts.find(post => post.id === ID)?.title, 'One mutation HTTP');
});
