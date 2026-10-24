import { createHash, randomUUID } from 'node:crypto';
import { createGitHubClient, httpError } from './github.mjs';
import { parseMarkdownDocument, serializeMarkdownDocument, mergeDocumentPatch, canonicalFilename } from '../src/shared/document.mjs';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_ASSET = 5 * 1024 * 1024;
const MAX_WIRE = 4 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const json = (value, status = 200) => Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
});
function requireValue(condition, message, status = 400) {
    if (!condition)
        throw httpError(status, message);
}
function validateDocument(operation) {
    try {
        return operation();
    } catch (error) {
        throw httpError(422, error.message);
    }
}

function uuid(value) {
    requireValue(typeof value === 'string' && UUID.test(value), 'Invalid UUID');
    return value;
}
function commitSha(value) {
    requireValue(typeof value === 'string' && SHA.test(value), 'Invalid Git SHA');
    return value;
}
async function readJson(request, limit = MAX_WIRE) {
    const reader = request.body?.getReader();
    requireValue(reader, 'Request body required');
    const parts = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            throw httpError(413, 'Request too large');
        }
        parts.push(Buffer.from(value));
    }
    try {
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
        requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'JSON object required');
        return value;
    }
    catch {
        throw httpError(400, 'Invalid JSON');
    }
}
function flatName(name) {
    requireValue(typeof name === 'string' && name.length > 0, 'Asset name required');
    requireValue(Buffer.byteLength(name) <= 200, 'Asset name is too long');
    requireValue(!/[\\/\u0000-\u001f\u007f]/.test(name), 'Asset name must be flat');
    requireValue(name !== '.' && name !== '..' && !/[. ]$/.test(name), 'Invalid asset name');
    const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
    requireValue(!reservedName && !/\.md$/i.test(name), 'Reserved asset name');
    return name;
}

export async function handleContentRequest(request, { token, config, fetcher, connection }) {
    const github = createGitHubClient(token, fetcher);
    const content = `/repos/${config.content.owner}/${config.content.repo}`;
    const app = `/repos/${config.app.owner}/${config.app.repo}`;
    const call = (path, options) => github(content + path, options);
    const blob = async (sha) => {
        const value = await call('/git/blobs/' + commitSha(sha));
        requireValue(value.encoding === 'base64' && typeof value.content === 'string', 'Invalid Git blob', 502);
        return Buffer.from(value.content.replace(/\s/g, ''), 'base64');
    };
    const head = async () => (await call('/git/ref/heads/' + encodeURIComponent(config.content.branch))).object.sha;
    const snapshot = async (commit) => {
        const record = await call('/git/commits/' + commitSha(commit));
        const result = await call('/git/trees/' + record.tree.sha + '?recursive=1');
        requireValue(!result.truncated && Array.isArray(result.tree), 'Repository tree is incomplete', 502);
        return {
            commit, treeSha: record.tree.sha, entries: result.tree
        };
    };
    const readCategories = async (tree) => {
        const entry = tree.entries.find(entry => entry.path === 'categories.json' && entry.type === 'blob' && entry.mode === '100644');
        requireValue(entry, 'Canonical categories missing', 409);
        const bytes = await blob(entry.sha);
        return { categories: JSON.parse(bytes.toString('utf8')), revision: digest(bytes) };
    };
    const readPost = async (tree, id) => {
        uuid(id);
        const prefix = `posts/${id}/`;
        const files = tree.entries.filter(entry => entry.path.startsWith(prefix));
        requireValue(files.every(entry => entry.type === 'blob' && entry.mode === '100644' && !entry.path.slice(prefix.length).includes('/')), 'Unsafe canonical post tree', 409);
        const documents = files.filter(entry => entry.path.endsWith('.md'));
        requireValue(documents.length === 1, 'Canonical document missing or ambiguous', 404);
        const bytes = await blob(documents[0].sha);
        const parsed = validateDocument(() => parseMarkdownDocument(bytes.toString('utf8')));
        requireValue(parsed.documentMode === 'full' && parsed.metadata.id === id, 'Canonical document ID mismatch', 409);
        return {
            document: { metadata: parsed.metadata, markdown: parsed.markdown },
            filename: documents[0].path.slice(prefix.length), path: documents[0].path,
            revision: digest(bytes),
            assets: files.filter(entry => !entry.path.endsWith('.md')).map(entry => ({
                name: entry.path.slice(prefix.length), sha: entry.sha, size: entry.size
            })),
        };
    };
    const requestBranch = requestId => 'heads/cms/requests/' + uuid(requestId);
    const existingCandidate = async (requestId) => {
        try {
            return (await call('/git/ref/' + requestBranch(requestId))).object.sha;
        }
        catch (error) {
            if (error.status === 404)
                return null;
            throw error;
        }
    };
    const verifyCandidate = async (requestId, candidate) => {
        commitSha(candidate);
        requireValue(await existingCandidate(requestId) === candidate, 'Candidate does not match request branch', 409);
        const record = await call('/git/commits/' + candidate);
        requireValue(record.message?.startsWith(`cms-request:${requestId}\npayload-sha256:`) && record.parents?.length === 1, 'Invalid candidate provenance', 409);
        return record;
    };
    const runTitle = (id, candidate) => `cms:${id}:${candidate}`;
    const findRun = async (id, candidate, excludeId) => {
        for (let page = 1; ; page++) {
            const result = await github(`${app}/actions/workflows/${config.workflow}/runs?per_page=100&event=workflow_dispatch&page=${page}`);
            const runs = result.workflow_runs ?? [];
            const run = runs.find(run => run.display_title === runTitle(id, candidate) && run.id !== excludeId);
            if (run) return run;
            if (runs.length < 100) return null;
        }
    };
    const dispatch = async (requestId, candidate, base) => {
        let run = await findRun(requestId, candidate);
        const previousRunId = run?.status === 'completed' && run.conclusion !== 'success' ? run.id : undefined;
        if (previousRunId) run = null;
        if (!run) {
            try {
                const response = await github(`${app}/actions/workflows/${config.workflow}/dispatches`, {
                    method: 'POST', body: { ref: config.app.branch, inputs: {
                            request_id: requestId, candidate_sha: candidate, base_sha: base
                        } },
                });
                const runId = response?.workflow_run_id ?? response?.run_id ?? response?.id;
                if (runId)
                    run = { id: runId, html_url: response.html_url ?? response.run_url };
            }
            catch (error) {
                run = await findRun(requestId, candidate, previousRunId);
                if (!run)
                    throw error;
            }
            if (!run)
                run = await findRun(requestId, candidate, previousRunId);
        }
        requireValue(run?.id, 'Workflow accepted; run is not visible yet. Resume this request.', 503);
        return {
            requestId, candidateCommit: candidate, baseCommit: base, runId: run.id, runUrl: run.html_url, state: 'validating'
        };
    };
    const writeBlob = async (bytes) => (await call('/git/blobs', { method: 'POST', body: { content: bytes.toString('base64'), encoding: 'base64' } })).sha;
    try {
        const url = new URL(request.url);
        if (url.pathname === '/api/assets' && request.method === 'POST') {
            const input = await readJson(request);
            let bytes;
            if (Object.hasOwn(input, 'content')) {
                requireValue(!Object.hasOwn(input, 'chunks') && typeof input.content === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content), 'Invalid base64');
                bytes = Buffer.from(input.content, 'base64');
                requireValue(bytes.toString('base64') === input.content, 'Invalid base64 padding');
            }
            else {
                requireValue(Array.isArray(input.chunks) && input.chunks.length > 0 && input.chunks.length <= 32, 'Invalid chunks');
                const parts = [];
                let size = 0;
                for (const sha of input.chunks) {
                    const part = await blob(commitSha(sha));
                    size += part.length;
                    requireValue(size <= MAX_ASSET, 'Asset exceeds 5 MiB', 413);
                    parts.push(part);
                }
                bytes = Buffer.concat(parts);
            }
            requireValue(bytes.length > 0 && bytes.length <= MAX_ASSET, 'Invalid asset size', 413);
            return json({ sha: await writeBlob(bytes), size: bytes.length });
        }
        if (url.pathname === '/api/content' && request.method === 'GET') {
            const contentCommit = await head();
            const tree = await snapshot(contentCommit);
            const categories = await readCategories(tree);
            const kind = url.searchParams.get('kind');
            if (kind === 'categories')
                return json({ ...categories, contentCommit });
            if (kind === 'new') {
                const date = new Date().toISOString();
                const document = { metadata: {
                        schema_version: 1, id: randomUUID(), title: '', parent_id: null, created: date, updated: date
                    }, markdown: '' };
                return json({
                    document, revision: null, contentCommit, categories: categories.categories, assets: []
                });
            }
            requireValue(kind === 'post', 'Invalid content kind');
            const post = await readPost(tree, url.searchParams.get('id'));
            const { path, ...result } = post;
            return json({
                ...result, contentCommit, categories: categories.categories
            });
        }
        if (url.pathname === '/api/content' && request.method === 'POST') {
            const input = await readJson(request);
            const { requestId, baseCommit, operation } = input;
            uuid(requestId);
            commitSha(baseCommit);
            requireValue(operation && typeof operation === 'object', 'Operation required');
            const fingerprint = digest(JSON.stringify(input));
            const message = `cms-request:${requestId}\npayload-sha256:${fingerprint}`;
            const existing = await existingCandidate(requestId);
            if (existing) {
                const record = await verifyCandidate(requestId, existing);
                requireValue(record.message === message && record.parents[0].sha === baseCommit, 'Request ID already used for different content', 409);
                return json(await dispatch(requestId, existing, baseCommit));
            }
            requireValue(await head() === baseCommit, 'Canonical branch changed', 409);
            const tree = await snapshot(baseCommit);
            const changes = [];
            let unchanged = false;
            if (operation.type === 'categories.save') {
                const current = await readCategories(tree);
                requireValue(operation.baseRevision === current.revision, 'Categories revision changed', 409);
                requireValue(Array.isArray(operation.categories), 'Invalid categories', 422);
                const ids = new Set();
                const merged = operation.categories.map(item => {
                    requireValue(item && typeof item === 'object', 'Category object required', 422);
                    requireValue(typeof item.id === 'string' && !ids.has(item.id), 'Invalid or duplicate category ID', 422);
                    requireValue(typeof item.name === 'string', 'Category name must be a string', 422);
                    const validParent = item.parent_id === null || typeof item.parent_id === 'string';
                    requireValue(validParent, 'Invalid category parent', 422);
                    requireValue(Number.isSafeInteger(item.order) && item.order >= 0, 'Invalid category order', 422);
                    ids.add(item.id);
                    const original = current.categories.find(category => category.id === item.id);
                    const category = original ?? {id:item.id, sources:[item.id]};
                    return {
                        ...category,
                        name:item.name,
                        parent_id:item.parent_id,
                        order:item.order,
                    };
                });
                requireValue(ids.has('group:unclassified'), 'Cannot delete unclassified category', 422);
                for (const item of merged) {
                    const visited = new Set([item.id]);
                    let parent = item.parent_id;
                    while (parent !== null) {
                        requireValue(ids.has(parent) && !visited.has(parent), 'Invalid category ancestry', 422);
                        visited.add(parent);
                        parent = merged.find(category => category.id === parent).parent_id;
                    }
                }
                unchanged = JSON.stringify(merged) === JSON.stringify(current.categories);
                changes.push({
                    path: 'categories.json', mode: '100644', type: 'blob', sha: await writeBlob(Buffer.from(JSON.stringify(merged, null, 2) + '\n'))
                });
            }
            else {
                requireValue(['post.create', 'post.update', 'post.delete'].includes(operation.type), 'Unknown operation');
                let document;
                let original;
                let id;
                if (operation.type === 'post.create') {
                    requireValue(operation.document?.metadata, 'Document required', 422);
                    id = uuid(operation.document.metadata.id);
                    requireValue(!tree.entries.some(entry => entry.path.startsWith(`posts/${id}/`)), 'Post already exists', 409);
                    document = operation.document;
                }
                else {
                    id = uuid(operation.id);
                    original = await readPost(tree, id);
                    requireValue(operation.baseRevision === original.revision, 'Document revision changed', 409);
                    if (operation.type === 'post.update')
                        document = validateDocument(() => mergeDocumentPatch(original.document, {
                            id, baseRevision: operation.baseRevision, changes: operation.changes ?? {}, markdown: operation.markdown ?? original.document.markdown
                        }, original.revision));
                }
                if (operation.type === 'post.delete') {
                    for (const entry of tree.entries.filter(entry => entry.path.startsWith(`posts/${id}/`)))
                        changes.push({
                            path: entry.path, mode: entry.mode, type: 'blob', sha: null
                        });
                }
                else {
                    requireValue(operation.assets === undefined || Array.isArray(operation.assets), 'Invalid assets');
                    const assets = operation.assets ?? [];
                    for (const asset of assets) {
                        const validRecord = asset !== null && typeof asset === 'object' && !Array.isArray(asset);
                        requireValue(validRecord, 'Asset record must be an object');
                    }
                    const documentUnchanged = original && JSON.stringify(original.document) === JSON.stringify(document);
                    const assetsUnchanged = assets.every(asset => {
                        return original?.assets.some(current => {
                            return current.name === asset.name && current.sha === asset.sha && current.size === asset.size;
                        });
                    });
                    unchanged = documentUnchanged && assetsUnchanged;
                    const text = validateDocument(() => serializeMarkdownDocument(document));
                    const path = `posts/${id}/${canonicalFilename(document.metadata.title)}`;
                    if (original && original.path !== path)
                        changes.push({
                            path: original.path, mode: '100644', type: 'blob', sha: null
                        });
                    changes.push({
                        path, mode: '100644', type: 'blob', sha: await writeBlob(Buffer.from(text))
                    });
                    const names = new Set();
                    for (const asset of assets) {
                        const name = flatName(asset.name);
                        requireValue(!names.has(name), 'Duplicate asset name');
                        names.add(name);
                        const bytes = await blob(commitSha(asset.sha));
                        requireValue(Number.isSafeInteger(asset.size) && bytes.length === asset.size && bytes.length > 0 && bytes.length <= MAX_ASSET, 'Invalid asset size');
                        const previous = original?.assets.find(item => item.name === name);
                        requireValue(!previous || previous.sha === asset.sha, 'Asset filename collision', 409);
                        changes.push({
                            path: `posts/${id}/${name}`, mode: '100644', type: 'blob', sha: asset.sha
                        });
                    }
                }
            }
            if (unchanged)
                return json({
                    state: 'unchanged', requestId, contentCommit: baseCommit
                });
            const nextTree = await call('/git/trees', { method: 'POST', body: { base_tree: tree.treeSha, tree: changes } });
            const candidate = await call('/git/commits', { method: 'POST', body: {
                    message, tree: nextTree.sha, parents: [baseCommit]
                } });
            try {
                await call('/git/refs', { method: 'POST', body: { ref: 'refs/' + requestBranch(requestId), sha: candidate.sha } });
            }
            catch (error) {
                if (error.status !== 422)
                    throw error;
                const concurrent = await existingCandidate(requestId);
                const record = await verifyCandidate(requestId, concurrent);
                requireValue(record.message === message && record.parents[0].sha === baseCommit, 'Request ID conflict', 409);
                return json(await dispatch(requestId, concurrent, baseCommit));
            }
            return json(await dispatch(requestId, candidate.sha, baseCommit));
        }
        if (url.pathname === '/api/publish') {
            const input = request.method === 'POST' ? await readJson(request) : Object.fromEntries(url.searchParams);
            const { requestId, candidateCommit } = input;
            const candidate = await verifyCandidate(requestId, candidateCommit);
            if (request.method === 'POST')
                return json(await dispatch(requestId, candidateCommit, candidate.parents[0].sha));
            requireValue(request.method === 'GET', 'Method not allowed', 405);
            requireValue(/^\d+$/.test(String(input.runId)), 'Invalid run ID');
            const run = await github(`${app}/actions/runs/${input.runId}`);
            requireValue(run.display_title === runTitle(requestId, candidateCommit) && (run.event === undefined || run.event === 'workflow_dispatch') && (run.path === undefined || run.path.startsWith('.github/workflows/' + config.workflow)), 'Workflow does not match request', 409);
            const current = await head();
            let accepted = current === candidateCommit;
            let canonicalConflict = false;
            let sourceDescendsCandidate = false;
            if (!accepted) {
                const comparison = await call(`/compare/${candidateCommit}...${current}`);
                sourceDescendsCandidate = comparison.status === 'ahead';
                accepted = sourceDescendsCandidate || comparison.status === 'identical';
                canonicalConflict = !accepted && current !== candidate.parents[0].sha;
            }
            let deployConclusion;
            if (accepted && run.status === 'completed') {
                let jobsPath = `${app}/actions/runs/${input.runId}`;
                if (run.run_attempt !== undefined) {
                    requireValue(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'Invalid workflow attempt', 502);
                    jobsPath += `/attempts/${run.run_attempt}`;
                }
                const deploymentSteps = [];
                for (let page = 1; ; page++) {
                    const result = await github(`${jobsPath}/jobs?per_page=100&page=${page}`);
                    requireValue(Array.isArray(result.jobs), 'Invalid workflow jobs response', 502);
                    for (const job of result.jobs) {
                        for (const step of job.steps ?? []) {
                            if (step.name === 'Deploy preview') deploymentSteps.push(step);
                        }
                    }
                    if (result.jobs.length < 100) break;
                }
                if (deploymentSteps.length > 0) {
                    if (deploymentSteps.every(step => step.conclusion === 'success')) {
                        deployConclusion = 'success';
                    } else if (deploymentSteps.every(step => step.conclusion === 'skipped')) {
                        deployConclusion = 'skipped';
                    }
                }
            }
            let state = 'validating';
            if (accepted) {
                state = 'saved';
                if (run.status === 'completed') {
                    state = 'pending';
                    if (run.conclusion === 'success' && deployConclusion === 'success') {
                        state = 'published';
                    } else if (sourceDescendsCandidate && deployConclusion === 'skipped') {
                        state = 'superseded';
                    }
                }
            } else if (canonicalConflict) {
                state = 'failed';
            } else if (run.status === 'completed') {
                state = 'failed';
            }
            const result = {state, runUrl:run.html_url};
            if (accepted) {
                result.contentCommit = candidateCommit;
                result.commitUrl = `https://github.com/${config.content.owner}/${config.content.repo}/commit/${candidateCommit}`;
            }
            if (canonicalConflict) {
                result.error = 'Canonical branch conflict: this candidate was not saved. Reload the original and submit a new request.';
            } else if (state === 'failed' || state === 'pending') {
                result.error = 'Publication did not complete; resume this request.';
            }
            return json(result);
        }
        throw httpError(404, 'Unknown content route');
    }
    catch (error) {
        if (error.status)
            return json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
        throw error;
    }
}
