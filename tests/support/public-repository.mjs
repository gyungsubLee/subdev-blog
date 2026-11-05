import { createHash } from 'node:crypto';
import { createGitHubClient } from '../../app/server/src/github.mjs';
import { serializeMarkdownDocument } from '../../app/shared/document.mjs';

export const ID = '12345678-1234-1234-1234-123456789abc';
export const A = 'a'.repeat(40);
export const B = 'b'.repeat(40);
export const REPOSITORY = 'gyungsubLee/subdev-blog-content';
export const categories = [{ id: 'group:unclassified', name: 'Other', parent_id: null, order: 0, sources: [] }];
export const document = (markdown = 'Original body', metadata = {}, id = ID) => serializeMarkdownDocument({
  metadata: { schema_version: 1, id, title: 'Title', parent_id: null, created: '2026-10-24', updated: '2026-10-24', ...metadata }, markdown,
});
const sha = value => createHash('sha1').update(value).digest('hex');

export function publicRepository(files = {}) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const refs = new Map([['main', A]]);
  const calls = [];
  const controls = { failPath: '', compare: null, delay: 0, active: 0, peak: 0 };
  const ancestors = descendant => {
    const seen = new Set();
    const pending = [descendant];
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(commits.get(current)?.parents ?? []).map(parent => parent.sha));
    }
    return seen;
  };
  const put = value => {
    const bytes = Buffer.from(value);
    const id = sha(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
    blobs.set(id, bytes);
    return id;
  };
  const addSource = (commit, extra = {}) => {
    const entries = Object.entries({ 'categories.json': JSON.stringify(categories), [`posts/${ID}/Title.md`]: document(), ...files, ...extra })
      .map(([path, content]) => ({ path, sha: put(content), size: Buffer.byteLength(content), type: 'blob', mode: '100644' }));
    const tree = sha(JSON.stringify(entries));
    trees.set(tree, entries);
    commits.set(commit, { sha: commit, tree: { sha: tree }, parents: [] });
  };
  addSource(A);
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    const pathname = decodeURIComponent(url.pathname);
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: pathname, host: url.host, method, body, signal: options.signal, authorization: options.headers?.Authorization });
    if (controls.failPath && pathname.includes(controls.failPath)) return Response.json({ error: 'injected' }, { status: 503 });
    if (url.host === 'raw.githubusercontent.com') {
      const [, owner, repo, commit, ...parts] = pathname.split('/');
      if (`${owner}/${repo}` !== REPOSITORY) throw Error('Wrong raw repository');
      const entry = trees.get(commits.get(commit)?.tree.sha)?.find(item => item.path === parts.join('/'));
      if (!entry || !blobs.has(entry.sha)) return new Response('Missing', { status: 404 });
      controls.peak = Math.max(controls.peak, ++controls.active);
      try {
        if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
        return new Response(blobs.get(entry.sha));
      } finally { controls.active--; }
    }
    const path = pathname.replace('/repos/' + REPOSITORY, '');
    if (path === '/graphql') {
      if (!body.query.startsWith('query ReadCategories(')) throw Error('Expected category query');
      const commit = refs.get('main');
      const entry = trees.get(commits.get(commit).tree.sha).find(item => item.path === 'categories.json');
      const bytes = entry && blobs.get(entry.sha);
      return Response.json({ data: { repository: { object: { oid: commit, file: entry ? {
        type: entry.type, mode: parseInt(entry.mode, 8), object: {
          text: bytes.toString(), byteSize: bytes.length, isBinary: false,
        },
      } : null } } } });
    }
    if (path.startsWith('/git/ref/heads/')) {
      const ref = refs.get(path.slice('/git/ref/heads/'.length));
      return ref ? Response.json({ object: { type: 'commit', sha: ref } }) : Response.json({}, { status: 404 });
    }
    if (path.startsWith('/git/blobs/')) {
      const bytes = blobs.get(path.split('/').at(-1));
      return bytes ? Response.json({content:bytes.toString('base64'),encoding:'base64',size:bytes.length}) : Response.json({}, {status:404});
    }
    if (path === '/git/blobs' && method === 'POST') {
      return Response.json({sha:put(Buffer.from(body.content,body.encoding === 'base64' ? 'base64' : 'utf8'))});
    }
    if (path.startsWith('/git/refs/heads/') && method === 'PATCH') {
      const name = path.slice('/git/refs/heads/'.length);
      const current = refs.get(name);
      if (!current) return Response.json({}, {status:404});
      if (body.force !== false || !ancestors(body.sha).has(current)) return Response.json({}, {status:422});
      refs.set(name,body.sha);
      return Response.json({object:{type:'commit',sha:body.sha}});
    }
    if (path === '/git/refs' && method === 'POST') {
      const name = body.ref.slice('refs/heads/'.length);
      if (refs.has(name)) return Response.json({}, { status: 422 });
      refs.set(name, body.sha);
      return Response.json({ object: { sha: body.sha } });
    }
    if (path.startsWith('/git/commits/')) return Response.json(commits.get(path.split('/').at(-1)));
    if (path.startsWith('/git/trees/')) return Response.json({ truncated: false, tree: trees.get(path.split('/').at(-1)) });
    if (path === '/git/trees' && method === 'POST') {
      const merged = new Map((trees.get(body.base_tree) ?? []).map(entry=>[entry.path,entry]));
      for (const entry of body.tree) {
        if (entry.sha === null) {
          merged.delete(entry.path);
          continue;
        }
        const id = entry.content === undefined ? entry.sha : put(entry.content);
        merged.set(entry.path,{...entry,content:undefined,sha:id,size:blobs.get(id)?.length ?? entry.size});
      }
      const tree = [...merged.values()];
      const key = sha(JSON.stringify(tree));
      trees.set(key, tree);
      return Response.json({ sha: key });
    }
    if (path === '/git/commits' && method === 'POST') {
      const key = sha(JSON.stringify(body));
      commits.set(key, { ...body, sha: key, tree: { sha: body.tree }, parents:(body.parents??[]).map(sha=>({sha})) });
      return Response.json({ sha: key });
    }
    if (path.startsWith('/compare/')) {
      const [ancestor,descendant]=path.slice('/compare/'.length).split('...');
      const status=ancestor===descendant?'identical':ancestors(descendant).has(ancestor)?'ahead':ancestors(ancestor).has(descendant)?'behind':'diverged';
      return Response.json({status:controls.compare??status});
    }
    throw Error('Unexpected request: ' + method + ' ' + path);
  };
  const client = createGitHubClient(undefined, fetcher);
  return { fetcher, github: (path, options) => client('/repos/' + REPOSITORY + path, options), calls, refs, trees, commits, blobs, controls, addSource };
}
