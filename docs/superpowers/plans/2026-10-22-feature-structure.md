# Feature Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 사용자가 선택한 3안으로 화면·기능·컴포넌트·CSS·설정을 정리하고 기존 동작을 유지한다.

**Architecture:** `app`이 화면 전환과 상태 수명을 관리한다. `pages`는 독립 기능과 공통 컴포넌트를 조립한다. 검색·분류·페이지 개수는 독립 기능으로 만들고, CSS는 소유 코드 옆에 둔다.

**Tech Stack:** React 19, TypeScript, Vite, BlockNote, 기존 Node test와 JSDOM.

**Spec:** `docs/superpowers/specs/2026-10-22-feature-structure-design.md`

## Global Constraints

- 기존 URL, 화면 문구, DOM 클래스, 초안 형식과 지연 로딩을 보존한다.
- 검색·분류·페이지 개수는 각각 독립 기능으로 분리한다.
- 검색 입력·분류 선택은 표시 개수를 12로 초기화한다. 더 보기는 12개씩 늘린다.
- Escape와 빈 결과의 필터 초기화는 기존처럼 표시 개수를 유지한다.
- 자동 저장 650ms, 이미지 5MiB, 문서 10MiB 제한을 유지한다.
- 새 의존성, 인증·게시·동기화 기능은 추가하지 않는다.
- 공유 문서 코드는 DOM에 의존하지 않는다.
- 사용자 승인 범위는 현재 작업 폴더의 리팩터링과 추가로 요청한 로컬 커밋이다. 푸시·배포는 수행하지 않는다.

## Review Focus

- 목록·상세 왕복 후 검색·분류·표시 개수가 유지되는가.
- 검색이나 분류를 바꾸면 표시 개수가 초기화되는가.
- 본문 요청이 완료될 때 제목·블록 이동과 다운로드 차단이 유지되는가.
- 저장 실패나 손상된 초안에서 기존 데이터와 현재 작성 내용이 유지되는가.
- CSS 이동 후 앱 상태와 Markdown·BlockNote 스타일이 빠지지 않는가.

## Task 1: 공통 계약과 회귀 검사

**Files:** `src/shared/post.ts`, `src/shared/drafts.mjs`, `src/shared/document.mjs`, `src/shared/download-file.mjs`, `src/config/site.ts`, `tests/blog.test.mjs`, `tests/*test.mjs`, `scripts/import-markdown.mjs`.

**Interfaces:** `Post` 타입을 이동한다. `isDraft/readDrafts/saveDraft`, `parseBlockBackup/parseMarkdownDocument/markdownDocument`, `downloadFile`의 동작을 유지한다.

- [x] 기존 검사 결과와 원본을 `.tmp/refactor-baseline`에 보관한다.
- [x] 검색·분류·더 보기와 상세 왕복 회귀 검사를 기존 구현에서 실행한다.
- [x] 공유 코드를 옮기고 테스트 로더를 다중 파일 번들 방식으로 연결한다.
- [x] 문서·저장 검사를 실행한다.

## Task 2: 읽기 화면과 독립 기능

**Files:** `src/app/BlogView.tsx`, `src/pages/home/*`, `src/pages/post/*`, `src/features/post-search/*`, `src/features/post-category/*`, `src/features/post-pagination/*`, `src/features/post-list/*`, `src/features/post-reader/*`, `src/features/page-explorer/*`, `src/components/*`.

**Interfaces:** `BlogView({ posts, hash, onWrite, onEdit })`를 기본 내보내기로 제공한다. 검색·분류·개수 훅은 `BlogView`에서 실행한다. `PostPage`에 선택한 글·전체 글·hash·편집 콜백을 전달한다.

- [x] 기존 JSX와 동작을 책임별로 추출한다.
- [x] 검색·분류·개수의 상태와 UI를 각 기능에서 제공한다.
- [x] 기존 HTML 검사·내부 링크·페이지 탐색 계약을 유지한다.
- [x] 블로그 DOM 검사와 조합 회귀 검사를 실행한다.

## Task 3: 편집 화면

**Files:** `src/pages/write/WritePage.tsx`, `src/features/post-editor/*`.

**Interfaces:** 작성 페이지는 기존 `Editor`의 `post/onClose/onSaved` 계약을 유지한다. `useDraftEditor`가 편집 상태·자동 저장·가져오기·내보내기·닫기 처리를 함께 소유한다.

- [x] 편집기·코드 블록·확장을 이동한다.
- [x] 구문 강조 설정과 도구막대·단축키 안내를 추출한다.
- [x] 초안·문서·실제 React 편집기 검사를 실행한다.

## Task 4: CSS 소유 위치

**Files:** `src/styles/*`, `src/app/app.css`, 각 페이지·기능·컴포넌트의 `.css`.

**Interfaces:** `styles/global.css`가 기본 규칙을 제공한다. `app/app.css`가 앱 상태를 제공한다. 소유 컴포넌트가 자신의 CSS를 가져온다.

- [x] 기존 선택자와 미디어 조건을 보존하며 CSS를 분리한다.
- [x] 반복 색상을 같은 값의 CSS 변수로 모은다.
- [x] CSS 규칙 보존과 빌드 입력을 확인한다.

## Task 5: 앱 연결과 최종 검증

**Files:** `src/app/App.tsx`, `src/app/useHashRoute.ts`, `src/app/usePosts.ts`, `src/app/ErrorBoundary.tsx`, `src/main.tsx`, `README.md`.

**Interfaces:** `useHashRoute()`는 `{ hash, postId }`를 반환한다. `App`만 hash를 구독한다. 작성 페이지는 `lazy()`로 가져온다.

- [x] 앱과 페이지를 연결하고 기존 루트 파일을 제거한다.
- [x] README에 구조와 소유 규칙을 기록한다.
- [x] `npm run check`, `npm run check:export`, `npm run check:assets`, `npm run build`를 실행한다.
- [x] 독립 검토와 가능한 Chrome 검증 결과를 기록한다.

## 실행 결과

- 전체 검사: `npm run check`, 66개 통과, 실패 0개.
- 수집 검사: `npm run check:export`, 종료 코드 0.
- 자산 검사: `npm run check:assets`, 종료 코드 0.
- 프로덕션 빌드: `npm run build`, 종료 코드 0. 500kB 초과 청크 경고가 있다.
- 기존·변경 구현 비교: 목록·상세·로딩·없는 글 화면 7개의 정적 DOM이 일치했다.
- CSS 비교: 선택자·미디어 조건·선언 1,003개와 선언 순서 1,001개를 보존했다.
- 독립 코드 검토: 수정이 필요한 항목 0개.
- Chrome 전용 탭 생성과 연결 목록 조회가 `The browser access host is unavailable`을 반환했다.
- 실제 화면, 모바일 배치, 네이티브 대화상자와 실제 입력기 검증은 실행하지 못했다.

검사 로그와 비교 스크립트는 `.tmp/refactor-*`, `.tmp/browse-ssr-parity.*`, `.tmp/check-css-preservation.mjs`에 있다.
이 경로는 Git에서 제외한다. 재현 가능한 동작 검사는 `tests`에 유지한다.
