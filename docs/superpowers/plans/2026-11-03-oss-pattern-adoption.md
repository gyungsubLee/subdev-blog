# OSS Pattern Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 블로그 구조를 유지하면서 동시 본문 다운로드를 줄이고 편집·저장 계약의 누락 검사를 추가한다.

**Architecture:** `server/public-content.mjs`의 공통 파일 읽기 경로에서 진행 중인 blob 요청을 공유한다. 기존 API·저장 트랜잭션·BlockNote UI를 유지한다. 스키마와 변환은 기존 검사에 실패 사례가 있을 때만 수정한다.

**Tech Stack:** React 19, Vite 7, TypeScript, BlockNote 0.56.0, Node 내장 test runner, JSDOM. 새 의존성 없음.

**Spec:** [통합 조사와 설계 근거](../../research/2026-11-03-oss/README.md). 상태: 제안, 구현 미착수. 사용자의 이번 요청은 조사와 계획 작성까지다.

## Global Constraints

- HEAD 확인 간격은 30초다. 개별 GitHub·raw 요청 제한은 15초다.
- blob 캐시는 32 MiB다. 스냅샷은 3개·128 MiB이며 캐시 설정은 4개까지 보관한다.
- 파일은 2 MiB, 공개 원본 합계는 64 MiB, 응답은 4 MiB 상한을 유지한다.
- 1 MiB를 넘는 공개 응답의 gzip 처리를 유지한다.
- 스냅샷의 변경 문서 읽기는 최대 8개, 저장 검증의 문서 읽기는 최대 6개를 유지한다.
- 일반 첨부는 최대 5 MiB다. 이식 때문에 요청·병렬 처리·메모리의 상한을 높이지 않는다.
- Markdown·`editor.json`·첨부의 원자적 저장, 해시 연결과 원본 메타데이터 보존을 유지한다.
- strict HEAD 충돌, 요청 ID·입력 지문, `force:false`, 저장 결과 확인을 유지한다.
- GitHub 본인·App·저장소 검증, Origin·CSRF, 공개 조회의 계보·blob 검증을 유지한다.
- 기존 UI·문구·반응형 동작을 유지한다. 제품 화면에 조사 결과나 내부 구현을 추가하지 않는다.
- Notion 수집기, 저장 API, 인증 체계와 파일 구조를 이번 이식 때문에 교체하지 않는다.
- 기존 `vite.config.ts`, `native/`, native 인증·검사 변경을 되돌리거나 이번 커밋에 포함하지 않는다.

## Review Focus

1. 공유한 raw 읽기가 실패하면 다음 요청은 재시도할 수 있어야 한다. Task 1이 검사한다.
2. 공유 대기 목록의 한도에서 다른 본문을 전역 직렬 처리하지 않아야 한다. Task 1이 검사한다.
3. 같은 blob을 다른 문맥에서 읽어도 공개 계보 검사를 건너뛰지 않아야 한다. Task 1이 검사한다.
4. 기본 블록·표·커스텀 속성과 알 수 없는 JSON 속성이 검사 추가 때문에 사라지면 안 된다. Task 2가 검사한다.
5. URL 인코딩·개행·빈 본문 때문에 상대경로나 Markdown 해시가 달라지면 안 된다. Task 3이 검사한다.

---

## 작업 소유권과 진행 순서

구현 전 `using-git-worktrees`로 격리 작업 공간을 준비한다. 기존 미완료 파일을 복사하거나 자동 정리하지 않는다.
필요한 콘텐츠 submodule 커밋과 테스트 의존성이 준비됐는지 확인한다.
조사 기준 이후 제품 코드가 바뀌었으면 해당 파일의 근거와 재현을 먼저 갱신한다.

Task 1은 공개 조회 담당자가 맡는다. Task 2·3은 편집·문서 담당자 한 명이 맡는다.
두 담당자는 서로 다른 파일을 수정하므로 병렬로 진행할 수 있다.
공유 변환기를 수정해야 하면 편집·문서 담당자가 모든 호출부를 확인한다.
Task 4의 전체 검사는 통합 담당자만 실행한다. 다른 세션이 실행 중이면 그 결과를 따른다.

### Task 1: 같은 blob의 진행 중 읽기를 공유한다

**왜:** 모의 상세 요청 8회가 같은 본문을 8번 내려받았다. 완료 캐시는 이 동시 요청을 묶지 못한다.

**Files:**
- Modify: `server/public-content.mjs`의 `cacheFor`, `readFile`.
- Test: `tests/public-content.test.mjs`.
- Reference: `docs/research/2026-11-03-oss/probe-concurrent-detail.mjs`와 결과 JSON.

**Interfaces:**
- Consumes: 기존 `handlePublicRequest(request, { env, fetcher, catalog })`, 테스트의 `fixture`와 `calls`.
- Preserves: `readFile(entry, commit, cache, fetcher): Promise<string>`와 공개 응답 계약.
- Produces: 캐시별 `blobPending: Map<string, Promise<string>>`. 키는 검증한 Git blob SHA다.

새 캐시 서비스나 공개 export를 만들지 않는다.
진행 중 작업의 등록 상한은 캐시별 64개로 제안한다. 이는 새 정책이며 운영 측정값은 아니다.
등록 한도에서는 새 키를 등록하지 않고 기존의 제한된 파일 읽기 경로를 사용한다.
이미 등록한 키는 한도와 무관하게 공유한다. 처리 완료·실패 때 등록을 제거한다.
진행 중 Map 때문에 기존 파일 읽기의 동시 처리를 전역 잠금으로 바꾸지 않는다.

- [ ] **Step 1: 현재 실패를 기존 검사에 추가한다.** 기준 목록이 있는 스냅샷을 준비한다. 지연 게이트로 같은 상세 요청 8개를 겹친다.

```js
assert.ok(statuses.every(status => status === 200));
assert.equal(rawBodyReads, 1);
assert.ok(markdowns.every(markdown => markdown === expectedBody));
```

게이트는 `finally`에서 해제한다. 비동기 검사는 5초 이내에 끝나게 한다.
대형 응답·DOM·Response 객체를 assertion 피연산자로 넘기지 않는다.

- [ ] **Step 2: 공개 조회 검사만 실행해 실패를 확인한다.** `rawBodyReads`가 8이라서 실패해야 한다. 다른 실패면 먼저 원인을 확인한다.

Run: `node --test tests/public-content.test.mjs`.
외부 실행 제한은 60초다. stdout·stderr는 파일에 기록하고 사용자 출력은 16 KiB로 제한한다.

- [ ] **Step 3: 공통 `readFile` 경로에 공유를 적용한다.** 완료 캐시 → 진행 중 작업 → 새 읽기 순서로 처리한다.

기존 raw 요청, 파일 크기, SHA 검증, reader 정리와 캐시 축출을 유지한다.
등록 한도의 우회 경로와 일반 경로가 같은 검증·저장 코드를 사용하게 한다.
같은 SHA를 다시 저장하면 이전 문자열 크기를 제외하고 새 크기를 계산한다. 중복 완료가 `blobBytes`를 부풀리지 않아야 한다.
공개 계보 검사는 계속 `handlePublicRequest`에서 먼저 실행한다.
요청마다 자동 재시도를 추가하지 않는다.

- [ ] **Step 4: 실패 정리·분리·등록 한도를 검사한다.** 같은 파일의 실패 요청은 1회 읽기를 공유해야 한다. 다음 요청은 다시 읽고 성공할 수 있어야 한다.

다른 SHA 두 개는 동시에 시작해야 한다. 다른 캐시 설정의 토큰과 fetcher는 서로의 Promise를 공유하지 않는다.
64개 키를 게이트로 대기시킨 뒤 65번째 키가 막히지 않는지 검사한다.
한도가 찬 상태에서 같은 미등록 SHA의 읽기 2개를 겹친다. 두 raw 요청이 시작되는지 확인해 우회 정책을 검증한다.
두 완료의 실제 고유 문자열 합계는 32 MiB 아래로 구성한다. 중복 크기를 잘못 더하면 한도를 넘는 입력을 사용한다.
완료 뒤 기존의 다른 blob을 다시 요청해 raw 읽기가 추가되지 않는지 확인한다. 이 검사로 크기 중복 계산과 조기 축출을 확인한다.
실패나 SHA 불일치 결과가 완료 캐시에 남지 않는지 확인한다.
기존 계보 이탈·비공개 저장소·예약 파일·변경 문서 병렬 처리 검사를 유지한다.

- [ ] **Step 5: 같은 입력으로 전후 결과를 비교한다.** 조사 재현 검사를 실행하고 raw 본문 읽기 1회, 후속 캐시 읽기 추가 0회를 기록한다.

이식 후 결과는 기존 조사 결과를 덮어쓰지 말고 별도 파일로 저장한다.
네트워크 횟수 감소만 보고한다. 운영 지연 시간·전체 메모리를 측정하지 않았으면 향상 수치를 쓰지 않는다.

- [ ] **Step 6: 공개 조회 변경과 검사를 하나의 커밋으로 만든다.**

**DoD:** 같은 요청 8개 → raw 읽기 1회. 다른 본문은 병렬 처리. 실패 후 재요청 성공. 기존 공개 조회 검사 통과.

### Task 2: 설치한 편집기와 서버 검증기의 대응을 검사한다

**왜:** UI의 BlockNote 스키마와 DOM 없는 서버 검증기가 별도 목록을 유지한다. 현재 불일치는 확인하지 못했다.

**Files:**
- Create: `tests/editor-schema-contract.test.mjs`.
- Conditional modify: `src/shared/editor-document.mjs`.
- Reference: `src/features/post-editor/code-block.ts`, `tests/support/load-component.mjs`, 기존 편집기 검사.

**Interfaces:**
- Consumes: 기존 `editorSchema`, `BlockNoteEditor.create`, `validateEditorDocument(value, { documentId, markdownHash })`.
- Produces: 설치 버전이 생성한 블록 JSON을 실제 검증기가 받아들이는 검사. 새 런타임 스키마 API는 없음.

- [ ] **Step 1: 기존 편집기 검사의 중복 범위를 읽는다.** 블록 종류와 기본 속성의 전체 대응을 확인하는 검사가 이미 있으면 재사용한다.
- [ ] **Step 2: 실제 스키마에서 블록을 생성해 JSON으로 저장한 값을 검증한다.** 지원 블록 이름, 기본 속성, 노트·접기·코드·표를 확인한다.

`JSON.parse(JSON.stringify(editor.document))`처럼 실제 저장 형태를 사용한다.
블록 값은 편집기 API로 만들며 모든 기본 블록을 문장형 블록으로 가정하지 않는다.
허용한 알 수 없는 속성은 검증 뒤에도 유지한다. 잘못된 타입·깊이·버전은 기존처럼 거부한다.
에디터와 JSDOM은 성공·실패 모두에서 정리한다.

- [ ] **Step 3: 새 검사와 기존 검증기 검사를 실행한다.** `node --test tests/editor-schema-contract.test.mjs tests/editor-document.test.mjs`를 외부 60초 제한으로 실행한다.
- [ ] **Step 4: 불일치가 재현될 때만 원인을 고친다.** 현재 편집기가 생성한 유효 값만 수용한다. 외부 입력 검증과 알 수 없는 속성 보존을 약화하지 않는다.

불일치가 없으면 검사만 남긴다. 필드 registry, 범용 스키마 프레임워크, 서버의 BlockNote import는 추가하지 않는다.

- [ ] **Step 5: 검사와 필요한 최소 수정을 하나의 커밋으로 만든다.**

**DoD:** 실제 설치 스키마의 저장 결과를 검증한다. 실패는 블록 이름·속성명 같은 짧은 값으로 출력한다. 제품 변경 여부를 구분해 기록한다.

### Task 3: 반복 저장과 첨부·본문 보존의 누락 사례를 검사한다

**왜:** TinaCMS와 Decap의 검사 구조를 현재 계약에 적용한다. 기존 검사와 겹치는 사례는 추가하지 않는다.

**Files:**
- Modify only when coverage is absent: `tests/managed-block-editor.test.mjs`, `tests/import-document.test.mjs`.
- Conditional modify after reproducer: `src/features/post-editor/document-markdown.ts`, `src/features/content-management/ManagedPostEditor.tsx`, `src/shared/document.mjs`.
- Preserve: `src/features/post-reader/MarkdownContent.tsx`의 HTML 정화와 기존 화면.

**Interfaces:**
- Consumes: 기존 `serializeEditorMarkdown(editor)`, `parseMarkdownDocument(text)`, `serializeMarkdownDocument(document)`, `mergeDocumentPatch(original, patch, revision)`.
- Produces: JSON 재개방·Markdown 공개 표시·첨부 SHA·본문 바이트를 각각 확인하는 검사. 저장 형식은 변경 없음.

- [ ] **Step 1: 기존 사례와 추가 후보를 대조한다.** 노트·접기·코드 캡션·표·팔레트·한글·첨부의 기존 검사를 표로 기록한다.
- [ ] **Step 2: 누락된 반복 주기만 추가한다.** 블록 저장 → 저장 JSON으로 재개방 → 두 번째 저장을 실행한다.

블록 계층·캡션·줄바꿈은 선택한 속성으로 비교한다. 공개 HTML은 의미 요소와 텍스트로 비교한다.
Markdown으로 원래 블록 JSON 전체를 복원하라고 요구하지 않는다. 편집 원본은 `editor.json`이다.

- [ ] **Step 3: 첨부 사례가 없으면 추가한다.** 한글·공백·괄호·인코딩된 이름, 외부 HTTPS URL을 확인한다.

기존 상대경로와 첨부 SHA는 두 저장 주기에서 유지한다.
표시 URL만 콘텐츠 커밋으로 해석한다. 위험한 scheme과 `editor.json` 예약 경로는 기존처럼 거부한다.

- [ ] **Step 4: 본문 경계 사례가 없으면 추가한다.** 빈 본문, 공백, LF·CRLF, 마지막 개행 유무와 제목만 바꾸는 patch를 확인한다.

원래 본문 문자열을 그대로 비교한다. YAML 전체 문자열의 정렬·공백까지 같다고 요구하지 않는다.
`---js`, `---JS`, `---javascript`, `--- javascript `는 코드를 실행하지 않아야 한다.
기존 파서가 이를 일반 Markdown으로 보존하면 허용한다. 레퍼런스의 오류 문구를 맞추려고 파서를 바꾸지 않는다.

- [ ] **Step 5: 실패한 계약만 수정하고 해당 검사를 다시 실행한다.** 실패가 없으면 제품 코드를 수정하지 않는다.

Run: `node --test tests/managed-block-editor.test.mjs tests/import-document.test.mjs`.
외부 실행 제한은 90초다. UI 대기에는 개별 deadline을 두며 정리 코드는 `finally`에서 실행한다.
제품 변환기를 수정했으면 모든 호출부를 `rg`로 찾고 영향을 받는 기존 검사도 포함한다.

- [ ] **Step 6: 누락 검사와 필요한 수정만 하나의 커밋으로 만든다.**

**DoD:** 실제 추가 사례와 기존 재사용 사례를 구분한다. 반복 저장 뒤 값·경로·본문 보존을 입증한다. 새 UI나 변환 정책을 도입하지 않는다.

### Task 4: 통합 담당자가 범위와 회귀를 확인한다

**Files:** 제품 추가 변경 없음. 실제 실행 결과와 한계를 작업 기록에 남긴다.

**Interfaces:** Task 1의 요청 횟수, Task 2·3의 계약 검사 결과를 소비한다. 실행 중인 중복 검사는 시작하지 않는다.

- [ ] **Step 1: 전체 diff를 요청과 연결한다.** 기존 native 변경과 콘텐츠 원본이 포함되지 않았는지 확인한다. 새 의존성·CMS·스타일 변경이 없어야 한다.
- [ ] **Step 2: 같은 입력의 성능 근거를 확인한다.** 조사 당시 8회와 이식 뒤 1회를 비교한다. 파일 크기·원본 합계·gzip·변경 문서 병렬 상한의 기존 검사가 통과해야 한다.
- [ ] **Step 3: 통합 검사를 한 번 실행한다.** `npm run check`, `npm run check:content`, `npm run build`를 각각 외부 300초 제한으로 실행한다.

로그는 명령별로 분리한다. 결과를 기다릴 때는 60초 이하 간격으로 상태를 전달한다.
명령이 멈추거나 메모리가 늘면 기존 프로세스와 로그를 먼저 확인한다. 실행 중인 자식이 남아 있으면 다시 실행하지 않는다.
기존 native 변경 때문에 실패하면 이식 실패와 구분한다. 그 파일을 임의로 고치지 않는다.
격리 작업 공간의 기준에서 발생한 실패도 생략하지 않는다.

- [ ] **Step 4: UI 영향 여부를 확인한다.** 제품 UI 코드가 바뀌었으면 전용 Chrome 탭에서 기존 기준과 같은 상태를 비교한다.

서버·검사만 바뀌었으면 UI 변경 없음으로 기록한다. 브라우저 검사를 실행하지 않았으면 UI 검증 통과라고 쓰지 않는다.
실제 로그인·원격 저장·배포는 이 계획의 자동 검증으로 실행하지 않는다.

- [ ] **Step 5: 독립 검토에서 변경 파일의 계약과 라이선스를 확인한다.** 공유 Promise의 실패 정리, 한도, 공개 계보와 해시 보존을 우선 검토한다.
- [ ] **Step 6: 실행한 검사·실패·미확인 항목과 남은 작업을 보고한다.** 사용자 검토 전에는 구현이나 배포를 완료했다고 쓰지 않는다.

**DoD:** 요청한 파일 범위와 실제 diff가 일치한다. 실행 결과가 현재 소스와 연결된다. 기능 실패와 자원 실패를 구분한다.

## 구현 검토 지점

우선 추천은 Task 1이다. 동시 다운로드 8회라는 재현 근거가 있고 공개 조회 파일 한 곳에서 해결할 수 있다.
Task 2·3은 현재 계약을 확인하는 검사 작업이다. 검사가 통과하면 제품 변경 없이 끝낸다.
범용 CMS 이식, 자동 rebase, 분산 캐시, Notion 수집 재개는 이 계획에 포함하지 않는다.

실행 방식은 공개 조회 담당자와 편집·문서 담당자를 병렬로 두는 방식을 추천한다.
통합 검사는 한 명이 맡는다. 구현 시작 전 사용자가 이 계획과 실행 범위를 검토한다.
