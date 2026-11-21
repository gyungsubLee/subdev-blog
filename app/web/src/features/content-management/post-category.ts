import type { Post } from '../../shared/post';
import { readDrafts, saveDraft } from '../../shared/drafts.mjs';
import { requestApi } from './api';
import { enqueueContentSync } from './background-sync.mjs';
import type { ManagementSession, SourceDocument } from './types';

export async function changePostCategory(post: Post, categoryId: string, session: ManagementSession) {
  if (session.state !== 'ready') throw new Error('로그인이 필요합니다.');
  const key = 'second-brain:canonical-draft:' + (post.recoveryKey ?? post.id);
  const bytes = localStorage.getItem(key);
  const recovery = bytes ? JSON.parse(bytes) : null;
  if (bytes && (!recovery || typeof recovery.title !== 'string' ||
      typeof recovery.markdown !== 'string' || !recovery.sourceDocument?.document?.metadata)) {
    throw new Error('보관한 초안을 읽지 못했습니다. 기존 데이터는 유지합니다.');
  }
  if (post.draft) {
    const draft = readDrafts(localStorage).find((item: Post) => item.id === post.id);
    if (!draft && !recovery) throw new Error('보관한 초안을 찾지 못했습니다.');
    if (recovery) localStorage.setItem(key, JSON.stringify({
      ...recovery, category: categoryId, updatedAt: new Date().toISOString(),
      requestId: crypto.randomUUID(), publication: undefined,
    }));
    if (draft) saveDraft(localStorage, { ...draft, category: categoryId, categoryId });
    return;
  }

  // Recovery contains the exact editor revision and preserves unpublished edits.
  const source: SourceDocument = recovery?.sourceDocument ?? await requestApi<SourceDocument>(
    '/api/content?' + new URLSearchParams({ kind: 'post', id: post.id, scope: 'single' }),
    { signal: AbortSignal.timeout(30000) },
  );
  if (source.document.metadata.id !== post.id) throw new Error('보관한 원본 글의 ID를 확인하십시오.');
  if (source.editorError) throw new Error(source.editorError);
  if (!source.categories.some(category => category.id === categoryId)) {
    throw new Error('원본에 없는 분류입니다. 분류를 새로 확인하십시오.');
  }
  if (localStorage.getItem(key) !== bytes) {
    throw new Error('보관한 초안이 바뀌었습니다. 분류를 다시 선택하십시오.');
  }
  const draft = {
    title: source.document.metadata.title, markdown: source.document.markdown,
    assets: source.assets, revision: source.revision,
    ...recovery, sourceDocument: source, canonicalId: post.id,
    category: categoryId, updatedAt: new Date().toISOString(),
    // A category-only receipt must not mark other local edits as published.
    requestId: crypto.randomUUID(), publication: undefined,
  };
  localStorage.setItem(key, JSON.stringify(draft));
  await enqueueContentSync({
    baseCommit: source.contentCommit, categoryOnly: true,
    operation: { type: 'post.update', id: post.id,
      baseRevision: source.revision, baseEditorRevision: source.editorRevision ?? null,
      changes: { category_id: categoryId },
    },
  }, session, key, crypto.randomUUID());
}
