import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SHA = /^[a-f0-9]{40}$/;
const number = value => Number.isFinite(value) ? value : null;
const sum = values => values.reduce((total, value) => total + (number(value) ?? 0), 0);
export function median(values) {
  const sorted = values.filter(value => number(value) !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeCalls(calls) {
  return {
    calls: calls.length,
    apiCalls: calls.filter(call => call.host === 'api.github.com').length,
    rawReads: calls.filter(call => call.host === 'raw.githubusercontent.com').length,
    writes: calls.filter(call => !['GET', 'HEAD'].includes(call.method ?? 'GET') && call.readOnly !== true).length,
    readOnlyPosts: calls.filter(call => call.method === 'POST' && call.readOnly === true).length,
    requestBytes: sum(calls.map(call => call.requestBytes)),
    decodedResponseBytes: sum(calls.map(call => call.responseBytes)),
    unfinishedBodies: calls.filter(call => call.bodyComplete !== true).length,
    notFoundCalls: calls.filter(call => call.status === 404).length,
    failedCalls: calls.filter(call => !Number.isFinite(call.status) || call.status >= 400).length,
  };
}

export function parseWorkflowTrace(source) {
  const calls = [];
  const generatorShas = new Set();
  let result = null;
  let malformedLines = 0;
  for (const line of source.split('\n')) {
    const checkout = line.match(/switching to '([a-f0-9]{40})'/);
    if (checkout) generatorShas.add(checkout[1]);
    const start = line.indexOf('{');
    if (start < 0) continue;
    let row;
    try { row = JSON.parse(line.slice(start)); }
    catch {
      if (line.includes('"requestBytes"') || line.includes('"sourceCommit"')) malformedLines++;
      continue;
    }
    if (Number.isFinite(row.requestBytes)) {
      calls.push(Object.fromEntries(['method', 'host', 'path', 'startedAt', 'requestBytes', 'responseBytes',
        'bodyComplete', 'status', 'ms', 'networkError', 'bodyError', 'cancelled']
        .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
    } else if (SHA.test(row.sourceCommit ?? '')) {
      result = {sourceCommit: row.sourceCommit, publicationCommit: row.publicationCommit ?? null, state: row.state ?? null};
    }
  }
  return {calls, result, generatorShas: [...generatorShas], malformedLines};
}

export function readyResponse(trace) {
  const writes = trace.calls.filter(call => call.method === 'PATCH' && call.status >= 200 && call.status < 300 &&
    decodeURIComponent(call.path ?? '').endsWith('/git/refs/heads/public-ready/main') &&
    Number.isFinite(call.startedAt) && Number.isFinite(call.ms));
  const last = writes.at(-1);
  return last ? {startedAt: last.startedAt, responseAt: last.startedAt + last.ms, ms: last.ms} : null;
}

function rowTraffic(rows) {
  const calls = rows.flatMap(row => {
    const url = new URL(row.path, 'https://measurement.invalid');
    const categoryRead = row.method === 'GET' && url.pathname === '/api/content' && url.searchParams.get('kind') === 'categories';
    return (row.trace?.calls ?? []).map(call => {
      // The measured content handler explicitly sends this one ReadCategories
      // query with readOnly:true. Other GraphQL POSTs retain write semantics.
      if (categoryRead && call.host === 'api.github.com' && call.method === 'POST' && call.path === '/graphql') {
        return {...call, readOnly:true};
      }
      return call;
    });
  });
  return {
    appRequests: rows.length,
    appRequestBytes: sum(rows.map(row => row.requestBytes)),
    appResponseBytes: sum(rows.map(row => row.responseBytes)),
    github: summarizeCalls(calls),
  };
}

async function optionalJson(filename, issues) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    issues.push(`${path.basename(filename)}: ${error.code === 'ENOENT' ? 'missing' : error.name}`);
    return null;
  }
}

async function workflowEvidence(folder, sourceCommit, issues) {
  if (!SHA.test(sourceCommit ?? '')) return null;
  const metadata = await optionalJson(path.join(folder, `workflow-${sourceCommit}.json`), issues);
  let trace;
  try { trace = parseWorkflowTrace(await readFile(path.join(folder, `workflow-${sourceCommit}-trace.log`), 'utf8')); }
  catch (error) {
    issues.push(`workflow-${sourceCommit}-trace.log: ${error.code === 'ENOENT' ? 'missing' : error.name}`);
    return null;
  }
  const ready = readyResponse(trace);
  const complete = metadata?.headSha === sourceCommit && metadata.status === 'completed' && metadata.conclusion === 'success' &&
    trace.result?.sourceCommit === sourceCommit && trace.result.state === 'published' && Boolean(ready) && trace.malformedLines === 0 &&
    ['createdAt', 'startedAt', 'updatedAt'].every(key => Number.isFinite(Date.parse(metadata[key])));
  if (!complete) issues.push(`Workflow ${sourceCommit}: successful ready publication is not fully evidenced`);
  return {
    complete,
    ...Object.fromEntries(['id', 'attempt', 'url', 'headSha', 'status', 'conclusion', 'createdAt', 'startedAt', 'updatedAt', 'watchExit']
      .map(key => [key, metadata?.[key] ?? null])),
    publisherResult: trace.result,
    generatorShas: trace.generatorShas, malformedTraceLines: trace.malformedLines,
    github: summarizeCalls(trace.calls),
    readyResponse: ready,
    runnerGenerationStartedAt: trace.calls.length ? Math.min(...trace.calls.map(call => call.startedAt).filter(Number.isFinite)) : null,
  };
}

function inventoryEvidence(before, after) {
  const beforeFiles = before?.files ?? {};
  const afterFiles = after?.files ?? {};
  const paths = new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)]);
  const differences = [...paths].filter(filename => beforeFiles[filename] !== afterFiles[filename]);
  const complete = Boolean(before && after && Object.keys(beforeFiles).length && Object.keys(afterFiles).length);
  return {
    complete,
    beforeCommit: before?.head ?? null,
    afterCommit: after?.head ?? null,
    beforeFiles: Object.keys(beforeFiles).length,
    afterFiles: Object.keys(afterFiles).length,
    beforePosts: before?.posts ?? null,
    afterPosts: after?.posts ?? null,
    allOriginalFileShasMatch: complete ? differences.length === 0 : null,
    postCountMatches: complete ? before.posts === after.posts : null,
    differenceCount: differences.length,
    differencePaths: differences.slice(0, 20),
    beforeReady: before?.ready ?? null,
    afterReady: after?.ready ?? null,
    afterGenerator: after?.generator ?? null,
    afterPin: after?.pin ?? null,
  };
}

export async function analyzeMeasurements(folder = import.meta.dirname, root = ROOT, {nominalDebounceMs = 5000} = {}) {
  const issues = [];
  const report = await optionalJson(path.join(folder, 'live-report.json'), issues);
  const before = await optionalJson(path.join(folder, 'state-before.json'), issues);
  const after = await optionalJson(path.join(folder, 'state-after.json'), issues);
  const sourceHashes = await optionalJson(path.join(folder, 'measurement-source-hashes.json'), issues);
  const baseline = await optionalJson(path.join(root, 'docs/research/2026-11-04-save-optimization/verification.json'), issues);
  const baselineAnalysis = await optionalJson(path.join(root, 'docs/research/2026-11-04-save-optimization/analysis.json'), issues);
  const rows = report?.rows ?? [];
  const browser = report?.browser ?? [];
  const savedEvents = browser.filter(event => event.event === 'source-saved' && ['create', 'update', 'delete'].includes(event.action));
  const operations = [];
  for (const event of savedEvents) {
    const posts = rows.filter(row => row.method === 'POST' && row.path === '/api/content' && row.requestId === event.requestId);
    const device = browser.find(item => item.event === 'device-saved' && item.clickAt === event.clickAt && item.id === event.id) ?? event;
    const observed = browser.filter(item => item.event === 'publication-observed' && item.sourceCommit === event.contentCommit &&
      item.publicCommit === event.contentCommit && item.expected === true && item.state === 'published')
      .sort((a, b) => a.at - b.at)[0];
    const workflow = await workflowEvidence(folder, event.contentCommit, issues);
    const readyAt = workflow?.readyResponse?.responseAt;
    operations.push({
      action: event.action, sample: event.sample, requestId: event.requestId, id: event.id,
      sourceCommit: event.contentCommit, sourceState: event.state, clickAt: event.clickAt,
      durable: device.durable === true,
      durableNotificationMs: number(device.durableNotificationMs),
      independentDurableReadMs: number(device.independentDurableReadMs),
      enqueueMs: number(device.enqueueMs), uiPaintMs: number(device.uiPaintMs),
      queueBytes: number(device.queueBytes),
      queueIncludingDebounceMs: number(event.sendingMs),
      preSendingBeyondNominalDebounceMs: number(event.sendingMs) === null ? null : event.sendingMs - nominalDebounceMs,
      nominalDebounceMs: event.action === 'delete' ? 0 : nominalDebounceMs,
      clickToSourceMs: number(event.sourceMs),
      remoteExcludingDebounceMs: number(event.remoteExcludingDebounceMs),
      clickToSourceWithoutNominalDebounceMs: number(event.sourceMs) === null ? null : event.sourceMs - (event.action === 'delete' ? 0 : nominalDebounceMs),
      serverPost: {
        requests: posts.length, ms: posts.length === 1 ? number(posts[0].ms) : null,
        individualMs: posts.map(post => post.ms), statuses: posts.map(post => post.status),
        browserRequestBytes: sum(posts.map(post => post.requestBytes)),
        browserResponseBytes: sum(posts.map(post => post.responseBytes)),
        requestsBeforeUiPaint: number(device.uiPaintMs) === null ? null
          : posts.filter(post => Date.parse(post.at) <= event.clickAt + device.uiPaintMs).length,
        github: summarizeCalls(posts.flatMap(post => post.trace?.calls ?? [])),
      },
      publication: {
        workflow,
        runnerReadyResponseSinceBrowserClickMs: Number.isFinite(readyAt) && Number.isFinite(event.clickAt) ? readyAt - event.clickAt : null,
        browserObservedUpperBoundMs: number(observed?.elapsedSinceClickMs),
        browserObservedAt: number(observed?.at),
        workflowCreatedSinceClickMs: workflow?.createdAt ? Date.parse(workflow.createdAt) - event.clickAt : null,
        workflowStartedSinceClickMs: workflow?.startedAt ? Date.parse(workflow.startedAt) - event.clickAt : null,
        workflowUpdatedSinceClickMs: workflow?.updatedAt ? Date.parse(workflow.updatedAt) - event.clickAt : null,
      },
    });
  }
  const samples = operations.filter(operation => operation.action === 'update').sort((a, b) => a.sample - b.sample);
  const sampleNumbers = samples.map(sample => sample.sample);
  if (JSON.stringify(sampleNumbers) !== '[1,2,3]') issues.push('Exactly title samples 1, 2 and 3 are required');
  if (operations.filter(operation => operation.action === 'create').length !== 1 || operations.filter(operation => operation.action === 'delete').length !== 1) {
    issues.push('Exactly one temporary create and delete are required');
  }
  if (new Set(operations.map(operation => operation.id)).size > 1) issues.push('Measured operations do not share one disposable post');
  if (new Set(operations.map(operation => operation.sourceCommit)).size !== operations.length) issues.push('Distinct source mutations do not have distinct source commits');
  if (operations.some(operation => operation.sourceState !== 'saved')) issues.push('A measured mutation did not report a newly saved source');
  for (const sample of samples) {
    if (!Number.isFinite(sample.clickAt) || !sample.durable || [sample.durableNotificationMs, sample.independentDurableReadMs, sample.enqueueMs, sample.uiPaintMs,
      sample.queueIncludingDebounceMs, sample.clickToSourceMs, sample.remoteExcludingDebounceMs].some(value => value === null)) {
      issues.push(`Sample ${sample.sample}: device/UI/queue evidence is incomplete`);
    }
  }
  if (operations.some(operation => operation.serverPost.requests !== 1 || operation.serverPost.statuses[0] !== 200)) {
    issues.push('Each measured source operation must match one successful exact HTTP POST');
  }
  if (operations.some(operation => operation.serverPost.github.calls === 0)) issues.push('Source POST GitHub traces are incomplete');
  if (browser.some(event => event.event === 'measurement-error')) issues.push('Browser measurement-error events require review');
  const inventory = inventoryEvidence(before, after);
  if (!inventory.allOriginalFileShasMatch || !inventory.postCountMatches) issues.push('Final canonical file SHA and post-count cleanup is not verified');
  const deletion = operations.find(operation => operation.action === 'delete');
  if (deletion && inventory.afterReady !== deletion.sourceCommit) issues.push('Final default ready pointer does not match the deletion source');
  const changedSources = [];
  const missingSources = [];
  for (const [filename, expected] of Object.entries(sourceHashes ?? {})) {
    try {
      const actual = createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex');
      if (actual !== expected) changedSources.push(filename);
    } catch { missingSources.push(filename); }
  }
  const bindings = {files: Object.keys(sourceHashes ?? {}).length, changedPaths: changedSources, missingPaths: missingSources,
    matches: Boolean(sourceHashes && Object.keys(sourceHashes).length && !changedSources.length && !missingSources.length)};
  if (!bindings.matches) issues.push('Measured source hashes do not all match current files');
  if (after && (after.generator !== after.pin || operations.some(operation => operation.publication.workflow?.generatorShas.length !== 1 ||
    operation.publication.workflow.generatorShas[0] !== after.pin))) issues.push('Workflow generator identity does not match the final generator pin');
  const sortedByPost = samples.filter(sample => sample.serverPost.ms !== null).sort((a, b) => a.serverPost.ms - b.serverPost.ms);
  const representative = sortedByPost.length === 3 ? sortedByPost[1] : null;
  const oldPostMs = number(baseline?.medianSeconds) === null ? median((baselineAnalysis?.samples ?? []).map(sample => sample.handlerMs)) : baseline.medianSeconds * 1000;
  const newPostMs = median(samples.map(sample => sample.serverPost.ms));
  const traffic = {
    sourcePosts: rowTraffic(rows.filter(row => row.method === 'POST' && row.path === '/api/content')),
    publicationPolling: rowTraffic(rows.filter(row => row.path.startsWith('/api/publish'))),
    publicReads: rowTraffic(rows.filter(row => row.path.startsWith('/api/public'))),
    sourcePreparationReads: rowTraffic(rows.filter(row => row.method === 'GET' && row.path.startsWith('/api/content'))),
    sessionAndAuth: rowTraffic(rows.filter(row => row.path.startsWith('/api/session') || row.path.startsWith('/api/auth/'))),
  };
  return {
    complete: issues.length === 0,
    issues: [...new Set(issues)],
    scope: 'Real GitHub/OAuth/CSRF; production IndexedDB/background modules on a disposable browser control page. Control-page paint is not a full editor interaction benchmark.',
    samples, operations, inventory, sourceBindings: bindings, traffic,
    medians: Object.fromEntries(['durableNotificationMs', 'independentDurableReadMs', 'enqueueMs', 'uiPaintMs',
      'queueIncludingDebounceMs', 'clickToSourceMs', 'remoteExcludingDebounceMs'].map(key => [key, median(samples.map(sample => sample[key]))])),
    publicationMedians: {
      runnerReadyResponseSinceBrowserClickMs: median(samples.map(sample => sample.publication.runnerReadyResponseSinceBrowserClickMs)),
      browserObservedUpperBoundMs: median(samples.map(sample => sample.publication.browserObservedUpperBoundMs)),
    },
    sourcePostComparison: {
      before: {medianMs: oldPostMs, samplesSeconds: baseline?.samplesSeconds ?? null, calls: baseline?.githubCalls ?? null, writes: baseline?.githubWrites ?? null,
        requestBytes: baseline?.requestPayloadBytes ?? null, decodedResponseBytes: baseline?.decodedResponseBytes ?? null},
      after: {medianMs: newPostMs, representativeSample: representative?.sample ?? null, github: representative?.serverPost.github ?? null},
      measuredImprovementPercent: oldPostMs && newPostMs !== null ? (oldPostMs - newPostMs) / oldPostMs * 100 : null,
    },
    notes: [
      'Source POST baseline is server HTTP time; it is not a click-to-device or click-to-screen baseline.',
      'Each local/queue median is selected independently. Source POST calls/bytes use the sample with the median POST time.',
      `remoteExcludingDebounceMs is sending-notification-to-source-ACK; nominal save debounce is ${nominalDebounceMs} ms.`,
      'Ready response completion is publisher startedAt + measured ms. Subtracting browser clickAt compares runner and browser wall clocks; no clock synchronization or skew bound was measured.',
      'Browser publication checks are polling upper bounds. Workflow updatedAt includes post-publication job cleanup.',
      'Workflow traffic covers instrumented publisher GitHub/raw calls only; checkout, npm, Actions log retrieval, watch polling and capture-state diagnostic requests are excluded.',
      'Source preparation classifies only POST /graphql within the bound GET /api/content?kind=categories trace as the explicit readOnly ReadCategories query; other GraphQL POSTs remain writes. Calls and byte totals retain the query.',
      'Unfinished source POST response bodies are preserved in the counts; the expected request-ref 404 probes may leave these bodies unfinished. No complete-body or compressed-wire claim is made.',
      'Traffic failedCalls includes expected GitHub 404 misses; it does not by itself indicate a failed save or workflow.',
      'Workflow traffic is separate from source POST and application publication polling/read traffic. Request bytes exclude HTTP/TLS headers; decoded response bytes are not compressed wire bytes.',
      'The historical save baseline used 3033 posts; the current pre-test canonical has 3032. Commits and GitHub/network conditions differ; no randomized interleaved control was measured.',
      'Browser large-queue memory safety and the full editor save interaction are outside these small disposable control-page samples.',
      'Missing evidence remains incomplete; no zero-valued timing or original inventory is inferred for absent files.',
    ],
  };
}

export function measurementTable(analysis) {
  const ms = value => number(value) === null ? 'pending' : value.toFixed(1);
  const lines = [
    `Measurement evidence complete: ${analysis.complete}`,
    '| Title sample | Durable notification ms | Independent durable read ms | Enqueue ms | UI paint ms | Queue incl. debounce ms | Remote after sending ms | Server POST ms | Calls/writes | GitHub request bytes | Browser request bytes | Runner ready since click ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...analysis.samples.map(sample => `| ${sample.sample} | ${ms(sample.durableNotificationMs)} | ${ms(sample.independentDurableReadMs)} | ${ms(sample.enqueueMs)} | ${ms(sample.uiPaintMs)} | ${ms(sample.queueIncludingDebounceMs)} | ${ms(sample.remoteExcludingDebounceMs)} | ${ms(sample.serverPost.ms)} | ${sample.serverPost.github.calls}/${sample.serverPost.github.writes} | ${sample.serverPost.github.requestBytes} | ${sample.serverPost.browserRequestBytes} | ${ms(sample.publication.runnerReadyResponseSinceBrowserClickMs)} |`),
    '| Workflow title sample | GitHub calls/writes | Request bytes | Decoded response bytes | Browser public-observation upper bound ms |',
    '|---|---:|---:|---:|---:|',
    ...analysis.samples.map(sample => {
      const github = sample.publication.workflow?.github;
      return `| ${sample.sample} | ${github ? github.calls + '/' + github.writes : 'pending'} | ${github?.requestBytes ?? 'pending'} | ${github?.decodedResponseBytes ?? 'pending'} | ${ms(sample.publication.browserObservedUpperBoundMs)} |`;
    }),
    `Source POST median: ${ms(analysis.sourcePostComparison.before.medianMs)} -> ${ms(analysis.sourcePostComparison.after.medianMs)} ms.`,
  ];
  if (analysis.issues.length) lines.push('Outstanding evidence: ' + analysis.issues.join('; '));
  return lines.join('\n');
}

async function selfCheck() {
  const source = 'a'.repeat(40);
  const trace = parseWorkflowTrace('runner\tstep\t2026-11-05T00:00:00Z ' + JSON.stringify({
    method:'PATCH',host:'api.github.com',path:'/repos/o/r/git/refs/heads/public-ready%2Fmain',
    startedAt:1000,ms:25,requestBytes:11,responseBytes:13,bodyComplete:true,status:200,
  }) + '\nrunner prefix ' + JSON.stringify({sourceCommit:source,publicationCommit:'b'.repeat(40),state:'published'}) + '\nHEAD is now at abc123');
  assert.equal(trace.calls.length, 1);
  assert.equal(trace.result.sourceCommit, source);
  assert.equal(readyResponse(trace).responseAt, 1025);
  const traffic = summarizeCalls([...trace.calls,{method:'GET',host:'raw.githubusercontent.com',requestBytes:0,responseBytes:7,bodyComplete:true,status:200}]);
  assert.equal(traffic.calls, 2);
  assert.equal(traffic.writes, 1);
  assert.equal(traffic.requestBytes, 11);
  assert.equal(traffic.decodedResponseBytes, 20);
  const graphQL = {method:'POST',host:'api.github.com',path:'/graphql',requestBytes:11,responseBytes:13,bodyComplete:true,status:200};
  const queries = rowTraffic([
    {method:'GET',path:'/api/content?kind=categories&refresh=1',trace:{calls:[graphQL]}},
    {method:'GET',path:'/api/content?kind=post&id=x',trace:{calls:[graphQL]}},
    {method:'POST',path:'/api/content',trace:{calls:[graphQL]}},
  ]);
  assert.equal(queries.github.writes, 2, 'Only the bound category read query is classified read-only');
  assert.equal(queries.github.readOnlyPosts, 1);
  assert.equal(queries.github.requestBytes, 33);

  assert.equal(median([3,1,2]), 2);
  assert.equal(median([]), null);
  assert.equal(inventoryEvidence(null, null).complete, false);
  assert.equal(inventoryEvidence({files:{x:'a'},posts:1},{files:{x:'b'},posts:1}).allOriginalFileShasMatch, false);
  const partial = await analyzeMeasurements(path.join(ROOT, '.tmp/__analyzer_missing_evidence_self_check__'));
  assert.equal(partial.complete, false);
  assert.equal(partial.samples.length, 0);
  console.log('Analyzer self-check passed: prefixed JSON, ready timing, traffic, medians and missing/changed inventory.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-check') await selfCheck();
  else {
    const folder = path.resolve(process.argv[2] ?? import.meta.dirname);
    const analysis = await analyzeMeasurements(folder);
    await writeFile(path.join(folder, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
    console.log(measurementTable(analysis));
    if (!analysis.complete) process.exitCode = 2;
  }
}
