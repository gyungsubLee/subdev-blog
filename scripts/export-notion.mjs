#!/usr/bin/env node
import fs from 'node:fs/promises';
import { assertLegacyContentWritable } from './content.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
const execFileAsync = promisify(execFile);
import { fileURLToPath } from 'node:url';

export const ROOT_ID = '1c3eda9b-0fe1-8053-a02d-d27418c5a3fb';
const ORIGIN = 'https://beautiful-college-c84.notion.site';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = '/Users/igyeongseob/Knowledge/SecondBrain/notion-blog';
const cache = path.join(project, 'content/raw');
const blocks = new Map();
const records = {};
const pages = new Map();
const unavailable = new Map();
const warnings = new Set();
const refresh = process.argv.includes('--refresh');
const assetMap = new Map();
const assetResults = [];
const signedSources = new Map();
const collectionRows = new Map();
const collectionParents = new Map();
const exportedBlockIds = new Set();
const externalEmbeds = [];
const pageTypes = new Set(['page', 'collection_view_page']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = value => (value ?? []).map(part => part[0]).join('');
const title = block => plain(block?.properties?.title).replace(/‣/g, '').trim() || '제목 없음';
const notionUrl = id => ORIGIN + '/' + id.replaceAll('-', '');
const unwrap = value => value?.value?.value ?? value?.value ?? value;
const date = value => value ? new Date(value).toISOString() : null;
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
const safe = value => Array.from(value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().replace(/[. ]+$/g, '')).slice(0, 45).join('') || 'untitled';

let nextRequestAt = 0;
async function api(endpoint, body, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const wait = Math.max(0, nextRequestAt - Date.now());
      nextRequestAt = Math.max(nextRequestAt, Date.now()) + 1100;
      if (wait) await sleep(wait);
      const { stdout } = await execFileAsync('curl', [
        '-sS', '--dump-header', '-', '--max-time', '60',
        '-X', 'POST', 'https://www.notion.so/api/v3/' + endpoint,
        '-H', 'content-type: application/json', '--data', JSON.stringify(body),
      ], { maxBuffer: 100 * 1024 * 1024 });
      const boundary = stdout.lastIndexOf('\r\n\r\n');
      const headers = stdout.slice(0, boundary);
      const responseBody = stdout.slice(boundary + 4);
      const status = Number(headers.match(/HTTP\/[\d.]+ (\d+)/g)?.at(-1)?.split(' ').at(-1));
      if (status >= 400) {
        const error = new Error('HTTP ' + status + ': ' + responseBody.slice(0, 200));
        error.status = status;
        const retry = headers.match(/retry-after:\s*([^\r\n]+)/i)?.[1];
        error.retryAfterMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
        throw error;
      }
      return JSON.parse(responseBody);
    } catch (error) {
      if (attempt === attempts - 1 || (error.status >= 400 && error.status < 500 && error.status !== 429)) throw error;
      const limited = /429/.test(error.stderr ?? error.message);
      if (limited) console.log('RATE_LIMIT', endpoint, 'retry=' + (attempt + 1));
      await sleep(limited ? Math.max(error.retryAfterMs ?? 0, Math.min(60000, 15000 * 2 ** attempt)) : Math.min(30000, 700 * 2 ** attempt));
    }
  }
}

function merge(recordMap = {}) {
  for (const [table, values] of Object.entries(recordMap)) {
    if (!values || typeof values !== 'object') continue;
    records[table] ??= {};
    for (const [id, entry] of Object.entries(values)) {
      const value = unwrap(entry);
      if (value?.id) {
        const { crdt_data, ...record } = value;
        records[table][id] = record;
        if (table === 'block') {
          const previous = blocks.get(id);
          if (!previous || (record.version ?? 0) >= (previous.version ?? 0)) blocks.set(id, record);
        }
      }
    }
  }
}

async function loadPage(id) {
  const saved = path.join(cache, id + '.json');
  let chunks;
  try { if (refresh) throw new Error('refresh'); chunks = JSON.parse(await fs.readFile(saved, 'utf8')); }
  catch {
    chunks = [];
    let cursor = { stack: [] };
    let chunkNumber = 0;
    do {
      const response = await api('loadPageChunk', { pageId: id, limit: 1000, cursor, chunkNumber, verticalColumns: false });
      chunks.push(response);
      cursor = response.cursor ?? { stack: [] };
      chunkNumber++;
      if (chunkNumber > 1000) throw new Error('Page pagination exceeded 1000 chunks: ' + id);
    } while (cursor.stack?.length);
    await fs.writeFile(saved, JSON.stringify(chunks));
  }
  for (const chunk of chunks) merge(chunk.recordMap);
  const page = blocks.get(id);
  if (!page) throw new Error('공개 접근 불가 또는 페이지 없음');
  return page;
}

async function loadMissing(ids, table = 'block') {
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const saved = path.join(cache, (table === 'block' ? 'blocks-' : 'views-') + hash([...batch].sort().join(',')) + '.json');
    let result;
    try { if (refresh) throw new Error('refresh'); result = JSON.parse(await fs.readFile(saved, 'utf8')); }
    catch {
      result = await api('syncRecordValues', {
        requests: batch.map(id => ({ pointer: { table, id }, version: -1 })),
      });
      await fs.writeFile(saved, JSON.stringify(result));
    }
    merge(result.recordMap);
  }
}

function children(block) {
  return [...(block?.content ?? [])];
}

async function queryView(viewBlock) {
  const viewId = viewBlock.view_ids?.[0];
  let view = records.collection_view?.[viewId];
  let collectionId = viewBlock.collection_id ?? viewBlock.format?.collection_pointer?.id ?? view?.format?.collection_pointer?.id ?? view?.collection_id;
  if (!collectionId && viewId) {
    await loadMissing(viewBlock.view_ids, 'collection_view');
    view = records.collection_view?.[viewId];
    collectionId = view?.format?.collection_pointer?.id ?? view?.collection_id;
  }
  if (!collectionId) {
    warnings.add('연결 데이터베이스 원본 접근 불가: ' + viewBlock.id);
    return [];
  }
  const sourceSpace = view?.format?.collection_pointer?.spaceId ?? viewBlock.format?.collection_pointer?.spaceId;
  if (sourceSpace && sourceSpace !== blocks.get(ROOT_ID)?.space_id) {
    warnings.add('다른 워크스페이스 데이터베이스 링크 유지: ' + viewBlock.id);
    return [];
  }
  if (!collectionParents.has(collectionId)) collectionParents.set(collectionId, viewBlock.id);
  const saved = path.join(cache, 'collection-' + viewBlock.id + '.json');
  let result;
  try {
    try { if (refresh) throw new Error('refresh'); result = JSON.parse(await fs.readFile(saved, 'utf8')); }
    catch {
      result = await api('queryCollection', {
        collection: { id: collectionId },
        collectionView: { id: viewId },
        loader: {
          type: 'reducer', reducers: { collection_group_results: { type: 'results', limit: 100000 } },
          searchQuery: '', userTimeZone: 'Asia/Seoul',
        },
      });
      await fs.writeFile(saved, JSON.stringify(result));
    }
    merge(result.recordMap);
    const data = result.result ?? {};
    const rowIds = new Set(data.reducerResults?.collection_group_results?.blockIds ?? data.blockIds ?? []);
    for (const block of blocks.values()) {
      if (block.parent_table === 'collection' && block.parent_id === collectionId && pageTypes.has(block.type)) rowIds.add(block.id);
    }
    collectionRows.set(viewBlock.id, [...rowIds]);
    if (data.hasMore || data.reducerResults?.collection_group_results?.hasMore) warnings.add('데이터베이스 결과 100000개 상한 도달: ' + collectionId);
    return [...rowIds];
  } catch (error) {
    warnings.add('데이터베이스 조회 실패 ' + collectionId + ': ' + error.message);
    return [];
  }
}

async function collectGraph() {
  for (const filename of refresh ? [] : await fs.readdir(cache)) {
    if (!/^(?:[a-f0-9-]{36}|blocks-[a-f0-9]{16}|views-[a-f0-9]{16}|collection-[a-f0-9-]{36})\.json$/.test(filename)) continue;
    try {
      const cached = JSON.parse(await fs.readFile(path.join(cache, filename), 'utf8'));
      for (const chunk of Array.isArray(cached) ? cached : [cached]) merge(chunk.recordMap);
    } catch { warnings.add('읽을 수 없는 캐시 무시: ' + filename); }
  }
  if (!blocks.has(ROOT_ID)) await loadPage(ROOT_ID);
  const missingViews = [...new Set([...blocks.values()].filter(block => ['collection_view', 'collection_view_page'].includes(block.type)).flatMap(block => block.view_ids ?? []))].filter(id => !records.collection_view?.[id]);
  if (missingViews.length) await loadMissing(missingViews, 'collection_view');
  const pending = [ROOT_ID];
  const visited = new Set();
  const discoveredPages = new Set();
  while (pending.length) {
    const batch = [...new Set(pending.splice(0, 500))].filter(id => !visited.has(id));
    const missing = batch.filter(id => !blocks.has(id));
    if (missing.length) await loadMissing(missing);
    for (const id of batch) {
      visited.add(id);
      const block = blocks.get(id);
      if (!block) {
        unavailable.set(id, { id, url: notionUrl(id), reason: 'Notion 공개 권한 없음 또는 삭제된 블록' });
        continue;
      }
      if (block.alive === false) continue;
      if (block.space_id && block.space_id !== blocks.get(ROOT_ID)?.space_id) {
        warnings.add('다른 워크스페이스 참조 유지: ' + id);
        continue;
      }
      exportedBlockIds.add(id);
      if (pageTypes.has(block.type)) {
        pages.set(id, { id, title: title(block), parentId: null, category: '', createdAt: date(block.created_time), updatedAt: date(block.last_edited_time), path: '', url: notionUrl(id) });
        discoveredPages.add(id);
      }
      pending.push(...children(block));
      const ref = block.format?.transclusion_reference_pointer?.id;
      if (ref) pending.push(ref);
      // Aliases keep their original link; they do not expand this descendant export.
      if (block.type === 'collection_view' || block.type === 'collection_view_page') pending.push(...await queryView(block));
    }
    console.log('GRAPH', 'pages=' + pages.size, 'blocks=' + visited.size, 'pending=' + pending.length, 'unavailable=' + unavailable.size);
  }
  return discoveredPages;
}

function nearestParent(id) {
  const directParent = blocks.get(id)?.parent_id;
  for (const candidate of [directParent, collectionParents.get(directParent)]) {
    let current = candidate;
    const seen = new Set([id]);
    while (current && !seen.has(current)) {
      if (pages.has(current)) return current;
      seen.add(current);
      const parent = blocks.get(current) ?? records.collection?.[current];
      current = parent?.parent_id;
    }
  }
  return id === ROOT_ID ? null : ROOT_ID;
}

function makePaths() {
  function resolvePage(id, ancestors = new Set()) {
    const page = pages.get(id);
    if (page.path) return page.path;
    if (ancestors.has(id)) return 'Main/' + safe(page.title) + '-' + id.replaceAll('-', '').slice(-12) + '/index.md';
    ancestors.add(id);
    const parent = page.parentId && pages.get(page.parentId);
    const prefix = parent ? path.posix.dirname(resolvePage(parent.id, ancestors)) + '/' : '';
    page.path = prefix + (id === ROOT_ID ? 'Main' : safe(page.title) + '-' + id.replaceAll('-', '').slice(-12)) + '/index.md';
    return page.path;
  }
  for (const id of pages.keys()) resolvePage(id);
  for (const page of pages.values()) {
    const trail = [];
    let current = page;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      trail.unshift({ id: current.id, title: current.title });
      current = pages.get(current.parentId);
    }
    page.breadcrumbs = trail;
    page.category = trail[1]?.title ?? 'Main';
  }
}

export function relativePageLink(fromPath, toPath, anchor = '') {
  const relative = path.posix.relative(path.posix.dirname(fromPath), toPath);
  return (relative || 'index.md').split('/').map(segment => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29')).join('/') + (anchor ? '#' + anchor.replaceAll('-', '') : '');
}

function rewriteUrl(url, fromPage) {
  if (!url) return '';
  let candidate = url;
  if (url.startsWith('/')) candidate = ORIGIN + url;
  const match = candidate.match(/(?:notion\.so|notion\.site)\/[^?#]*?([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9-]{27})(?:[?#]|$)/i);
  if (match) {
    const compact = match[1].replaceAll('-', '');
    const id = compact.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    if (pages.has(id)) {
      const anchor = candidate.split('#')[1] ?? '';
      return relativePageLink(fromPage.path, pages.get(id).path, anchor);
    }
  }
  return candidate;
}

// Entities keep source punctuation literal in both Markdown and raw HTML containers.
function inlineText(value) {
  return String(value).replace(/[&<>"'\\`*_[\]~#!|+.:@$\-]/g, character => '&#' + character.charCodeAt(0) + ';');
}

function inlineLink(text, url) {
  const destination = String(url ?? '');
  const scheme = destination.replace(/[\x00-\x20\x7f]/g, '').match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (scheme && !['http', 'https', 'mailto', 'tel', 'ftp', 'irc', 'ircs', 'xmpp'].includes(scheme)) return text;
  return '<a href="' + destination.replace(/[&<>"']/g, character => '&#' + character.charCodeAt(0) + ';') + '">' + text + '</a>';
}

export function richText(value, link = value => value) {
  const runs = [];
  let previousSimpleCode = false;
  for (const [text, annotations = []] of value ?? []) {
    const simpleCode = annotations.some(([type]) => type === 'c') &&
      annotations.every(([type]) => type === 'c' || type === 'h');
    if (simpleCode && previousSimpleCode) runs.at(-1)[0] += text;
    else runs.push([text, annotations]);
    previousSimpleCode = simpleCode;
  }
  return runs.map(([text, annotations]) => {
    let result = inlineText(text).replace(/\r\n?|\n/g, '<br>');
    if (annotations.some(annotation => annotation[0] === 'c')) result = '<code>' + result + '</code>';
    for (const [type, target] of annotations) {
      if (type === 'b') result = '<strong>' + result + '</strong>';
      if (type === 'i') result = '<em>' + result + '</em>';
      if (type === 's') result = '<del>' + result + '</del>';
      if (type === '_') result = '<u>' + result + '</u>';
      if (type === 'a') result = inlineLink(result, link(target));
      if (type === 'p') result = inlineLink(text === '‣' ? '페이지' : result, link(notionUrl(target)));
      // Keep formula line feeds as text even inside Markdown table cells.
      if (type === 'e') result = '<code class="language-math">' + inlineText(target).replace(/\r\n?|\n/g, '&#10;') + '</code>';
      if (type === 'd') result = inlineText(target?.start_date ?? text);
      if (type === 'u') result = '@' + inlineText(target);
      if (type === 'ce') result = text === '‣' ? '' : result;
    }
    return result;
  }).join('');
}

function assetLink(source, block, page) {
  const asset = assetMap.get(source + '|' + block.id);
  if (!asset?.path) return source?.startsWith('attachment:') ? notionUrl(block.id) : source;
  return path.posix.relative(path.posix.dirname(page.path), asset.path).split('/').map(segment => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29')).join('/');
}

function renderChildren(block, page, stack = new Set()) {
  return children(block).map(id => renderBlock(id, page, stack)).filter(Boolean).join('\n\n');
}

function renderBlock(id, page, stack = new Set()) {
  if (stack.has(id)) return '<!-- 순환 블록 참조: ' + id + ' -->';
  const block = blocks.get(id);
  if (!block) return '[공개 접근 불가 블록](' + notionUrl(id) + ')';
  if (block.alive === false) return '';
  const next = new Set(stack).add(id);
  const text = richText(block.properties?.title, url => rewriteUrl(url, page));
  const nested = () => renderChildren(block, page, next);
  const anchor = '<a id="' + id.replaceAll('-', '') + '"></a>\n\n';
  const suffix = content => content ? '\n\n' + content : '';
  switch (block.type) {
    case 'page':
    case 'collection_view_page':
      return pages.has(id) ? '[' + title(block) + '](' + relativePageLink(page.path, pages.get(id).path) + ')' : '[' + title(block) + '](' + notionUrl(id) + ')';
    case 'text': return (text ? anchor + text : '') + suffix(nested());
    case 'header': return anchor + '# ' + text + suffix(nested());
    case 'sub_header': return anchor + '## ' + text + suffix(nested());
    case 'sub_sub_header': return anchor + '### ' + text + suffix(nested());
    case 'header_4': return anchor + '#### ' + text + suffix(nested());
    case 'bulleted_list':
    case 'numbered_list':
    case 'to_do': {
      const prefix = block.type === 'numbered_list' ? '1. ' : block.type === 'to_do' ? '- [' + (plain(block.properties?.checked) === 'Yes' ? 'x' : ' ') + '] ' : '- ';
      return prefix + text.replaceAll('\n', '\n  ') + (block.content?.length ? '\n' + nested().split('\n').map(line => line ? '    ' + line : '').join('\n') : '');
    }
    case 'quote': return (text + suffix(nested())).split('\n').map(line => '> ' + line).join('\n');
    case 'callout': return '> ' + (block.format?.page_icon && !block.format.page_icon.includes(':') ? block.format.page_icon + ' ' : '') + (text + suffix(nested())).split('\n').join('\n> ');
    case 'toggle': return '<details>\n<summary>' + text + '</summary>\n\n' + nested() + '\n\n</details>';
    case 'divider': return '---';
    case 'code': {
      const code = plain(block.properties?.title);
      const runs = code.match(/`+/g) ?? [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      const language = plain(block.properties?.language).replace(/[^\w+#.-]/g, '').toLowerCase();
      return anchor + fence + language + '\n' + code + '\n' + fence + (block.properties?.caption ? '\n\n' + richText(block.properties.caption) : '');
    }
    case 'image': {
      const source = plain(block.properties?.source) || block.format?.display_source;
      return '![' + plain(block.properties?.caption).replaceAll(']', '\\]') + '](' + assetLink(source, block, page) + ')';
    }
    case 'file':
    case 'pdf':
    case 'video':
    case 'audio': {
      const source = plain(block.properties?.source) || block.format?.display_source;
      return '[' + (plain(block.properties?.title) || plain(block.properties?.caption) || block.type) + '](' + assetLink(source, block, page) + ')';
    }
    case 'copy_indicator': return '';
    case 'external_object_instance': {
      const label = block.format?.attributes?.find(attribute => attribute.id === 'title')?.values?.join('') ?? block.format?.domain ?? '외부 링크';
      return '[' + label + '](' + (block.format?.original_url ?? block.format?.uri ?? notionUrl(id)) + ')';
    }
    case 'bookmark':
    case 'embed':
    case 'gist':
    case 'maps':
    case 'figma':
    case 'tweet':
    case 'drive':
      return '[' + (text || plain(block.properties?.source) || block.type) + '](' + rewriteUrl(plain(block.properties?.source), page) + ')' + suffix(nested());
    case 'equation': return '$$\n' + plain(block.properties?.title) + '\n$$';
    case 'column_list':
    case 'column': return nested();
    case 'transclusion_container':
    case 'synced_block': return nested();
    case 'transclusion_reference': {
      const ref = block.format?.transclusion_reference_pointer?.id;
      if (!ref) return nested();
      const source = blocks.get(ref);
      if (!source || source.space_id !== blocks.get(ROOT_ID)?.space_id) return '[동기화 원본](' + notionUrl(ref) + ')';
      return renderChildren(source, page, next);
    }
    case 'alias': {
      const target = block.format?.alias_pointer?.id;
      return target ? renderBlock(target, page, next) : nested();
    }
    case 'table': {
      const rows = children(block).map(rowId => blocks.get(rowId)).filter(Boolean);
      const columns = block.format?.table_block_column_order ?? Object.keys(rows[0]?.properties ?? {});
      const rendered = rows.map(row => '| ' + columns.map(column => richText(row.properties?.[column], url => rewriteUrl(url, page)).replaceAll('|', '\\|')).join(' | ') + ' |');
      if (!rendered.length) return '';
      const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
      if (block.format?.table_block_column_header) rendered.splice(1, 0, separator);
      else rendered.unshift('| ' + columns.map(() => '').join(' | ') + ' |', separator);
      return rendered.join('\n');
    }
    case 'table_of_contents': {
      const headings = [];
      function visit(parent) {
        for (const child of children(parent).map(childId => blocks.get(childId)).filter(Boolean)) {
          if (['header', 'sub_header', 'sub_sub_header', 'header_4'].includes(child.type)) headings.push('- [' + plain(child.properties?.title) + '](#' + child.id.replaceAll('-', '') + ')');
          if (!pageTypes.has(child.type)) visit(child);
        }
      }
      visit(blocks.get(page.id));
      return headings.join('\n');
    }
    case 'collection_view': return (collectionRows.get(id) ?? []).map(rowId => renderBlock(rowId, page, next)).join('\n\n');
    case 'breadcrumb': return page.breadcrumbs.map(item => '[' + item.title + '](' + relativePageLink(page.path, pages.get(item.id).path) + ')').join(' / ');
    case 'table_row': return '';
    default:
      warnings.add('일반 Markdown 대체: ' + block.type);
      return anchor + (text || '[' + block.type + '](' + notionUrl(id) + ')') + suffix(nested());
  }
}

function gatherAssets() {
  for (const block of blocks.values()) {
    if (!exportedBlockIds.has(block.id)) continue;
    const sources = [];
    if (['image', 'file', 'pdf', 'video', 'audio'].includes(block.type)) {
      const source = plain(block.properties?.source) || block.format?.display_source;
      if (source && block.type === 'video' && !source.startsWith('attachment:') && !/\.(mp4|mov|webm|m4v)(?:\?|$)/i.test(source)) {
        externalEmbeds.push({ blockId: block.id, url: source, type: block.type });
      } else if (source) sources.push({ source, role: block.type });
    }
    if (pages.has(block.id) || block.type === 'callout') {
      for (const [key, role] of [['page_cover', 'cover'], ['page_icon', 'icon']]) {
        let source = block.format?.[key];
        if (source?.startsWith('notion://custom_emoji/')) source = records.custom_emoji?.[source.split('/').at(-1)]?.url;
        if (source && /^(https?:|attachment:|\/images\/)/.test(source)) sources.push({ source, role });
      }
    }
    for (const item of sources) {
      const key = item.source + '|' + block.id;
      if (!assetMap.has(key)) assetMap.set(key, { ...item, blockId: block.id });
    }
  }
}

function privateAddress(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) {
    const suffix = normalized.slice(7);
    if (suffix.includes('.')) return privateAddress(suffix);
    const groups = suffix.split(':').map(group => parseInt(group || '0', 16));
    if (groups.length === 2) return privateAddress([groups[0] >> 8, groups[0] & 255, groups[1] >> 8, groups[1] & 255].join('.'));
    return true;
  }
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(normalized) === 6) return normalized === '::' || normalized === '::1' || /^(fc|fd|fe|ff)/i.test(normalized);
  return false;
}

export function validateAssetUrl(source) {
  const url = new URL(source);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || privateAddress(hostname)) {
    throw new Error('공개 HTTP 또는 HTTPS 자산 URL만 허용');
  }
  return url;
}

const resolvedHosts = new Map();
async function publicAddress(source) {
  const url = validateAssetUrl(source);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!resolvedHosts.has(hostname)) resolvedHosts.set(hostname, lookup(hostname, { all: true }));
  const addresses = await resolvedHosts.get(hostname);
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error('사설 네트워크 주소는 수집하지 않음');
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  return { url, address: selected.address };
}

function localAssetPath(asset) {
  let basename = asset.source.split('/').at(-1)?.split('?')[0] ?? '';
  try { basename = decodeURIComponent(basename); } catch {}
  basename = basename.replace(/^attachment:[^:]+:/, '');
  const ext = path.extname(basename).slice(0, 10).replace(/[^.a-zA-Z0-9]/g, '') || (asset.role === 'image' || asset.role === 'cover' ? '.png' : '.bin');
  return 'assets/' + hash(asset.source) + ext;
}

async function signAssets(assets) {
  const pending = [];
  for (const asset of assets) {
    if (!/^(attachment:)|secure\.notion-static\.com|prod-files-secure\.s3\./.test(asset.source)) continue;
    try { if (!refresh && (await fs.stat(path.join(archive, localAssetPath(asset)))).size > 0) continue; } catch {}
    pending.push(asset);
  }
  for (let offset = 0; offset < pending.length; offset += 50) {
    const batch = pending.slice(offset, offset + 50);
    try {
      const result = await api('getSignedFileUrls', { urls: batch.map(asset => ({ url: asset.source, permissionRecord: { table: 'block', id: asset.blockId } })) });
      for (let index = 0; index < batch.length; index++) {
        if (result.signedUrls?.[index]) signedSources.set(batch[index].source, result.signedUrls[index]);
      }
    } catch (error) { warnings.add('자산 URL 일괄 조회 실패: ' + error.message); }
    console.log('SIGNED_ASSETS', Math.min(offset + 50, pending.length), '/', pending.length);
  }
}

async function transferAsset(source, target) {
  let metadata;
  for (let redirects = 0; redirects <= 10; redirects++) {
    const resolved = await publicAddress(source);
    const port = resolved.url.port || (resolved.url.protocol === 'https:' ? '443' : '80');
    const address = isIP(resolved.address) === 6 ? '[' + resolved.address + ']' : resolved.address;
    const { stdout } = await execFileAsync('curl', [
      '-sS', '--fail', '--max-time', '120',
      '--retry', '3', '--retry-delay', '1', '--retry-max-time', '30',
      '--proto', '=http,https',
      '--resolve', resolved.url.hostname + ':' + port + ':' + address,
      '--output', target + '.partial', '--write-out', '%{json}',
      '--', source,
    ], { maxBuffer: 1024 * 1024 });
    metadata = JSON.parse(stdout);
    if (metadata.http_code >= 300 && metadata.http_code < 400 && metadata.redirect_url) {
      if (redirects === 10) throw new Error('자산 리다이렉트가 10회를 초과');
      source = metadata.redirect_url;
      continue;
    }
    break;
  }
  if (metadata.http_code >= 300) throw new Error('HTTP ' + metadata.http_code);
  if (metadata.content_type?.includes('text/html')) throw new Error('파일 대신 HTML 응답');
  return metadata;
}

async function downloadAsset(asset) {
  let source = asset.source;
  const localPath = localAssetPath(asset);
  const target = path.join(archive, localPath);
  try {
    const cachedStat = await fs.stat(target);
    if (!refresh && cachedStat.size > 0) {
      asset.bytes = cachedStat.size;
      asset.path = localPath;
      asset.status = 'cached';
      assetResults.push(asset);
      return;
    }
  } catch {}
  try {
    if (source.startsWith('attachment:') || /secure\.notion-static\.com|prod-files-secure\.s3\./.test(source)) {
      if (signedSources.has(source)) source = signedSources.get(source);
      else {
        const signed = await api('getSignedFileUrls', { urls: [{ url: source, permissionRecord: { table: 'block', id: asset.blockId } }] });
        source = signed.signedUrls?.[0];
      }
      if (!source) throw new Error('서명 URL 없음');
    }
    if (source.startsWith('/')) source = 'https://www.notion.so' + source;
    let metadata;
    try { metadata = await transferAsset(source, target); }
    catch (error) {
      const message = error.stderr?.trim() || error.message;
      const image = ['image', 'cover', 'icon'].includes(asset.role);
      if (!image || !/HTML|error: (?:403|404|410|422|503)/.test(message)) throw error;
      const proxy = 'https://www.notion.so/image/' + encodeURIComponent(asset.source) + '?table=block&id=' + asset.blockId + '&cache=v2';
      try {
        metadata = await transferAsset(proxy, target);
        asset.recoveredVia = 'notion-image-proxy';
      } catch (proxyError) {
        asset.recoveryError = proxyError.stderr?.trim().slice(0, 300) || proxyError.message;
        throw error;
      }
    }
    await fs.rename(target + '.partial', target);
    asset.path = localPath;
    asset.bytes = Number(metadata.size_download);
    asset.contentType = metadata.content_type;
    asset.status = 'downloaded';
  } catch (error) {
    await fs.rm(target + '.partial', { force: true });
    asset.status = 'failed';
    asset.error = error.stderr?.trim().slice(0, 300) || error.message;
  }
  assetResults.push(asset);
}

async function pool(items, concurrency, fn) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }));
}

export async function writeMarkdown(relativePath, content, directory = archive) {
  const target = path.join(directory, relativePath);
  let previous;
  try { previous = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous === content) return;
  let mode = 0o666;
  if (previous !== undefined) {
    mode = (await fs.stat(target)).mode & 0o777;
    const digest = crypto.createHash('sha256').update(previous).digest('hex');
    const historical = path.join(directory, '.history', digest, relativePath);
    await fs.mkdir(path.dirname(historical), { recursive: true });
    try { await fs.writeFile(historical, previous, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    await fs.writeFile(temporary, content, { mode });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
}

export function webMarkdown(markdown) {
  // Protect code examples before rewriting only link destinations and HTML attributes.
  const code = /<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>|^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[ \t]*$|(`+)(?!`)[\s\S]*?(?<!`)\3(?!`)/gm;
  const normalize = text => text
    .replace(/(\]\()(?:\.\.\/|\.\/)*(assets\/[^)\s]+)(\))/g, '$1/notion/$2$3')
    .replace(/(\b(?:src|href)\s*=\s*["'])(?:\.\.\/|\.\/)*(assets\/[^"']+)(["'])/gi, '$1/notion/$2$3');
  let result = '';
  let cursor = 0;
  for (const match of markdown.matchAll(code)) {
    result += normalize(markdown.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return result + normalize(markdown.slice(cursor));
}

function markdownExcerpt(markdown) {
  return markdown.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#(?!\d+;)|[*`_>]/g, '')
    .replace(/&#(\d+);/g, (entity, code) => {
      const codePoint = Number(code);
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity;
      return String.fromCodePoint(codePoint);
    })
    .replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function renderArchivedPosts(sourceRecords, existingPosts, manifest) {
  blocks.clear();
  pages.clear();
  assetMap.clear();
  collectionRows.clear();
  exportedBlockIds.clear();
  externalEmbeds.length = 0;
  warnings.clear();
  for (const table of Object.keys(records)) delete records[table];
  merge(sourceRecords);
  for (const post of existingPosts) pages.set(post.id, { ...post });
  for (const id of blocks.keys()) exportedBlockIds.add(id);
  for (const { id, rowIds } of manifest.collectionRows ?? []) collectionRows.set(id, rowIds);
  gatherAssets();
  const assetsBySource = new Map((manifest.assetDetails ?? []).map(asset => [asset.source, asset]));
  for (const asset of assetMap.values()) Object.assign(asset, assetsBySource.get(asset.source));
  return existingPosts.map(post => {
    const block = blocks.get(post.id);
    if (!block) throw new Error('Archived page record is missing: ' + post.id);
    const markdown = renderChildren(block, pages.get(post.id)).trim() + '\n';
    return { ...post, markdown: webMarkdown(markdown), excerpt: markdownExcerpt(markdown) };
  });
}

async function main() {
  await assertLegacyContentWritable(project);
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(path.join(archive, 'assets'), { recursive: true });
  const queued = await collectGraph();
  for (const page of pages.values()) page.parentId = nearestParent(page.id);
  makePaths();
  if (new Set([...pages.values()].map(page => page.path)).size !== pages.size) throw new Error('Duplicate Markdown output paths');
  const maxPathBytes = Math.max(...[...pages.values()].map(page => Buffer.byteLength(path.join(archive, page.path))));
  console.log('MAX_PATH_BYTES', maxPathBytes);
  if (maxPathBytes >= 1024) throw new Error('Markdown path exceeds macOS 1024-byte path limit');
  await fs.writeFile(path.join(project, 'content/records.json'), JSON.stringify(records));
  gatherAssets();
  console.log('ASSETS', assetMap.size);
  const uniqueAssets = new Map([...assetMap.values()].map(asset => [asset.source, asset]));
  if (!process.argv.includes('--no-assets')) {
    await signAssets([...uniqueAssets.values()]);
    await pool([...uniqueAssets.values()], 12, downloadAsset);
  }
  for (const asset of assetMap.values()) Object.assign(asset, uniqueAssets.get(asset.source));
  const posts = [];
  for (const page of pages.values()) {
    const block = blocks.get(page.id);
    page.markdown = renderChildren(block, page).trim() + '\n';
    page.excerpt = markdownExcerpt(page.markdown);
    const coverAsset = assetMap.get(block.format?.page_cover + '|' + block.id);
    page.cover = coverAsset?.path ? '/notion/' + coverAsset.path : null;
    let iconSource = block.format?.page_icon;
    if (iconSource?.startsWith('notion://custom_emoji/')) iconSource = records.custom_emoji?.[iconSource.split('/').at(-1)]?.url;
    const iconAsset = assetMap.get(iconSource + '|' + block.id);
    page.icon = iconAsset?.path ? '/notion/' + iconAsset.path : iconSource ?? null;
    const collection = records.collection?.[block.parent_id];
    page.notionProperties = Object.fromEntries(Object.entries(block.properties ?? {}).filter(([key]) => key !== 'title').map(([key, value]) => [collection?.schema?.[key]?.name ?? key, richText(value)]));
    const frontmatter = [
      '---', 'title: ' + JSON.stringify(page.title), 'notion_id: ' + JSON.stringify(page.id),
      'source_url: ' + JSON.stringify(page.url), 'parent_id: ' + JSON.stringify(page.parentId),
      'created: ' + JSON.stringify(page.createdAt), 'updated: ' + JSON.stringify(page.updatedAt),
      'cover: ' + JSON.stringify(coverAsset?.path ? assetLink(block.format.page_cover, block, page) : null),
      'icon: ' + JSON.stringify(iconAsset?.path ? assetLink(iconSource, block, page) : iconSource ?? null),
      'category: ' + JSON.stringify(page.category), 'properties: ' + JSON.stringify(page.notionProperties), 'tags: [notion-import]',
      '---', '', '# ' + page.title, '', '',
    ].join('\n');
    await writeMarkdown(page.path, frontmatter + page.markdown);
    posts.push({ ...page, markdown: webMarkdown(page.markdown) });
  }
  posts.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const manifest = {
    schemaVersion: 1, exportedAt: new Date().toISOString(), rootId: ROOT_ID, rootUrl: notionUrl(ROOT_ID),
    archivePath: archive, pageCount: pages.size, blockCount: exportedBlockIds.size, maxPathBytes, discoveredPages: queued.size,
    unavailable: [...unavailable.values()], warnings: [...warnings],
    externalEmbeds,
    assets: { total: uniqueAssets.size, references: assetMap.size, bytes: assetResults.reduce((total, asset) => total + (asset.bytes ?? 0), 0), downloaded: assetResults.filter(asset => asset.path).length, failed: assetResults.filter(asset => asset.status === 'failed').length },
    collectionRows: [...collectionRows].map(([id, ids]) => ({ id, rowIds: ids })),
    assetDetails: assetResults, pages: posts.map(({ markdown, excerpt, ...page }) => page),
  };
  await fs.writeFile(path.join(project, 'content/posts.json'), JSON.stringify(posts, null, 2));
  await fs.writeFile(path.join(project, 'content/manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(archive, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.copyFile(path.join(project, 'content/records.json'), path.join(archive, 'notion-records.json'));
  const ordered = [];
  function walk(parentId) {
    for (const page of [...pages.values()].filter(page => page.parentId === parentId).sort((a, b) => a.title.localeCompare(b.title, 'ko'))) {
      ordered.push(page);
      walk(page.id);
    }
  }
  walk(null);
  const catalog = ['# 전체 페이지', '', ...ordered.map(page => '  '.repeat(Math.max(0, page.breadcrumbs.length - 1)) + '- [' + page.title + '](' + page.path.split('/').map(segment => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29')).join('/') + ')'), ''].join('\n');
  await writeMarkdown('pages.md', catalog);
  const topics = [...pages.values()].filter(page => page.parentId === ROOT_ID).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  const index = [
    '# Notion 블로그 인덱스', '', '공개 페이지 ' + pages.size + '개를 수집했다.', '',
    '수집 시각: ' + manifest.exportedAt, '', '원본: ' + notionUrl(ROOT_ID), '',
    '[원본 메인](Main/index.md) · [전체 페이지](pages.md) · [LLM 읽기 안내](LLM_CONTEXT.md)', '',
    '## 주제', '',
    ...topics.map(topic => '- [' + topic.title + '](' + topic.path.split('/').map(segment => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29')).join('/') + ') — ' + [...pages.values()].filter(page => page.breadcrumbs.some(item => item.id === topic.id)).length + '개'),
    '', '## 수집 상태', '', '- 접근 불가 블록: ' + unavailable.size,
    '- 다운로드한 자산: ' + manifest.assets.downloaded, '- 자산 다운로드 실패: ' + manifest.assets.failed,
    '', ...[...warnings].map(warning => '- ' + warning), '',
    '결과와 원본 식별자는 [manifest.json](manifest.json)에 있다.',
    '원본 블록 데이터는 [notion-records.json](notion-records.json)에 있다.', '',
  ].join('\n');
  await writeMarkdown('index.md', index);
  await writeMarkdown('README.md', '# 수집한 Notion 블로그\n\n[index.md](index.md)에서 주제를 선택한다. 전체 계층은 [pages.md](pages.md)에 있다.\n이 폴더는 공개 Notion 원문을 변환한 수집본이다. 사람이 검토한 지식으로 분류하지 않았다.\n\n각 글의 frontmatter에는 원본 URL, Notion ID, 부모 ID, 작성일, 수정일, 데이터베이스 속성이 있다.\n본문 링크와 이미지 경로는 이 폴더 안의 상대 경로를 사용한다.\n\n수집기는 이전 API 응답을 캐시로 보관한다. 캐시 재실행은 이전 수집 시점의 스냅샷을 사용한다.\n최신 재수집 방법은 [코드 저장소의 절차](../../../Develop/10_herness/notion2md/README.md)에 있다.\n\n기존 Markdown과 새 결과가 다르면 기존 파일을 .history/<내용 hash>/<기존 경로>에 보관한다.\n수집기는 파일을 임시 파일에 쓴 뒤 원자적으로 교체한다.\n현재 수집 범위는 manifest.json을 기준으로 판단한다.\n\n수집기는 Notion 웹앱의 비공식 API를 사용한다. 접근 불가 항목과 변환 제한은 manifest.json에 기록한다.\n');
  await writeMarkdown('LLM_CONTEXT.md', '# LLM 읽기 안내\n\n필요한 주제와 글만 읽는다. 원본 블록 전체를 한 번에 읽지 않는다.\n\n1. [index.md](index.md)에서 주제를 선택한다.\n2. 선택한 주제의 index.md에서 하위 글을 찾는다.\n3. 글 안의 상대 링크를 따라 필요한 근거를 읽는다.\n4. 원본을 인용할 때 frontmatter의 source_url과 본문의 블록 ID를 사용한다.\n5. 접근 불가 항목과 첨부 파일 실패는 manifest.json에서 확인한다.\n\nupdated는 Notion이 기록한 수정 시각이다. 이 시각만으로 내용의 정확성을 판단하지 않는다.\n원문에 없는 사실은 추론으로 표시한다. 원본과 변환본이 다르면 notion-records.json을 확인한다.\n');
  await fs.mkdir(path.join(project, 'public/notion'), { recursive: true });
  const webAssets = path.join(project, 'public/notion/assets');
  await fs.rm(webAssets, { recursive: true, force: true });
  await fs.rm(path.join(project, 'public/notion/asset-map.json'), { force: true });
  await fs.mkdir(webAssets, { recursive: true });
  for (const asset of uniqueAssets.values()) if (asset.path) {
    await fs.copyFile(path.join(archive, asset.path), path.join(project, 'public/notion', asset.path));
  }
  console.log(JSON.stringify({ pageCount: pages.size, blockCount: blocks.size, unavailable: unavailable.size, assets: manifest.assets, warnings: [...warnings], archivePath: archive }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
