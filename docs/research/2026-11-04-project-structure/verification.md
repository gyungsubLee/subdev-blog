# 프로젝트 구조 변경 검증

후속 변경: [중복 Notion 자산 제거](notion-assets-cleanup.md). 이전 호환 자산 보존 결정을 변경했다.

구조 변경 구현을 완료했다. 현재 작업 트리 전체의 검사가 통과했다고 주장하지 않는다.
별도 테마 작업이 검사 도중과 검사 이후에 소스를 바꿨다.
기준 문서는 [폴더 구조 기준](../../architecture/project-structure.md)이다.
실행 절차는 [개발 안내](../../guides/development.md)를 따른다.

## 변경 범위

제품 코드를 app/web, app/server, app/content, app/native, app/shared로 이동했다.
웹의 최상위 구성 폴더는 site다. 검사도 같은 영역으로 분류했다.
콘텐츠 원본 서브모듈은 이동하거나 수정하지 않았다. 본문과 첨부파일은 글 UUID 폴더에서 함께 관리한다.
서버 생성 데이터는 app/server/generated로 옮겼다. 일반 빌드는 공개 콘텐츠 복사본을 만들지 않는다.
명시적 정적 내보내기는 dist/static/content에 격리했다.
과거 초안 자산은 app/web/public/notion으로 옮기고 공개 URL과 바이트를 보존했다.
루트 api/index.js는 Vercel 탐색을 위한 최소 연결이다. 실제 진입점은 app/server/api/index.js다.
빌드, 배포 workflow, 네이티브 경로, 검사 fixture와 문서 링크를 함께 갱신했다.

## 실행한 검사

| 검사 | 결과 | 근거 |
|---|---|---|
| 변경 전 전체 검사 | 467개 중 463개 통과. 기존 편집기 실패 2개와 포트 제한 2개 | baseline-check.log |
| 변경 전 포트 검사 | 제한 밖에서 3개 통과 | 로컬 .tmp/structure-migration 기록 |
| 마지막 전체 검사 | 487개 중 481개 통과. 실패 6개 | full-check.log |
| 구조 변경 관련 검사 | 새 구조, 목록 준비, 과거 자산 도구, 이관 CLI, 게시 검증과 기존 복구 검사 통과 | full-check.log |
| TypeScript | 실행 시점 exit0 | typecheck.log |
| 콘텐츠 원본 | 글 3,032개, 분류 48개, 참조 첨부 7,255개, 오류 0개 | content-corpus.log |
| Python | 앱 조립과 Swift 탐색 검사 2개 통과 | python-tests.log |
| 웹 빌드 | dist/web 생성, exit0. 이후 별도 테마 코드가 변경됨 | web-build.log |
| macOS 빌드 | dist/native/Second Brain.app 생성, 서명 검증 통과 | native-build.log |
| 자산 보존 | 공개 자산 6,455개 모두 SHA-256 일치 | preservation.json |
| 성능 비교 | 3쌍에서 응답 바이트, 요청 수, 캐시 보유량 일치 | performance-comparison.json |

최종 전체 검사에서 구조 변경의 정적 출력 검사 4개는 통과했다.
이전 실행에서는 fixture의 부모 폴더 누락으로 실패했다. 준비 코드를 고치고 원래 assertion과 실패 주입을 유지했다.
해당 실패 기록은 fixture-failure.log에 보존했다.

## 남은 전체 검사 실패

기존 편집기 실패는 다음 두 개다. 변경 전에도 같은 요소 조회 오류를 확인했다.

- tags, category cancellation and reader controls preserve local-only drafts
- editor confirms a category double-click through the shared dialog without publishing

나머지 네 개는 별도 theme-settings 검사다.
검사 실행 중 테마 소스가 아직 없어서 모듈을 불러오지 못했다. 이후 소스와 통합 코드가 추가됐다.
테마 작업의 개별 통과 기록은 확인했지만, 기록한 해시와 현재 파일이 다시 달라 재사용하지 않았다.
이 작업에서는 테마 코드를 수정하거나 해당 작업의 검사를 중복 실행하지 않았다.
마지막 전체 실행 결과를 임의로 통과로 바꾸지 않는다.

## 성능과 보존

같은 입력을 사용해 변경 전후를 번갈아 3쌍 비교했다.
최초 조회 중앙값은 800.025ms에서 789.924ms였다. 반복 조회는 0.337104ms에서 0.337500ms였다.
응답 바이트, 압축 바이트, 요청 수, 캐시 보유량은 모든 대응 관측에서 같았다.
실제 사용자 네트워크와 하드웨어의 프레임 시간은 측정하지 않았다.
잠금 파일과 콘텐츠 서브모듈 커밋은 바꾸지 않았다.
웹 빌드가 네이티브 출력 폴더의 검사 파일을 보존하는 것도 확인했다.

## 빌드 환경과 실행 중 앱

macOS 아이콘 변환은 샌드박스 안에서 실패했다.
기존 정상 아이콘을 추출한 입력도 같은 변환에 실패했다. 동일 입력은 샌드박스 밖에서 통과했다.
코드 수정 없이 제한 밖에서 네이티브 빌드와 codesign 검증을 완료했다.
기존 실행 중 앱의 native/dist 번들과 이전 root dist 출력은 임시 호환용으로 보존했다.
새 빌드의 기준 경로는 dist/web과 dist/native다. 기존 앱을 종료하거나 새 앱을 실행하지 않았다.

## 검증 한계

Chrome 탐색과 전용 탭 생성은 native pipe 오류로 실패했다. 같은 화면 크기의 구조 변경 전후 비교는 하지 못했다.
별도 디자인, 삭제, 테마 작업의 변경을 되돌리지 않았다. 전체 CSS가 그대로라고 주장하지 않는다.
웹 빌드와 TypeScript 검사 이후에도 테마 코드가 바뀌었으므로 최신 통합 상태의 빌드와 검사는 미확인이다.
구조 변경 당시의 소스 바인딩과 이후 변경 목록은 함께 보존했다.
project-context 검사는 시작부터 INDEX.md 크기 제한으로 실패했다. 기존 기록 전체를 다시 쓰지 않았다.
운영 배포, 원격 푸시와 커밋은 실행하지 않았다.

## 다음 행동

별도 테마 작업이 소스를 확정하면 그 작업의 최신 검증 기록을 현재 파일 해시와 대조한다.
그 뒤 남은 편집기 실패 2개와 통합 빌드를 별도 범위에서 확인한다.
