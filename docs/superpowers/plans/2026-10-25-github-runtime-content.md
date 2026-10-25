# GitHub 원본 조회와 직접 저장 Implementation Plan

> **For agentic workers:** 기존 대화에서 확정한 설계와 사용자의 구현 요청을 따른다. `implement`와 `test-driven-development`로 실행한다.

**Goal:** 글 수정 후 앱 재배포 없이 GitHub 콘텐츠를 읽는다.
**Architecture:** 기존 GitHub 클라이언트·문서 파서·공개 변환을 재사용한다. 읽기는 공개 API, 쓰기는 인증 API가 맡고 콘텐츠 브랜치만 갱신한다.
**Tech Stack:** Node.js, Vercel Functions, React, TypeScript, 기존 Node test runner.
**Spec:** `docs/superpowers/specs/2026-10-25-github-runtime-content-design.md`

## Global Constraints

- 새 의존성을 추가하지 않는다.
- 권한·CSRF·충돌·초안 보존을 유지한다.
- 원격 콘텐츠·앱 브랜치와 배포를 변경하지 않는다.
- 검사 대상마다 실행 담당자 한 명을 정한다. 최종 전체 검사는 조정자만 실행한다.
- DOM 단언은 원시값과 불리언으로 제한한다. 명령과 비동기 작업에 유한한 제한을 둔다.

## Review Focus

- 로그인 설정이 없어도 공개 조회가 성공한다.
- 오래된 목록의 본문과 첨부가 새 버전과 섞이지 않는다.
- 응답이 유실된 저장을 재시도해도 커밋을 중복 생성하지 않는다.
- 다른 변경이 먼저 저장되면 기존 내용을 덮어쓰지 않는다.
- 참조가 있는 글과 사용 중인 분류를 삭제하지 않는다.

### Task 1: 공개 조회 API

**Files:** `server/public-content.mjs`, `server/github.mjs`, `scripts/content.mjs`, `scripts/prepare-site.mjs`, `tests/public-content.test.mjs`, `tests/content-build.test.mjs`.
**Interfaces:** `handlePublicRequest(request,{env,fetcher})`를 내보낸다. `kind=index`는 `{posts,categories,contentCommit}`, `kind=post`는 공개 Post를 반환한다.

- [x] 공개 조회·버전 고정·첨부·오류·캐시 검사부터 작성하고 실패를 확인한다.
- [x] 기존 공개 변환을 재사용하고 외부 요청·캐시를 제한한다.
- [x] 담당 테스트를 실행하고 실제 출력과 종료 코드를 기록한다.

### Task 2: 콘텐츠 브랜치 직접 저장

**Files:** `server/content.mjs`, `tests/github-content.test.mjs`.
**Interfaces:** `/api/content` 저장과 `/api/publish` 재시도는 같은 요청·커밋을 사용한다. 성공은 `{state:'published',requestId,candidateCommit,contentCommit,commitUrl}`이다. `runId`와 `runUrl`을 만들지 않는다.

- [x] 직접 갱신·중복 방지·유실 복구·충돌·삭제 참조 검사를 작성하고 실패를 확인한다.
- [x] Actions 호출과 작업 상태 추적을 제거하고 기준 브랜치를 fast-forward로 갱신한다.
- [x] 담당 테스트를 실행하고 실제 출력과 종료 코드를 기록한다.

### Task 3: 공개 조회와 저장 결과를 화면에 연결

**Files:** `src/app/usePosts.ts`, `src/app/App.tsx`, `src/app/BlogView.tsx`, `src/features/content-management/ManagedPostEditor.tsx`, `ManagedCategories.tsx`, `PublishStatus.tsx`, 필요하면 `src/pages/categories/CategoriesPage.tsx`, `tests/app-flow.test.mjs`, `tests/content-management.test.mjs`.
**Interfaces:** 공개 index 응답의 SHA로 본문을 고정한다. 저장 완료 시 `after=<contentCommit>`으로 공개 데이터를 재조회한다. 기존 편집 닫기와 관리 화면 prop 경로를 연결한다.

- [x] 공개 요청과 저장 후 목록·본문 재조회 검사를 먼저 작성하고 실패를 확인한다.
- [x] 현재 렌더링·초안 계약을 유지하면서 조회와 갱신을 연결한다.
- [x] 담당 테스트와 TypeScript 검사를 실행하고 결과를 기록한다.

### Task 4: 서버 연결·설정·통합 검증

**Files:** `server/handler.mjs`, `server/auth.mjs`, `tests/github-auth.test.mjs`, `tests/management-api.test.mjs`, `tests/management-runtime.test.mjs`, `.env.example`, `README.md`.

- [x] 공개 경로의 로그인 독립과 workflow 없는 관리 연결 검사를 먼저 추가하고 실패를 확인한다.
- [x] 공개 라우트를 인증 전에 연결하고 workflow 필수 검사를 제거한다.
- [x] 설정과 실행 문서를 현재 구조로 갱신한다.
- [x] 최종 `npm run check`, `npm run check:content`, `npm run build`를 유한한 제한 안에서 실행한다.
- [x] Chrome에서 공개 조회를 확인하고 독립 코드 리뷰를 받는다.
- [x] 확인한 결과와 원격 저장·운영 배포의 미실행 범위를 보고한다.

## 실행 결과와 검증 범위

2026-10-25 KST에 전용 작업 브랜치에서 구현했다.

- `npm run check`: 검사 368개 통과, 실패 0개. TypeScript 검사도 통과했다.
- `npm run check:content`: 글 3,032편·분류 48개·참조 첨부 7,255개, 오류 0개.
- `npm run build`: 성공했다. 기존 청크 크기 경고가 남았다.
- 독립 리뷰의 GET 변경 요청, URL 검사, 문서 크기, 캐시 계보 지적 4개를 수정하고 재검토했다.
- Chrome에서 실제 GitHub 공개 목록과 본문을 로그인 없이 읽었다.
- 실제 목록 응답: HTTP 200, JSON 5,559,817바이트, gzip 1,297,141바이트, 글 3,032편.
- Vercel 파일 추적으로 서버 기준 목록 포함과 원본·첨부 제외를 확인했다.
- 원격 콘텐츠 쓰기와 운영 배포는 실행하지 않았다.

검사 로그는 `/tmp/subdev-runtime-final-check.log`, `/tmp/subdev-runtime-content.log`, `/tmp/subdev-runtime-build.log`에 있다.
최종 검사 소스 해시는 `/tmp/subdev-runtime-final-check.evidence.json`에 기록했다.
