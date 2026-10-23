# 콘텐츠 submodule과 AI 메타데이터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `implement` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 글 원본과 첨부를 ID 고정 폴더의 콘텐츠 submodule로 이전하고, AI 메타데이터를 보존하면서 게시·편집 본문에서 분리한다.

**Architecture:** 공통 문서 계약을 먼저 만든다. 이전 도구와 빌드는 같은 문서·링크 규칙을 사용한다. 공개 데이터는 허용 필드만 생성한다. 로컬 wiki 확장은 문서 계약으로 준비한다.

**Tech Stack:** React 19, TypeScript, Node.js 24, 기존 BlockNote·Markdown 렌더러, `node:test`·jsdom, Git submodule, YAML 1.2용 `yaml@2`.

**Spec:** [리팩터링 설계서](../specs/2026-10-23-content-submodule-ai-metadata-design.md)

작성일: 2026-10-23 KST

상태: 실행 전. 아래 체크박스는 모두 미실행이다.

사용자는 이번에 문서 작성만 요청했다. 이 계획은 코드 변경, 패키지 설치, 콘텐츠 이전, 저장소 생성·푸시와 배포를 시작하는 지시가 아니다.
실행을 요청받으면 설계서와 이 계획을 함께 읽는다. GSD는 관리에만 사용하고 구현은 위 스킬로 진행한다.

## Global Constraints

- 원본은 `content/posts/<글 UUID>/<실제 제목>.md`와 같은 깊이의 첨부 파일이다.
- 카테고리·부모 변경으로 원본 폴더를 이동하지 않는다. 기존 UUID와 `#/post/<글 ID>`를 유지한다.
- 카테고리 미지정은 조상 상속이다. 직접 지정한 값은 부모 이동 뒤에도 유지한다.
- `schema_version`은 `1`이다. 알려진 필드를 검증하고 알 수 없는 JSON 호환 필드는 보존한다.
- raw frontmatter와 AI 필드를 게시 본문·목록·미리보기·편집기 DOM·공개 다운로드에 포함하지 않는다.
- 원본·초안·공개 `Post`를 구분한다. 공개 수정본은 revision을 확인한 뒤 원본에 합친다.
- 기존 정식 ID를 갱신하는 전체 편집본에도 기준 revision을 요구한다. 새 ID의 첫 저장과 구분한다.
- 기존 글·가져온 Markdown은 본문 전용 Markdown 입력으로 편집한다. 제목만 바꿀 때 본문을 블록으로 재직렬화하지 않는다.
- 원본 첨부는 현재 공개 파일의 바이트를 사용한다. 원본 archive의 재변환과 원격 재다운로드를 하지 않는다.
- 코드 예제·앵커·GFM·HTML·수식과 현재 렌더링 복구 작업을 보존한다.
- 기존 초안 키와 카테고리 v1·v2 브라우저 설정을 보존한다. 손상된 저장소를 덮어쓰지 않는다.
- 새 외부 라이브러리는 YAML 파서 `yaml@2`로 제한한다. 설치한 실제 버전은 lockfile에 기록한다.
- 실행 중 다른 작업자의 변경을 되돌리지 않는다. 구현용 작업 트리는 실행 착수 때 준비한다.
- Chrome 연결의 지원 API로 실제 화면을 검증한다. Playwright를 사용하지 않는다.
- 자동 AI 호출·검색 서버·벡터 DB·인증·웹 발행 백엔드·자동 배포는 범위 밖이다.
- 수집 CLI 전면 개편과 wiki 색인 생성기·변경 감지기의 구현은 후속 작업이다.

## Review Focus

- 전체 문서와 공개 수정본의 ID를 구분한다. 가져온 정식 ID가 새 초안 ID로 바뀌면 안 된다. 담당: Task 1, 5.
- 잘못된 헤더·중복 키·알 수 없는 필드가 본문 노출이나 메타데이터 손실을 만들면 안 된다. 담당: Task 1, 4.
- 제목 변경·인코딩 경로·HTML 링크·코드 예제·글 ID를 포함한 PDF URL을 구분한다. 담당: Task 2, 3, 4.
- revision 충돌·없는 첨부·저장 실패에서 원본과 기존 초안을 보존한다. 담당: Task 2, 5.
- 전체 문서의 본문·형제 첨부를 보존한다. 브라우저 파일 선택과 CLI의 로컬 폴더 접근을 구분한다. 담당: Task 5.
- 분류 상속·개인 분류 설정·공개 출력·로컬 wiki의 저장 경계를 섞지 않는다. 담당: Task 2, 4, 6, 8.

## 파일 책임과 의존 순서

아래 파일은 구현 때 만들거나 수정할 대상이다. 이번 문서 작성에서는 생성하지 않는다.

| 소유 범위 | 파일 | 책임 |
|---|---|---|
| 공통 문서 계약 | `src/shared/document.mjs`, `src/shared/post.ts` | 파싱·직렬화·파일명·수정본 합치기와 공개 타입 |
| 링크 변환 | 새 `src/shared/content-links.mjs` | 목적지 변환, 코드 보호, 로컬·공개·정식 글 링크 구분 |
| 콘텐츠 파일 처리 | 새 `scripts/content.mjs` | 파일 읽기·관계 검증·분류 계산·첨부 검증·정식 저장 |
| 이전 | 새 `scripts/migrate-content.mjs` | 게시 JSON과 현재 공개 첨부를 staging에 이전 |
| 공개 출력 | `scripts/prepare-site.mjs`, `src/app/usePosts.ts` | 허용 필드·목록·본문·카테고리·첨부 출력과 로딩 |
| 분류 연결 | `catalog.ts`, `hierarchy.ts`, `useCategoryCatalog.ts`, `App.tsx`, `BlogView.tsx` | 정식 카테고리와 브라우저 개인 설정의 연결 |
| 편집·가져오기 | `useDraftEditor.ts`, `EditorToolbar.tsx`, `drafts.mjs`, `WritePage.tsx`, `import-markdown.mjs` | 메타데이터·본문·형제 첨부와 수정본 보존 |
| 검사·기존 도구 보호 | `scripts/content.mjs`, corpus·목차 검사, 기존 수집 CLI | 실데이터 검사와 이전 경로의 쓰기 차단 |
| 저장소·배포 | `.gitmodules`, ignore 파일, workflow, `vite.config.ts`, `vercel.json` | 고정 콘텐츠 커밋과 빌드 입력 |
| 로컬 지식 계약 | 콘텐츠 저장소의 `AGENTS.md`, `CONTENT_SCHEMA.md` | 앱 밖 색인 형식과 wiki 출처·검토 규칙 |

기본 실행 순서는 Task 1부터 9까지다. Task 3·4·5·6은 Task 2 계약을 사용한다.
Task 7은 Task 3·4·5·6의 결과가 필요하다. Task 8은 Task 1·2 뒤 초안을 만들고 Task 7의 콘텐츠 문서에 반영한다.
Task 4와 5는 파일 소유권을 나누면 병렬로 진행할 수 있다. 공유 문서·공개 타입 파일의 쓰기 소유자는 한 명으로 고정한다.

## 공통 인터페이스

아래 이름과 반환값은 모든 작업에서 동일하게 사용한다. 타입은 설계를 설명하는 표기다.

```text
ContentDocument = { metadata: ContentMetadata, markdown: string }
ParsedDocument =
  | { documentMode: 'full', metadata: ContentMetadata, markdown: string, baseRevision?: string }
  | { documentMode: 'patch', patch: DocumentPatch }
  | { documentMode: 'legacy', metadata: LegacyMetadata, markdown: string }
ContentEntry = ContentDocument & {
  filename: string, revision: string, assets: Array<{ name, absolutePath }>
}
ContentSnapshot = {
  root: string,
  documents: Map<string, ContentEntry>,
  categories: Array<{ id, name, parent_id, order, sources }>,
  effectiveCategories: Map<string, string | null>
}
DocumentPatch = {
  id: string, baseRevision: string,
  changes: { title?, category_id? }, markdown: string
}
```

`ContentMetadata`의 필드와 기본값은 설계서 4장으로 고정한다.
`LegacyMetadata`는 기존 파일에서 읽은 JSON 호환 필드다. 정식 문서의 필수값을 읽기 단계에서 추측해 채우지 않는다.
기존 파서 반환 필드는 호출자를 이전하는 동안만 호환 어댑터로 제공한다. 새 호출자는 모드별 반환값을 사용한다.
`baseRevision`은 전송용 값이다. 정식 `ContentMetadata`에 넣지 않는다.

---

### Task 1: 문서 파서가 전체 메타데이터와 정식 ID를 보존한다

왜: 현재 파서는 AI 필드를 버린다. 편집기는 `id`만 있는 정식 문서의 연결도 잃을 수 있다.

**Files:** Modify `src/shared/document.mjs`, `src/shared/post.ts`, `package.json`, `package-lock.json`; Test `tests/import-document.test.mjs`.

**Interfaces:**
- Produces: `parseMarkdownDocument(text: string): ParsedDocument`.
- Produces: `serializeMarkdownDocument(document: ContentDocument, options?: { baseRevision?: string }): string`.
- Produces: `serializeDocumentPatch(patch: DocumentPatch): string`. 수정본에는 정식 메타데이터 기본값을 추가하지 않는다.
- Preserves: `markdownDocument(draft): string`, `parseBlockBackup(text)`의 기존 호출 계약.
- Produces: `canonicalFilename(title: string): string`.
- Produces: `mergeDocumentPatch(original: ContentDocument, patch: DocumentPatch, currentRevision: string): ContentDocument`.

- [ ] **Step 1:** 기존 검사에 배열·여러 줄 요약·확장 객체의 왕복 검사를 추가한다.
  `parse(serialize(doc)).metadata`가 원본 의미값과 같아야 한다. 일반 구분선과 코드 바이트도 같아야 한다.
  정식 본문의 첫 H1도 그대로 보존한다. 자동 제목 추가·제거는 기존 형식의 호환 어댑터로 한정한다.
- [ ] **Step 2:** 중복 키·잘못된 schema·YAML 별칭·잘못된 ID·헤더 미종결 검사를 추가한다.
  파싱 실패는 기존 편집 본문을 바꾸지 않아야 한다. unknown-only 매핑도 본문에서 분리해야 한다.
- [ ] **Step 3:** 파일명 검사에 같은 제목·`/`·예약 이름·NFC·UTF-8 200바이트 경계를 넣는다.
  제목 자체는 보존하고 파일명만 설계서 규칙을 따라야 한다.
- [ ] **Step 4:** `node --test tests/import-document.test.mjs`를 실행해 새 검사 실패를 확인한다.
- [ ] **Step 5:** `yaml@2`를 추가하고 위 인터페이스를 구현한다.
  설치 후 실제 버전을 `package-lock.json`에서 확인한다. 문서 작업 중에는 설치하지 않는다.
  legacy `source_id` 우선 규칙과 스키마 1의 ID 충돌 거부를 구분한다.
  전체 편집본의 `base_revision`을 본문·정식 metadata와 분리한다. 수정본 파싱·직렬화의 최소 필드도 검사한다.
- [ ] **Step 6:** 같은 명령에서 실패 0개를 확인한다. 파서의 미지 필드가 공개 DTO로 자동 확장되지 않게 검토한다.
- [ ] **Step 7:** 이 작업의 문서 계약·의존성·검사만 커밋한다.

대표 검사명은 `canonical metadata survives a Markdown round trip`이다.

```js
assert.deepEqual(
  parseMarkdownDocument(serializeMarkdownDocument(document)).metadata,
  document.metadata,
);
```

DoD: 의미값 왕복과 오류 검사가 통과한다. 정식 문서 ID와 로컬 초안 ID의 책임이 타입에 드러난다.

### Task 2: 공통 처리기가 ID·관계·첨부를 검증한다

왜: 이전·빌드·가져오기가 서로 다른 경로 규칙을 사용하면 링크와 메타데이터가 손상된다.

**Files:** Create `src/shared/content-links.mjs`, `scripts/content.mjs`, `tests/content.test.mjs`, `tests/content-links.test.mjs`.

**Interfaces:**
- Consumes: Task 1의 파서·직렬화기·파일명 함수.
- Produces: `rewriteContentLinks(markdown: string, resolve: (destination: string, context: { kind: 'image' | 'link', attribute?: 'src' | 'href' | 'srcset' }) => string): string`.
- Produces: `readContent(root: string): Promise<ContentSnapshot>`; `validateContent(snapshot: ContentSnapshot): void`.
- Produces: `toPublicPosts(snapshot: ContentSnapshot): Post[]`와 `toPublicCategories(snapshot): CategoryNode[]`.
- Produces: `writeContentDocument(root: string, document: ContentDocument, assets: Array<{ name: string, bytes: Uint8Array }>, { expectedRevision? }): Promise<{ id, filename, revision }>`.
  기존 ID의 갱신은 `expectedRevision`이 필수다. 없는 ID의 첫 저장은 같은 ID 파일이 없는지 확인한다.

- [ ] **Step 1:** 검사 파일 안에서 만든 작은 임시 폴더에 부모 1개·자식 2개·카테고리 2개를 구성한다.
  조상 상속, 자식의 명시적 분류, 순환·없는 부모·중복 ID·잘못된 category ID를 assert로 고정한다.
- [ ] **Step 2:** 링크 검사에 HTML 속성·Markdown 목적지·참조 링크·entity·퍼센트 인코딩·fragment를 넣는다.
  백틱·물결표 fence, 인라인 코드, HTML `code`·`pre` 안의 경로는 바이트가 같아야 한다.
- [ ] **Step 3:** `../` 이탈·심볼릭 링크 탈출·파일명 충돌·기존 파일과 다른 바이트의 덮어쓰기를 거부하는 검사를 추가한다.
  저장 실패 후 기존 Markdown과 첨부 해시가 같아야 한다.
- [ ] **Step 4:** `node --test tests/content.test.mjs tests/content-links.test.mjs`로 새 검사 실패를 확인한다.
- [ ] **Step 5:** 기존 `webMarkdown`의 코드 보호 원칙을 확장해 목적지만 바꾼다. 본문 전체를 재직렬화하지 않는다.
  같은 변환 책임을 이전·빌드·가져오기가 재사용한다. 기존 AST 도구를 직접 import하면 의존성 선언도 명시한다.
- [ ] **Step 6:** 파일 읽기, 분류 상속과 공개 projection을 구현한다. 본문·metadata 전체를 공개 객체에 펼치지 않는다.
  `legacy_category`는 현재 분류의 `sources`에 있을 때만 호환 값으로 쓴다. 나머지는 설계서 5장의 ID 기반 값을 사용한다.
- [ ] **Step 7:** 임시 파일과 staging에서 검증한 뒤 정식 파일을 교체한다. 두 검사 파일의 실패 0개를 확인한다.
- [ ] **Step 8:** 공통 처리기와 검사만 커밋한다.

대표 검사명은 `explicit child categories override inherited categories`이다.
부모 분류가 `source:리액트`이고 자식이 분류를 생략하면 같은 ID를 계산해야 한다.
자식에 `source:CSS`를 직접 지정하면 그 값을 유지해야 한다.

```js
assert.equal(snapshot.effectiveCategories.get(inheritedChildId), "source:리액트");
assert.equal(snapshot.effectiveCategories.get(explicitChildId), "source:CSS");
```

DoD: 순환·첨부 누락·저장 실패가 명시적으로 실패한다. 분류 변경은 원본 파일 경로를 바꾸지 않는다.

### Task 3: 이전 도구가 최신 게시 내용과 공개 첨부를 staging에 옮긴다

왜: 외부 보관 Markdown은 최신 렌더링 복구 결과를 포함하지 않을 수 있다.

**Files:** Create `scripts/migrate-content.mjs`, `tests/content-migration.test.mjs`; 참고 `scripts/prepare-site.mjs`, `scripts/export-notion.mjs`.

**Interfaces:**
- Consumes: Task 1·2의 문서·파일·링크 계약.
- Produces: `migrateLegacyContent({ postsPath, writtenDir, assetMapPath, publicRoot, targetRoot, dryRun }): Promise<MigrationReport>`.
- CLI: `node scripts/migrate-content.mjs --output <앱 밖 staging 경로> --dry-run`.
- Report: 글 수·ID·부모·분류·원본 및 출력 해시·첨부·외부 URL·미소유 파일·오류 목록.

- [ ] **Step 1:** 작은 JSON 입력에 같은 ID의 작성본을 넣는다. 결과 본문은 작성본이어야 한다.
  archive 파일에 다른 본문을 두어도 입력으로 다시 읽지 않는 것을 검사한다.
- [ ] **Step 2:** 기존 PNG URL과 실제 WebP 파일의 매핑, 표지, HTML 이미지, 코드 안의 예제 경로를 검사한다.
  복사한 첨부 해시는 현재 공개 파일과 같아야 한다. 다른 글이 공유한 이미지도 각각 존재해야 한다.
- [ ] **Step 3:** 재실행 출력 해시 동일, 빈 부모 글 보존, 미소유 파일 보고와 dry-run의 입력 미변경을 검사한다.
- [ ] **Step 4:** `node --test tests/content-migration.test.mjs`에서 새 검사 실패를 확인한다.
- [ ] **Step 5:** 최신 `posts.json` → 작성본 override → 공개 asset map 순서로 이전을 구현한다.
  `legacy_path`·`legacy_category`와 날짜를 보존한다. 형제 순서는 입력의 기존 순서로 `order`를 매긴다.
- [ ] **Step 6:** 기존 기본 카테고리 ID·이름·`sources`를 사용해 `categories.json`을 만든다.
  분류 시작 글에 ID를 지정하고, 이전 전후 분류 차이는 개별 명시 값으로 보존해 보고한다.
- [ ] **Step 7:** 검사 통과 후 전체 corpus를 dry-run한다. 실행 시점의 글·첨부 수와 모든 오류를 보고서로 확인한다.
- [ ] **Step 8:** 별도 staging에 실제 출력하고 다시 실행해 해시를 비교한다. 아직 앱의 `content/`를 바꾸지 않는다.
- [ ] **Step 9:** 이전 도구·검사·보고서 형식만 앱에 커밋한다. 원문 캐시와 임시 staging은 커밋하지 않는다.

대표 검사명은 `written overrides and current public asset bytes survive migration`이다.

```js
assert.equal(migrated.documents.get(id).markdown, rewrittenWrittenBody);
assert.equal(sha256(copiedAsset), sha256(currentPublicAsset));
```

DoD: 기준 집계와 출력 ID·부모·분류가 일치한다. URL 재작성 외 본문 변경과 참조 첨부 누락이 없다.

### Task 4: 빌드와 화면이 메타데이터 없는 공개 데이터만 사용한다

왜: 현재 `{ ...post }` 출력은 추가한 AI 필드를 공개 JSON에 포함한다.

**Files:** Modify `scripts/prepare-site.mjs`, `src/shared/post.ts`, `src/app/usePosts.ts`, `src/app/App.tsx`, `src/app/BlogView.tsx`, `src/features/post-reader/page-links.ts`, `src/features/post-category/catalog.ts`, `src/features/post-category/hierarchy.ts`, `src/features/post-category/useCategoryCatalog.ts`, `src/pages/post/PostPage.tsx`; Create `tests/content-build.test.mjs`; Modify `tests/blog.test.mjs`, category 검사와 요청 fixture.

**Interfaces:**
- Consumes: Task 2의 `ContentSnapshot`, `toPublicPosts`, `toPublicCategories`.
- Produces: 기존 index·본문 URL과 새 `/content/categories.json`, `/content/assets/<ID>/<파일명>`.
- `usePosts` 반환값에 `categories`를 추가한다. `BlogView`와 `useCategoryCatalog(posts, categories)`로 전달한다.
- 생성 `Post` 필드는 설계서 7.1의 허용 목록을 따른다. `revision`, `categoryId`, `order`를 타입에 추가한다.
- 이 단계에서 `CONTENT_ROOT` 입력을 지원한다. 기본값은 앱의 `content/`이며, Task 3의 비Git staging도 검증·빌드할 수 있다.
  staging 빌드는 콘텐츠 커밋이 없음을 표시한다. Task 7에서 배포 빌드의 콘텐츠 커밋 검증을 추가한다.

- [ ] **Step 1:** 메타데이터에 `AI_INTERNAL_SENTINEL`을 넣은 작은 corpus로 공개 출력 검사를 만든다.
  표식이 index·상세 JSON·excerpt·복사 파일에 없어야 한다. 본문 구분선과 코드 문자열은 유지해야 한다.
- [ ] **Step 2:** 첨부 URL `/content/assets/<실제 ID>/첨부.pdf`가 글 주소로 바뀌지 않는 검사를 추가한다.
  기존 Notion 링크·새 ID 링크·블록 앵커·제목 앵커도 확인한다.
- [ ] **Step 3:** 카테고리 정식 이름 변경과 조상 상속을 공개 결과에 반영하는 검사를 추가한다.
  기존 v1·v2 개인 설정과 손상된 localStorage는 보존해야 한다.
  `Main`의 호환 값은 `Main`, 분류 없는 새 글은 `미분류`여야 한다.
  두 분류를 합쳐도 각 글의 기존 호환 값이 유지돼야 한다. 새 글과 다른 분류로 이동한 글은 ID 기반 필터에 포함돼야 한다.
- [ ] **Step 4:** `node --test tests/content-build.test.mjs tests/blog.test.mjs tests/category-*.test.mjs`의 새 실패를 확인한다.
- [ ] **Step 5:** 검증 뒤 임시 공개 디렉터리를 생성하도록 빌드를 바꾼다. 실패 때 기존 출력을 유지한다.
  전체 원본과 AI 필드를 복사하지 않는다. 1,400자 목록 미리보기와 lazy body를 유지한다.
- [ ] **Step 6:** 글 링크를 식별한 뒤에만 ID 라우트로 바꾼다. 공개 첨부 prefix는 먼저 그대로 통과시킨다.
- [ ] **Step 7:** 정식 카테고리를 초기값으로 읽고 기존 개인 설정을 overlay한다. `Post.category`는 호환 `sources` 문자열을 유지한다.
  개인 설정이 없으면 정식 이름·배치를 사용한다. 기존 개인 설정은 우선 적용하고 새 분류를 추가한다.
  `PostPage`에 `categoryName`을 전달해 표시 이름은 `categoryId`로 찾은 카테고리를 사용한다.
- [ ] **Step 8:** 같은 검사와 `npx tsc -b`를 실행한다. staging을 `CONTENT_ROOT`로 지정한 빌드도 확인한다.
- [ ] **Step 9:** 공개 데이터·로더·링크·분류 연결만 커밋한다.

대표 검사명은 `public projections exclude agent metadata and preserve attachment URLs`이다.

```js
assert.doesNotMatch(JSON.stringify(publicPosts), /AI_INTERNAL_SENTINEL/);
assert.equal(pageLink(pdfUrl, currentPost, publicPosts), pdfUrl);
```

DoD: 숨긴 표식이 공개 데이터에 없다. 본문 지연 로딩과 현재 목록·카테고리 동작이 유지된다.

### Task 5: 편집과 가져오기가 메타데이터·ID·첨부를 보존한다

왜: 현재 초안 snapshot과 CLI 가져오기는 원본 필드를 다시 조립하며 알 수 없는 필드를 잃는다.

**Files:** Modify `src/features/post-editor/useDraftEditor.ts`, `src/features/post-editor/EditorToolbar.tsx`, `src/shared/drafts.mjs`, `src/pages/write/WritePage.tsx`, `scripts/import-markdown.mjs`; Test `tests/drafts.test.mjs`, `tests/editor-ui.test.mjs`; Create `tests/content-import.test.mjs`.

**Interfaces:**
- Consumes: Task 1의 전체 문서·수정본 합치기, Task 2의 정식 저장과 링크 처리.
- Draft에 `documentId`, `metadata`, `documentMode`, `baseRevision`을 추가한다. 기존 저장 키와 `sourceId` 호환 입력은 유지한다.
- 원문 Markdown과 선택한 첨부의 이름·바이트도 초안·백업에 보존한다. 임시 미리보기 URL을 저장하지 않는다.
- 브라우저 가져오기는 본문 파일 하나와 선택한 형제 첨부를 받는다. 기존 단일 파일 입력도 지원한다.
- Produces: `importMarkdown(inputFile, { contentRoot, expectedRevision?, dryRun: false }): Promise<{ id, filename, revision }>`.
- CLI는 `--content-root`, `--expected-revision`, `--dry-run`을 읽는다. 기존 positional Markdown 입력은 유지한다.

- [ ] **Step 1:** 새 글을 두 번 저장·내보내도 정식 ID가 같고 로컬 `draft-UUID`와 구분되는 검사를 추가한다.
  `id`만 있는 정식 Markdown을 가져온 뒤에도 ID가 같아야 한다.
- [ ] **Step 2:** 전체 문서 가져오기→자동 저장→재열기→JSON 백업→Markdown 내보내기의 의미값 보존을 검사한다.
  확장 필드·배열·parent·분류 ID를 포함한다. 편집기 DOM에는 원시 헤더와 AI 표식이 없어야 한다.
  HTML·앵커·수식·Mermaid·코드를 가진 본문에서 제목만 바꾸면 원문 본문 바이트가 같아야 한다.
  실제 형제 이미지 선택→미리보기→재열기→백업 복원의 바이트도 같아야 한다. Markdown 다운로드의 상대경로는 유지해야 한다.
- [ ] **Step 3:** 공개 글 편집본이 `id`·`base_revision`을 포함하고 숨긴 필드를 추측해 채우지 않는지 검사한다.
  합친 원본의 출처·부모·AI 필드·확장 값은 유지해야 한다.
- [ ] **Step 4:** revision 불일치·원본 없음·첨부 없음·잘못된 data URL·QuotaExceeded에서 기존 데이터 보존을 검사한다.
  전체 편집본도 오래된 기준 revision이면 최신 AI·확장 필드와 첨부를 그대로 보존해야 한다.
  legacy ID 해석은 기존 우선 규칙을 따른다. 기존 ID에 기준 값 없이 쓰거나 서로 다른 기준 값을 넘기면 실패해야 한다.
- [ ] **Step 5:** `node --test tests/import-document.test.mjs tests/drafts.test.mjs tests/editor-ui.test.mjs tests/content-import.test.mjs`의 새 실패를 확인한다.
- [ ] **Step 6:** 초안 snapshot이 전체 metadata를 보존하게 바꾼다. 본문 편집기에는 분리한 본문만 넣는다.
  분류 입력은 알려진 category ID로 연결하고 YAML·AI 필드 UI를 추가하지 않는다.
  기존 글·가져온 Markdown은 본문 전용 Markdown 입력으로 편집한다. 새 블록 글과 기존 블록 초안은 BlockNote를 유지한다.
  본문 미편집 저장·내보내기는 보관한 원문을 사용한다. 정식 Markdown을 `blocksToMarkdownLossy()`로 재생성하지 않는다.
- [ ] **Step 7:** CLI가 수정본을 원본에 합치고 제목 파일을 안전하게 교체하도록 바꾼다.
  data URL 이미지를 형제 파일로 추출한다. 공개 첨부 URL과 입력 옆의 상대 파일도 검증한다.
  기존 ID는 전체 편집본과 수정본 모두 같은 revision 검사를 거친다. 신규 저장만 기준 값 없이 허용한다.
  브라우저는 선택한 첨부만 읽는다. 누락·크기 초과를 표시하고 Markdown 단독 다운로드의 첨부 보관 조건을 안내한다.
- [ ] **Step 8:** 본문 변경은 `needs_review`로 표시한다. 생성 실패나 미완성 AI 요약 때문에 본문 저장을 막지 않는다.
- [ ] **Step 9:** 같은 명령에서 실패 0개를 확인하고 이 작업만 커밋한다.

대표 검사명은 `stale public patches leave canonical files unchanged`이다.

```js
await assert.rejects(applyStalePatch(), /revision/i);
assert.equal(sha256(afterCanonicalFile), sha256(beforeCanonicalFile));
assert.equal(reopenedDraft.documentId, importedCanonicalId);
```

`applyStalePatch`는 이 검사 안에서 `importMarkdown`을 호출하는 로컬 함수다.

DoD: 전체 문서와 공개 수정본의 왕복이 구분된다. metadata·본문·선택한 첨부의 손실과 헤더 노출·ID 재생성이 없다.

### Task 6: 실제 콘텐츠 검사로 이전하고 기존 도구의 쓰기를 차단한다

왜: 기존 실데이터 검사는 삭제할 JSON을 읽는다. 기존 수집 CLI는 이전 경로에 쓰므로 그대로 실행하면 원본이 갈라진다.

**Files:** Modify `scripts/content.mjs`, `package.json`, `tests/markdown-corpus.test.mjs`, `tests/article-toc.test.mjs`, `scripts/export-notion.mjs`, `scripts/repair-markdown.mjs`, `scripts/prepare-web-assets.mjs`; Test `tests/content.test.mjs`, `tests/notion-markdown.test.mjs`, `tests/markdown-rendering.test.mjs`, `tests/post-reader.test.mjs`.

**Interfaces:**
- Consumes: Task 2의 `readContent`, `validateContent`, 공개 projection.
- Produces: `npm run check:content`는 `node scripts/content.mjs --check`를 실행한다.
- 검사 CLI는 `CONTENT_ROOT`의 실제 글·카테고리·로컬 첨부를 읽고 검증한다. 기본값은 앱의 `content/`다.
- 성공 시 글·카테고리·참조 첨부 수와 오류 0개를 출력한다. 누락·잘못된 관계는 0이 아닌 종료 코드로 끝낸다.
- 단위·렌더링 검사는 기존 `npm run check`에서 실행한다. `check:content`를 단위 검사 별칭으로 만들지 않는다.
- 기존 도구의 직접 CLI 실행은 콘텐츠 전환 뒤 쓰기 전에 중단한다. 순수 변환 함수의 import와 검사는 유지한다.

- [ ] **Step 1:** 작은 임시 corpus에서 검사 CLI의 성공·누락 첨부·잘못된 부모·초기화 누락 종료 코드를 검사한다.
  기존 도구의 직접 실행이 정식 입력과 이전 공개 경로에 쓰지 않는지도 확인한다.
- [ ] **Step 2:** `node --test tests/content.test.mjs`로 새 검사 실패를 확인한 뒤 공통 처리기에 검사 진입점을 연결한다.
  별도 검증 프레임워크나 같은 규칙의 복제본을 만들지 않는다.
- [ ] **Step 3:** corpus·목차 검사가 정식 Markdown의 공개 projection을 읽게 바꾼다.
  `content/posts.json` 직접 읽기를 제거하고 기존 article ID·HTML·수식·코드 assertion은 유지한다.
- [ ] **Step 4:** 기존 수집·복구·변환 CLI에 전환 후 쓰기 차단과 안내를 추가한다.
  세 도구의 새 staging CLI를 구현하지 않는다. `check:export`·`check:assets`는 이전 전 백업 환경의 검사로 문서화한다.
- [ ] **Step 5:** `CONTENT_ROOT`를 Task 3의 staging으로 지정해 `npm run check:content`와 `npm run check`를 실행한다.
  최신 corpus 집계와 기존 렌더링 회귀 결과를 기록한다. 개인 archive 폴더를 기본 검사의 필수 입력으로 쓰지 않는다.
- [ ] **Step 6:** 검사 전환과 기존 도구 보호만 커밋한다.

대표 검사명은 `content checking validates the selected corpus and preserves canonical files`이다.

```js
assert.notEqual(missingAssetCheck.exitCode, 0);
assert.equal(sha256(afterCanonicalFile), sha256(beforeCanonicalFile));
```

DoD: 실제 staging 전체를 검사한다. 기존 assertion을 유지하고, 전환 뒤의 수집 CLI가 정식 원본에 쓰지 않는다.

### Task 7: 검증한 콘텐츠를 submodule로 전환한다

왜: 앱과 콘텐츠의 버전을 별도로 관리하면서 같은 빌드를 재현해야 한다.

**Files:** Create `.gitmodules`; Modify `.gitignore`, `.vercelignore`, `.github/workflows/build.yml`, `vite.config.ts`, `vercel.json`, `package.json`; 콘텐츠 저장소에 `README.md`, `AGENTS.md`, `CONTENT_SCHEMA.md`, `categories.json`, `posts/`.

**Interfaces:**
- Consumes: Task 3의 검증한 staging, Task 4·6의 빌드·검사 계약.
- 콘텐츠 커밋은 gitlink로 고정한다. `build-info.json`에 `contentCommit`을 추가한다.
- `CONTENT_ROOT`는 로컬 staging 검사용 선택 입력이다. 기본값은 앱의 `content/`다.
- `CONTENT_COMMIT_SHA`는 Git 정보 없는 배포 포장의 필수 입력이다. 포장은 지정 커밋의 깨끗한 콘텐츠에서 만든다.
- Git 배포 빌드는 콘텐츠 HEAD·앱 gitlink·전달한 SHA의 일치와 콘텐츠 작업 트리 미변경을 확인한다.
- 앱 밖 staging 검사는 배포 빌드와 구분한다. Git 커밋이 없는 staging의 `contentCommit`은 `null`이며 배포 입력으로 사용하지 않는다.

- [ ] **Step 1:** 지정할 공개 HTTPS 원격 URL과 소유자를 확인한다.
  기존 저장소가 있으면 재사용 여부를 확인한다. 이 계획의 문서 작성만으로 저장소 생성·푸시를 실행하지 않는다.
- [ ] **Step 2:** 검증한 staging을 콘텐츠 저장소에 보관한다. 스키마와 에이전트 규칙에 원본·AI 보강·출처·검토 정책을 적는다.
- [ ] **Step 3:** 원격에 콘텐츠 커밋을 보관하고 접근 가능한 SHA를 확인한다.
  앱의 기존 `content/`와 공개 첨부는 해시 백업을 확인한 뒤에만 교체한다.
- [ ] **Step 4:** `content/`를 submodule로 등록한다. Actions checkout에 recursive submodule 초기화를 설정한다.
  기존 `content/`의 앱 추적을 먼저 해제한다. 이전 JSON은 이미 검증한 외부 백업에 보관한다.
  빌드에는 `--remote` 갱신과 네트워크 수집을 넣지 않는다.
- [ ] **Step 5:** 콘텐츠 누락·초기화 누락·커밋 불일치의 실패 검사를 추가한다. 오래된 JSON fallback은 금지한다.
- [ ] **Step 6:** 새 첨부 URL에 기존 CSP를 적용한다. CLI 포장에 콘텐츠 파일은 포함하고 Git·캐시·로컬 wiki는 제외한다.
- [ ] **Step 7:** 앱의 gitlink·빌드 설정을 전환 후보로 커밋하고 앱 SHA를 기록한다.
  해당 SHA를 별도 새 체크아웃에서 연다. `git submodule update --init --recursive`, `npm ci`, `npm run check`, `npm run check:content`, `npm run build`를 실행한다.
  로컬 빌드의 `GITHUB_SHA`에는 검증 대상 앱 SHA를 전달한다. 기존 버전 출력은 이 입력으로 앱 커밋을 기록한다.
  개인 archive 폴더가 없어도 성공해야 한다. `build-info.json`의 앱·콘텐츠 SHA와 빌드 결과를 확인한다.
- [ ] **Step 8:** 생성 결과와 이전 보고서를 비교한 뒤 옛 공개 첨부·asset map 사본을 앱 추적에서 제거한다.
  미소유 첨부는 보고서와 외부 백업으로 남긴다. 검증 전에 삭제하지 않는다.
- [ ] **Step 9:** 정리 변경을 커밋하고 최종 앱 SHA에서 Step 7의 새 체크아웃 검사를 반복한다.
  콘텐츠 커밋을 먼저 원격에 보관하는 순서를 유지한다. 실제 배포는 별도 요청 범위에서만 실행한다.

DoD: 새 체크아웃이 같은 콘텐츠 커밋을 사용한다. Git 연동과 CLI 포장의 검증 상태를 구분해 기록한다.

### Task 8: 로컬 LLM wiki 확장 계약을 문서로 확정한다

왜: LLM wiki가 원본을 찾고 근거 revision을 추적하려면 공개 출력과 다른 색인이 필요하다.

**Files:** Modify 콘텐츠 저장소의 `AGENTS.md`, `CONTENT_SCHEMA.md`, `README.md`.

**Interfaces:**
- Consumes: Task 2의 정식 문서와 revision.
- Produces: `catalog.jsonl` 레코드의 ID·파일 경로·metadata·revision 계약, wiki의 `source_ids`·`source_revisions` 예시.
- 첨부를 근거로 사용한 경우 `source_assets`에 파일명과 SHA-256을 기록하는 형식도 문서에 적는다.
- 저장 위치는 앱 밖이다. 생성기·wiki 순회·재검토 보고 명령은 구현하지 않는다.

- [ ] **Step 1:** 실제 글 세 개로 ID→원문 파일 경로→형제 첨부를 찾는 색인 레코드 예시를 적는다.
  절대경로를 Git에 고정하지 않고 로컬 checkout의 절대 root와 상대 파일 경로를 조합하도록 정의한다.
- [ ] **Step 2:** wiki 예시의 근거 ID와 revision을 적는다. 원문·첨부 변경 시 재검토하는 후속 규칙을 명시한다.
  빈 summary를 원문 부재로 취급하지 않는다. 생성기가 교체할 파일은 `catalog.jsonl`로 한정한다.
- [ ] **Step 3:** 에이전트 규칙에 원문 우선·이미지 확인·검토 상태·비공개 경계·개인 파일 덮어쓰기 금지를 적는다.
  AI가 원문을 보강하면 diff를 검토하고, 자동 AI 호출과 벡터 검색은 후속 범위로 남긴다.
- [ ] **Step 4:** 예시의 JSON 문법과 ID·경로·첨부·revision을 실제 콘텐츠와 대조한다.
  Task 4의 공개 출력 검사에서 로컬 지식 파일이 포함되지 않는지도 확인하고 문서만 커밋한다.
  콘텐츠 문서 커밋을 먼저 원격에 보관하고 앱 gitlink를 갱신한다. 예시와 문서만 바꾸며 생성기를 추가하지 않는다.

DoD: 원본과 파생 wiki의 저장·출처 계약이 명확하다. 현재 공통 문서 계약으로 후속 색인을 만들 수 있다.

### Task 9: 전체 계약을 검증하고 운영 문서를 갱신한다

왜: 단위 검사를 통과해도 실제 편집·이미지 요청·깨끗한 빌드가 연결되지 않을 수 있다.

**Files:** Modify `README.md`, `docs/MIGRATION.md`, `docs/notion-writing-ux.md`; 설계서·실행 계획에 실제 증거 기록.

**Interfaces:** Consumes Task 1-8의 결과. 새 제품 코드 인터페이스는 추가하지 않는다.

- [ ] **Step 1:** `npm run check`, `npm run check:content`, `npm run build`를 실행한다.
  실행한 명령·입력 커밋·exit code·실패 수를 기록한다. 기존 실패를 지우거나 assertion을 약하게 만들지 않는다.
- [ ] **Step 2:** 이전 도구의 검사가 필요하면 이전 전 백업 환경에서 `check:export`·`check:assets`를 실행한다.
  외부 archive와 구버전 JSON 입력이 필요함을 기록한다. 새 체크아웃의 필수 검사와 섞지 않는다.
- [ ] **Step 3:** 분류 이름·부모를 바꾸는 작은 입력의 전후 원본 경로와 첨부 해시를 비교한다.
  수정한 metadata만 달라져야 한다. 전체 준비 시간과 분류 변경 후 시간을 각각 측정한다.
- [ ] **Step 4:** Chrome 전용 탭에서 목록→상세→편집→자동 저장→내보내기→가져오기를 확인한다.
  raw YAML·AI 표식 미노출, 실제 이미지 요청, 첨부 다운로드와 제목·블록 앵커를 확인한다.
  전체 문서·형제 이미지의 백업 복원과 제목만 수정한 본문의 보존도 확인한다.
- [ ] **Step 5:** Chrome 연결 실패는 구체적인 API 오류로 기록한다. DOM 검사로 실제 브라우저 검증을 대체했다고 쓰지 않는다.
- [ ] **Step 6:** 실행 계획의 F01-F09와 C01-C12를 실제 증거에 연결한다.
  원문 백업·복구 절차와 콘텐츠 커밋 우선 발행 순서를 문서에 갱신한다.
- [ ] **Step 7:** 범위 전체의 코드 리뷰와 사용자 변경 보존을 확인한 뒤 완료 상태를 기록한다.
  배포·PR 생성·병합·추가 자동화는 별도 요청이 있을 때만 실행한다.

DoD: 필수 완료 기준은 증거로 확인한다. 미검증 필수 항목이 남으면 구현 완료로 기록하지 않는다.
문서가 실제 저장·발행·복구 절차와 일치해야 한다.

## 요구사항과 작업 연결

| 설계 요구 | 구현 작업 | 완료 기준 |
|---|---|---|
| F01·F09 submodule과 재현 가능한 빌드 | Task 3, 6, 7, 9 | C01·C02·C03 |
| F02 ID 폴더와 형제 첨부 | Task 1, 2, 3, 5 | C02·C03·C08 |
| F03 메타데이터 계층·분류 | Task 2, 3, 4 | C02·C08 |
| F04 AI 메타데이터 | Task 1, 5, 8 | C04·C11 |
| F05 게시·편집에서 분리 | Task 1, 4, 5, 9 | C05·C06·C12 |
| F06 왕복·ID·수정본 보존 | Task 1, 2, 5 | C04·C07 |
| F07 기존 콘텐츠·렌더링·주소 | Task 2, 3, 4, 6, 9 | C02·C03·C09·C10·C12 |
| F08 로컬 LLM wiki 확장 | Task 8 | C11 |

## 문서 자체 검토와 현재 실행 상태

이 계획의 자체 검토는 작성자가 수행한다. 문서 저장 뒤 요구사항 누락, 인터페이스 불일치와 검사 명령을 확인한다.
실제 구현 체크박스는 실행 전까지 비워 둔다. 문서 검사 결과를 제품 검사 통과로 기록하지 않는다.

현재 승인 범위는 이 실행 계획과 설계서의 작성·검토·수정이다.
구현용 작업 트리, 코드·콘텐츠 변경, 패키지 설치, Git 저장소 생성·연결·푸시와 배포는 실행하지 않았다.


### 문서 검토·수정 검증 기록

2026-10-23 KST에 문서 자체 검사만 실행했다.

- 기존 `unified`·`remark-parse`로 두 문서를 파싱하고 상호 링크와 코드 fence를 확인했다.
- 요구사항 9개, 완료 기준 12개와 실행 작업 9개의 연결을 확인했다.
- 기존 Python YAML 파서로 frontmatter 예시 1개를 읽었다. JSON 카테고리 예시도 파싱했다.
- 두 문서의 공백 검사와 문서 문장의 25어절 상한을 확인했다.
- 구현 체크박스는 모두 비워 뒀다. 제품 테스트·빌드·이전·배포는 실행하지 않았다.

이번 검토에서는 다음 문제를 두 문서에 반영했다.

1. 기존 JSON에 의존한 검사를 정식 Markdown 입력으로 전환하고, 실제 corpus 검사 명령을 별도로 정의했다.
2. 후보 앱 커밋 뒤 새 체크아웃을 검사하도록 순서를 바로잡았다. 옛 공개 첨부 정리 뒤 최종 SHA도 검사하도록 했다.
3. 전체 편집본의 revision 검사와 본문 보존 경로를 추가했다. 브라우저의 동반 첨부와 다운로드 한계도 명시했다.
4. 파서의 전체 문서·수정본 반환 계약과 카테고리 병합의 호환 값 선택을 구체화했다.
5. 기존 수집 도구는 쓰기 차단으로 범위를 줄였다. 로컬 wiki는 생성기 구현 대신 확장 계약을 확정하도록 했다.

판단 근거는 `useDraftEditor.ts`, `EditorToolbar.tsx`, `prepare-site.mjs`, 기존 corpus·목차 검사와 카테고리 필터다.
이 파일들은 읽기 전용으로 확인했다. 제품 코드와 콘텐츠는 이번 검토에서 수정하지 않았다.
실행자는 착수 시점의 작업 트리를 다시 확인하고, 이 문서의 집계를 새 입력에 맞춰 검증해야 한다.
