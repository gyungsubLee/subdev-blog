# 노션형 편집기와 GitHub 이중 형식 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 노션형 UI에서 작성한 글을 Markdown과 `editor.json`으로 같은 GitHub 커밋에 저장한다.

**Architecture:** 기존 BlockNote UI와 CMS 저장 경로를 재사용한다. 편집 JSON을 선택 원본 파일로 구분하고 Markdown 연결과 충돌을 검증한다. 공개 조회는 Markdown을 계속 사용한다.

**Tech Stack:** React 19, BlockNote 0.56.0, TypeScript, Node.js, GitHub Git 데이터 API, 기존 node:test와 JSDOM.

**Spec:** `docs/superpowers/specs/2026-10-25-block-editor-storage-design.md`

## Global Constraints

- 런타임 의존성을 추가하지 않는다. 기존 Markdown을 일괄 변환하지 않는다.
- 기존 Markdown `revision`의 의미는 유지한다.
- `editor.json`은 예약 파일명이다. 일반 첨부의 업로드, 목록과 공개 첨부 처리에서 제외한다.
- 실패한 초안을 자동 삭제하지 않는다.
- 실제 운영 글을 시험 목적으로 생성하거나 수정하지 않는다. 원격 푸시와 배포는 이 작업에 포함하지 않는다.
- 비동기 검사와 명령에는 유한한 기한을 둔다. assertion에는 선택한 원시 값만 전달한다.

## Review Focus

- JSON 속성만 수정한 저장도 반영한다. Task 1에서 반복 저장과 변경 없음 판정을 검사한다.
- Markdown만 외부에서 바뀌면 원본을 덮어쓰지 않는다. Task 1에서 연결 해시 불일치를 검사한다.
- 첨부 이름을 인코딩하거나 대소문자로 바꿔 예약 파일을 덮어쓰지 못한다. Task 1과 Task 3에서 검사한다.
- 초안 없이 다시 열어도 블록 설정을 복원한다. Task 2에서 JSON 초기화와 저장 요청을 검사한다.
- 기존 Markdown의 제목 변경이 본문을 바꾸지 않는다. 기존 회귀 검사를 유지하고 Task 2에서 전환 경계를 검사한다.

## Task 1: 저장 계약과 GitHub API

**Files:** `src/shared/editor-document.mjs`, `src/shared/post.ts`, `src/features/content-management/types.ts`, `server/content.mjs`, `tests/github-content.test.mjs`, `tests/editor-document.test.mjs`

**Interfaces:** `validateEditorDocument(value, { documentId, markdownHash })`는 유효한 편집 JSON을 반환한다. `SourceDocument`는 선택 `editor`와 `editorRevision`을 제공한다. 저장 작업은 선택 `editor`, `baseEditorRevision`을 받는다.

- [x] JSON 연결 해시, 잘못된 블록, 반복 수정과 충돌을 검증하는 실패 검사를 작성하고 실행한다.
- [x] 공통 검증기와 API 조회·원자적 저장·후보 재검증을 확장한다.
- [x] `node --test tests/editor-document.test.mjs tests/github-content.test.mjs`를 실행해 실패 0개를 확인한다.

## Task 2: 기존 UI 복원과 블록 변환

**Files:** `src/features/content-management/ManagedPostEditor.tsx`, `src/pages/write/WritePage.tsx`, `src/features/post-editor/*`, `src/features/post-reader/MarkdownContent.tsx`, `src/features/post-reader/MarkdownCodeBlock.tsx`, 해당 편집기·Markdown 검사.

**Interfaces:** Task 1의 `editor`와 `editorRevision`을 소비한다. 같은 스냅샷에서 본문 SHA-256과 블록을 저장 요청에 보낸다. 기존 JSON 없는 글은 명시적 전환 전까지 Markdown을 보존한다.

- [x] 새 글의 노션형 UI, JSON 재열기, 저장 요청과 기존 글 원문 보존의 실패 검사를 작성하고 실행한다.
- [x] 기존 UI와 편집 스키마를 재사용해 CMS 저장·첨부·복구 초안을 연결한다.
- [x] 접기·노트·코드 캡션과 줄바꿈 설정의 Markdown 표시를 보존한다.
- [x] 담당 편집기와 Markdown 개별 검사를 실행하고 결과를 기록한다.

## Task 3: 로컬 콘텐츠와 공개 경계

**Files:** `scripts/content.mjs`, `server/public-content.mjs`, `tests/content.test.mjs`, `tests/public-content.test.mjs`, 콘텐츠 계약 문서.

**Interfaces:** Task 1의 검증기를 사용한다. 로컬 reader는 선택 JSON을 검사하고 첨부 목록에서 제외한다. 공개 reader는 Markdown을 유지하고 편집 JSON을 첨부로 해석하지 않는다.

- [x] 로컬 JSON 검증, 예약 이름과 공개 첨부 제외의 실패 검사를 작성하고 실행한다.
- [x] 파일 reader와 공개 API를 확장하고 기존 콘텐츠 계약 문서를 갱신한다.
- [x] 담당 로컬·공개 개별 검사를 실행한다.

## Task 4: 통합 검증과 검토

- [x] 타입 검사로 세 작업의 인터페이스를 대조한다.
- [x] `npm run check`를 한 번 실행하고 실패 여부와 종료 코드를 기록한다.
- [x] `npm run build`를 실행하고 결과를 기록한다.
- [x] 전용 Chrome 탭에서 새 글 UI와 슬래시 메뉴를 확인한다. 운영 저장은 실행하지 않는다.
- [x] 독립 코드 검토의 실제 결함을 수정하고 영향받은 검사만 다시 실행한다.
- [x] 설계서, 코드와 검사 결과를 검토한 뒤 현재 작업 브랜치에 커밋한다.


## 실행 기록

2026-10-25에 구현과 검증을 실행했다.

- `npm run check`: 타입 검사와 테스트 414개를 통과했다. 종료 코드는 0이다.
- `npm run build`: 콘텐츠 준비와 프로덕션 빌드를 통과했다. 종료 코드는 0이다.
- 독립 코드 검토에서 발견한 접기 제목, 도움말 버튼, 첨부와 복구 결함을 수정했다.
- Chrome의 로컬 검증 화면에서 슬래시 메뉴, 노트 입력, 저장 요청과 새로고침 뒤 복원을 확인했다.
- 로컬 화면은 검증용 API를 사용했다. 실제 운영 GitHub 저장과 운영 배포는 실행하지 않았다.
- 콘텐츠 submodule의 기존 파일과 커밋은 변경하지 않았다.

로컬 실행 로그는 `.tmp/full-check-final.log`와 `.tmp/production-build.log`에 있다.
화면 기록은 `.tmp/editor-restored.png`와 `.tmp/editor-slash-menu.png`에 있다.
