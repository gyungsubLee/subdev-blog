# 기존 글의 Markdown 표시 수정 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 발견한 서식 오류를 고치고 기존 글 3,032개와 실제 블로그 화면에서 결과를 확인한다.

**Architecture:** 원본 Notion 블록을 기존 변환기로 다시 변환한다. 문맥에 민감한 인라인 서식에는 안전한 HTML 태그를 사용한다. 표시기는 밑줄과 수식을 지원하며 HTML 정리는 유지한다.

**Tech Stack:** Node.js, React, react-markdown, remark-gfm, rehype-sanitize, KaTeX.

**Spec:** 이 채팅의 원인 조사와 사용자의 전체 수정·기존 글 반영·실제 화면 검증 요청.

## Global Constraints

- 기존 글 ID, 제목, 계층, 날짜, 링크와 첨부 파일을 보존한다.
- 사용자가 수정 중인 기존 테스트 6개를 덮어쓰지 않는다.
- 원본 블록과 지식 보관 폴더는 보존한다. 기존 웹 본문만 다시 생성한다.
- 원문이 의도적으로 입력한 Markdown 기호를 일괄 해제하지 않는다.
- 새 수집과 네트워크 요청 없이 저장된 블록과 자산 정보를 재사용한다.
- 기존 Vercel 프로젝트의 배포 방식을 사용한다. Chrome 연결로 실제 글을 검증한다.

## Review Focus

- 공백·괄호·한글 조사가 붙어도 원본의 강조와 기울임을 보존한다.
- 인접한 서식과 코드 조각을 합쳐 읽을 때 기호가 추가되거나 내용이 사라지지 않는다.
- 토글 제목, 표의 코드 줄바꿈과 밑줄을 표시한다.
- 수식을 표시하되 실행 가능한 HTML과 위험한 URL은 차단한다.
- 기존 글을 다시 생성해도 ID, 내부 링크와 첨부 참조를 유지한다.

### Task 1: 공통 변환기 수정

**Files:** `scripts/export-notion.mjs`, `tests/notion-markdown.test.mjs`, `tests/export-check.mjs`.

**Interfaces:** 기존 `richText(value, link)`를 유지한다. `renderArchivedPosts(records, posts, manifest)`는 저장된 원본과 현재 글·자산 목록으로 새 본문을 반환한다.

- [x] 실제 오류를 재현하는 DOM 검사를 추가하고 실패를 확인한다.
- [x] 강조·기울임·밑줄·코드·링크를 문맥에 안전하게 변환한다.
- [x] 토글 제목과 표의 여러 줄 코드를 수정한다.
- [x] `assets/`와 상위 폴더의 첨부 경로를 모두 웹 경로로 변환한다.
- [x] 저장된 원본을 다시 렌더링하는 함수를 추가하고 회귀 검사를 통과한다.

### Task 2: 표시기 수정

**Files:** `src/features/post-reader/MarkdownContent.tsx`, `src/features/post-reader/post-reader.css`, `package.json`, `package-lock.json`, `tests/markdown-rendering.test.mjs`.

**Interfaces:** 기존 MarkdownContent props를 유지한다. 변환기가 만든 `<u>`, 인라인 HTML 서식과 표의 코드 줄바꿈을 표시한다.

- [x] 밑줄, 토글 서식, 인라인·블록 수식과 HTML 차단 검사를 먼저 추가한다.
- [x] HTML 정리 설정에서 밑줄을 허용한다.
- [x] 공식 Markdown 수식 플러그인과 KaTeX를 추가하고 수식 스타일을 적용한다.
- [x] 서식 보존과 HTML 차단 검사를 통과한다.

### Task 3: 기존 글 반영 및 실제 검증

**Files:** `scripts/repair-markdown.mjs`, `content/posts.json`, `tests/markdown-corpus.test.mjs`, 작성·검증 문서.

**Interfaces:** Task 1의 `renderArchivedPosts(records, posts, manifest)`를 사용한다. 본문 교체는 임시 파일과 rename으로 처리한다.

- [x] 실제 글의 강조·토글·코드가 실패하는 회귀 검사를 추가한다.
- [x] 저장된 원본으로 기존 글을 다시 생성한다. 변경 수와 첨부·링크 보존을 확인한다.
- [x] 기존 검사, 새 회귀 검사와 빌드를 실행한다. 기존 검사 실패는 원인과 범위를 구분한다.
- [x] Chrome에서 실제 글의 강조·밑줄·토글·수식·표·코드를 확인한다.
- [x] 독립 리뷰를 반영하고 기존 Vercel 프로젝트에 배포한다.
- [x] 배포된 글을 Chrome에서 다시 확인하고 결과를 기록한다.

## 실행 기록

- 현재 폴더에서 범위가 분리된 파일을 수정한다. 기존 테스트 수정과 원본 보관 폴더를 보호한다.
- 변경은 작업 폴더에 남긴다. 이 요청에 포함하지 않은 커밋·푸시는 실행하지 않는다.
