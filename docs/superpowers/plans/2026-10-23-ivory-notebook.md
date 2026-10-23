# 아이보리 줄노트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 실제 글쓰기 화면에서 `/` 메뉴로 아이보리 줄노트를 추가하고, 한글과 영어를 Hi Melody로 작성한다.

**Architecture:** 기존 BlockNote 스키마에 시안의 `layoutOnly` 노트 블록을 추가한다. 자식 블록은 기존 편집기에서 편집하며, 기존 초안 저장과 JSON 백업을 유지한다. 글 표시와 내보내기 경로에서도 노트의 내용을 보존한다.

**Tech Stack:** React, TypeScript, BlockNote 0.56, 기존 Markdown 렌더러, CSS, 로컬 WOFF2.

**Spec:** 사용자가 승인한 `http://127.0.0.1:58967/?variant=3&writing=1&font=hi-melody`와 시각화 폴더의 `notebook-block.jsx`, `writing.css`.

## Global Constraints

- 메뉴 이름은 `아이보리 줄노트`다.
- 배경은 `#fcfaf1`, 왼쪽 구멍은 3개, 줄 간격은 `36px`다.
- 노트의 본문은 `Hi Melody`, `25px`, `36px`다. 작은 화면 본문은 `23px`다.
- 인라인 코드의 한글과 영어도 노트 글꼴을 따른다. 코드 블록은 고정폭 글꼴을 유지한다.
- 기존 입력 규칙, 제목, 목록, 체크리스트, 이미지와 서식 도구를 재사용한다.
- 의존성을 추가하지 않는다. 관련 없는 기존 수정과 staged 파일을 유지한다.
- 제품 화면에 시안 선택기와 글꼴 비교기를 추가하지 않는다.

## Review Focus

- 빈 줄의 `/` 검색으로 노트를 추가하면 커서가 첫 자식 문단으로 이동한다.
- 제목과 목록 전환, Enter 입력은 같은 노트에서 동작한다.
- 초안 저장, 다시 열기와 JSON 백업은 자식 블록과 인라인 서식을 보존한다.
- Markdown 내보내기와 읽기에서 노트 내용이 누락되지 않는다.
- 모바일 화면에서 내용과 편집 도구가 노트 바깥으로 잘리지 않는다.

### Task 1: 기존 편집기에 노트 블록 연결

**Files:** `src/features/post-editor/notebook-block.ts`, `code-block.ts`, `useDraftEditor.ts`, `src/pages/write/WritePage.tsx`, 관련 편집기 검사.

**Interfaces:** `notebookBlockSpec`은 `type: notebook`, `content: none`, `layoutOnly: true`다. `notebookSlashItem(editor)`는 기존 slash 메뉴 항목을 반환한다. 기존 `editorSchema`에서 새 블록을 제공한다.

- [x] 실제 블록 삽입·커서·제목·목록·체크리스트·코드·JSON 왕복 검사를 먼저 추가하고 실패를 확인한다.
- [x] 시안의 프레임과 메뉴 항목을 이식한다. 스키마와 React 메뉴에 연결한다.
- [x] 저장과 Markdown 처리의 기존 호출을 추적하고, 내용 보존에 필요한 최소 연결을 적용한다.
- [x] 관련 DOM 검사와 `npx tsc -b`를 실행한다.

### Task 2: 승인한 스타일과 로컬 글꼴 적용

**Files:** `src/styles/notebook.css`, `src/assets/fonts/HiMelody-Regular.woff2`, 해당 OFL, 필요한 CSS import.

**Interfaces:** `.ivory-notebook`은 `.notebook-holes`와 `.ivory-notebook-content`를 포함한다. 편집기와 읽기 화면에서 같은 종이와 글꼴을 사용한다.

- [x] 선택한 WOFF2와 OFL을 제품 자산으로 복사한다.
- [x] 시안의 색상·여백·줄·구멍·모바일 규칙을 적용한다.
- [x] 인라인 코드 글꼴 상속과 코드 블록 고정폭 유지를 검사한다.

### Task 3: 통합 검증과 전달

**Files:** 관련 테스트와 필요 시 읽기 화면 연결.

- [x] 실제 React `/` 메뉴에서 노트를 삽입하고 저장·다시 열기를 검사한다.
- [x] `npm run check`, `npm run build`를 실행하고 결과를 확인한다.
- [x] 연결된 Chrome에서 노트 추가, 한글·영어 입력, 제목·목록 전환, 저장 후 다시 열기를 확인한다.
- [x] 데스크톱과 모바일 화면을 검수하고 실제 화면 이미지를 저장한다.
- [x] 관련 변경만 독립 검토하고, 발견한 결함을 수정한 뒤 검사를 다시 실행한다.

## 실행 기록

- 사용자가 시안을 승인하고 실제 화면 수정을 요청했다. 같은 작업 디렉터리에서 실행한다.
- 관련 없는 staged 수정은 포함하지 않는다. 이 작업에서 커밋과 배포는 수행하지 않는다.


## HANDOFF_READY

기준 시각: 2026-10-23T13:36:36+00:00.

공유 파일의 편집을 종료했다. 콘텐츠 서브모듈 작업은 아래 공유 파일의 편집권을 인수할 수 있다.
이후 줄노트 작업은 공유 파일을 수정하지 않는다. 추가 수정이 필요하면 이 절에 먼저 기록한다.
커밋은 수행하지 않았다. 아래 SHA-256이 인계 기준이다.

| 공유 파일 | SHA-256 |
| --- | --- |
| `src/features/post-editor/useDraftEditor.ts` | `de24d9c51a01dfa690e0d91b375d40f2cb1f44218f61d5dd6c5b04b7c92c2fc1` |
| `src/pages/write/WritePage.tsx` | `1d1252be735a83d66e73a48f3e04b19873841441413b5aae6f8c6bb1afab24e6` |
| `tests/editor-ui.test.mjs` | `ebc035a6e592311b02d46b314e842ef4622764afa89f741617902de47192f392` |
| `src/shared/document.mjs` | `f1586c2b82dd6bdcdbcd41d940c5fd707bad30a585f7530307bebce1d990987b` |

`src/shared/document.mjs`는 줄노트 작업에서 수정하지 않았다. 기존 어댑터의 편집권도 콘텐츠 작업으로 넘긴다.

### 유지할 계약

- 새 블록 글과 기존 블록 초안은 `editorSchema`의 `notebook` 블록을 사용한다.
- 실제 `/` 메뉴는 `notebookSlashItem(editor)`를 사용한다. 삽입하면 첫 자식 문단에 커서를 둔다.
- 블록 문서의 Markdown은 `serializeEditorMarkdown(editor)`로 만든다. 제목만 변경한 원문을 재직렬화하는 정책은 콘텐츠 작업이 결정한다.
- 블록 초안의 `blocks`는 원본 JSON 구조를 보존한다. 노트 자식의 텍스트도 excerpt에 포함한다.
- 노트의 표시 속성은 `<section data-ivory-notebook="true">`다. 읽기 화면은 이 속성만 인식한다.
- `Hi Melody`는 로컬 글꼴이다. 한글·영어·인라인 코드는 손글씨를 사용하며 코드 블록은 고정폭 글꼴을 유지한다.

### 검증 결과

- `npx tsc -b`: 통과, 종료 코드 0.
- `node --test tests/notebook-editor.test.mjs tests/notebook-markdown.test.mjs tests/editor-ui.test.mjs tests/notion-editor.test.mjs tests/post-reader.test.mjs`: 58개 통과, 실패 0, 종료 코드 0.
- 관련 검사 로그: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-scoped-check.log`.
- `npx vite build`: 통과, 종료 코드 0. 줄노트 코드와 Hi Melody 자산을 산출물에서 확인했다.
- Vite 빌드 로그: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-vite-build.log`.
- Chrome에서 실제 `/` 삽입, 제목·목록 변환, 한글·영어·인라인 코드 입력, 저장·읽기·재편집을 확인했다.
- 모바일 너비 390px에서 줄바꿈과 노트 배치를 확인했다. 검수 후 viewport를 복원했다.
- 독립 검토에서 목차·목록 번호·토글 자식 보존 문제를 수정했다. 해당 회귀 검사를 추가했고 최종 검토는 승인이다.

### 초기 검사 결과

- `npm run build`는 준비 단계에서 `content/categories.json`을 찾지 못해 중단됐다. 콘텐츠 작업 범위이므로 이 작업에서 수정하지 않았다.
- 최초 `npm run check`에서 앱 흐름 검사 파일이 실패했다. 단독 재검사는 2개 통과했다.
- 이후 전체 검사는 한 차례 215개 통과했다. 마지막 전체 실행은 병행 수정 중인 콘텐츠 검사 6개가 실패했다.
- 마지막 전체 실행: `node --test --test-concurrency=2 tests/*.test.mjs`, 총 222개 중 216개 통과, 실패 6개.
- 전체 검사 로그: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-full-check.log`.
- 콘텐츠 실패 위치는 `tests/content.test.mjs`의 357·387·409·441행 부근이다. 관련 실행 스크립트 수정과 연결된다.

줄노트 전용 파일과 읽기 화면 연결은 이 작업의 소유권을 유지한다.
인계하는 공유 파일에는 추가 편집을 예정하지 않았다.


### 최종 재검증

콘텐츠 작업에서 검증한 canonical 입력을 전달받았다. JSON fallback은 추가하지 않았다.

- 입력: `CONTENT_ROOT=/private/tmp/subdev-blog-content-refactor-izc5q0mt/canonical-staging`.
- 위 입력의 `npm run check`: 223개 통과, 실패 0, 종료 코드 0.
- 위 입력의 `npm run build`: 준비 단계에서 3032개 글을 생성했고 TypeScript와 Vite 빌드를 통과했다. 종료 코드 0.
- 최종 검사 로그: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-canonical-check.log`.
- 최종 빌드 로그: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-canonical-build.log`.
- 인라인 코드가 Hi Melody를 상속하고 코드 블록이 고정폭을 유지하는 CSS 회귀 검사도 `tests/notebook-editor.test.mjs`에 포함했다.
- 최종 이미지: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-editor-final.jpg`.
- 모바일 이미지: `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a168a4-f913-7903-a762-7911715ff26c/notebook-blocks/11-product-mobile.jpg`.
- 올바른 콘텐츠 입력에서는 남은 검사 실패가 없다. 기본 `content/` 전환은 콘텐츠 작업의 범위다.
- 공유 파일의 인계 기준과 편집 종료 상태는 변경하지 않았다.
