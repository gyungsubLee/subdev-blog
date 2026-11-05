import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { httpError } from './github.mjs';
import { createManagementGitHubClient, readCachedCategories, invalidateCategoryCache } from './management-read-cache.mjs';
import { readReadyPublicSource } from './public-publication.mjs';
import { parseMarkdownDocument, serializeMarkdownDocument, mergeDocumentPatch, canonicalFilename } from '../../shared/document.mjs';
import { EDITOR_FILENAME, isEditorFilename, validateEditorDocument } from '../../shared/editor-document.mjs';
import { validateContent, toPublicPost } from '../../content/src/content.mjs';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_ASSET = 5 * 1024 * 1024;
const MAX_WIRE = 4 * 1024 * 1024;
// Saved source files must fit the public runtime file limit.
const MAX_DOCUMENT = 2 * 1024 * 1024;
const MAX_INLINE_FILE = 64 * 1024;
const MAX_INLINE_TREE = 1024 * 1024;
let catalogFile;
function readCatalog() {
    catalogFile ??= readFile(new URL('../generated/content-catalog.json', import.meta.url), 'utf8')
        .then(JSON.parse)
        .catch(error => {
            if (error.code === 'ENOENT') return null;
            throw httpError(502, 'Invalid structural content catalog');
        });
    return catalogFile;
}
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
    let decoded = name;
    try {
        for (let count = 0; count < 5; count++) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
            if (!/%[a-f0-9]{2}/i.test(decoded)) break;
            requireValue(count < 4, 'Repeated asset path encoding');
        }
    } catch {
        throw httpError(400, 'Invalid asset path encoding');
    }
    requireValue(!/[\\/<>:"|?*\u0000-\u001f\u007f]/.test(decoded), 'Asset name must be flat');
    requireValue(decoded !== '.' && decoded !== '..' && !/[. ]$/.test(decoded), 'Invalid asset name');
    const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(decoded);
    requireValue(!reservedName && !/\.md$/i.test(decoded) && !isEditorFilename(decoded), 'Reserved asset name');
    return name;
}

function graphQLError(errors) {
    const types = errors.map(error => error.type);
    const stale = types.includes('STALE_DATA') || errors.some(error =>
        /Expected branch to point to .* but it did not/.test(error.message ?? ''));
    const status = types.includes('UNAUTHORIZED') ? 401
        : types.includes('FORBIDDEN') ? 403
        : stale ? 409
        : types.some(type => ['UNPROCESSABLE', 'GRAPHQL_VALIDATION_FAILED'].includes(type)) ? 422
        : types.includes('RATE_LIMITED') ? 503 : 502;
    return httpError(status, 'Atomic source save rejected');
}

export async function handleContentRequest(request, { token, config, fetcher, catalog }) {
    const categoryRead = request.method === 'GET' && new URL(request.url).pathname === '/api/content' &&
        new URL(request.url).searchParams.get('kind') === 'categories';
    const invalidatesCategories = request.method === 'POST' &&
        ['/api/content', '/api/publish'].includes(new URL(request.url).pathname);
    if (invalidatesCategories) invalidateCategoryCache(config, fetcher);
    const github = createManagementGitHubClient(token, config, fetcher);
    const content = `/repos/${config.content.owner}/${config.content.repo}`;
    const call = (path, options) => github(content + path, options);
    const blobSizes = new Map();
    const blobBytes = new Map();
    const inlineBlobs = new Map();
    let atomic = false;
    const blob = async (sha) => {
        if (blobBytes.has(sha)) return blobBytes.get(sha);
        const value = await call('/git/blobs/' + commitSha(sha));
        requireValue(value.encoding === 'base64' && typeof value.content === 'string', 'Invalid Git blob', 502);
        const bytes = Buffer.from(value.content.replace(/\s/g, ''), 'base64');
        blobSizes.set(sha, bytes.length);
        blobBytes.set(sha, bytes);
        return bytes;
    };
    const head = async () => commitSha((await call('/git/ref/heads/' + encodeURIComponent(config.content.branch))).object.sha);
    const snapshot = async (commit, recursive = true) => {
        const record = await call('/git/commits/' + commitSha(commit));
        const result = await call('/git/trees/' + record.tree.sha + (recursive ? '?recursive=1' : ''));
        requireValue(!result.truncated && Array.isArray(result.tree), 'Repository tree is incomplete', 502);
        return {
            commit, record, treeSha: record.tree.sha, entries: result.tree
        };
    };
    const readCategories = async (tree) => {
        const entry = tree.entries.find(entry => entry.path === 'categories.json' && entry.type === 'blob' && entry.mode === '100644');
        requireValue(entry, 'Canonical categories missing', 409);
        const bytes = await blob(entry.sha);
        requireValue(bytes.length <= MAX_DOCUMENT, 'Category document exceeds 2 MiB', 413);
        return { categories: JSON.parse(bytes.toString('utf8')), revision: digest(bytes) };
    };
    const readPost = async (tree, id, {recoverEditor = false} = {}) => {
        uuid(id);
        const prefix = `posts/${id}/`;
        const files = tree.entries.filter(entry => entry.path.startsWith(prefix));
        requireValue(files.every(entry => entry.type === 'blob' && entry.mode === '100644' && !entry.path.slice(prefix.length).includes('/')), 'Unsafe canonical post tree', 409);
        const editorFiles = files.filter(entry => isEditorFilename(entry.path.slice(prefix.length)));
        requireValue(editorFiles.length <= 1 && editorFiles.every(entry => entry.path === prefix + EDITOR_FILENAME), 'Reserved editor filename', 409);
        const documents = files.filter(entry => entry.path.endsWith('.md'));
        requireValue(documents.length === 1, 'Canonical document missing or ambiguous', 404);
        const bytes = await blob(documents[0].sha);
        requireValue(bytes.length <= MAX_DOCUMENT, 'Markdown document exceeds 2 MiB', 413);
        const parsed = validateDocument(() => parseMarkdownDocument(bytes.toString('utf8')));
        requireValue(parsed.documentMode === 'full' && parsed.metadata.id === id, 'Canonical document ID mismatch', 409);
        const editorFile = files.find(entry => entry.path === prefix + EDITOR_FILENAME);
        let editor = null;
        let editorRevision = null;
        let editorError;
        let editorRaw;
        if (editorFile) {
            const editorBytes = await blob(editorFile.sha);
            editorRevision = digest(editorBytes);
            try {
                requireValue(editorBytes.length <= MAX_DOCUMENT, 'Editor document exceeds 2 MiB', 413);
                editor = validateDocument(() => validateEditorDocument(JSON.parse(editorBytes.toString('utf8')), {
                    documentId: id, markdownHash: digest(parsed.markdown),
                }));
            } catch (error) {
                if (!recoverEditor) throw error;
                editorError = error.message;
                if (editorBytes.length <= MAX_DOCUMENT) editorRaw = editorBytes.toString('utf8');
            }
        }
        return {
            document: { metadata: parsed.metadata, markdown: parsed.markdown },
            editor, editorRevision, editorError, editorRaw,
            filename: documents[0].path.slice(prefix.length), path: documents[0].path,
            revision: digest(bytes),
            assets: files.filter(entry => !entry.path.endsWith('.md') && entry.path !== prefix + EDITOR_FILENAME).map(entry => ({
                name: entry.path.slice(prefix.length), sha: entry.sha, size: entry.size
            })),
        };
    };
    const requestBranch = requestId => 'heads/cms/requests/' + uuid(requestId);
    const existingCandidate = async (requestId) => {
        try {
            return commitSha((await call('/git/ref/' + requestBranch(requestId))).object.sha);
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
        const expectedMessage = new RegExp(`^cms-request:${requestId}\\npayload-sha256:[a-f0-9]{64}$`);
        const validProvenance = expectedMessage.test(record.message) && record.parents?.length === 1
            && SHA.test(record.parents[0]?.sha);
        requireValue(validProvenance, 'Invalid candidate provenance', 409);
        return record;
    };
    const acceptedCandidate = async (requestId, candidate, base, current) => {
        if (current !== candidate) {
            if (current === base) return null;
            const comparison = await call(`/compare/${candidate}...${current}`);
            if (!['ahead', 'identical'].includes(comparison.status)) return null;
        }
        return {
            state: current === candidate ? 'saved' : 'superseded',
            requestId, candidateCommit: candidate, contentCommit: current, baseCommit: base,
            commitUrl: `https://github.com/${config.content.owner}/${config.content.repo}/commit/${candidate}`,
        };
    };
    const publicationStatus = async (sourceCommit) => {
        const ready = await readReadyPublicSource({
            repository: config.content.owner + '/' + config.content.repo,
            branch: config.content.branch, github: call, fetcher: fetcher ?? globalThis.fetch,
        });
        const result = {state: 'saved'};
        if (!ready) return result;
        result.publicCommit = ready.sourceCommit;
        const comparison = ready.sourceCommit === sourceCommit ? 'identical'
            : (await call(`/compare/${sourceCommit}...${ready.sourceCommit}`)).status;
        if (['ahead', 'identical'].includes(comparison)) result.state = 'published';
        return result;
    };
    const applyCandidate = async (requestId, candidate, base, validated = false, bulk = false) => {
        let current = await head();
        let accepted = await acceptedCandidate(requestId, candidate, base, current);
        if (accepted) return accepted;
        requireValue(current === base, 'Canonical branch conflict: reload the original and submit a new request.', 409);
        if (!validated) await validatePendingCandidate(candidate, base, bulk);

        let updateError;
        try {
            await call('/git/refs/heads/' + encodeURIComponent(config.content.branch), {
                method: 'PATCH', body: {sha: candidate, force: false},
            });
        } catch (error) {
            // A lost response can still leave the candidate accepted by GitHub.
            updateError = error;
        }
        current = await head();
        accepted = await acceptedCandidate(requestId, candidate, base, current);
        if (accepted) return accepted;
        requireValue(current === base, 'Canonical branch conflict: this candidate was not saved.', 409);
        if (updateError) throw updateError;
        throw httpError(503, 'Canonical update is not visible yet. Resume this request.');
    };
    const readDocuments = async (tree, loaded = new Map(), requireReferences = false) => {
        const filesById = new Map();
        for (const entry of tree.entries) {
            if (!entry.path.startsWith('posts/')) continue;
            const parts = entry.path.split('/');
            if (parts.length < 3) continue;
            if (!filesById.has(parts[1])) filesById.set(parts[1], []);
            filesById.get(parts[1]).push(entry);
        }
        const ids = [...filesById.keys()];
        const sourceCatalog = catalog ?? await readCatalog();
        requireValue(sourceCatalog || ids.length <= 64, 'Structural content catalog is missing', 502);
        if (sourceCatalog) {
            requireValue(sourceCatalog.version === 1 && Array.isArray(sourceCatalog.documents), 'Invalid structural content catalog', 502);
        }
        const baseline = new Map((sourceCatalog?.documents ?? []).map(entry => [entry.filename, entry]));
        const documents = new Map();
        let index = 0;
        // ponytail: the build catalog covers unchanged blobs; six lanes read only changed documents. Rebuild the catalog if that delta outgrows request limits.
        await Promise.all(Array.from({length: Math.min(6, ids.length)}, async () => {
            while (index < ids.length) {
                const id = ids[index++];
                uuid(id);
                const files = filesById.get(id);
                requireValue(files.every(entry => entry.type === 'blob' && entry.mode === '100644' && entry.path.split('/').length === 3), 'Unsafe canonical post tree', 409);
                const markdownFiles = files.filter(entry => /\.md$/i.test(entry.path));
                requireValue(markdownFiles.length === 1, 'Canonical document missing or ambiguous', 404);
                const file = markdownFiles[0];
                const cached = baseline.get(file.path);
                const hasEditor = files.some(entry => entry.path === `posts/${id}/${EDITOR_FILENAME}`);
                const matching = cached?.blobSha === file.sha && !hasEditor;
                const hasReferences = Array.isArray(cached?.references);
                if (matching && requireReferences && !hasReferences) {
                    requireValue(ids.length <= 64, 'Structural catalog references are missing', 502);
                }
                if (!loaded.has(id) && matching && (!requireReferences || hasReferences)) {
                    requireValue(cached.metadata?.id === id && /^[a-f0-9]{64}$/.test(cached.revision), 'Invalid structural catalog document', 502);
                    requireValue(!hasReferences || cached.references.every(reference => typeof reference === 'string' && UUID.test(reference)), 'Invalid structural catalog references', 502);
                    const assets = files.filter(entry => !/\.md$/i.test(entry.path)).map(entry => ({
                        name: entry.path.split('/').at(-1), sha: entry.sha, size: entry.size,
                    }));
                    documents.set(id, {
                        metadata: cached.metadata, markdown: '', filename: file.path, revision: cached.revision,
                        assets, allAssets: assets, references: cached.references,
                    });
                    continue;
                }
                const post = loaded.get(id) ?? await readPost(tree, id);
                documents.set(id, {
                    ...post.document, filename: post.path, revision: post.revision,
                    editor: post.editor, editorRevision: post.editorRevision,
                    assets: post.assets, allAssets: post.assets,
                });
            }
        }));
        return documents;
    };
    const categoryDeletionPlan = async (tree, id, mode, categorySource) => {
        requireValue(typeof id === 'string' && id !== 'group:unclassified', 'Cannot delete unclassified category', 422);
        requireValue(['move', 'delete'].includes(mode), 'Choose category deletion mode', 422);
        const current = categorySource ?? await readCategories(tree);
        requireValue(current.categories.some(category => category.id === id), 'Category not found', 404);
        requireValue(!current.categories.some(category => category.parent_id === id), 'Move child categories before deletion', 409);
        const categories = current.categories.filter(category => category.id !== id);
        requireValue(categories.some(category => category.id === 'group:unclassified'), 'Unclassified category is missing', 409);
        const documents = await readDocuments(tree, new Map());
        const corpus = {categories: current.categories, documents};
        validateDocument(() => validateContent(corpus));
        const affectedPostIds = [...documents.keys()]
            .filter(postId => corpus.effectiveCategories.get(postId) === id).sort();
        const changes = [{
            path: 'categories.json', mode: '100644', type: 'blob',
            bytes: Buffer.from(JSON.stringify(categories, null, 2) + '\n'),
        }];
        requireValue(changes[0].bytes.length <= MAX_DOCUMENT, 'Category document exceeds 2 MiB', 413);
        if (mode === 'delete') {
            const deletedIds = new Set(affectedPostIds);
            for (const entry of tree.entries) {
                if (deletedIds.has(entry.path.split('/')[1]) && entry.path.startsWith('posts/')) {
                    changes.push({path: entry.path, mode: entry.mode, type: 'blob', sha: null});
                }
            }
        } else {
            // Updating explicit assignments also moves descendants that inherit them.
            const explicitIds = affectedPostIds.filter(postId => documents.get(postId).metadata.category_id === id);
            let index = 0;
            await Promise.all(Array.from({length: Math.min(6, explicitIds.length)}, async () => {
                while (index < explicitIds.length) {
                    const position = index++;
                    const postId = explicitIds[position];
                    const entry = documents.get(postId);
                    const original = Object.hasOwn(entry, 'editorRevision')
                        ? entry : (await readPost(tree, postId)).document;
                    const document = {
                        metadata: {...original.metadata, category_id: 'group:unclassified'},
                        markdown: original.markdown,
                    };
                    const bytes = Buffer.from(validateDocument(() => serializeMarkdownDocument(document)));
                    requireValue(bytes.length <= MAX_DOCUMENT, 'Markdown document exceeds 2 MiB', 413);
                    changes[position + 1] = {path: entry.filename, mode: '100644', type: 'blob', bytes};
                }
            }));
        }
        return {changes, affectedPostIds, deletedPostIds: mode === 'delete' ? affectedPostIds : []};
    };
    const validateCategoryDeletion = async (tree, previous, categories) => {
        const ids = new Set(categories.map(category => category.id));
        const deleted = previous.filter(category => !ids.has(category.id));
        for (const category of deleted) {
            requireValue(!previous.some(child => child.parent_id === category.id), 'Cannot delete category with children: ' + category.id, 409);
        }
        if (deleted.length > 0) {
            const documents = await readDocuments(tree);
            for (const category of deleted) {
                requireValue(![...documents.values()].some(entry => entry.metadata.category_id === category.id), 'Cannot delete assigned category: ' + category.id, 409);
            }
        }
    };
    const validatePostReferences = (tree, document, categories, creating) => {
        const id = document.metadata.id;
        requireValue(document.metadata.category_id === undefined || categories.some(category => category.id === document.metadata.category_id), 'Missing explicit category', 422);
        if (creating) {
            const existingIds = new Set(tree.entries
                .filter(entry => /^posts\/[^/]+\/[^/]+\.md$/i.test(entry.path))
                .map(entry => entry.path.split('/')[1]));
            const parent = document.metadata.parent_id;
            requireValue(parent === null || (parent !== id && existingIds.has(parent)), 'Missing or invalid parent document', 422);
            existingIds.add(id);
            for (const reference of [...(document.metadata.related_ids ?? []), ...(document.metadata.source_ids ?? [])]) {
                requireValue(existingIds.has(reference), 'Missing document reference: ' + reference, 422);
            }
        }
    };
    const validateAuthoredLinks = async (tree, document, filename, assets, categories) => {
        const sourceCatalog = catalog ?? await readCatalog();
        if (sourceCatalog) {
            requireValue(sourceCatalog.version === 1 && Array.isArray(sourceCatalog.documents), 'Invalid structural content catalog', 502);
        }
        const baseline = new Map((sourceCatalog?.documents ?? []).map(entry => [entry.filename, entry]));
        const documents = new Map();
        const paths = new Map();
        for (const file of tree.entries) {
            const parts = file.path.split('/');
            if (parts.length !== 3 || parts[0] !== 'posts' || !UUID.test(parts[1]) || !/\.md$/i.test(parts[2])) continue;
            const cached = baseline.get(file.path);
            const metadata = cached?.blobSha === file.sha ? cached.metadata : {id: parts[1]};
            documents.set(parts[1], {metadata, markdown: '', filename: file.path});
            paths.set(posix.normalize(file.path), parts[1]);
            if (metadata.legacy_path) paths.set(posix.normalize(metadata.legacy_path), parts[1]);
        }
        const id = document.metadata.id;
        documents.set(id, {...document, filename, assets, allAssets: assets});
        paths.set(posix.normalize(filename), id);
        if (document.metadata.legacy_path) paths.set(posix.normalize(document.metadata.legacy_path), id);
        const projection = {
            categories, documents, paths, allowUnresolvedLinks: true,
            effectiveCategories: new Map([[id, document.metadata.category_id ?? 'group:unclassified']]),
        };
        // Project only this authored body. Discard rewritten output so saved Markdown bytes stay intact.
        validateDocument(() => toPublicPost(projection, id));
    };
    const validatePendingCandidate = async (candidate, base, bulk = false, knownBefore, knownAfter) => {
        // Only the request's validated base and successful Git tree delta enter here.
        // Recovery requests fetch and validate persisted objects again.
        const before = knownBefore ?? await snapshot(base);
        const after = knownAfter ?? await snapshot(candidate);
        const previous = new Map(before.entries.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
        const next = new Map(after.entries.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
        const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(path => {
            const older = previous.get(path);
            const newer = next.get(path);
            return older?.sha !== newer?.sha || older?.mode !== newer?.mode || older?.type !== newer?.type;
        });
        requireValue(changed.length > 0, 'Empty candidate', 409);
        const ids = new Set();
        for (const path of changed) {
            const parts = path.split('/');
            const safePostPath = parts.length === 3 && parts[0] === 'posts' && UUID.test(parts[1])
                && parts[2] && !/[\\\u0000-\u001f]/.test(parts[2]) && !['.', '..'].includes(parts[2]);
            const entry = next.get(path);
            const validMode = !entry || (entry.mode === '100644' && entry.type === 'blob');
            requireValue((path === 'categories.json' || safePostPath) && validMode,
                'Forbidden candidate path or mode: ' + path, 409);
            if (safePostPath) ids.add(parts[1]);
        }
        const categories = await readCategories(after);
        if (changed.includes('categories.json')) {
            if (ids.size > 0 && !bulk) {
                const originalCategories = (await readCategories(before)).categories;
                const removed = originalCategories.filter(category => !categories.categories.some(next => next.id === category.id));
                requireValue(removed.length === 1, 'Candidate must delete exactly one category', 409);
                const hasDeletedPosts = [...ids].some(id => !after.entries.some(entry => entry.path.startsWith(`posts/${id}/`)));
                const plan = await categoryDeletionPlan(before, removed[0].id, hasDeletedPosts ? 'delete' : 'move', {categories: originalCategories});
                const expected = new Map(plan.changes.map(change => [change.path, change]));
                requireValue(changed.length === expected.size, 'Category deletion changes unrelated files', 409);
                for (const path of changed) {
                    const change = expected.get(path);
                    const entry = next.get(path);
                    requireValue(change && (change.sha === null ? !entry : entry), 'Invalid category deletion path: ' + path, 409);
                    if (change.bytes) {
                        requireValue(digest(await blob(entry.sha)) === digest(change.bytes), 'Category deletion changes unrelated content: ' + path, 409);
                    }
                }
                return after;
            }
            requireValue(categories.categories.some(category => category.id === 'group:unclassified'), 'Cannot delete unclassified category', 422);
            validateDocument(() => validateContent({categories: categories.categories, documents: new Map()}));
            await validateCategoryDeletion(bulk ? after : before, (await readCategories(before)).categories, categories.categories);
            if (!bulk) return after;
        }
        requireValue(bulk ? ids.size <= 20 : ids.size === 1, 'Candidate must change one post', 409);
        for (const id of ids) {
        const prefix = `posts/${id}/`;
        const existed = before.entries.some(entry => entry.path.startsWith(prefix));
        const remains = after.entries.some(entry => entry.path.startsWith(prefix));
        const original = existed ? await readPost(before, id) : undefined;
        if (!remains) {
            requireValue(!bulk, 'Bulk save cannot delete posts', 409);
            requireValue(original, 'Deleted candidate document missing', 409);
            continue;
        }
        const post = await readPost(after, id);
        requireValue(!original?.editor || post.editor, 'Candidate removes editor document', 409);
        requireValue(post.filename === canonicalFilename(post.document.metadata.title), 'Candidate filename differs from title', 409);
        requireValue(!original || post.document.metadata.parent_id === original.document.metadata.parent_id, 'Candidate changes immutable document parent', 409);
        validatePostReferences(after, post.document, categories.categories, !original);
        const names = new Set([post.filename.normalize('NFC').toLowerCase()]);
        for (const asset of post.assets) {
            flatName(asset.name);
            const key = asset.name.normalize('NFC').toLowerCase();
            requireValue(!names.has(key), 'Candidate asset filename collision', 409);
            names.add(key);
            const older = original?.assets.find(item => item.name.normalize('NFC').toLowerCase() === key);
            requireValue(!older || (older.name === asset.name && older.sha === asset.sha), 'Candidate replaces a canonical asset', 409);
            if (!older) {
                const bytes = await blob(asset.sha);
                requireValue(bytes.length > 0 && bytes.length <= MAX_ASSET, 'Invalid asset size', 413);
            }
        }
        const retainsAssets = !original || original.assets.every(asset => {
            return post.assets.some(item => item.name === asset.name && item.sha === asset.sha);
        });
        requireValue(retainsAssets, 'Candidate removes canonical assets', 409);
        await validateAuthoredLinks(after, post.document, post.path, post.assets, categories.categories);
        }
        return after;
    };
    const writeBlob = async (bytes) => {
        const { sha } = await call('/git/blobs', { method: 'POST', body: { content: bytes.toString('base64'), encoding: 'base64' } });
        const expected = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        requireValue(sha === expected, 'Uploaded source blob identity mismatch', 502);
        blobSizes.set(sha, bytes.length);
        blobBytes.set(sha, bytes);
        return sha;
    };
    const writeSourceBlob = async bytes => {
        const text = bytes.toString('utf8');
        if (!atomic && (bytes.length > MAX_INLINE_FILE || !Buffer.from(text).equals(bytes))) return writeBlob(bytes);
        const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        blobSizes.set(sha, bytes.length);
        blobBytes.set(sha, bytes);
        inlineBlobs.set(sha, text);
        return sha;
    };
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
            const kind = url.searchParams.get('kind');
            if (categoryRead) {
                const data = await readCachedCategories(token, config, fetcher, async () => {
                    const result = await github('/graphql', {
                        method: 'POST',
                        readOnly: true,
                        body: {
                            query: `query ReadCategories($owner: String!, $repo: String!, $branch: String!) {
                                repository(owner: $owner, name: $repo) {
                                    object(expression: $branch) {
                                        ... on Commit {
                                            oid
                                            file(path: "categories.json") {
                                                mode type
                                                object { ... on Blob { text byteSize isBinary } }
                                            }
                                        }
                                    }
                                }
                            }`,
                            variables: {
                                owner: config.content.owner,
                                repo: config.content.repo,
                                branch: `refs/heads/${config.content.branch}`,
                            },
                        },
                    });
                    if (result.errors?.length) {
                        const types = result.errors.map(error => error.type);
                        const status = types.includes('UNAUTHORIZED') ? 401
                            : types.includes('FORBIDDEN') ? 403 : types.includes('NOT_FOUND') ? 404 : 502;
                        throw httpError(status, 'GitHub category query failed');
                    }
                    const record = result.data?.repository?.object;
                    const entry = record?.file;
                    requireValue(entry?.type === 'blob' && entry.mode === 0o100644, 'Canonical categories missing', 409);
                    const file = entry.object;
                    requireValue(file?.isBinary === false && typeof file.text === 'string', 'Invalid category file', 502);
                    const bytes = Buffer.from(file.text);
                    requireValue(bytes.length <= MAX_DOCUMENT, 'Category document exceeds 2 MiB', 413);
                    requireValue(bytes.length === file.byteSize, 'Incomplete category file', 502);
                    // The file and save base come from the same response; no separate HEAD read.
                    return { categories: JSON.parse(file.text), revision: digest(bytes), contentCommit: commitSha(record.oid) };
                }, url.searchParams.get('refresh') === '1');
                return json(data);
            }
            const contentCommit = await head();
            const tree = await snapshot(contentCommit, !categoryRead);
            const categories = await readCategories(tree);
            if (kind === 'categories')
                return json({ ...categories, contentCommit });
            if (kind === 'new') {
                const date = new Date().toISOString();
                const document = { metadata: {
                        schema_version: 1, id: randomUUID(), title: '', parent_id: null, created: date, updated: date
                    }, markdown: '' };
                return json({
                    document, editor: null, editorRevision: null, revision: null, contentCommit, categories: categories.categories, assets: []
                });
            }
            requireValue(kind === 'post', 'Invalid content kind');
            const post = await readPost(tree, url.searchParams.get('id'), {recoverEditor:true});
            const { path, ...result } = post;
            return json({
                ...result, contentCommit, categories: categories.categories
            });
        }
        if (url.pathname === '/api/content' && request.method === 'POST') {
            const input = await readJson(request);
            const { requestId, baseCommit } = input;
            commitSha(baseCommit);
            atomic = input.saveMode === 'atomic';
            requireValue(input.saveMode === undefined || atomic, 'Unknown save mode');
            if (atomic) {
                requireValue(typeof requestId === 'string' && requestId.startsWith('atomic-'), 'Atomic request namespace required');
                uuid(requestId.slice(7));
            } else uuid(requestId);
            const bulk = Object.hasOwn(input, 'operations');
            requireValue(!bulk || !Object.hasOwn(input, 'operation'), 'Choose one operation contract');
            const operations = bulk ? input.operations : [input.operation];
            requireValue(Array.isArray(operations) && operations.length > 0 && operations.length <= 20, 'Invalid operation count');
            const targets = new Set();
            for (const operation of operations) {
                requireValue(operation && typeof operation === 'object', 'Operation required');
                if (bulk) {
                    requireValue(['categories.save', 'post.create', 'post.update'].includes(operation.type), 'Unsupported bulk operation');
                    const target = operation.type === 'categories.save' ? 'categories' : operation.id ?? operation.document?.metadata?.id;
                    requireValue(typeof target === 'string' && !targets.has(target), 'Duplicate or invalid bulk target');
                    targets.add(target);
                }
            }
            let verifiedSnapshot;
            const withReceipt = async result => {
                if (!bulk) return result;
                const savedTree = verifiedSnapshot?.commit === result.contentCommit ? verifiedSnapshot : await snapshot(result.contentCommit);
                const categories = await readCategories(savedTree);
                const sources = {};
                for (const operation of operations) {
                    if (operation.type === 'categories.save') continue;
                    const id = operation.id ?? operation.document.metadata.id;
                    const {path, ...source} = await readPost(savedTree, id, {recoverEditor:true});
                    sources[id] = {revision:source.revision,editorRevision:source.editorRevision,
                        filename:source.filename,updatedAt:source.document.metadata.updated,contentCommit:result.contentCommit};
                }
                return {...result, sources, categories: {...categories, contentCommit:result.contentCommit},
                    receipt: {requestId, payloadHash:digest(JSON.stringify(input)), contentCommit:result.contentCommit}};
            };
            const fingerprint = digest(JSON.stringify(input));
            const message = `cms-request:${requestId}${atomic ? '\n\n' : '\n'}payload-sha256:${fingerprint}`;
            const existing = atomic ? null : await existingCandidate(requestId);
            if (existing) {
                const record = await verifyCandidate(requestId, existing);
                requireValue(record.message === message && record.parents[0].sha === baseCommit, 'Request ID already used for different content', 409);
                const result = await applyCandidate(requestId, existing, baseCommit, false, bulk);
                const operation = operations[0];
                if (operation.type === 'category.delete') {
                    const plan = await categoryDeletionPlan(await snapshot(baseCommit), operation.id, operation.mode);
                    return json({...result, affectedPostIds: plan.affectedPostIds, deletedPostIds: plan.deletedPostIds});
                }
                return json(await withReceipt(result));
            }
            if (!atomic) requireValue(await head() === baseCommit, 'Canonical branch changed', 409);
            const baseTree = await snapshot(baseCommit);
            const receiptPath = '.cms/requests/' + requestId + '.json';
            if (atomic) requireValue(!baseTree.entries.some(entry => entry.path === receiptPath),
                'Request ID already used for different content', 409);
            const tree = {...baseTree,entries:[...baseTree.entries]};
            const changes = [];
            let allUnchanged = true;
            let deletionPlan;
            const ordered = [...operations].sort((left, right) => Number(right.type === 'categories.save') - Number(left.type === 'categories.save'));
            for (const operation of ordered) {
                let unchanged = false;
                const changeStart = changes.length;
                if (operation.type === 'category.delete') {
                    const current = await readCategories(tree);
                    requireValue(operation.baseRevision === current.revision, 'Categories revision changed', 409);
                    deletionPlan = await categoryDeletionPlan(tree, operation.id, operation.mode, current);
                    let index = 0;
                    await Promise.all(Array.from({length: Math.min(6, deletionPlan.changes.length)}, async () => {
                        while (index < deletionPlan.changes.length) {
                            const position = index++;
                            const {bytes, ...change} = deletionPlan.changes[position];
                            changes[position] = {...change, sha: bytes ? await writeSourceBlob(bytes) : change.sha};
                        }
                    }));
                }
                else if (operation.type === 'categories.save') {
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
                    validateDocument(() => validateContent({categories: merged, documents: new Map()}));
                    if (!bulk) await validateCategoryDeletion(tree, current.categories, merged);
                    unchanged = JSON.stringify(merged) === JSON.stringify(current.categories);
                    const bytes = Buffer.from(JSON.stringify(merged, null, 2) + '\n');
                    requireValue(bytes.length <= MAX_DOCUMENT, 'Category document exceeds 2 MiB', 413);
                    changes.push({
                        path: 'categories.json', mode: '100644', type: 'blob', sha: await writeSourceBlob(bytes)
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
                    if (original?.editor || operation.editor !== undefined || operation.baseEditorRevision !== undefined) {
                        requireValue((operation.baseEditorRevision ?? null) === (original?.editorRevision ?? null), 'Editor revision changed', 409);
                    }
                    if (operation.type === 'post.delete') {
                        for (const entry of tree.entries.filter(entry => entry.path.startsWith(`posts/${id}/`)))
                            changes.push({
                                path: entry.path, mode: entry.mode, type: 'blob', sha: null
                            });
                    }
                    else {
                        let editor = original?.editor ?? null;
                        if (operation.editor !== undefined) {
                            editor = validateDocument(() => validateEditorDocument(operation.editor, {
                                documentId: id, markdownHash: digest(document.markdown),
                            }));
                        } else if (editor) {
                            requireValue(document.markdown === original.document.markdown, 'Body edits require an updated editor document', 422);
                        }
                        const editorBytes = editor ? Buffer.from(JSON.stringify(editor, null, 2) + '\n') : null;
                        requireValue(!editorBytes || editorBytes.length <= MAX_DOCUMENT, 'Editor document exceeds 2 MiB', 413);
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
                        const editorUnchanged = JSON.stringify(original?.editor ?? null) === JSON.stringify(editor);
                        unchanged = documentUnchanged && assetsUnchanged && editorUnchanged;
                        const text = validateDocument(() => serializeMarkdownDocument(document));
                        requireValue(Buffer.byteLength(text) <= MAX_DOCUMENT, 'Markdown document exceeds 2 MiB', 413);
                        const categories = await readCategories(tree);
                        if (!bulk) validatePostReferences(tree, document, categories.categories, operation.type === 'post.create');
                        const path = `posts/${id}/${canonicalFilename(document.metadata.title)}`;
                        const names = new Set();
                        for (const asset of assets) {
                            const name = flatName(asset.name);
                            const key = name.normalize('NFC').toLowerCase();
                            requireValue(!names.has(key), 'Duplicate asset name');
                            names.add(key);
                            const bytes = await blob(commitSha(asset.sha));
                            requireValue(Number.isSafeInteger(asset.size) && bytes.length === asset.size && bytes.length > 0 && bytes.length <= MAX_ASSET, 'Invalid asset size');
                            const previous = original?.assets.find(item => item.name.normalize('NFC').toLowerCase() === key);
                            requireValue(!previous || (previous.name === name && previous.sha === asset.sha), 'Asset filename collision', 409);
                            changes.push({
                                path: `posts/${id}/${name}`, mode: '100644', type: 'blob', sha: asset.sha
                            });
                        }
                        await validateAuthoredLinks(tree, document, path, [...(original?.assets ?? []), ...assets], categories.categories);
                        if (original && original.path !== path)
                            changes.push({
                                path: original.path, mode: '100644', type: 'blob', sha: null
                            });
                        changes.push({
                            path, mode: '100644', type: 'blob', sha: await writeSourceBlob(Buffer.from(text))
                        });
                        if (editorBytes && !editorUnchanged) {
                            changes.push({
                                path: `posts/${id}/${EDITOR_FILENAME}`, mode: '100644', type: 'blob', sha: await writeSourceBlob(editorBytes)
                            });
                        }
                    }
                }
                if (atomic && unchanged) changes.splice(changeStart);
                allUnchanged = allUnchanged && unchanged;
                if (bulk) {
                    const entries = new Map(tree.entries.map(entry => [entry.path, entry]));
                    for (const change of changes.slice(changeStart)) {
                        if (change.sha === null) entries.delete(change.path);
                        else entries.set(change.path, {...change});
                    }
                    tree.entries = [...entries.values()];
                }
            }
            if (allUnchanged && !atomic) {
                verifiedSnapshot = baseTree;
                return json(await withReceipt({state:'unchanged', requestId, contentCommit:baseCommit, publicationPending:true}));
            }
            if (atomic) {
                const entries = new Map(baseTree.entries.map(entry => [entry.path, entry]));
                const atomicChanges = changes.filter(change => {
                    const previous = entries.get(change.path);
                    if (change.sha === null) return Boolean(previous);
                    return previous?.sha !== change.sha || previous.mode !== change.mode || previous.type !== change.type;
                });
                const additions = [];
                const deletions = [];
                // Count every destination before allocating base64. Repeated asset
                // identities share bytes, but each GraphQL destination duplicates them.
                let encodedBytes = 1024;
                for (const change of atomicChanges) {
                    if (change.sha === null) {
                        encodedBytes += Buffer.byteLength(JSON.stringify({path:change.path})) + 1;
                    } else {
                        const bytes = await blob(change.sha);
                        encodedBytes += 4 * Math.ceil(bytes.length / 3) + Buffer.byteLength(change.path) * 6 + 100;
                    }
                }
                const useGitData = encodedBytes > MAX_WIRE;
                for (const change of atomicChanges) {
                    const previous = entries.get(change.path);
                    if (change.sha !== null && previous?.sha === change.sha && previous.mode === change.mode && previous.type === change.type) continue;
                    if (change.sha === null) {
                        entries.delete(change.path);
                        deletions.push({path: change.path});
                    } else {
                        const bytes = await blob(change.sha);
                        entries.set(change.path, {...change, size: bytes.length});
                        if (!useGitData) additions.push({path: change.path, contents: bytes.toString('base64')});
                    }
                }
                const proposed = {...baseTree, entries: [...entries.values()]};
                if (bulk && !allUnchanged) await validatePendingCandidate(baseCommit, baseCommit, true, baseTree, proposed);
                // Immutable receipts grow with accepted requests. Existing recursive-tree
                // limits bound repository capacity; a sharded ledger is the upgrade path.
                const marker = Buffer.from(JSON.stringify({version:1,requestId,payloadHash:fingerprint,baseCommit}));
                const markerSha = await writeSourceBlob(marker);
                additions.push({path:receiptPath,contents:marker.toString('base64')});
                proposed.entries.push({path:receiptPath,sha:markerSha,type:'blob',mode:'100644',size:marker.length});
                let commit;
                let canonical;
                let fallbackResult;
                const reconcile = async () => {
                    const recovered = await github('/graphql',{method:'POST',readOnly:true,body:{
                        query:`query RecoverAtomicSave($owner:String!,$repo:String!,$branch:String!,$path:String!) {
                          repository(owner:$owner,name:$repo) {
                            object(expression:$branch) { ... on Commit {
                              oid file(path:$path) { mode type object { ... on Blob { text byteSize isBinary } } }
                              history(first:1,path:$path) { nodes { oid message tree { oid } parents(first:2) { nodes { oid } } } }
                            } }
                          }
                        }`,
                        variables:{owner:config.content.owner,repo:config.content.repo,branch:'refs/heads/'+config.content.branch,path:receiptPath},
                    }});
                    if (recovered.errors?.length) throw graphQLError(recovered.errors);
                    const source = recovered.data?.repository?.object;
                    requireValue(source && SHA.test(source.oid), 'Invalid reconciliation source', 502);
                    if (!source.file) {
                        requireValue(source.oid === baseCommit, 'Canonical branch changed', 409);
                        return false;
                    }
                    const file = source.file;
                    requireValue(file.type === 'blob' && file.mode === 0o100644 && file.object?.isBinary === false &&
                        file.object.text === marker.toString('utf8') && file.object.byteSize === marker.length,
                        'Request ID already used for different content',409);
                    const record = source.history?.nodes?.[0];
                    requireValue(record?.message === message && record.parents?.nodes?.length === 1 && record.parents.nodes[0].oid === baseCommit,
                        'Invalid request provenance',409);
                    canonical = commitSha(source.oid);
                    commit = {sha:commitSha(record.oid),message:record.message,tree:{sha:commitSha(record.tree?.oid)},parents:[{sha:baseCommit}]};
                    return true;
                };
                if (request.headers.get('X-Content-Reconcile') === '1') await reconcile();
                try {
                    if (!commit && useGitData) {
                        const uploaded = new Set();
                        const delta = [...atomicChanges, {path:receiptPath,sha:markerSha,mode:'100644',type:'blob'}];
                        const treeChanges = [];
                        let inlineBytes = 0;
                        for (const change of delta) {
                            const text = inlineBlobs.get(change.sha);
                            const escapedBytes = text === undefined ? 0 : Buffer.byteLength(JSON.stringify(text));
                            if (text !== undefined && Buffer.byteLength(text) <= MAX_INLINE_FILE && inlineBytes + escapedBytes <= MAX_INLINE_TREE) {
                                inlineBytes += escapedBytes;
                                const {sha,...entry} = change;
                                treeChanges.push({...entry,content:text});
                            } else {
                                if (text !== undefined && !uploaded.has(change.sha)) {
                                    await writeBlob(blobBytes.get(change.sha));
                                    uploaded.add(change.sha);
                                }
                                treeChanges.push(change);
                            }
                        }
                        const nextTree = await call('/git/trees',{method:'POST',body:{base_tree:baseTree.treeSha,tree:treeChanges}});
                        const candidate = await call('/git/commits',{method:'POST',body:{message,tree:nextTree.sha,parents:[baseCommit]}});
                        commit = {sha:commitSha(candidate.sha),message,tree:{sha:commitSha(nextTree.sha)},parents:[{sha:baseCommit}]};
                        fallbackResult = await applyCandidate(requestId,commit.sha,baseCommit,true,bulk);
                    } else if (!commit) {
                        const response = await github('/graphql', {method:'POST', body:{
                            query: `mutation AtomicSave($input: CreateCommitOnBranchInput!) {
                              createCommitOnBranch(input:$input) {
                                commit { oid message tree { oid } parents(first:2) { nodes { oid } } }
                              }
                            }`,
                            variables:{input:{branch:{repositoryNameWithOwner:config.content.owner+'/'+config.content.repo,branchName:config.content.branch},
                                expectedHeadOid:baseCommit, message:{headline:message.split('\n')[0],body:message.split('\n').at(-1)},
                                fileChanges:{additions,deletions},clientMutationId:requestId}},
                        }});
                        if (response.errors?.length) {
                            throw graphQLError(response.errors);
                        }
                        const value = response.data?.createCommitOnBranch?.commit;
                        if (!value || value.message !== message || value.parents?.nodes?.length !== 1 || value.parents.nodes[0].oid !== baseCommit) {
                            throw Object.assign(httpError(409, 'Invalid atomic source receipt'), {invalidProvenance:true});
                        }
                        commit = {sha:commitSha(value.oid),message:value.message,tree:{sha:commitSha(value.tree?.oid)},parents:[{sha:baseCommit}]};
                    }
                } catch (error) {
                    if (error.invalidProvenance || [401,403,422].includes(error.status)) throw error;
                    if (!await reconcile()) throw error;
                }
                // Rebuilding an update generates a new timestamp. A recovered commit
                // therefore needs its actual immutable files, never the retry's delta.
                verifiedSnapshot = canonical ? await snapshot(commit.sha)
                    : {...proposed,commit:commit.sha,record:commit,treeSha:commit.tree.sha};
                github.prime(content+'/git/commits/'+commit.sha,commit);
                github.prime(content+'/git/trees/'+commit.tree.sha+'?recursive=1',{truncated:false,tree:verifiedSnapshot.entries});
                for (const [sha, bytes] of blobBytes) github.prime(content+'/git/blobs/'+sha,{encoding:'base64',content:bytes.toString('base64'),size:bytes.length});
                const result = {
                    state:fallbackResult?.state ?? (canonical && canonical !== commit.sha ? 'superseded' : allUnchanged ? 'unchanged' : 'saved'),
                    requestId,contentCommit:fallbackResult?.contentCommit ?? canonical ?? commit.sha,sourceOnly:true,publicationPending:true,
                    commitUrl:`https://github.com/${config.content.owner}/${config.content.repo}/commit/${commit.sha}`,
                };
                if (result.state === 'superseded') return json(result);
                return json(await withReceipt(deletionPlan ? {...result,affectedPostIds:deletionPlan.affectedPostIds,deletedPostIds:deletionPlan.deletedPostIds} : result));
            }
            let inlineBytes = 0;
            const treeChanges = [];
            for (const change of changes) {
                const text = inlineBlobs.get(change.sha);
                const bytes = text === undefined ? 0 : Buffer.byteLength(JSON.stringify(text));
                if (text !== undefined && inlineBytes + bytes <= MAX_INLINE_TREE) {
                    const {sha, ...entry} = change;
                    treeChanges.push({...entry,content:text});
                    inlineBytes += bytes;
                } else {
                    if (text !== undefined) await writeBlob(blobBytes.get(change.sha));
                    treeChanges.push(change);
                }
            }
            const nextTree = await call('/git/trees', { method: 'POST', body: { base_tree: tree.treeSha, tree: treeChanges } });
            const candidate = await call('/git/commits', { method: 'POST', body: {
                    message, tree: nextTree.sha, parents: [baseCommit]
                } });
            // GitHub has applied this exact delta to the complete base tree.
            // Reuse its known file inventory for validation and the source receipt.
            const candidateEntries = new Map(tree.entries.map(entry => [entry.path, entry]));
            for (const change of changes) {
                if (change.sha === null) candidateEntries.delete(change.path);
                else candidateEntries.set(change.path, { ...change, size: blobSizes.get(change.sha) });
            }
            const sourceSnapshot = {
                commit: candidate.sha,
                record: { sha: candidate.sha, tree: { sha: nextTree.sha }, parents: [{ sha: baseCommit }] },
                treeSha: nextTree.sha,
                entries: [...candidateEntries.values()],
            };
            if (bulk) await validatePendingCandidate(candidate.sha, baseCommit, true, baseTree, sourceSnapshot);
            verifiedSnapshot = sourceSnapshot;
            try {
                await call('/git/refs', { method: 'POST', body: { ref: 'refs/' + requestBranch(requestId), sha: candidate.sha } });
            }
            catch (error) {
                if (error.status !== 422)
                    throw error;
                const concurrent = await existingCandidate(requestId);
                const record = await verifyCandidate(requestId, concurrent);
                requireValue(record.message === message && record.parents[0].sha === baseCommit, 'Request ID conflict', 409);
                const result = await applyCandidate(requestId, concurrent, baseCommit, false, bulk);
                return json(await withReceipt(deletionPlan ? {...result, affectedPostIds: deletionPlan.affectedPostIds, deletedPostIds: deletionPlan.deletedPostIds} : result));
            }
            const result = await applyCandidate(requestId, candidate.sha, baseCommit, true, bulk);
            return json(await withReceipt(deletionPlan ? {...result, affectedPostIds: deletionPlan.affectedPostIds, deletedPostIds: deletionPlan.deletedPostIds} : result));
        }
        if (url.pathname === '/api/publish') {
            requireValue(['GET', 'POST'].includes(request.method), 'Method not allowed', 405);
            const input = request.method === 'POST' ? await readJson(request) : Object.fromEntries(url.searchParams);
            if (request.method === 'GET' && Object.hasOwn(input, 'sourceCommit')) {
                requireValue(!Object.hasOwn(input, 'requestId') && !Object.hasOwn(input, 'candidateCommit'), 'Choose one publication contract');
                const sourceCommit = commitSha(input.sourceCommit);
                const current = await head();
                if (sourceCommit !== current) {
                    let comparison;
                    try { comparison = await call(`/compare/${sourceCommit}...${current}`); }
                    catch (error) {
                        if (error.status === 404) throw httpError(409, 'Source commit is outside the canonical branch');
                        throw error;
                    }
                    requireValue(['ahead', 'identical'].includes(comparison.status), 'Source commit is outside the canonical branch', 409);
                }
                return json({sourceCommit, contentCommit:sourceCommit, ...await publicationStatus(sourceCommit)});
            }
            const { requestId, candidateCommit } = input;
            const candidate = await verifyCandidate(requestId, candidateCommit);
            const baseCommit = candidate.parents[0].sha;
            if (request.method === 'POST') return json(await applyCandidate(requestId, candidateCommit, baseCommit));
            const current = await head();
            const accepted = await acceptedCandidate(requestId, candidateCommit, baseCommit, current);
            if (accepted) {
                const publication = await publicationStatus(candidateCommit);
                if (publication.publicCommit) accepted.publicCommit = publication.publicCommit;
                if (publication.state === 'published') accepted.state = 'published';
                return json(accepted);
            }
            requireValue(current === baseCommit, 'Canonical branch conflict: this candidate was not saved.', 409);
            return json({state: 'pending', requestId, candidateCommit, baseCommit});
        }
        throw httpError(404, 'Unknown content route');
    }
    catch (error) {
        if (error.status)
            return json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
        throw error;
    }
    finally {
        if (invalidatesCategories) invalidateCategoryCache(config, fetcher);
    }
}
