# 콘텐츠와 네이티브 기능 조사

기준일: 2026-11-07 KST. 조사 범위는 `app/content`, `app/shared`, `app/native`와 대응 검사다.

문서 날짜 검사가 존재하지 않는 날짜를 허용하는 오류 1건을 고쳤다. 최종 콘텐츠·네이티브 인증 검사 112개가 통과했다.
콘텐츠 전수 검사는 글 3,032개, 분류 48개, 참조한 첨부 7,255개에서 오류 0개를 보고했다.
네이티브 Python 검사 2개도 통과했다. 브라우저에서 실제 GitHub 로그인과 `.app` 실행은 이 조사에서 검증하지 않았다.

## 범위와 보존 조건

- 기존 UI 구성과 문구를 유지했다. 새 화면은 만들지 않았다.
- `content/`의 기존 변경과 `app/server/src/public-files.mjs`의 기존 변경을 보존했다.
- 실제 원격 게시, 데이터 변경, 커밋, push, 배포는 실행하지 않았다.
- 서버·웹 통합 검사, 빌드와 브라우저 검사의 실행 소유자는 상위 에이전트다.
- 새 의존성, 저장 구조, 캐시 정책과 렌더링 경로는 바꾸지 않았다.

## 구현 기능과 CRUD 경계

| 기능 | 구현 위치 | 확인한 동작과 경계 |
|---|---|---|
| 정식 콘텐츠 읽기 | `app/content/src/content.mjs`의 `readContent` | 글 폴더당 Markdown 1개, UUID, 제목 파일명, 정규 파일, 첨부와 편집 JSON을 검사한다. |
| 계층과 분류 조회 | `validateContent` | 부모 순환, 중복 ID, 분류 순환과 중복 원본을 거부한다. 자식의 명시 분류가 상속 분류보다 우선한다. |
| 삭제된 글의 참조 | `validateContent`, `linkResolver` | 삭제된 ID를 메타데이터와 본문에서 읽을 수 있다. 누락한 부모 글을 이유로 남은 문서를 자동 삭제하지 않는다. |
| 공개 조회 변환 | `toPublicPosts`, `toPublicPost`, `toPublicCategories` | 공개 필드만 내보낸다. 수정 시각순 정렬, 미분류, 기존 분류 이름과 아이콘 표현을 보존한다. |
| 문서 생성 | `writeContentDocument` | 새 UUID 폴더에 정식 Markdown과 평면 첨부를 저장한다. 기존 폴더를 새 문서로 덮어쓰지 않는다. |
| 문서 수정과 제목 변경 | `writeContentDocument` | 현재 revision이 필요하다. 검증 뒤 같은 UUID 폴더에서 제목 파일명만 바꾼다. |
| 저장 실패와 복구 | `writeContentDocument` | 저장소 잠금, 임시 저장, 원본 백업과 복구를 사용한다. 복구가 실패하면 복구 파일과 원래 오류를 남긴다. |
| 저장 뒤 정리 실패 | `writeContentDocument` | 이미 저장한 결과를 실패로 바꾸지 않고 `cleanupWarnings`를 돌려준다. 잠금 해제를 시도한다. |
| 첨부 저장 | `assetName`, `writeContentDocument` | 경로 이탈, 심볼릭 링크, 예약 파일명, 파일명 충돌과 바이트 충돌을 거부한다. 기존 첨부는 보존한다. |
| 로컬 삭제 | `app/content` | 문서·분류 삭제용 로컬 API는 없다. 실제 관리 삭제는 `app/server`의 조사 범위다. |
| 분류 생성·수정·삭제 | `app/content` | 이 모듈은 분류를 읽고 검증한다. 원격 CRUD는 `app/server`, 조작 UI는 `app/web`에 있다. |
| 문서 전송 형식 | `app/shared/document.mjs` | 기존 형식, 전체 문서, 수정본을 구분한다. YAML 별칭, 태그, 중복 키와 위험한 객체 키를 거부한다. |
| 수정본 병합 | `mergeDocumentPatch` | 원본 ID와 revision을 검사한다. 제목·분류·태그와 본문을 병합하며 본문 변경은 검토 상태를 바꾼다. |
| 변경 없는 수정본 | `mergeDocumentPatch` | 본문과 수정 필드가 같으면 원래 수정 시각을 보존한다. |
| 백업 형식 | `parseBlockBackup`, `markdownDocument` | 기존 블록 백업과 Markdown 내보내기 형식을 지원한다. 실제 파일 선택과 다운로드는 웹 기능이다. |
| 편집 문서 검증 | `app/shared/editor-document.mjs` | 문서 ID와 Markdown 해시를 연결한다. 블록·표·링크·속성, 깊이 64와 노드 예산 50,000을 검사한다. |
| 편집 JSON 보호 | `isEditorFilename`, `readContent` | `editor.json`과 인코딩한 예약 이름을 첨부로 취급하지 않는다. 2MiB를 넘는 편집 원본을 거부한다. |
| 링크 변환 | `app/shared/content-links.mjs` | Markdown 목적지와 HTML `href`, `src`, `srcset`을 변환한다. 코드 예제와 목적지 밖의 바이트를 보존한다. |
| 기존 Notion 주소 | `linkResolver` | 알려진 글 ID와 Markdown 별칭을 앱 주소로 바꾼다. fragment를 보존하며 첨부 UUID를 글로 오인하지 않는다. |
| 출처 확인 | `getContentProvenance` | 로컬 변경 상태를 보고한다. 배포에서는 깨끗한 콘텐츠와 앱의 고정 gitlink를 검사한다. |
| Git 없는 배포 | `getContentProvenance` | `CONTENT_COMMIT_SHA`를 요구한다. 반환값 `package-attested`는 포장 과정의 확인을 뜻한다. |

## CLI 기능

| 명령·파일 | 구현 기능 | 실행 또는 검사 상태 |
|---|---|---|
| `npm run check:content` | 선택한 정식 콘텐츠를 읽고 계층·문서·첨부·출처를 검사한다. | 실제 콘텐츠 전수 검사 통과. |
| `npm run import:md` | 이전 형식의 Markdown을 `content/written/<UUID>.json`으로 저장한다. 같은 ID면 기존 부모·경로를 보존한다. | 백업 checkout의 동작과 정식 콘텐츠 차단을 임시 fixture에서 검사했다. |
| `npm run export` | Notion 페이지·컬렉션을 수집하고 Markdown·첨부·메타데이터를 보관한다. | 실제 원격 수집은 실행하지 않았다. 정식 콘텐츠에서는 쓰기 전에 거부한다. |
| `repair-markdown.mjs` | 저장한 Notion 블록에서 본문을 다시 만들며 글 메타데이터를 보존한다. | 변환 검사와 정식 콘텐츠 차단 검사를 통과했다. 실제 콘텐츠는 수정하지 않았다. |
| `migrate-content.mjs --output ... [--dry-run]` | 이전 JSON과 작성본을 병합해 외부 폴더로 옮긴다. 입력·출력·첨부 해시와 미소유 파일을 보고한다. | dry-run, 실제 임시 출력, 원본 보존, 경로 이탈과 누락 첨부 검사를 통과했다. |
| `publish-public-content.mjs --commit ... --output ...` | 고정 SHA에서 공개 파일을 만든다. | 구현을 읽었다. GitHub를 사용하는 실제 명령은 실행하지 않았다. |
| 같은 파일의 `--publish` | 명시한 옵션으로 공개 원본을 게시한다. | 실행하지 않았다. 서버 검사 소유자가 fixture 경로를 담당한다. |
| `check:export`, `check:assets` | 이전 JSON·외부 보관 폴더·옛 공개 첨부를 대조한다. | README가 이전 전 백업 전용 검사로 지정한다. 현재 checkout에서는 실행하지 않았다. |

Notion 수집기는 원본 응답과 다운로드 파일의 캐시를 재사용한다. API 요청 간격, 재시도와 작업 풀도 유지했다.
자산 요청은 공개 HTTP·HTTPS 주소, DNS 응답과 리다이렉트 주소를 검사한다.
`writeMarkdown`은 바뀐 원본의 해시별 이력을 보관하며 같은 본문은 다시 쓰지 않는다.
이 기능의 외부 서비스 가용성과 실제 다운로드 결과는 이번 검사로 확정하지 않았다.

## 네이티브 기능

| 기능 | 구현과 검증 |
|---|---|
| 앱 조립 | `build.py`가 실행 파일과 `config.json`을 묶는다. 사용자 콘텐츠는 복사하지 않는다. 임시 bundle 검사 통과. |
| 로컬 서버 시작 | 앱이 Node와 기존 Vite preview를 시작한다. 전용 health token으로 자기 서버를 확인한다. |
| 서버 종료 | 앱이 시작한 프로세스만 종료한다. 종료 때 로그 핸들과 로그인 흐름을 정리한다. |
| 창과 메뉴 | 뒤로·앞으로·홈·새로고침, 편집 메뉴, 창 크기 저장을 구현한다. 실제 창 조작은 실행하지 않았다. |
| 네비게이션 제한 | 설정한 loopback origin을 앱 안에서 연다. 외부 HTTPS는 기본 브라우저로 보낸다. |
| 오류 복구 | 기존 주소를 복구한다. 사용한 OAuth callback 코드를 재전송하지 않고 로그인을 다시 시작한다. Swift 9개 주소 사례 통과. |
| 브라우저 로그인 | 전용 토큰으로 시작·조회·수신 확인·취소한다. 완료 cookie를 WebKit 저장소에 넣은 뒤 수신을 확인한다. |
| 로그인 상태 | 반복 시작, 명시 재시작, 지연된 응답, 실패, 만료와 취소를 fixture에서 검사했다. 실제 계정 로그인은 실행하지 않았다. |
| 로그인 재시도 | 전송 실패와 서버 오류를 제한해 재시도한다. 인증 거절·만료·횟수·기한 경계의 Swift precondition 10개 통과. |
| 파일 다운로드 | 로컬 주소와 로컬 blob 다운로드에 저장 패널을 제공한다. 실제 저장 패널은 조작하지 않았다. |
| 앱 빌드 | Swift 컴파일, 아이콘 생성, 임시 서명, 서명 검사를 구현한다. 이번에는 전체 `.app` 빌드를 실행하지 않았다. |
| preview API | 빌드한 정적 파일, 버전, health 응답, 기존 API와 요청 크기 제한을 로컬 HTTP로 검사했다. |

## 오류 수정

`validateKnownFields`가 `Date.parse`의 성공만 확인했다. JavaScript는 `2025-02-29`와 `2025-04-31`을 다음 달 날짜로 보정한다.
이 때문에 가져온 문서와 저장할 문서에서 존재하지 않는 날짜가 검사를 통과했다.

`app/shared/document.mjs`에서 입력의 날짜 부분을 별도로 읽고 UTC 일자가 입력 일자와 같은지 검사한다.
timezone 변환 전의 날짜를 검사하므로 정상 offset 문자열은 보존한다. 기존 오류 문구와 날짜·시간 형식은 바꾸지 않았다.
이 검사는 전체 문서, 기존 형식, 수정본과 저장 직렬화가 공유한다.

새 회귀 검사는 `tests/content/document.test.mjs`에 있다.

- 수정 전: `created must reject 2025-02-29`에서 기대한 예외가 없어 실패했다.
- 수정 후: 두 날짜 필드의 잘못된 윤일·월말·offset 사례와 정상 윤일·offset 사례가 통과했다.
- 정상 `2024-02-29`, `2000-02-29`와 날짜 경계를 넘는 양·음 timezone offset 문자열을 그대로 유지했다.

## 실행한 검사와 결과

모든 명령은 저장소 루트에서 실행했다. Node 테스트 동시 실행 수는 2로 제한했다.
외부 명령의 제한 시간은 Node 묶음 180초, preview 재검사 90초, 콘텐츠 검사 90초, Python 검사 210초였다.
로그를 파일로 받아 출력량을 제한했다. Node 서버와 임시 fixture는 기존 검사 코드의 정리 경로를 사용했다.

| 검사 | 결과 | 시간·로그 |
|---|---|---|
| 최초 `node --test --test-concurrency=2 tests/content/*.test.mjs tests/native/*.test.mjs` | 111개 중 110개 통과. preview 1개는 sandbox의 `listen EPERM`으로 실패했다. | 22.90초, `/tmp/subdev-content-native-baseline.log` |
| 권한 상승 뒤 `node --test --test-concurrency=2 tests/native/native-preview.test.mjs` | 1개 통과. 이전 프로세스 종료 뒤 같은 소스에서 로컬 포트 권한만 바꿨다. | 2.75초, `/tmp/subdev-native-preview-baseline.log` |
| 수정 전 날짜 회귀 | 2개 중 1개 실패. 달력 초과 허용을 재현했다. | 0.47초, 도구 출력 |
| 수정 후 날짜 회귀 | 2개 통과. | 0.53초, 도구 출력 |
| 최종 `node --test --test-concurrency=2 tests/content/*.test.mjs tests/native/native-auth.test.mjs` | 112개 통과, 실패·취소·건너뜀 0개. | 23.30초, `/tmp/subdev-content-native-final.log` |
| 최초 `npm run check:content` | 글 3,032개, 분류 48개, 참조 첨부 7,255개, 오류 0개. | 24.91초, `/tmp/subdev-check-content.log` |
| 수정 후 `npm run check:content` | 같은 집계, 오류 0개. | 22.00초, `/tmp/subdev-check-content-final.log` |
| `npm run check:native` | Python 검사 2개 통과. bundle 조립과 실제 Swift 컴파일을 포함한다. | 14.46초, `/tmp/subdev-check-native.log` |

전수 검사에서 콘텐츠 커밋은 `9f99941c6b650c70f363208cd97c7191ef785a46`, 상태는 `git-local-dirty`였다.
검사 과정에서 기존 콘텐츠 변경을 정리하거나 커밋하지 않았다.
최초 preview 결과는 수정 전 빌드의 근거다. 수정 뒤 빌드와 통합 검사는 상위 에이전트의 결과를 사용해야 한다.
Python 검사가 읽는 네이티브 소스와 빌더는 바꾸지 않아 완료한 근거를 재사용했다.

## 성능 관찰과 한계

기존 변환 캐시 `validatedTransforms`, 단일 문서 투영, 첨부 목록과 동시 쓰기 잠금을 유지했다.
공개 조회의 본문 지연 로딩이나 원격 요청 캐시는 수정하지 않았다.

날짜 검사 전후를 같은 프로세스에서 번갈아 측정했다. 입력 문서는 윤일과 `+09:00` offset을 포함한다.
각 버전을 1,000회 준비한 뒤 2,000개 문서를 9회씩 파싱했다.
중앙값은 수정 전 99.663ms, 수정 후 100.697ms였다. 차이는 2,000개당 1.034ms, 문서당 0.517µs다.
새 검사는 추가 날짜 비교 비용이 있다. 한 번의 측정으로 모든 환경의 성능이 같다고 단정하지 않는다.
실제 콘텐츠 전수 검사는 같은 입력에서 24.91초에서 22.00초로 측정했다. 병렬 작업과 파일 캐시가 시간에 영향을 줄 수 있다.

preview에서 같은 로컬 API 요청 20개는 개발 서버 31.7ms, preview 서버 12.1ms였다.
이 수치는 수정 전 관찰값이다. 네트워크·CPU·GPU·메모리의 포괄 성능 검사는 아니다.

## 남은 검증 경계

- 실제 GitHub·Notion 인증, 원격 게시와 원격 다운로드는 검증하지 않았다.
- macOS 앱의 실제 창, 뒤로·앞으로, 로그인 복귀와 파일 저장 패널은 조작하지 않았다.
- `.app` 전체 빌드, 아이콘 렌더링과 codesign 결과는 이번 하위 작업의 완료 조건에 포함하지 않았다.
- 웹·서버 CRUD의 통합 결과, 최신 빌드와 브라우저 결과는 상위 보고서에서 확인해야 한다.
- 기능 목록은 구현과 실행한 검사를 구분한다. 목록에 있다는 이유로 실제 외부 서비스까지 통과했다고 판단하면 안 된다.

다음 행동은 상위 에이전트가 공유 날짜 검사를 포함한 웹·서버 통합 결과를 최종 보고서에 합치는 것이다.
