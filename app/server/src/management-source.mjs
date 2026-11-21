import { createHash } from 'node:crypto';
import { httpError } from './github.mjs';

const MAX_DOCUMENT = 2 * 1024 * 1024;

function requireValue(condition, message, status = 502) {
  if (!condition) throw httpError(status, message);
}

// Read the file and its save base from the same commit, without a HEAD round trip.
export async function readManagementSource(github, repository, id) {
  const result = await github('/graphql', {
    method: 'POST', readOnly: true,
    body: {
      query: `query ${id ? 'ReadPost' : 'ReadCategories'}($owner: String!, $repo: String!, $branch: String!${id ? ', $path: String!' : ''}) {
        repository(owner: $owner, name: $repo) {
          object(expression: $branch) { ... on Commit {
            oid
            file(path: "categories.json") { mode type object { ... on Blob { text byteSize isBinary } } }
            ${id ? `post: file(path: $path) { mode type object { ... on Tree {
              entries { name mode type oid object { ... on Blob { byteSize } } }
            } } }` : ''}
          } }
        }
      }`,
      variables: {
        owner: repository.owner, repo: repository.repo,
        branch: `refs/heads/${repository.branch}`,
        ...(id ? { path: `posts/${id}` } : {}),
      },
    },
  });
  if (result.errors?.length) {
    const types = result.errors.map(error => error.type);
    const status = types.includes('UNAUTHORIZED') ? 401
      : types.includes('FORBIDDEN') ? 403 : types.includes('NOT_FOUND') ? 404 : 502;
    throw httpError(status, 'GitHub source query failed');
  }
  const record = result.data?.repository?.object;
  requireValue(/^[a-f0-9]{40}$/.test(record?.oid ?? ''), 'Invalid Git SHA');
  const entry = record.file;
  requireValue(entry?.type === 'blob' && entry.mode === 0o100644, 'Canonical categories missing', 409);
  const file = entry.object;
  requireValue(file?.isBinary === false && typeof file.text === 'string', 'Invalid category file');
  const bytes = Buffer.from(file.text);
  requireValue(bytes.length <= MAX_DOCUMENT, 'Category document exceeds 2 MiB', 413);
  requireValue(bytes.length === file.byteSize, 'Incomplete category file');
  const categories = JSON.parse(file.text);
  const source = {
    categories,
    revision: createHash('sha256').update(bytes).digest('hex'),
    contentCommit: record.oid,
  };
  if (!id) return source;

  requireValue(record.post, 'Canonical document missing or ambiguous', 404);
  requireValue(record.post.type === 'tree' && record.post.mode === 0o040000,
    'Unsafe canonical post tree', 409);
  requireValue(Array.isArray(record.post.object?.entries), 'Repository tree is incomplete');
  const entries = record.post.object.entries.map(item => {
    requireValue(typeof item.name === 'string' && item.name.length > 0 && !item.name.includes('/') &&
      !['.', '..'].includes(item.name), 'Unsafe canonical post tree', 409);
    return {
      path: `posts/${id}/${item.name}`, type: item.type,
      mode: item.mode.toString(8), sha: item.oid, size: item.object?.byteSize,
    };
  });
  return { ...source, entries };
}
