# 웹 기능과 CRUD 검사

웹에서 오류 3건을 재현하고 수정했다. 수정 전 웹 테스트 280개가 통과했으며, 기존 검사가 놓친 후속 편집 경로에서 오류가 드러났다.
검사 기준일은 2026-11-07이다. 실행 환경은 macOS, Node.js `v24.3.0`, 기존 `package-lock.json`이다.

## 범위와 완료 조건

- 변경 대상은 `app/web/src`와 `tests/web`이다. 제품 코드는 `ManagedCategories.tsx`와 `ManagedPostEditor.tsx`만 수정했다.
- 기존 화면, 문구, 배치, 스타일, 버튼, 경로를 유지한다. 새 화면을 추가하지 않았다.
- 완료 조건은 기존 CRUD 동작 검사, 재현한 오류의 회귀 검사 통과, 요청 횟수 확인이다.
- 기존 `app/server/src/public-files.mjs`와 `content` 수정은 보존했다. 다른 담당자의 `app/shared/document.mjs` 수정도 건드리지 않았다.
- 원격 GitHub 쓰기, 커밋, 푸시, 배포를 실행하지 않았다.

## 구현 기능 목록

| 기능 | 구현한 동작 | 검사 근거 |
| --- | --- | --- |
| 화면 이동 | 홈, 기록, 글 본문, 콘텐츠 관리, 카테고리 관리, 없는 글, 본문 건너뛰기, 뒤로가기, 화면 제목 | `app-flow`, `blog`, `records-flow` |
| 홈 | 최신 공개 글 4개, 예시 인기 목록 5개, 빈 목록, 날짜 정렬, 원본 표지 우선 | `home-page`, `blog` |
| 공개 글 조회 | 공개 목록과 본문 분리, 커밋에 고정한 본문 조회, 브라우저 캐시, 오류 표시, 초안 비공개 | `app-flow`, `public-client-cache`, `blog` |
| 기록 탐색 | 카테고리 트리, 하위 분류 포함, 검색, `/` 검색 초점, 12개씩 더 보기, 화면 왕복 후 상태 유지 | `records-page`, `records-interactions`, `category-records`, `records-flow` |
| 콘텐츠 관리 | 공개 글과 브라우저 초안 통합, 복구 별칭 통합, 상태·분류·검색 필터, 15행 페이지, 수정·삭제 연결 | `content-workspace` |
| 글 생성 | 브라우저 초안 생성, 기존 목록 기준 재사용, 공개 목록 실패 때 인증한 원본 조회, 선택한 분류 전달 | `content-management`, `managed-block-editor`, `app-flow` |
| 글 수정 | 제목, 본문, 태그, 분류, 첨부, Markdown과 블록 JSON의 같은 저장 시점 유지, 공개 뒤 재수정 | `content-management`, `managed-block-editor` |
| 글 삭제 | 확인 창, 중복 실행 방지, 공개 원본과 복구 초안 삭제, 로컬 초안 단독 삭제, 실패 때 행 복원 | `content-workspace`, `content-management` |
| 카테고리 관리 | 추가, 이름 변경, 키보드·포인터 이동, 순서, 실행 취소, 별칭 보존, 같은 이름·잘못된 계층 거부 | `category-manager`, `category-hierarchy`, `category-catalog`, `managed-categories` |
| 카테고리 삭제 | 보호 분류와 하위 분류 검사, 미분류 이동 또는 글 삭제 선택, 별도 최종 확인, 실패 후 같은 요청 재시도 | `managed-categories`, `category-manager` |
| 블록 편집기 | 슬래시 메뉴, Notion 입력 규칙, 단축키, 실행 취소, 블록 복제·이동, 노트북, 토글, 코드 언어·설명·줄바꿈 | `editor-ui`, `notion-editor`, `notebook-editor`, `notebook-markdown` |
| 초안 복구 | 자동 보관, `Cmd/Ctrl+S`, 기존 초안 이관, 손상한 바이트 보존, 저장 공간 오류, 공개 ID와 별칭 연결 | `drafts`, `managed-block-editor`, `content-workspace` |
| 가져오기·내보내기 | Markdown·JSON 가져오기, 메타데이터 검사, Markdown·복구 JSON 내보내기, 손상한 원본 내보내기 | `import-document`, `editor-ui`, `managed-block-editor` |
| 첨부 | 5MiB 제한, 1MiB 청크, 이름 검사, 같은 이름 예약, 동시 업로드, 이미지 미리보기, 상대 경로 저장 | `managed-block-editor`, `content-management` |
| 본문 렌더링 | 안전한 HTML, 내부 글·첨부 링크, 제목 앵커와 목차, 수식, 코드, 중첩 토글, 색상·정렬 | `markdown-rendering`, `post-reader`, `article-toc`, `blog`, `notebook-markdown` |
| 로그인 | 공개 조회와 세션 조회 분리, 관리 권한 제한, 임시 실패 재시도, 요청 병합, 로그아웃 경쟁 방지 | `management-recovery`, `content-management` |
| 백그라운드 저장 | 지속 저장 큐, 전송 전 병합, 같은 요청 재시도, 원본 저장과 공개 생성 분리, 여러 탭 조정, 확인 기록 정리 | `sync-core`, `sync-recovery`, `content-api` |
| 테마·미리보기 | 팔레트·강조색 저장, 기본값 복원, 대화상자, 독자 미리보기 숨김과 화면 크기 선택 | `theme-settings`, `managed-block-editor` |

표의 검사 이름에는 `tests/web/`와 `.test.mjs`를 생략했다. 모든 검사 파일은 초기 전체 검사에 포함했다.

홈의 인기 목록은 조회수 순위가 아닌 최신 글을 쓰는 예시다. 기록 검색은 제목·요약·불러온 Markdown에서 문자열을 찾는다.

## 수정한 오류

### 카테고리를 삭제한 뒤 다음 저장이 이전 버전을 사용함

재현 순서는 카테고리 삭제, 다른 카테고리 이름 변경, 저장이다.
기존 코드는 삭제한 행만 초안에서 지웠다. 삭제 전 `revision`과 `contentCommit`을 그대로 보관했다.
다음 저장은 이전 `baseCommit`을 전송했다. 서버가 이 요청을 받으면 `409 Canonical branch changed`로 거부한다.

삭제가 확정되면 `/api/content?kind=categories&refresh=1`을 한 번 조회한다.
응답의 분류·버전·커밋으로 현재 원본, 복구 초안, 원본 캐시를 갱신한다.
조회가 실패하면 삭제 요청을 그대로 보관한다. 사용자는 같은 요청으로 결과를 다시 확인할 수 있다.

추가한 회귀 검사는 다음 두 가지다.

- `saving another category after deletion uses the confirmed source revision without restoring the deleted row`
- `a failed category refresh preserves the exact completed deletion request for retry`

첫 검사는 수정 전에 `baseCommit` 불일치로 실패했다. 수정 후 두 검사 모두 통과했다.

### 카테고리 삭제 성공 응답을 실패로 분류함

독립 검토에서 삭제 성공 fixture가 실제 서버 계약과 다르다는 점을 찾았다.
서버의 `acceptedCandidate`는 원본 저장을 확정하면 `saved`를 반환한다.
웹은 `published`, `superseded`, `unchanged`만 성공으로 받아 새 원본 조회에 도달하지 못했다.

삭제 fixture를 실제 응답인 `saved`와 `candidateCommit`으로 고쳤다.
기존 후속 저장 검사와 조회 실패 재시도 검사가 모두 실패했다.
`deleteCategory`가 `saved`를 원본 저장 성공으로 인정하게 수정한 뒤 두 검사를 포함한 카테고리 검사 13개가 통과했다.

공개 완료 판정은 바꾸지 않았다. 기존 `PublishStatus`는 `saved`를 `원본 저장 완료`로 표시한다.
회귀 검사도 이 표시를 확인한다. 공개 완료 확인은 기존 `candidateCommit` 조회 경로가 맡는다.

웹에서 `category.delete` 요청을 만드는 곳은 `ManagedCategories` 한 곳이다.
글 삭제의 공개 완료 대기와 일반 게시 상태 판정은 수정하지 않았다.
서버 계약 근거는 `tests/server/github-content.test.mjs:1036`의 GitHub API 대역 검사다.
이 검사는 `200`, `saved`, 원본 분류 변경과 재시도한 요청의 같은 커밋을 확인한다.
이 담당자는 서버 검사를 중복 실행하지 않았다.
상위 통합 로그 `/private/tmp/subdev-audit-full-node.log`에서 위 삭제 API 검사와 전체 삭제 재시도 검사의 통과를 확인했다.
이 통합 실행은 마지막 웹 상태 판정 수정 전의 기록이다. 서버 응답을 만드는 코드는 이 수정에서 바꾸지 않았다.

### 게시한 직후 첨부를 추가할 수 없음

재현 순서는 글 게시 완료, 본문 변경 없이 첨부 업로드다.
기존 `upload`의 `accepted` 검사가 백그라운드 게시 상태까지 막았다.
편집기는 입력을 허용했지만 업로드는 `첨부를 저장할 수 없습니다.`로 실패했다.

백그라운드 게시 상태를 편집기의 기존 `busy` 규칙과 같게 처리했다.
새 첨부는 다음 초안에 남는다. 전송 중인 저장 요청은 기존 시점의 첨부 목록을 유지한다.
같은 이름 예약과 업로드 중 게시 차단은 유지했다.

추가한 회귀 검사는 다음 두 가지다.

- `a confirmed publication keeps attachment uploads available for the next edit`
- `an attachment added during background publication survives the earlier snapshot confirmation`

첫 검사는 수정 전에 기존 업로드 오류로 실패했다. 수정 후 두 검사 모두 통과했다.
경쟁 검사는 이전 저장의 확인 응답 뒤에도 새 첨부가 남고, 다음 저장이 새 버전과 첨부를 보내는지 확인한다.

## 실행한 검사

모든 Node 테스트는 `--test-concurrency=2`로 실행했다. DOM 객체 대신 문자열·불리언·작은 데이터만 비교했다.
실행 래퍼는 로그를 파일에 보관했다. 전체 초기 검사에는 180초 기한과 2MB 출력 상한을 적용했다.
대상 전체 검사에는 100초 기한과 2MB 출력 상한을 적용했다. 실행이 끝난 뒤 종료 코드를 확인했다.

| 단계 | 실제 명령의 테스트 대상 | 결과 | 실행 시간과 로그 |
| --- | --- | --- | --- |
| 수정 전 전체 웹 | `node --test --test-concurrency=2 tests/web/*.test.mjs` | 280개 통과, 실패 0개 | 75.80초, `/private/tmp/subdev-web-baseline.log` |
| 카테고리 오류 재현 | `--test-name-pattern="after deletion uses\|confirmed publication keeps attachment"`와 수정 대상 두 파일 | 카테고리 회귀가 이전 커밋 전송으로 실패 | `/private/tmp/subdev-web-crud-red.log` |
| 첨부 오류 재현 | `--test-name-pattern="confirmed publication keeps attachment" tests/web/managed-block-editor.test.mjs` | 1개 실패, 기존 업로드 오류 확인 | 2.43초, `/private/tmp/subdev-upload-red.log` |
| 주 회귀 수정 확인 | 같은 두 회귀와 수정 대상 두 파일 | 2개 통과 | 7.76초, `/private/tmp/subdev-web-crud-green.log` |
| 수정 대상 전체 | `node --test --test-concurrency=2 tests/web/managed-categories.test.mjs tests/web/managed-block-editor.test.mjs` | 39개 통과, 실패 0개 | 22.53초, `/private/tmp/subdev-web-targeted-green.log` |
| 추가 오류 경로 확인 | `--test-name-pattern="failed category refresh\|after deletion uses" tests/web/managed-categories.test.mjs` | 2개 통과, 실패 0개 | 8.87초, `/private/tmp/subdev-web-category-refresh-green.log` |
| 실제 삭제 응답 재현 | `--test-name-pattern="after deletion uses\|failed category refresh" tests/web/managed-categories.test.mjs` | `saved` fixture에서 2개 실패 | 2.54초, `/private/tmp/subdev-web-saved-red.log` |
| 실제 삭제 응답 수정 확인 | `node --test --test-concurrency=2 tests/web/managed-categories.test.mjs` | 13개 통과, 실패 0개 | 21.46초, `/private/tmp/subdev-web-saved-green.log` |

첫 오류 재현에서 첨부 검사는 잘못된 BlockNote API 접근으로 실패했다. 기존 검사의 접근 방식으로 고친 뒤 별도로 다시 재현했다.
이 첫 첨부 실패를 제품 오류의 근거로 쓰지 않았다.

최종 신규 검사는 총 4개다. 마지막 카테고리 보강 검사와 다른 담당자의 문서 파서 수정까지 포함한 전체 검사는 통합 실행 담당자가 맡는다.
이 문서는 최종 전체 웹 검사를 통과했다고 주장하지 않는다.
앞선 `published` fixture의 통과 기록만으로 실제 삭제 계약을 검증했다고 판단하지 않았다.
최종 카테고리 검사 13개는 실제 `saved` 응답을 사용한다.

## 요청 횟수와 기존 보호 수단

| 경로와 입력 | 변경 전 | 변경 후 검사값 | 판단 |
| --- | --- | --- | --- |
| 카테고리 화면 진입 후 일반 저장 | 원본 조회 1회 | 원본 조회 1회 | 저장 때문에 조회를 추가하지 않음 |
| 카테고리 삭제 후 다른 분류 저장 | 원본 조회 1회, 이전 버전 전송 | 원본 조회 2회, 새 버전 전송 | 삭제 확정에 필요한 조회 1회 추가 |
| 글 게시 뒤 첨부 1개 업로드 | 기존 업로드 검사에서 차단 | 원본 조회 추가 0회, 업로드 1회 | 불필요한 원본 재조회 없음 |
| 같은 첨부 이름을 다시 선택 | 이름 예약에서 차단 | 두 번째 업로드 요청 0회 | 기존 중복 업로드 차단 유지 |
| 저장 응답 대기 중 새 첨부 | 업로드 차단 | 전송 요청 1개 유지, 후속 저장 1개 | 전송 요청을 바꾸지 않고 새 초안 보존 |

삭제 후 조회에는 기존 API의 캐시 갱신 옵션과 30초 제한을 사용한다.
일반 공개 캐시, 편집기 지연 로딩, 세션 요청 병합, 미리보기 200ms 지연, 동기화 큐 병합, 정리 작업은 수정하지 않았다.
동시 첨부 검사와 저장 중 첨부 검사를 함께 통과했다.

실제 GitHub 응답 시간, 브라우저 CPU·메모리, 렌더링 프레임은 이 담당자가 측정하지 않았다.
따라서 전체 실행 성능이 같다고 단정하지 않는다. 위 수치는 같은 로컬 검사에서 확인한 요청 횟수다.

## 남은 확인과 기존 경고

- 브라우저 화면 비교는 상위 담당자가 맡았다. 이 문서는 JSDOM 검사로 화면 일치를 확인했다고 쓰지 않는다.
- 전체 빌드와 최종 통합 검사는 상위 담당자가 맡았다. 중복 실행하지 않았다.
- GitHub 인증과 원격 쓰기는 로컬 응답으로 대체했다. 실제 계정으로 글과 카테고리를 변경하지 않았다.
- 기존 `background-sync.mjs`에는 `updatedAt` 중복 키 경고가 있다. 이번 CRUD 오류를 고치는 데 필요하지 않아 유지했다.
- 초기 웹 검사에는 JSDOM의 `window.scrollBy` 경고와 React `act` 경고가 있었다. 초기 검사 280개는 종료 코드 0으로 끝났다.
- 전체 기능 목록은 현재 웹 코드와 기존 검사에서 확인한 동작이다. 모든 브라우저·기기·원격 장애 조합을 전수 실행한 결과는 아니다.

다음 단계는 통합 실행 담당자가 최종 전체 검사와 브라우저 비교 결과를 종합 보고서에 합치는 것이다.
