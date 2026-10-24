# GitHub Content Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans. Track steps with checkboxes. The user explicitly requested plan creation followed by implementation on 2026-10-24 KST.

**Goal:** 공개 조회를 유지하면서 본인만 GitHub 인증 뒤 Post와 Category 원본을 바꾸고 자동 게시한다.

**Architecture:** Vercel Functions가 GitHub App 로그인과 원본 편집 요청을 받는다. API는 후보 커밋을 만들고 Actions가 전체 콘텐츠를 검증한 뒤 원본 브랜치와 앱 gitlink를 갱신한다. 기존 React 화면은 비로그인 조회와 인증한 관리 상태를 구분한다.

**Tech Stack:** React, TypeScript, Node.js 표준 API, Vercel Functions, GitHub App, GitHub Actions, 기존 YAML·Markdown 도구, Node test runner, jsdom.

**Spec:** `docs/superpowers/specs/2026-10-24-github-content-management-design.md`

## Global Constraints

- 누구나 로그인 없이 정식 글과 카테고리를 조회한다.
- 카테고리 관리 메뉴와 화면은 `ready`에서만 표시한다. 공개 분류 표시와 필터는 로그인 없이 유지한다.
- 로그인 전 상단 버튼은 기존 글쓰기 디자인의 `GitHub 아이콘 + 로그인`이다. 연결 재확인과 설정 오류 문구는 상단에 표시하지 않는다.
- 카테고리 관리는 기존 트리 UI를 재사용하고 정식 원본 저장을 연결한다.
- 콘텐츠 저장소는 `gyungsubLee/subdev-blog-content`로 고정한다.
- 앱 저장소는 `gyungsubLee/subdev-blog`로 고정한다.
- App 권한은 `Contents: write`, `Actions: write`와 기본 `Metadata: read`로 한정한다.
- 세션 수명은 최대 1시간이며 GitHub 토큰 만료 시각보다 짧아야 한다.
- GitHub API 버전은 `2026-03-10`으로 고정한다.
- Workflow의 `run-name`은 `cms:<요청 UUID>:<후보 SHA>`로 고정한다.
- `group:unclassified`는 삭제할 수 없다.
- 첨부 요청의 HTTP 본문 전체는 4MiB 이하로 제한한다.
- 원본 브랜치 변경과 앱 gitlink 갱신은 fast-forward만 허용한다.
- 원문 Markdown, 첨부와 확장 메타데이터를 보존한다. 신규 런타임 의존성을 기본으로 추가하지 않는다.
- 기존 카테고리 작업의 미커밋 변경을 덮어쓰거나 이 작업의 커밋에 넣지 않는다.
- 실제 GitHub App 없는 로그인 대체값으로 원격 검증 통과를 주장하지 않는다.
- 운영 배포는 preview 검증 뒤 별도 승인한다.

## Review Focus

- 공개 조회가 `/api/session` 오류나 응답 지연 때문에 멈추는 경우: Task 3에서 공개 화면을 먼저 표시한다.
- 로그인했지만 App 설치나 쓰기 권한이 없는 경우: Task 1에서 상태를 차단하고 모든 변경 API를 거부한다.
- 제목만 수정했는데 본문이나 확장 필드가 바뀌는 경우: Task 2에서 원문 바이트와 메타데이터를 대조한다.
- 삭제 뒤 Notion 링크가 외부 링크로 바뀌어 의존 검사를 피하는 경우: Task 4에서 삭제 전 참조도 검사한다.
- 이전 요청이 늦게 끝나 최신 게시를 되돌리는 경우: Task 4에서 두 저장소의 계보와 재시도 상태를 검사한다.

## 파일과 공유 계약

- Task 1 소유: `server/github.mjs`, `server/auth.mjs`, `server/handler.mjs`, `api/index.js`, `tests/github-auth.test.mjs`, `tests/management-api.test.mjs`.
- Task 2 소유: `server/content.mjs`, `tests/github-content.test.mjs`.
- Task 3 소유: `src/features/content-management/*`, `src/app/App.tsx`, `src/app/BlogView.tsx`, `src/components/layout/SiteHeader.tsx`, `src/pages/post/PostPage.tsx`, `tests/content-management.test.mjs`, 인증에 영향을 받는 기존 검사.
- Task 4 소유: `scripts/publish-content.mjs`, `.github/workflows/publish-content.yml`, `tests/publish-content.test.mjs`.
- Task 5 소유: `vite.config.ts`, `vercel.json`, `.env.example`, `README.md`의 새 관리 절차, 전체 통합 검사와 계획 진행 기록.

서버는 표준 `Request`를 받아 `Response`를 반환한다. `api/index.js`는 `{ fetch: handleRequest }`를 기본 export한다.
`vercel.json`은 `/api/:path*`를 `/api?path=:path*`로 연결한다. Vite 개발 서버도 같은 handler를 호출한다.
Handler는 원래 pathname과 재작성한 `path`를 같은 허용 경로 집합으로 정규화한다.

`server/github.mjs`는 다음 계약을 제공한다.

```text
createGitHubClient(token, fetcher = globalThis.fetch)
  -> async request(path, { method = 'GET', body, headers } = {}) -> parsed JSON
httpError(status, message, details?) -> Error with status and safe details
```

`server/auth.mjs`는 다음 계약을 제공한다.

```text
loadConfig(env = process.env) -> config
authenticate(request, config, fetcher, { mutate = false } = {}) -> { token, user, csrfToken }
checkConnection(token, config, fetcher) -> { repository, branch, contentCommit, appContentCommit, appCommit }
```

`config`에는 `origin`, `clientId`, `clientSecret`, `sessionKey`, `adminUserId`, `appId`, `installationId`, `workflow`를 둔다.
`config.app`과 `config.content`는 각각 `{ owner, repo, id, branch }`다. `workflow`는 `publish-content.yml`로 고정한다.
`GET /api/session`은 `{ state, user?, csrfToken?, connection?, error? }`를 반환한다.
상태 값은 `signed_out`, `checking`, `ready`, `blocked`다.

`server/content.mjs`의 진입점은 `handleContentRequest(request, { token, config, fetcher, connection }) -> Response`다.
Handler는 이 모듈에 진입하기 전에 본인 인증을 검사한다. 변경 메서드에서는 연결 상태와 CSRF도 검사한다.

```text
GET /api/content?kind=post&id=<UUID>
  -> { document: {metadata, markdown}, filename, revision, contentCommit, categories, assets }
GET /api/content?kind=categories
  -> { categories, revision, contentCommit }
GET /api/content?kind=new
  -> { document: {metadata, markdown}, revision: null, contentCommit, categories, assets: [] }
POST /api/content
  <- { requestId, baseCommit, operation }
  -> { requestId, candidateCommit, baseCommit, runId, runUrl, state: 'validating' }
  -> 변경이 없으면 { requestId, contentCommit, state: 'unchanged' }
```

`operation.type`은 `post.create`, `post.update`, `post.delete`, `categories.save`다.
생성은 `document`와 `assets`, 수정은 `id`, `baseRevision`, `changes`, `markdown`, `assets`를 받는다.
삭제는 `id`, `baseRevision`을 받는다. 카테고리 저장은 `baseRevision`, `categories`를 받는다.
`assets`는 안전한 이름과 Git blob SHA를 담은 `{ name, sha, size }[]`다.

`POST /api/assets`는 Base64 파일 조각을 Git blob으로 올린다. `{ content }`를 받아 `{ sha, size }`를 반환한다.
`{ chunks: SHA[] }`를 받으면 조각을 읽고 합쳐 최종 blob을 만든다. 누적 크기는 기존 이미지 제한인 5MiB까지 허용한다.
파일은 최종 blob 하나로 후보 트리에 넣는다. 조각을 정식 글 폴더에 저장하지 않는다.

```text
GET /api/publish?requestId=<UUID>&candidateCommit=<SHA>&runId=<ID>
  -> { state, contentCommit?, runUrl?, commitUrl?, error? }
POST /api/publish
  <- { requestId, candidateCommit } -> existing or resumed run
```

게시 상태는 `validating`, `saved`, `pending`, `published`, `failed`, `superseded`다.
응답은 콘텐츠 원본 저장과 workflow 성공을 구분한다. 후보 저장만으로 `saved`를 반환하지 않는다.

## Task 1: GitHub 로그인과 서버 권한 경계

**Interfaces:** 위 GitHub client, auth, handler 계약을 생산한다. Task 2 모듈은 콘텐츠 경로에서만 동적으로 불러온다.

- [ ] **Step 1:** 실패 검사를 작성한다. 비로그인 변경은 `401`, 다른 사용자는 `403`, 변조·만료 쿠키는 `401`이어야 한다.
- [ ] **Step 2:** `node --test tests/github-auth.test.mjs tests/management-api.test.mjs`로 누락된 기능의 실패를 확인한다.
- [ ] **Step 3:** Node `crypto`로 state·PKCE·인증된 쿠키 암호화를 구현한다. 운영 쿠키와 CSRF 규칙은 설계서 그대로 적용한다.
- [ ] **Step 4:** 본인 ID, App 설치, 두 저장소 ID·권한·브랜치·gitlink·원본 구조·workflow를 확인한다. 실패를 `ready`로 바꾸지 않는다.
- [ ] **Step 5:** GitHub API만 네트워크 경계에서 대체한 HTTP 검사로 코드 교환, 토큰 유출 차단, 로그인 취소와 권한 취소를 확인한다.
- [ ] **Step 6:** 같은 명령으로 통과를 확인하고 담당 파일만 검토·커밋한다.

## Task 2: 원본 읽기와 후보 커밋

**Interfaces:** 위 content·assets·publish HTTP 계약을 생산한다. Task 1의 client와 오류 계약을 소비한다.
후보 커밋 메시지에는 요청 ID와 요청 본문의 SHA-256 지문을 넣어 중복 요청을 검증한다.

- [ ] **Step 1:** 제목 수정의 본문·확장 필드 보존, stale revision, 기존 첨부 보존, ID 경로 이탈 거부 검사를 먼저 작성한다.
- [ ] **Step 2:** `node --test tests/github-content.test.mjs`로 의도한 실패를 확인한다.
- [ ] **Step 3:** 원본 브랜치 HEAD와 Git tree를 읽고 UUID 경로를 찾는다. 큰 디렉터리는 Contents API의 1,000개 제한에 의존하지 않는다.
- [ ] **Step 4:** 기존 파서·`mergeDocumentPatch`·파일명 규칙으로 변경 파일만 구성한다. 메타데이터만 바꾸면 본문을 변환하지 않는다.
- [ ] **Step 5:** 정식 카테고리의 ID·sources·확장 필드를 보존한다. 개인 `CategoryNode` 직렬화를 저장 입력으로 쓰지 않는다.
- [ ] **Step 6:** Git blob·tree·commit과 후보 브랜치를 생성한다. 같은 요청·같은 바이트는 후보를 재사용하고 다른 바이트는 `409`로 거부한다.
- [ ] **Step 7:** 고정 workflow에 SHA만 전달하고 실행 ID를 반환한다. 응답 유실과 중복 실행은 고정 run-name으로 복구한다.
- [ ] **Step 8:** 조각 업로드와 5MiB 최종 크기 제한, malformed Base64, 비정상 SHA와 누적 크기를 검사한다.
- [ ] **Step 9:** 전체 담당 검사를 통과시키고 원본 브랜치가 후보 생성만으로 바뀌지 않았음을 검증·커밋한다.

## Task 3: 공개 조회와 인증한 관리 화면

**Interfaces:** Task 1·2의 HTTP 계약을 소비한다. 비밀값은 React에 전달하지 않는다.
`src/features/content-management/useManagement.ts`는 세션 상태·재확인·로그아웃·CSRF를 제공한다.
`ManagedPostEditor.tsx`는 원문 Markdown, 제목과 정식 분류를 편집한다. `ManagedCategories.tsx`는 정식 레코드만 편집한다.
`PublishStatus.tsx`는 요청 ID·후보 SHA·실행 ID로 상태를 조회하고 재시도를 제공한다.

- [ ] **Step 1:** 비로그인 공개 글 표시와 변경 차단, 인증 실패 중 공개 표시, 본인 ready 상태의 편집 검사를 작성한다.
- [ ] **Step 2:** `node --test tests/content-management.test.mjs tests/app-flow.test.mjs`로 새 계약의 실패를 확인한다.
- [ ] **Step 3:** 공개 fetch와 세션 fetch를 병렬로 시작한다. 로그인 버튼과 글쓰기 버튼을 상태에 따라 교체하고 `ready`에서만 관리 화면을 연다.
- [ ] **Step 4:** 인증한 원본을 편집기에 불러온다. 제목만 수정한 요청의 Markdown은 받은 원문 그대로 보낸다.
- [ ] **Step 5:** 새 글, 수정, 말단 글 삭제를 연결한다. 기존 카테고리 트리 UI의 추가·수정·이동·순서·삭제를 API에 연결한다.
- [ ] **Step 6:** 초안과 게시 요청 ID를 브라우저에 보존한다. 저장 실패, 충돌과 재로그인이 초안을 지우지 않는지 검사한다.
- [ ] **Step 7:** 기존 블록 초안을 보존한다. 공개 카테고리 표시와 정식 관리에 개인 alias가 덮어쓰지 않게 연결한다.
- [ ] **Step 8:** 게시 상태·실행 링크를 표시한다. 말단이 아니거나 의존하는 항목의 삭제 실패를 사용자에게 알린다.
- [ ] **Step 9:** 담당 DOM 검사와 TypeScript 검사를 통과시키고 UI 변경을 검토·커밋한다.

## Task 4: Actions 원본 검증과 게시

**Interfaces:** `publish-content.yml`은 `request_id`, `candidate_sha`, `base_sha` 입력을 받는다.
`scripts/publish-content.mjs`는 import 가능한 검증·승격 함수를 제공하고 CLI도 지원한다.
인증된 설치 토큰은 선택한 두 저장소의 Contents write로 제한한다.

- [ ] **Step 1:** 임시 로컬 Git 저장소로 후보의 부모·허용 경로·삭제 참조·fast-forward·재시도·게시 순서 역전 검사를 작성한다.
- [ ] **Step 2:** `node --test tests/publish-content.test.mjs`에서 실제 Git 변경 결과가 실패하는지 확인한다.
- [ ] **Step 3:** 신뢰한 앱 코드로 후보를 읽고 전체 `readContent` 검사를 실행한다. 콘텐츠 안의 코드와 workflow는 실행하지 않는다.
- [ ] **Step 4:** 삭제 전 링크도 검사해 Notion URL 참조를 보호한다. 사용 중인 카테고리와 미분류 삭제를 거부한다.
- [ ] **Step 5:** 원본 HEAD가 기준·후보·후속·충돌일 때를 분기한다. 두 브랜치를 강제로 갱신하지 않는다.
- [ ] **Step 6:** 앱 gitlink 갱신은 후속 커밋으로만 진행한다. 앱 HEAD 충돌은 새 기준에서 제한된 재시도로 검사한다.
- [ ] **Step 7:** 기존 검사·빌드 뒤 Vercel preview를 만든다. 앱·콘텐츠 SHA를 검증하고 실행 요약에 URL과 결과를 기록한다.
- [ ] **Step 8:** 신뢰한 기존 action pin을 재사용하거나 공식 릴리스의 전체 SHA를 확인한다. secrets가 없으면 명확히 실패하며 공개 조회에는 영향이 없다.
- [ ] **Step 9:** 로컬 Git 검사와 사용 가능한 workflow 검사를 통과시키고 CI 변경을 검토·커밋한다.

## Task 5: 개발 서버·설정·전체 검증

**Interfaces:** 같은 `handleRequest(Request, {env, fetcher}?)`를 Vercel과 Vite에서 사용한다.

- [ ] **Step 1:** Vercel rewrite와 Vite API adapter를 연결한다. Node cookie와 응답 헤더를 보존한다.
- [ ] **Step 2:** `.env.example`에 비밀값 없는 설정 예시를 추가한다. README에 GitHub App 등록·두 저장소 설치·서버 환경·Actions secrets 절차를 적는다.
- [ ] **Step 3:** `npm run check`, `npm run check:content`, `npm run build`를 실행한다. 다른 작업의 기존 실패와 이번 변경의 실패를 구분한다.
- [ ] **Step 4:** Chrome 전용 탭에서 비로그인 공개 조회와 변경 차단을 확인한다. 로그인 설정이 없으면 그 상태를 그대로 확인한다.
- [ ] **Step 5:** 전체 변경을 독립 검토하고 보안·데이터 보존·동시성의 실질 결함을 수정한다.
- [ ] **Step 6:** GitHub App 설정이 준비되면 실제 로그인·권한·검증용 CUD·preview를 확인한다. 준비되지 않으면 로컬 구현과 실제 원격 검증의 경계를 보고한다.
- [ ] **Step 7:** 실제로 실행한 검사, 커밋과 남은 초기 설정을 보고한다. 사용자 승인 없이 운영으로 전환하지 않는다.

## 실행 판단 기록

- 사용자가 설계서 승인 뒤 계획 작성과 구현의 연속 실행을 명시했다. 계획 작성 후 추가 대기 없이 구현한다.
- 독립 파일을 가진 서버 인증·원본 API·Actions를 병렬 작업한다. 공유 계약은 위 Interfaces로 고정한다.
- native worktree는 생성했지만 샌드박스가 쓰기를 차단했다. 비어 있는 worktree를 archive하고 현재 feature 브랜치에서 파일별 소유권을 지킨다.
- 자격 증명이 필요한 외부 설정은 로컬 구현 뒤 진행한다. 가짜 로그인으로 실제 GitHub 검증을 대신하지 않는다.
- 사용자는 구현 중 카테고리 관리 화면의 로그인 제한과 기존 UI 유지를 요청했다. 해당 요청을 기존 공개 조회 규칙보다 우선한다.
- 검사는 대상별 실행 담당자를 정한다. 전체 검사는 하위 검사가 끝난 뒤 한 번 실행하고 중복 실행하지 않는다.
