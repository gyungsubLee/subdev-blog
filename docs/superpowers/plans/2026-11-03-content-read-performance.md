# 콘텐츠 READ 중복 작업 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 서버가 같은 Markdown을 두 번 분석하지 않고, 같은 목록 응답을 반복해서 직렬화하거나 압축하지 않게 한다.

**Architecture:** 기존 snapshot 캐시와 공개 응답 계약을 유지한다. 검증 중 계산한 링크 변환 결과를 같은 snapshot과 원문에서 재사용한다. 목록 응답의 bytes도 기존 용량 제한 안에서 재사용한다.

**Tech Stack:** Node.js ESM, `node:test`, `node:zlib`, 기존 `micromark`와 `parse5`. 새 의존성을 추가하지 않는다.

**Spec:** [공개 조회 계약](../specs/2026-10-25-github-runtime-content-design.md), 이 문서의 「확정한 범위와 설계」.

## 상태와 실행 권한

- 작업 ID: `READ-PERF-01`.
- 작성일: 2026-11-03 KST.
- 상태: 구현·관련 검사·전후 비교·독립 재검토·빌드를 완료했다. 전체 검사에서 권한 때문에 실패한 두 파일도 별도 확인했다.
- 요청 원문: “작업 문서 작성하고 이관해서 작업 처리해줘”.
- 원본 채팅: `01a1a17b-8a9d-7361-bddd-d38f8ed274ac`, 제목 `콘텐츠 READ 병목 측정`.
- 사용자는 검토한 개선안을 문서화하고 이관해서 처리하도록 요청했다. 이 계획의 1·2번 개선을 구현하고 검증한다.
- 구현 담당자는 새 로컬 작업 채팅 한 곳이다. 이 채팅이 제품 코드 편집과 겹치는 검사 전체를 소유한다.
- 원본 채팅은 계획·초기 근거·이관 기록만 작성한다. 제품 코드를 함께 수정하거나 같은 검사를 다시 실행하지 않는다.
- 이관 정보는 `.project-context/dispatch/content-read.json`에 기록한다. 생성 전에는 이 파일이 없다.
- 실행 상태와 검사 결과는 이 문서에서 갱신한다. 별도 TODO를 만들지 않는다.

## Global Constraints

- 공개 응답의 필드, 정렬, 1,400자 요약, `bodyLoaded` 값과 검색 결과를 유지한다.
- 기존 UI의 구성·문구·스타일·로딩 동작을 유지한다. 프런트엔드 파일은 수정하지 않는다.
- 문서 검증, URL 안전 검사, 공개 필드 제한과 오류 응답을 유지한다.
- 공개 저장소 확인, 현재 head 기준 조상 확인과 저장 직후 `after` 처리를 우회하지 않는다.
- `HEAD_FRESH_MS=30000`, snapshot 3개·128 MiB 제한, blob 32 MiB 제한과 중복 요청 방지를 유지한다.
- 응답은 1 MiB 초과 시 기존 gzip 협상을 따른다. 압축 응답의 4 MiB 상한을 유지한다.
- `Cache-Control: no-store`와 `Vary: Accept-Encoding`을 유지한다. CDN 캐시는 이번 범위가 아니다.
- 새 캐시 데이터도 기존 용량 제한에 포함한다. 프로세스 전체에 무제한 Map을 추가하지 않는다.
- 캐시된 변환 문자열과 응답 bytes의 메모리를 함께 계산한다. 기존 branch·token별 캐시 격리를 유지한다.
- 현재 작업 트리의 기존 수정을 되돌리거나 포함해서 커밋하지 않는다. 커밋·푸시·배포는 이번 완료 조건에 포함하지 않는다.
- 브라우저 검사가 필요하면 연결된 Chrome만 사용한다. Playwright 실행과 API는 사용하지 않는다.
- 실행한 검사와 실행하지 않은 검사를 구분한다. 빌드 성공으로 UI나 운영 성능을 검증했다고 쓰지 않는다.
- 테스트 진단에는 boolean과 작은 원시값을 사용한다. DOM·React tree·순환 객체 전체를 assertion에 넣지 않는다.
- 비동기 검사에는 제한 시간을 둔다. 성공·실패 모두에서 서버·worker·JSDOM과 임시 자원을 정리한다.
- 검사 실행이 멈추거나 메모리가 급증하면 기존 프로세스와 로그를 읽는다. 원인을 확인하지 않고 같은 검사를 재실행하지 않는다.

## Review Focus

- 목록 요약 뒤 상세 본문을 조회하면 1,400자를 넘는 전체 본문을 반환해야 한다. 복사한 entry의 요약 캐시를 재사용하면 안 된다.
- 같은 원문도 snapshot의 경로·카테고리·첨부 URL이 바뀌면 이전 변환 결과를 재사용하면 안 된다.
- gzip 허용 요청 뒤 거부 요청이 와도 `406`과 작은 JSON 응답의 기존 동작을 유지해야 한다.
- 캐시된 응답도 `after` 갱신과 변경된 head의 계보 검사를 통과한 뒤 반환해야 한다.
- 응답 body를 소비한 요청 뒤에도 다음 요청이 독립적으로 읽을 수 있어야 한다. 같은 `Response` 객체를 재사용하면 안 된다.

## 측정 근거와 한계

초기 근거는 [측정 파일 목록](../../research/2026-11-03-content-read/baseline-manifest.json)에 보관한다.
그 파일은 입력과 근거의 SHA-256도 기록한다. 측정용 임시 복사본에서만 구간 타이머를 사용했다.

- 콘텐츠 커밋: `723231cd3cedd4702d2d77ced9190e63387e852d`. 공개 글은 3,033개다.
- 로컬 캐시 없음: 4,786.7ms와 4,941.2ms. 네트워크 응답을 재현한 실행은 3,203.6ms와 3,234.5ms다.
- 구간 측정: `validateContent` 1,756.3ms, `toPublicPosts` 1,337.1ms, JSON 생성과 gzip 136.2ms.
- 로컬 캐시 있음: 129.3ms에서 137.0ms. 이 구간에서는 GitHub 요청이 없었다.
- 목록 JSON은 5,560,675bytes다. gzip은 1,297,467bytes다.
- 운영 목록 관측값: 첫 측정 14.48초, 반복 측정 1.66초. 운영 본문 한 건은 1.10초였다.
- 운영 첫 측정이 콜드 스타트였는지는 확인하지 못했다. 운영 내부 구간과 브라우저 렌더링 시간도 측정하지 않았다.
- 로컬 측정은 서버 함수의 직접 호출이다. 사전 로드한 catalog와 응답을 버퍼링하는 fetch 래퍼를 사용했다.
- 이 수치는 진단 근거다. 새 구현의 전후 비교는 같은 입력·환경·측정기로 다시 실행한다.
- `toPublicPosts`의 1,337.1ms에는 정렬과 공개 필드 생성도 포함된다. 이 시간을 전부 줄인다고 가정하지 않는다.

## 확정한 범위와 설계

### 1. 검증 중 계산한 Markdown 결과 재사용

`validateContent(snapshot)`는 링크 검증과 첨부 수집을 하면서 `rewriteContentLinks()`를 호출한다.
지금은 그 결과를 버린다. 이어서 `publicPost()`가 같은 원문을 다시 분석한다.

검증한 snapshot 안에서 변환 결과를 보관하고 공개 목록 생성에 재사용한다.
원문과 snapshot의 문맥이 같을 때만 적중하도록 한다.
entry를 복사해 본문을 바꾸는 상세 경로에서는 반드시 새 본문을 변환한다.
재검증 실패가 이전 캐시를 유효한 결과로 남기면 안 된다.
공유 함수의 호출부를 읽고, 기존 문서 저장·게시·빌드 동작도 유지한다.

### 2. 목록 응답 bytes 재사용

현재 snapshot은 `posts`와 `categories`를 보관하지만, 응답 JSON과 gzip은 매 요청마다 다시 만든다.
같은 snapshot의 목록 응답 bytes를 인코딩별로 재사용한다.
bytes와 응답 헤더로 매 요청마다 새 `Response`를 만든다.
요청 검증과 head·계보 확인을 마친 뒤 캐시된 bytes를 반환한다.
gzip 협상과 오류 크기 제한을 기존 순서대로 적용한다.
보관한 bytes를 snapshot 용량에 더하고, 기존 퇴출 기준을 유지한다.

### 보류한 항목

목록과 검색 데이터 분리, 상세 요청 구조 변경, 공유 캐시 서비스, HTML 없는 본문의 별도 단축 경로는 이번에 구현하지 않는다.
운영 서버의 계측·배포와 macOS 앱 재빌드도 포함하지 않는다.
캐시 TTL을 늘리거나 검증을 생략해서 측정값을 줄이면 안 된다.

## 편집 대상과 기존 수정

제품 편집 대상은 `scripts/content.mjs`, `server/public-content.mjs`다.
회귀 검사는 `tests/content.test.mjs`, `tests/public-content.test.mjs`에서 보강한다.
성능 비교용 파일이 필요하면 `scripts/measure-content-read.mjs` 한 개를 추가할 수 있다.
그 파일은 로컬 또는 결정적인 입력으로 비교하며 원격 쓰기를 하지 않는다.
실행 결과는 `docs/research/2026-11-03-content-read/`에 추가한다. 초기 근거 파일은 덮어쓰지 않는다.

인계 전에 존재하던 수정은 이 작업의 소유가 아니다.

- 수정됨: `server/github.mjs`, `tests/github-auth.test.mjs`, `vite.config.ts`.
- 추적되지 않음: 기존 `docs/research/` 내용, `docs/superpowers/plans/2026-11-03-oss-pattern-adoption.md`, `native/`.
- 추적되지 않음: `server/native-auth.mjs`, `tests/native-auth.test.mjs`, `tests/native-preview.test.mjs`.
- 추적되지 않음: `tests/test_native_build.py`, `tests/test_native_navigation.py`.

전체 diff를 결과에 섞지 않는다. 인계 시점의 대상 파일 hash는 초기 근거 목록에서 확인한다.
이관 뒤에는 원본 채팅이 제품 편집과 검사를 실행하지 않는다.

## Task 1: Markdown을 한 번 분석하도록 변경한다

**Files:** `scripts/content.mjs`, `tests/content.test.mjs`, `tests/public-content.test.mjs`.

**Interfaces:** `validateContent(snapshot)`, `toPublicPosts(snapshot)`, `toPublicPost(snapshot, id)`의 기존 인자와 반환 계약을 유지한다.
새 결과 캐시는 공개 응답과 catalog 출력에 노출하지 않는다.

- [x] 공유 함수의 모든 호출부와 기존 테스트를 읽는다. 원래 출력과 비용을 고정 입력으로 기록한다.
- [x] 회귀 검사를 추가한다. 요약 뒤 전체 본문, 재검증, 다른 snapshot의 링크 문맥을 확인한다.
- [x] 한 번의 분석 결과를 재사용하도록 최소 변경한다. 원문이나 문맥이 바뀌면 다시 계산한다.
- [x] `node --test tests/content.test.mjs tests/public-content.test.mjs tests/content-links.test.mjs`를 실행한다.
- [x] 반복 분석을 줄였다는 측정 근거를 남긴다. 기존 구현에서도 통과하는 동작 검사는 성능 회귀를 검출한다고 쓰지 않는다.

## Task 2: 같은 목록의 압축 결과를 재사용한다

**Files:** `server/public-content.mjs`, `tests/public-content.test.mjs`.

**Interfaces:** `handlePublicRequest(request, options)`의 기존 계약을 유지한다.
Task 1이 만든 공개 목록의 필드와 순서를 그대로 직렬화한다.

- [x] 반복 조회, 소비한 응답 body, gzip 허용·거부 순서를 검사한다.
- [x] 새 커밋의 `after` 조회와 변경된 head의 조상 확인을 회귀 검사로 확인한다.
- [x] 목록 bytes만 재사용한다. 매 요청마다 새 `Response`를 만들고 용량을 제한한다.
- [x] `node --test tests/public-content.test.mjs`를 실행한다.
- [x] 같은 입력으로 캐시 없음과 캐시 있음의 전후 시간·응답 digest·보관 크기를 비교한다.

## Task 3: 구현과 근거를 검토하고 인계를 마친다

**Files:** 이 계획, `docs/research/2026-11-03-content-read/`, `.project-context/`의 이 작업 기록.

- [x] 구현 담당자가 고정 입력으로 전후 성능을 비교한다. 캐시 없음은 독립 캐시 5회, 캐시 있음은 준비 뒤 10회 측정한다.
- [x] 새 커밋·동시 요청·반복 본문 조회에서 GitHub 호출 수가 늘지 않았는지 확인한다.
- [x] 시간 비교는 중앙값·입력 hash·환경을 함께 남긴다. 운영 수치로 환산하거나 측정하지 않은 절감률을 쓰지 않는다.
- [x] 검사에 외부 시간 제한을 둔다. 대상 Node 검사는 180초, 최종 검사와 빌드는 각각 300초를 상한으로 둔다.
- [x] 입력과 환경에 맞는 기준선을 먼저 확보한다. 같은 입력에서 시간이 늘면 원인을 고친 뒤 확인한다.
- [x] 기존 동작 검사와 별도로 새 캐시의 메모리 상한·퇴출을 확인한다.
- [x] 독립 리뷰어가 변경 diff와 근거를 읽는다. 이 리뷰어는 제품을 수정하거나 겹치는 검사를 중복 실행하지 않는다.
- [x] 구현 담당자 한 명이 `npm run check`와 `npm run build`를 최종 상태에서 순서대로 한 번 실행한다.
- [x] 최종 diff에서 요청 밖 변경을 제거한다. 기존 사용자 수정은 보존한다.
- [x] 아래 실행 기록에 명령·종료 코드·검사 수·성능 전후값·미확인 항목을 적는다.

## 완료 조건

두 중복 작업을 줄였다는 근거와 공개 응답이 같다는 근거가 있어야 한다.
1,400자를 넘는 상세 본문과 저장 직후 새 커밋 조회가 기존 동작을 유지해야 한다.
기존 검사에서 실패하면 이번 변경 때문인지 기존 실패인지 구분한다.
관련 실패가 남거나 성능 비교를 끝내지 못하면 전체 완료로 표시하지 않는다.
운영 성능·UI 비교·macOS 앱 재빌드는 실행하지 않은 항목으로 보고한다.

## 실행 기록

- 2026-11-03 KST: 원본 채팅이 측정과 독립 검토를 마쳤다. 위 범위로 작업 문서를 작성했다.
- 2026-11-03 KST: 프로젝트 기록을 새로 초기화했다. 다른 프로젝트나 체크아웃의 상태를 복사하지 않았다.
- 2026-11-03 KST: 독립 검토자가 계획의 계약·캐시 무효화·용량·검사 조건을 읽었다. 이관을 막는 누락은 없다고 보고했다.
- 구현 시작, 검사 결과와 완료 여부는 이관받은 채팅이 추가한다.

### 2026-11-03 구현 진행

- 이 채팅이 `READ-PERF-01`의 구현과 겹치는 검사 전체를 맡았다. checkout identity 검사를 통과했다.
- 기존 dirty 파일은 이 작업에서 수정하지 않았다. 공유 checkout 사용은 이관 요청에서 승인한 조건이다.
- Task 1과 Task 2는 공개 목록 필드와 순서를 공유한다. 변환 결과는 내부 WeakMap에 보관하며 공개 JSON에 넣지 않는다.
- 검증에 성공한 snapshot과 원문에서만 변환 결과를 재사용한다. 재검증 시작 때 기존 결과를 지운다.
- 문서 ID·경로 목록, 첨부 목록, 원문, filename, assetUrl 함수와 링크 정책을 비교한다. 복사한 상세 snapshot은 캐시를 공유하지 않는다.
- 목록 JSON·gzip bytes는 snapshot에 보관한다. 매 요청에서 head·계보와 인코딩 협상을 확인하고 새 Response를 만든다.
- 변환 결과와 응답 bytes를 기존 snapshot 용량에 더한다. 3개·128 MiB 제한과 blob 32 MiB 제한은 유지했다.
- `task1-red.log`는 재분석 횟수 2 대 기대값 1로 실패했다. `task2-red.log`는 직렬화 횟수 3 대 기대값 1로 실패했다.
- 첫 Task 1 검사: 80개 통과, 종료 코드 0. 첫 Task 2 검사: 23개 통과, 종료 코드 0.
- `targeted-final.log`는 83개 중 1개가 실패했다. data URL로 불러온 검사 모듈에 catalog를 전달하지 않아 로컬 catalog URL 생성이 실패했다.
- 해당 검사는 명시한 빈 catalog로 수정했다. 제품의 catalog 처리 경로는 바꾸지 않았다.
- 독립 검토자는 첨부 목록이 없는 entry에서 `inventory.length`가 실패한다고 지적했다. `review-red.log`에서 TypeError를 재현했다.
- 첨부 수집 뒤 빈 목록을 정규화하도록 고쳤다. `targeted-fixed.log`의 84개 검사는 모두 통과했다. 외부 상한은 180초였다.
- 새 검사는 gzip 재압축 방지, 소비한 Response의 독립성, 4개 커밋의 퇴출을 확인한다.
- 용량 검사는 다른 데이터가 128 MiB 경계에 있다고 모사한다. 실제 응답 bytes가 늘 때 기존 상한으로 snapshot을 퇴출하는지 확인한다.
- 독립 검토자는 파일 수정과 검사 실행을 하지 않았다. 재검토에서 남은 수정 사항은 없었다.
- `before.json`과 `after.json`은 같은 결정적 입력을 썼다. GitHub 대신 로컬 replay를 사용했고 원격 쓰기는 없었다.
- 입력은 1,200개 요약, 전체 본문, 저장 뒤 변경본이다. 기존 운영 관측의 3,033개 입력과 다르다.
- cold 5회, 준비 뒤 warm 10회, 동시 조회 2회, 최초·반복 본문 조회와 저장 직후 조회를 구분했다.
- 응답 JSON·gzip digest와 GitHub 호출 수는 모든 대응 행에서 같았다. 첫 본문 요청은 1회, 반복 요청은 0회 원격 읽기를 요구했다.
- cold 중앙값은 1,097.8ms에서 800.1ms로 줄었다. warm 중앙값은 455.0ms에서 0.4ms로 줄었다.
- 저장 직후 단일 관측은 1,091.2ms에서 812.2ms로 줄었다. 반복 표본의 중앙값으로 표현하지 않는다.
- snapshot 1개의 용량 계산값은 8,817,818bytes에서 23,128,344bytes로 늘었다. 실제 heap·RSS 측정값이 아니다.
- 이 로컬 시간을 운영 절감량으로 환산하지 않는다. 운영 14.48초의 원인이 콜드 스타트였는지도 확인하지 않았다.

### 최종 결과

- 최종 근거는 [verified-comparison.json](../../research/2026-11-03-content-read/verified-comparison.json)이다. 앞선 측정과 초기 근거는 보존했다.
- 측정기의 짝수 표본 중앙값 계산을 보완했다. 최초·반복 본문 관측도 별도로 출력한다.
- 보완한 같은 측정기로 전후를 다시 비교했다. 변경 전 제품 파일은 HEAD에서 임시 폴더에 읽었다.
- 해당 파일의 hash가 인계 시점과 같은지 확인했다. GitHub 코드와 의존성은 같은 실제 파일을 사용했다.
- 공유 checkout의 파일을 되돌리지 않았다. 임시 폴더는 측정 뒤 정리했다.
- cold 5회 중앙값: 1052.0ms → 804.6ms.
- warm 10회 중앙값: 450.2ms → 0.4ms.
- 최초 본문 단일 관측: 17.7ms → 13.0ms.
- 반복 본문 단일 관측: 6.4ms → 5.1ms.
- 저장 직후 단일 관측: 1085.0ms → 826.9ms.
- 모든 대응 응답의 JSON·gzip digest, 크기, HTTP 상태와 원격 호출 수가 같았다. 입력·소스 hash와 환경도 근거에 기록했다.
- `npm run check`: 47.4초, 종료 코드 1. 426개 중 424개 통과, 2개는 sandbox의 `listen EPERM`으로 실패했다.
- 실패한 파일은 `tests/management-runtime.test.mjs`와 `tests/native-preview.test.mjs`다. 제품 기능 실패로 분류하지 않았다.
- 기존 로그와 종료 상태를 확인한 뒤 두 파일만 포트 접근이 가능한 환경에서 실행했다. 3개 통과, 종료 코드 0, 2.2초였다.
- 전체 검사는 재실행하지 않았다. 검사 기준을 낮추거나 테스트를 끄지 않았다.
- `npm run build`: 106.9초, 종료 코드 0. prebuild는 로컬 콘텐츠 3,032개를 생성했다.
- 빌드 중 출력이 없을 때 기존 프로세스를 확인했다. Vite가 진행 중이었고 새 빌드를 띄우지 않았다.
- 기존 500kB 초과 chunk 경고는 남았다. 이번 서버 캐시 작업에서 프런트엔드 분할을 바꾸지 않았다.
- 최종 전체 검사·빌드의 외부 상한은 각각 300초였다. 설명되지 않은 hang이나 자원 실패는 없었다.
- 최종 source binding을 확인했다. 제품 파일·검사·설정·의존성은 해당 검사 기록과 같았다.
- `git diff --check`를 통과했다. 요청 범위는 제품 파일 2개, 관련 검사 2개, 측정기 1개와 작업 기록이다.
- 독립 검토 기록은 [implementation-review.md](../../research/2026-11-03-content-read/implementation-review.md)에 있다.
- UI 비교, 운영 서버 성능, 실제 heap·RSS, 원격 저장, 커밋·푸시·배포와 macOS 앱 재빌드는 실행하지 않았다.
- 완료 조건을 충족했다. 다음 단계는 사용자가 원할 때 별도 범위로 운영 배포와 운영 측정을 정하는 것이다.
