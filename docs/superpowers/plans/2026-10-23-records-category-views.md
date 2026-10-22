# Records and Category Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 승인한 목업에 따라 홈을 보존하고 기록의 세 가지 보기와 독립된 카테고리 관리 화면을 추가한다.

**Architecture:** 기존 hash 경로와 기능별 React 구조를 사용한다. 새 분류는 원문 `category`를 식별자로 연결하며 `parentId`를 변경하지 않는다. 분류 설정은 버전이 있는 localStorage 데이터로 저장한다.

**Tech Stack:** React 19, TypeScript, Vite 7, 기존 CSS 변수, node:test, jsdom. 새 의존성은 추가하지 않는다.

**Spec:** 사용자가 승인한 `/Users/igyeongseob/.codex/visualizations/2026/10/22/01a16420-0443-72e0-8750-34f36e9ed708/category-navigation-final/category-management-home.html`과 같은 폴더의 PNG 시안이다.

## Global Constraints

- 현재 홈의 소개·대표 글·평면 필터·카드와 작성 흐름을 보존한다.
- 홈은 `#/`, 기록은 `#/records`, 관리는 `#/categories`다. `메인` 메뉴를 추가하지 않는다.
- Second Brain 로고는 기존 홈 링크를 유지한다.
- 기존 PageTree 모달은 원문 `parentId`를 사용한다. 원문 데이터와 계층을 수정하지 않는다.
- 기록의 아이콘 버튼 이름은 `사이드바 보기`, `탭 보기`, `섹션 보기`다. 선택 상태를 `aria-pressed`로 표시한다.
- 보기 전환과 글 상세 왕복은 검색어·분류·표시 개수를 유지한다.
- 카테고리 추가·이름 변경·상위 분류 이동·순서 변경은 이 브라우저에 저장한다. 실패하면 저장 성공으로 표시하지 않는다.
- 기존 색상·글꼴·카드·버튼 클래스를 재사용한다. 새 의존성과 브라우저 자동화 도구를 추가하지 않는다.
- Chrome 연결로만 실화면을 검증한다. 연결이 없으면 DOM 검사와 실화면 검증을 구분한다.
- BUILD_HISTORY.md의 기존 수정과 다른 채팅의 작업은 변경하지 않는다. 배포·푸시는 이 작업 범위에 없다.

## Review Focus

- 손상된 저장소와 용량 초과에서도 기존 설정을 덮어쓰거나 저장 성공으로 표시하지 않는다.
- 이름 변경 후에도 원래 분류의 문서가 사라지지 않는다.
- 새 초안과 알 수 없는 분류도 미분류 묶음에서 탐색할 수 있다.
- 빈 목록과 긴 한국어 이름에서도 관리·보기 버튼을 사용할 수 있다.
- 기록에서 글을 읽고 돌아오면 같은 보기·검색·분류를 복원한다. 홈 왕복의 기존 동작도 보존한다.

## Shared Interfaces

`src/features/post-category/catalog.ts`:

```ts
export type CategoryItem = { id: string; source: string; name: string };
export type CategoryGroup = { id: string; name: string; categories: CategoryItem[] };
export type CategoryCatalog = {
  groups: CategoryGroup[];
  error: string;
  save: (groups: CategoryGroup[]) => boolean;
};
export function createCategoryGroups(posts: Pick<Post, "category">[]): CategoryGroup[];
export function reconcileCategoryGroups(groups: CategoryGroup[], posts: Pick<Post, "category">[]): CategoryGroup[];
```

`useCategoryCatalog(posts: Post[]): CategoryCatalog`는 같은 기능 폴더에서 제공한다.

`useRecordsBrowser(posts: Post[], groups: CategoryGroup[], enabled: boolean)`는 기록의 검색·선택·보기·표시 개수를 보관한다.
`RecordsPage`는 `{ posts, catalog, browser, onWrite }`를 받는다. `browser` 타입은 위 hook의 반환 타입이다.
`CategoriesPage`는 `{ posts, catalog }`를 받는다.

## Task 1: 분류 저장과 관리 화면

**Files:** `src/features/post-category/catalog.ts`, `useCategoryCatalog.ts`, `src/pages/categories/CategoriesPage.tsx`, `CategoriesPage.css`, `tests/category-catalog.test.mjs`, `tests/category-manager.test.mjs`.

**Ownership:** Task 1만 위 파일을 수정한다. 다른 작업의 파일은 수정하지 않는다.

- [x] 원래 source를 유지하는 이름 변경, 그룹 이동, 새 분류 보존, 미분류 수용, 손상 데이터와 저장 실패 검사를 먼저 작성하고 실패를 확인한다.
- [x] 목업의 CS·백엔드·프론트엔드·인프라·AI·데이터·학습·도구 묶음을 실제 source 이름으로 연결한다.
- [x] 저장 키 `second-brain:categories:v1`과 `{ version: 1, groups }` 구조를 검증한다. 중복 ID·source와 잘못된 형식은 거부한다.
- [x] 새 분류는 원문 문자열과 별개인 ID를 사용한다. 사용자 입력은 공백을 정리하고 빈 이름·100자 초과·중복 표시 이름을 거부한다.
- [x] 화면에 분류 트리, 선택한 분류의 이름·상위 분류, 기록 수·기록 링크, 추가와 저장을 제공한다.
- [x] 드래그와 키보드용 위·아래 이동 버튼으로 순서를 변경한다. 데이터가 있는 분류를 삭제하는 기능은 범위에 없다.
- [x] 로컬 저장 안내와 저장 오류를 표시한다. 실패한 변경은 기존 상태를 보존한다.
- [x] 집중 검사를 통과시키고 `npm run check` 결과와 RED/GREEN 근거를 보고한다. 소유 파일만 커밋한다.

## Task 2: 기록의 세 가지 보기

**Files:** `src/features/post-category/useRecordsBrowser.ts`, `src/pages/records/RecordsPage.tsx`, `RecordsPage.css`, `src/components/icons/RecordViewIcon.tsx`, `tests/records-page.test.mjs`.

**Ownership:** Task 2만 위 파일을 수정한다. Task 1의 타입을 import하고 구현을 복제하지 않는다.

- [x] 실제 컴포넌트로 검색·분류 선택 뒤 보기 전환 검사를 작성하고 실패를 확인한다.
- [x] 기존 PostSearch·PostList·PostLoadMore·검색 hook·페이지 나누기 hook을 재사용한다.
- [x] hook은 query, inputRef, setQuery, clearQuery, groupId, categoryId, selectGroup, selectCategory, view, setView, limit, showMore, resetFilters, filteredPosts를 반환한다.
- [x] 선택은 ID, 문서 분류 비교는 category.source를 사용한다. 카드는 표시 이름만 바꾸고 원문의 문서와 링크를 유지한다.
- [x] 사이드바 트리, 2단 탭, 주제 섹션을 구현한다. 세 보기는 같은 검색·선택 상태를 공유한다.
- [x] 본문에는 홈의 소개와 대표 글을 복제하지 않는다. 기록 제목·검색·관리 링크와 아이콘 버튼 세 개를 배치한다.
- [x] 기존 반응형 구간과 CSS 변수를 사용한다. 긴 이름과 빈 결과를 처리하고 아이콘에 접근성 이름을 준다.
- [x] 집중 검사와 전체 검사의 결과를 보고하고 소유 파일만 커밋한다.

## Task 3: 경로 연결과 회귀 검사

**Files:** `src/app/BlogView.tsx`, `src/shared/routes.ts`, `src/components/layout/SiteHeader.tsx`, `src/components/layout/layout.css`, `src/pages/post/PostPage.tsx`, `tests/app-flow.test.mjs`, `tests/blog.test.mjs`, `tests/records-flow.test.mjs`, `README.md`.

**Ownership:** Task 3만 위 파일을 수정한다. 홈·원문 탐색·편집기의 기존 컴포넌트와 스타일을 보존한다.

- [x] 새 경로, 로고 홈 이동, 기록·관리 메뉴, 기록 상세 왕복 검사를 먼저 작성하고 실패를 확인한다.
- [x] routes에 RECORDS_HREF와 CATEGORIES_HREF를 추가한다. 글 ID 읽기는 기존 계약을 유지한다.
- [x] BlogView가 catalog와 records hook의 수명을 소유하고 새 페이지를 조립한다. 검색 단축키는 현재 목록 화면에서만 활성화한다.
- [x] 헤더의 기록 링크를 기록 경로로 연결하고 관리 링크를 추가한다. 메인 메뉴는 만들지 않는다.
- [x] 상세의 전체 글 링크는 진입한 목록으로 돌아간다. 직접 상세를 열면 기존 홈 반환을 유지한다.
- [x] 목록·관리 진입은 요약만 사용한다. 선택한 글에서만 본문을 요청하는 기존 흐름을 보존한다.
- [x] README에 경로와 브라우저별 분류 저장의 범위를 짧게 기록한다.
- [x] npm run check와 npm run build를 통과시킨다. 원문 계층·기존 홈·편집기 회귀 검사를 유지한다.
- [x] 가능한 Chrome 화면 확인을 수행하고, 연결 오류는 별도 한계로 보고한다. 소유 파일만 커밋한다.

## Delivery

- [x] 작업별 독립 검토와 전체 변경 검토를 완료한다.
- [x] 검증한 변경을 원래 작업 폴더에 패치로 반영한다. 기존 BUILD_HISTORY.md 수정은 보존한다.
- [x] 원래 작업 폴더에서 최종 검사와 빌드를 확인한다. 배포하거나 원격 브랜치를 갱신하지 않는다.

## 검증 결과

- 원래 작업 폴더에서 `npm run check`를 통과했다. 테스트 85개가 통과했고 실패는 없다.
- 같은 폴더에서 `npm run build`를 통과했다. 500kB 초과 청크 경고가 남았다.
- 작업별 검토와 전체 변경 검토를 통과했다. 분류 이름 충돌 문제는 수정 후 재검토를 통과했다.
- 실제 기록 3,032건과 원본 분류 40개가 새 분류에 모두 포함됨을 확인했다.
- 검토한 21개 파일을 원래 작업 폴더에 반영했다. 기존 `BUILD_HISTORY.md` 수정은 보존했다.
- Chrome 연결 호스트 오류로 실화면을 검증하지 못했다. DOM 검사와 빌드 결과는 실화면 검증을 대신하지 않는다.
