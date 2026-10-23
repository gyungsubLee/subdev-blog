# 홈 아티클 UI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 승인한 홈 목업을 적용해 최신 아티클 4개와 인기 아티클 예시 5개를 표시한다.

**Architecture:** `HomePage`가 공개 글을 작성일 순서로 정렬하고 두 목록을 렌더링한다. 기존 `PostArt`, `Arrow`, 날짜 표시와 경로 상수를 재사용한다. `BlogView`에서 홈 전용 검색·필터·페이지 수 상태를 제거한다.

**Tech Stack:** React 19, TypeScript, CSS, Node 내장 테스트, JSDOM, 연결된 Chrome.

**Spec:** 사용자가 승인한 [홈 목업](/Users/igyeongseob/.codex/visualizations/2026/10/23/01a1685b-6f82-7fe2-abd2-91d0701e59a2/home-mockup.html)과 이 채팅의 적용 요청.

## Global Constraints

- 기존 색상, 서체, 상단 메뉴와 하단 영역을 유지한다.
- 홈의 대표 글, 전체 기록 목록, 검색, 카테고리 구분과 작성 안내 배너를 제거한다.
- 카드와 인기 목록에서 분류 정보를 표시하지 않는다.
- 인기 순위는 조회수 연동 전 예시임을 표시한다. 조회수를 만들지 않는다.
- 초안은 홈 목록에서 제외한다. 기록 관리와 글 편집 동작을 유지한다.
- 새 의존성을 추가하지 않는다. 기존 작업 파일을 되돌리지 않는다.
- 실행 중인 로컬 화면에 적용하도록 현재 작업 폴더에서 수정한다.

## Review Focus

- 작성일 순서가 입력 순서나 수정일에 의존하지 않아야 한다.
- 초안과 빈 목록에서도 공개 아티클 목록에 초안이 나오지 않아야 한다.
- 홈에서 `/` 기본 동작을 차단하지 않아야 한다.
- 기록 관리의 검색·분류·페이지 수 상태를 유지해야 한다.
- 긴 제목과 모바일 화면에서 가로 스크롤이 생기지 않아야 한다.

### Task 1: 홈 목록과 연결 수정

**Files:**
- Modify: `src/pages/home/HomePage.tsx`
- Modify: `src/app/BlogView.tsx`
- Modify: `tests/blog.test.mjs`
- Modify: `tests/app-flow.test.mjs`
- Modify: `tests/browse-controls.test.mjs`
- Modify: `tests/records-flow.test.mjs`
- Create: `tests/home-page.test.mjs`

**Interfaces:**
- Consumes: 기존 `Post[]`, `PostArt`, `formatDate`, `postHref`, `RECORDS_HREF`.
- Produces: `HomePage({ posts }: { posts: Post[] })`.

- [x] 정렬, 4개 카드, 5개 예시, 초안 제외, 빈 목록과 기록 연결을 검사하는 테스트를 작성한다.
- [x] `node --test tests/home-page.test.mjs` 실행으로 기존 화면의 실패를 확인한다.
- [x] 홈 UI를 구현하고 홈 전용 상태와 검색 단축키를 제거한다.
- [x] 기존 홈 검사와 탐색 검사를 새 UI에 맞춘다.
- [x] 관련 테스트를 실행해 홈 탐색과 기록 관리 상태 보존을 확인한다.

### Task 2: 목업 스타일과 화면 검증

**Files:**
- Modify: `src/pages/home/HomePage.css`

**Interfaces:**
- Consumes: Task 1의 홈 카드와 순위 목록 마크업.
- Produces: 데스크톱 2열 구성, 모바일 1열 구성.

- [x] 목업의 간격, 카드, 순위 목록, 기록 관리 연결 영역을 적용한다.
- [x] `npm run check`와 `npm run build`를 실행한다.
- [x] 연결된 Chrome에서 홈, 글 연결, 기록 관리 이동을 확인한다.
- [x] 데스크톱과 모바일 화면을 캡처하고 잘림을 확인한다.
- [x] 변경 범위를 독립 검토하고 결과를 전달한다.

커밋은 이 작업의 파일만 포함한다. 기존 사용자 변경은 포함하지 않는다.

## 검증 결과

- `npm run check`: 136개 통과, 실패 0개. 로그: `/tmp/subdev-home-check.log`.
- `npm run build`: 성공. 기존 번들 크기 경고가 남아 있다. 로그: `/tmp/subdev-home-build.log`.
- Chrome에서 홈 → 기록 관리 → 홈, 홈 → 아티클 → 홈 이동을 확인했다.
- 데스크톱 화면과 너비 390px 모바일 화면에서 긴 제목과 하단 목록의 잘림이 없었다.
- 독립 코드 검토에서 수정할 항목이 없었다.
- 캡처: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a1685b-6f82-7fe2-abd2-91d0701e59a2/home-implemented-desktop.png`.
- 인기 목록은 최신 공개 글 5개를 사용한 예시다. 실제 조회수 집계는 이번 작업 범위에서 제외했다.
