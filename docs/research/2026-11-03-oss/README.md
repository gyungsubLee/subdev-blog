# 오픈소스 구조 분석과 이식 제안

2026-11-03 KST. 상태: 조사 완료, 구현 제안 검토 전.

기존 구조를 유지하고 필요한 구조만 이식한다. 우선 대상은 같은 본문의 동시 다운로드를 하나로 묶는 처리다.
편집기 스키마와 문서 변환은 검사 방법을 가져온다. 기능 차이는 실패 사례로 확인한 뒤 수정한다.
CMS 전체 교체나 새 관리 화면은 제안 범위에서 제외했다.

## 요청과 조사 범위

사용자는 앞서 비교한 오픈소스를 병렬로 클론하고 분석한 뒤 통합 계획을 요청했다.
세 작업 세션이 다섯 저장소를 나눠 읽었다. 주 작업 세션은 현재 코드와 조사 결과를 대조했다.
상세 보고서는 원본 코드의 커밋 고정 링크를 포함한다.

이번 산출물은 조사 보고서, 재현 검사와 실행 계획이다. 제품 코드, 의존성, 콘텐츠, 승인한 UI는 변경하지 않았다.
원격 저장, 푸시, 배포와 운영 콘텐츠 수정도 실행하지 않았다.

현재 앱 HEAD는 `52c0a6ba77bf2966ee05feb1519cd1eff4ce1e41`이다.
조사 시작 때 `vite.config.ts`, `native/`, `server/native-auth.mjs`와 native 검사 파일에 기존 변경이 있었다.
이 변경은 다른 작업의 소유로 취급한다. 조사 결과의 구현 대상으로 포함하지 않는다.

## 수집한 소스

| 레퍼런스 | 조사 커밋 | 루트 라이선스 | 상세 보고서 |
| --- | --- | --- | --- |
| [Pages CMS](https://github.com/hunvreus/pagescms) | `6f4e860a35d934406580287e7042e5e111e207a1` | MIT | [Pages CMS·Keystatic](pagescms-keystatic.md) |
| [Keystatic](https://github.com/Thinkmill/keystatic) | `b8ec9650622c11e1d38e73fca3b64c17ec278d18` | MIT | [Pages CMS·Keystatic](pagescms-keystatic.md) |
| [Decap CMS](https://github.com/decaporg/decap-cms) | `61ceb6e0680bb0362dba6d0cfe346c51e3ca3a58` | MIT | [Decap CMS](decap.md) |
| [TinaCMS](https://github.com/tinacms/tinacms) | `d38621b06002ef53e9cd1344793a7657894e6a37` | Apache-2.0 | [TinaCMS·NotionNext](tina-notionnext.md) |
| [NotionNext](https://github.com/notionnext-org/NotionNext) | `a2aa934b41c51ea95b74cbb67430e38392be01cd` | MIT | [TinaCMS·NotionNext](tina-notionnext.md) |

클론 위치는 `/private/tmp/subdev-reference-20261103/<저장소 이름>`이다.
하위 폴더는 `pagescms`, `keystatic`, `decap-cms`, `tinacms`, `notionnext`다.
임시 폴더는 영구 보관을 보장하지 않는다. 다시 수집할 때 위 커밋을 기준으로 삼는다.
각 보고서는 원격 주소, 조사 파일, 줄 번호와 라이선스 근거를 기록한다.

첫 클론은 샌드박스 DNS 제한으로 실패했다. 네트워크 권한을 받은 재시도로 다섯 클론을 완료했다.
원본 패키지를 설치하거나 원본 스크립트를 실행하지 않았다.
소스를 복사할 때는 파일별 라이선스와 고지를 확인한다. 이번 제안은 구조를 참고해 기존 코드에 직접 작성하는 방식이다.

## 현재 구조의 기준

| 경계 | 현재 소유 파일 | 유지할 계약 |
| --- | --- | --- |
| 공개 조회 | `server/public-content.mjs`, `src/app/usePosts.ts` | 목록·상세·첨부의 커밋 일치, 로그인과 독립한 조회 |
| GitHub 저장 | `server/content.mjs`, `server/github.mjs` | 후보 커밋, 요청 ID, 입력 지문, strict HEAD 충돌, `force:false` |
| 인증 | `server/auth.mjs`, `server/handler.mjs` | 본인·App·두 저장소 확인, 서버 토큰, Origin·CSRF 검사 |
| 문서 | `src/shared/document.mjs`, `src/shared/editor-document.mjs` | Markdown과 `editor.json`의 해시 연결, 원본 메타데이터 보존 |
| 편집과 표시 | `ManagedPostEditor.tsx`, `document-markdown.ts`, `MarkdownContent.tsx` | 기존 BlockNote UI, 복구용 초안, 허용 HTML 정화 |
| 콘텐츠 검증 | `scripts/content.mjs` | 고정 UUID 폴더, 형제 첨부, 분류·부모·참조 검사 |

`ManagedPostEditor.tsx`는 `src/features/content-management/`에 있다.
`document-markdown.ts`는 `src/features/post-editor/`에 있다.
`MarkdownContent.tsx`는 `src/features/post-reader/`에 있다.

조회는 기준 목록과 Git blob ID를 비교한다. 바뀐 문서만 읽으며 상세 본문은 요청할 때 읽는다.
저장은 Markdown·편집 JSON·첨부를 하나의 Git 커밋으로 기록한다. 콘텐츠 저장 때문에 앱을 다시 배포하지 않는다.
이 구조는 레퍼런스와 비교해 유지할 가치가 있다.

## 합친 판단

| 가져올 구조 | 레퍼런스 | 현재 차이 | 결정 |
| --- | --- | --- | --- |
| 진행 중인 읽기 요청 공유와 완료 뒤 정리 | NotionNext | HEAD·스냅샷은 공유하지만 개별 blob은 완료 캐시만 사용 | **우선 이식**. 아래 모의 요청에서 중복 다운로드를 확인 |
| 편집기와 검증기의 스키마 대응 검사 | Pages CMS·Keystatic | BlockNote 스키마와 서버의 블록 목록을 별도로 유지 | **검사 방법 이식**. 실제 불일치는 아직 미확인 |
| 입력 블록·저장 결과·재개방 결과를 함께 비교 | TinaCMS | 속성·Markdown·복구 검사는 있으나 반복 주기의 전체 대응은 미확인 | **누락 사례만 추가** |
| 첨부 경로의 읽기→저장→읽기 검사 | TinaCMS·Decap | 상대경로·SHA·고정 커밋 미리보기를 이미 사용 | **기존 구조 유지**, 인코딩과 반복 저장의 누락 사례만 추가 |
| 본문 바이트와 frontmatter 분리 | Decap·Pages CMS | 기존 파서와 제한된 patch가 이미 보존 | **유지**, 실행 형식처럼 보이는 입력은 필요할 때 검사 |
| 다중 파일의 원자적 커밋 | Keystatic·Decap | 이미 Markdown·JSON·첨부를 함께 기록 | **유지**, 단일 파일 Contents API로 교체하지 않음 |
| 변경 없는 Git 객체 재사용 | Keystatic | 기존 blob 캐시와 빌드 기준 목록이 이미 담당 | **유지**, IndexedDB·웹훅 DB를 추가하지 않음 |
| 오래된 HEAD의 자동 재시도·rebase | Keystatic·Decap | 현재는 문서 밖 참조까지 검사하고 HEAD 변경을 충돌로 처리 | **제외**, 기존 충돌 정책을 바꾸기 때문 |
| 범용 컬렉션·필드 등록 체계 | Pages CMS·Keystatic | 현재 단일 콘텐츠 계약에 필요하다는 근거 없음 | **제외**, 스키마 프레임워크와 새 의존성을 추가하지 않음 |
| 설치 토큰 DB와 협업 권한 | Pages CMS | 현재 본인 전용 GitHub App 인증과 목적이 다름 | **제외**, 인증 권한을 넓히지 않음 |
| 실시간 Notion과 만료 이미지 URL 갱신 | NotionNext | 현재 원본은 GitHub Markdown과 보관한 첨부 | **제외**, 공개 조회에 Notion 의존성을 다시 넣지 않음 |
| 새 Notion 블록 정규화 | NotionNext | 현재 수집기 쓰기는 의도적으로 중단 | **보류**, 수집 재개 요청과 실패한 원본 기록이 필요 |

근거는 각 상세 보고서의 커밋 고정 링크에 있다.
예를 들어 NotionNext는 [진행 중인 호출을 공유](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/db/notion/getNotionAPI.js#L59-L79)한다.
Keystatic의 [스키마 기반 직렬화](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/form/serialize-props.ts#L19-L88)는 대응 검사의 참고 근거다.
TinaCMS의 [첨부 왕복 검사](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/graphql/src/resolver/media-rich-text.test.ts#L102)는 현재 저장 형식으로 다시 작성한다.

## 확인한 중복 다운로드

[재현 검사](probe-concurrent-detail.mjs)는 실제 네트워크 없이 현재 공개 조회 함수를 호출한다.
기준 목록으로 초기 목록을 읽은 뒤 같은 커밋의 같은 본문을 동시에 8회 요청했다.
Node `v24.3.0`, 힙 상한 128 MiB, 외부 실행 제한 20초로 실행했다.

- 초기 목록은 본문을 내려받지 않았다.
- 동시 상세 요청 8회가 모두 `200`을 반환했다.
- 같은 본문의 raw 다운로드는 8회였다.
- 이후 상세 요청 1회는 완료 캐시를 사용했다. raw 다운로드는 추가되지 않았다.

이는 모의 요청의 다운로드 횟수다. 운영 지연 시간이나 전체 메모리 사용량을 측정한 결과는 아니다.
목표는 같은 조건에서 raw 다운로드를 1회로 줄이는 것이다. 다른 본문은 동시에 읽을 수 있어야 한다.
실패한 진행 중 요청은 제거한다. 사용자의 다음 요청은 새로 읽을 수 있어야 한다.

[결과 JSON](probe-concurrent-detail-result.json)은 명령, 종료 코드, Node 버전과 제품 소스 해시를 기록한다.
첫 검사에서는 모의 commit 응답에 `sha`가 빠져 `502`가 났다.
실제 검증 조건을 읽고 모의 응답만 고쳤다. [첫 실행 기록](probe-concurrent-detail-attempt1.json)은 이 검사 작성 오류를 보존한다.
제품 오류나 제품 수정으로 계산하지 않는다.

## 제안한 실행 순서

1. 개별 blob의 진행 중 요청을 같은 캐시 안에서 공유한다.
2. 편집기와 검증기의 대응을 검사한다. 실패한 계약만 수정한다.
3. 변환·첨부·본문 보존 검사에서 빠진 사례만 추가한다.
4. 변경한 경로를 통합 검증하고 요청 횟수와 자원 제한을 확인한다.

1번과 2번·3번의 조사·검사는 파일 소유자를 나누면 병렬로 진행할 수 있다.
실제 변환기 수정이 필요하면 2번과 3번의 소유자를 하나로 합친다.
겹치는 전체 검사는 통합 실행 소유자 한 명이 실행한다.

## 성능과 UI 기준

HEAD 확인 간격은 30초다. 개별 GitHub·raw 요청 제한은 15초다.
blob 캐시는 32 MiB다. 스냅샷은 3개·128 MiB이며 캐시 설정은 4개까지 보관한다.
파일은 2 MiB, 공개 원본 합계는 64 MiB, 응답은 4 MiB 상한을 유지한다.
1 MiB를 넘는 공개 응답의 gzip 처리를 유지한다.
스냅샷의 변경 문서 읽기는 최대 8개, 저장 검증의 문서 읽기는 최대 6개를 유지한다.
일반 첨부는 최대 5 MiB다. 이식 때문에 요청·병렬 처리·메모리의 상한을 높이지 않는다.

UI 기준은 현재 구현의 홈·기록·상세·분류·글쓰기 화면이다.
이번 조사에는 UI 변경이 없다. 계획도 구성·문구·버튼·간격·색상·애니메이션을 유지한다.
후속 구현이 화면에 영향을 주면 전용 Chrome 탭에서 변경 전후의 같은 화면 크기·상태를 비교한다.

## 검증 상태와 다음 단계

완료: 다섯 소스 클론, 커밋·라이선스 기록, 세 병렬 분석 보고서, 현재 코드 대조, 중복 읽기 재현.
계획의 독립 검토도 완료했다. 등록 한도의 우회 요청에서 중복 완료가 캐시 크기를 부풀리는지 확인하는 사례를 보완했다.
미실행: 제품 전체 검사·빌드, 실제 GitHub 로그인·저장, 운영 성능 측정, 브라우저 UI 비교.
이번에는 제품 실행 코드를 변경하지 않았다. 전체 검사 통과나 운영 성능 유지를 주장하지 않는다.

[통합 실행 계획](../../superpowers/plans/2026-11-03-oss-pattern-adoption.md)을 검토한 뒤 구현 범위를 확정한다.
전체 CMS 교체, 새 기능, Notion 수집 재개와 배포는 별도 요청으로 다룬다.
