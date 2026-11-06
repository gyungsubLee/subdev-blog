# 실제 GitHub 검사 준비

필수 설정은 모두 있다. 실제 OAuth를 시작하기 전에 `5173` 포트 충돌을 해결해야 한다.
이 문서는 2026-11-07 KST의 소스·설정 조사 결과다. 원격 요청, 브라우저 조작, 제품 검사와 원격 쓰기는 실행하지 않았다.

## 확인한 설정

Vite의 `loadEnv('development', root, ['CMS_', 'GITHUB_'])`로 설정을 읽었다.
출력에는 키 존재 여부, 원점, 저장소와 브랜치만 포함했다. 자격증명은 출력하거나 파일로 저장하지 않았다.

- `CMS_ORIGIN`: `http://127.0.0.1:5173`
- 앱 저장소: `gyungsubLee/subdev-blog`, 브랜치 `main`
- 콘텐츠 저장소: `gyungsubLee/subdev-blog-content`, 브랜치 `main`
- 필수 키 11개가 모두 비어 있지 않다.
- 선택 키 `GITHUB_PUBLIC_TOKEN`은 없다.

필수 키는 `CMS_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `CMS_SESSION_KEY`, `GITHUB_ADMIN_USER_ID`, `GITHUB_APP_ID`,
`GITHUB_INSTALLATION_ID`, `GITHUB_APP_REPOSITORY_ID`, `GITHUB_CONTENT_REPOSITORY_ID`, `GITHUB_APP_BRANCH`, `GITHUB_CONTENT_BRANCH`다.
세션 키 길이, 숫자 ID 유효성, GitHub App의 현재 권한은 이 조사에서 검사하지 않았다.

## 원점과 실제 로그인

[`auth.mjs`](../../../app/server/src/auth.mjs)의 세션은 원점, GitHub App, 설치, 사용자와 저장소 설정에 결합된다.
`/api/auth/github`는 `${CMS_ORIGIN}/api/auth/callback`을 OAuth 콜백으로 지정한다.
콜백은 실제 코드 교환과 `/user`, 설치 권한·저장소 검사를 마친 뒤 최대 1시간 세션을 만든다.
`/api/session`은 그 실제 세션을 확인한다. 변경 요청에는 같은 원점과 세션의 CSRF 토큰이 필요하다.

부모 에이전트는 `5173`을 다른 프로젝트가 사용하며 원본 앱 시작이 실패한다고 보고했다.
이 작업자는 포트 소유자와 앱 시작을 따로 검사하지 않았다.
기존 프로세스를 종료하거나 다른 프로젝트의 콜백 경로를 바꾸지 않는다.
전용 포트를 쓰려면 프로세스에만 `CMS_ORIGIN`을 덮어쓴다. GitHub App이 그 콜백을 허용하는지는 실제 로그인에서 확인해야 한다.
원점을 바꾸면 기존 원점에 결합된 세션은 재사용할 수 없다.

네이티브 앱은 [`build.py`](../../../app/native/build.py)의 `Resources/config.json`에 포트 `5173`을 기록한다.
Swift는 그 포트에 `vite preview --strictPort`를 실행한다.
`/__native/health`의 시작 토큰이 일치해야 앱을 연다. 이미 있는 서버를 앱 서버로 대신 사용하지 않는다.
환경 변수만 바꾸면 앱의 설정 포트와 서버 원점이 달라진다.

포트를 분리하려면 작업 전용 앱 복사본의 설정 포트와 실행 환경의 `CMS_ORIGIN`을 함께 맞춘다.
복사본을 바꾸면 서명을 다시 확인해야 한다. 원본 앱과 `.env.local`은 보존한다.
부모 에이전트는 전용 복사본에 포트 `55173`을 쓰기로 정했다. 실제 OAuth 성공 여부는 아직 확인하지 않았다.

네이티브 로그인은 앱이 `POST /__native/auth/start`로 시작한다.
시스템 브라우저가 받은 URL을 열고 실제 OAuth를 마친다.
같은 서버의 메모리 흐름이 콜백을 받은 뒤, 앱이 결과 쿠키를 WKWebView에 넣고 `POST /__native/auth/result`로 수신을 확인한다.
별도 웹 서버의 로그인 성공만으로 네이티브 왕복 성공을 주장할 수 없다.

## 실제 CRUD 실행 권고

검사 글과 카테고리에는 이번 실행만의 UUID와 이름 접두사를 사용한다.
기존 글을 수정하거나 기존 카테고리에 글을 배치하지 않는다. 모든 단계는 실제 앱의 기존 화면에서 조작한다.

1. 변경 전 콘텐츠 브랜치의 HEAD와 전체 Git tree를 읽어 기준 파일 목록을 보관한다.
2. 실제 앱에서 로그인한 뒤 `ready` 세션과 기존 공개 목록의 글 3,032개를 확인한다.
3. 검사 카테고리를 만든다. 실제 원본 조회에서 새 카테고리와 새 `revision`, `contentCommit`을 확인한다.
4. 검사 카테고리에 새 검사 글을 만든다. 원본 조회에서 제목·본문·분류를 확인한다.
5. 검사 글에 작은 첨부를 올린다. 원본 조회에서 첨부 이름·SHA·크기를 확인한다.
6. 검사 글의 제목·본문을 바꾼다. 새 revision으로 조회해 바뀐 값과 첨부 보존을 확인한다.
7. 검사 카테고리 이름을 바꾼다. 원본을 다시 읽어 이름과 새 revision을 확인한다.
8. 검사 글을 삭제한다. 원본 조회의 `404`와 `posts/<검사 UUID>/` 전체 부재를 확인한다.
9. 비어 있는 검사 카테고리를 삭제한다. 원본 조회에서 그 ID의 부재를 확인한다.
10. 공개 workflow가 끝나면 공개 목록에서 검사 글·카테고리 부재와 기존 글 3,032개를 확인한다.
11. 변경 후 Git tree를 읽어 기준 파일과 검사 파일의 정리를 비교한다.

카테고리 삭제의 두 모드를 실제로 검사하려면 별도 검사 글을 추가한다.
`move`는 검사 글을 미분류로 옮긴 뒤 그 글을 삭제한다.
`delete`는 해당 카테고리에 검사 글만 있는지 확인한 뒤 실행한다.
카테고리의 유효 분류를 상속받는 하위 글도 삭제 범위에 들어간다.
원본 글의 ID가 `affectedPostIds`나 `deletedPostIds`에 나오면 다음 변경을 중단하고 원인을 확인한다.

첨부 업로드는 먼저 Git blob을 만든다. 저장 전에는 브랜치 경로가 없다.
글 삭제는 그 글의 Markdown, 편집 JSON과 첨부 경로를 함께 삭제한다.
연결되지 않은 blob의 영구 삭제나 Git 저장소 이력 제거는 앱의 정리 계약이 아니다.
앱의 저장 영수증과 후보 브랜치는 복구 근거다. 검사 뒤 임의로 지우지 않는다.

## 재시도와 충돌

- 같은 요청의 재시도는 `requestId`, `baseCommit`과 본문을 그대로 유지한다. 이 동작을 멱등 재시도라고 부른다.
- 일반 저장은 `cms/requests/<UUID>` 후보와 본문 해시로 같은 요청인지 확인한다.
- 원자 저장은 `atomic-<UUID>`와 `.cms/requests/<requestId>.json` 영수증으로 결과를 복구한다.
- 원자 저장의 응답 유실을 다시 확인할 때는 같은 요청과 `X-Content-Reconcile: 1`을 사용한다.
- 같은 ID로 본문을 바꾸면 `409`다. 새 내용은 새 요청 ID로 보낸다.
- HEAD가 기준 커밋과 다르면 `409`다. 원본을 다시 읽고 변경을 대조한 뒤 새 요청을 만든다.
- `baseRevision`은 글·카테고리 바이트를 보호한다. 편집 JSON이 있으면 `baseEditorRevision`도 보존한다.
- `saved`는 원본 저장 성공이다. 공개 완료는 workflow 또는 `/api/publish`와 공개 조회로 따로 확인한다.

응답 유실이나 시간 초과 뒤에는 새 생성 요청을 바로 보내지 않는다.
기존 요청과 원본을 한 번 대조해 실제 반영 여부를 먼저 확인한다.
검사 정리에는 마지막으로 확인한 HEAD와 revision을 사용한다.

## 원본 보존의 최소 근거

원격 HEAD를 읽고 그 커밋의 tree SHA를 읽는다. 이어 `git/trees/<tree SHA>?recursive=1`을 한 번 읽는다.
`truncated === false`를 확인하고 모든 파일의 `path`, `mode`, `type`, `sha`를 보관한다.
쿠키, 토큰, CSRF 토큰과 OAuth URL은 이 기록에 넣지 않는다.

변경 전의 기존 `posts/` 파일은 변경 후에도 같은 경로·mode·type·SHA여야 한다.
각 저장 커밋의 delta는 검사 글 경로, `categories.json`과 이번 요청의 영수증에만 한정한다.
최종 `categories.json`은 변경 전과 같은 SHA여야 하며 검사 글 경로는 없어야 한다.
새 영수증 외의 추가 파일, 기존 파일의 변경·삭제가 없으면 기존 원본 불변의 근거가 된다.
동시에 다른 사용자가 쓴 파일은 이번 작업과 구분한다. 그 경우 저장소 전체가 불변이라고 주장하지 않는다.

작업 전후 HEAD가 같아야 하는 것은 아니다. CRUD와 영수증은 새 커밋을 만든다.
공개 브랜치와 앱의 콘텐츠 pin도 workflow 때문에 바뀔 수 있다.
원본 파일의 불변과 공개 산출물의 변경을 분리해 보고한다.

기존 [`capture-state.mjs`](../2026-11-05-single-request/capture-state.mjs)의 Git tree 수집 방법은 재사용할 수 있다.
다만 과거 증거 폴더를 덮어쓰지 않는다. 그 스크립트는 SHA만 비교하고 `.github/`를 제외하므로 이번 비교에는 mode·type을 포함한다.
과거의 3,032개 수치를 새 기준으로 대신 사용하지 않는다. 이번 시작 HEAD에서 다시 집계한다.

## 기존 측정 도구의 재사용 범위

[`serve-optimistic-github.mjs`](../../../tests/e2e/serve-optimistic-github.mjs)는 실제 OAuth·CSRF와 현재 서버 소스를 사용한다.
기존 `CMS_ORIGIN`에 요청 원점을 맞추며, 별도 임의 포트를 연다.
콜백 포트가 사용 중이면 `EADDRINUSE`를 무시한다. 다른 프로젝트가 받는 콜백을 해결하지 못한다.
이 도구의 Vite 루트는 저장소 루트다. 실제 UI의 `app/web/index.html`과 `/src/main.tsx`를 그대로 제공하지 않는다.
`/__measure/control`은 검사 화면이다. 실제 앱을 조작했다는 근거로 사용하지 않는다.

[`serve-github.mjs`](../../../tests/e2e/serve-github.mjs)는 `dist/web`의 실제 UI를 제공한다.
다만 과거 공개 reader와 전후 서버 두 개를 불러온다. 이번 CRUD에는 그 비교 구성이 필요하지 않다.
두 도구 모두 CLI 토큰을 메모리에서 공개 읽기에만 사용한다. 이것은 관리자 OAuth를 대신하지 않는다.

실제 앱의 Vite preview와 네이티브 흐름을 우선 사용한다.
시간·요청 수가 필요하면 [`save-trace.mjs`](../../../tests/e2e/save-trace.mjs)의 `traceRequest`와 `profileFetch`만 재사용한다.
이 모듈은 헤더, 토큰과 본문을 기록하지 않는다. 메서드·경로·상태·시간·바이트 수만 기록한다.
가짜 로그인, fixture 응답과 과거 측정 화면은 이번 실제 검사 결과에서 제외한다.

## 조사 범위와 미확인

소스와 설정 키를 읽었고 이 문서만 추가했다. 제품 코드, 기존 UI, 원본 콘텐츠와 다른 작업자의 변경은 수정하지 않았다.
`project-context check`는 기존 `INDEX.md` 크기 제한 때문에 종료 코드 `1`을 반환했다. 과거 기록은 축약하지 않았다.
실제 인증, 원격 CRUD, 앱 실행, workflow, 지연과 기기 성능은 이 작업자가 검사하지 않았다.
다음 행동은 실행 소유자가 전용 원점과 앱 포트를 맞추고 실제 OAuth 콜백을 확인하는 것이다.
