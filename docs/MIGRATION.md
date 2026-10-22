# 수집과 배포 검증

2026-10-22에 공개 Notion 블로그를 수집했다. 수집한 원문과 웹용 글을 분리해 보관한다.

## 수집 결과

- 공개 페이지: 3,032개.
- 수집한 블록: 141,136개.
- 첨부 파일: 6,453개, 1,843,587,382바이트.
- 접근 불가 블록: 6개. 공개 권한이 없거나 삭제된 항목이다.
- 외부 이미지 실패: 23개. 원본 서버는 이미지 대신 HTML을 반환하고 Notion 프록시는 422를 반환했다.
- 데이터베이스 조회 경고: 0개.

실패 항목의 URL과 사유는 원문 보관 폴더의 `manifest.json`에 있다.
가져오지 못한 이미지는 원본 링크를 유지한다.

지식 진입점은 [주제 색인](/Users/igyeongseob/Knowledge/SecondBrain/notion-blog/index.md)이다.
[전체 계층](/Users/igyeongseob/Knowledge/SecondBrain/notion-blog/pages.md)은 부모와 자식 관계를 보여준다.
원본 Markdown과 첨부 파일은 `/Users/igyeongseob/Knowledge/SecondBrain/notion-blog`에 있다.

## 웹 작성

글쓰기 화면은 블록 메뉴, 선택 서식, 목록, 토글, 표와 미디어를 제공한다.
Notion 문서를 기준으로 블록 변환 단축키와 입력 규칙을 보완했다.
코드에는 언어, 구문 강조, 복사, 줄바꿈과 캡션 도구가 있다.

초안은 현재 브라우저의 localStorage에 저장한다.
기기 간 동기화와 웹에서 공개 발행하는 기능은 없다.
공개 글은 Markdown을 가져온 뒤 Vercel에 다시 배포한다.
[작성 UX 근거](notion-writing-ux.md)는 기능별 구현 범위와 검사를 기록한다.

## 실행한 검사

`npm run check`에서 TypeScript와 동작 검사 64개를 통과했다.
검사는 실제 React 편집기의 저장, 가져오기, 내보내기와 슬래시 메뉴를 포함한다.
[검사 코드](/Users/igyeongseob/Develop/10_herness/notion2md/tests)는 재실행할 수 있다.

`npm run check:export`에서 페이지 3,032개, 내부 링크 22,671개와 첨부 파일 6,453개를 확인했다.
Markdown 이력 쓰기와 동일 내용의 중복 방지 검사도 통과했다.

별도 검사에서 상대 Markdown 링크 15,851개를 실제 웹 라우트 함수로 해석했다.
내부 앵커 1,896개와 본문 자산 참조 6,819회도 대응하는 원본 ID와 파일을 찾았다.
`npm run check:assets`에서 웹 첨부 파일 6,453개를 확인했다.
이 중 6,378개를 더 작은 WebP로 바꿨다.
웹 첨부 파일은 342,669,552바이트이며 원본은 바꾸지 않았다.
GIF 검사가 프레임 차이를 찾으면 원본 GIF를 유지했다.

`npm run build`가 성공했다.
Vite는 지연 로딩하는 편집기와 문법 청크가 500kB를 넘는다고 경고했다.
최종 출력에서 글 3,032개와 첨부 참조 7,099회의 파일 존재를 확인했다.
글 목록 JSON은 6,671,341바이트이며 본문은 글별 파일로 나눴다.

## 실행하지 못한 검사

Chrome 연결 도구가 시작 오류를 반환했다.
실제 화면 비교, 모바일 배치, 클립보드 권한과 실제 한글 입력기는 검증하지 못했다.
DOM 검사는 이 범위를 대신하지 않는다.
Claude 블로그의 정보 구조와 색상 계열을 적용했으며 픽셀 일치는 확인하지 못했다.

## 배포 상태

Vercel 프로젝트는 `notion2md-blog`다.
[최신 검증 배포](https://notion2md-blog-6mrigosj8-gyungsublees-projects.vercel.app)는 로그인 없이 공개하도록 설정했다.

최신 배포 ID는 `dpl_7L9TqhZQ2u6HoJPKbfS45L13Ex29`이며 대상은 `preview`다.
Vercel 검사에서 `Ready`를 확인했다.
원격 빌드 로그는 소스 파일 6,480개 추출과 글 3,032개 생성을 기록했다.
압축 업로드 크기는 320.9MB였다.

명령은 `vercel deploy --archive=tgz --yes --no-wait --scope gyungsublees-projects`를 사용했다.
최초 배포 ID는 `dpl_7BrWTeMGneaZXYSvK1V5p7yfzB98`다.
`--prod`를 사용하지 않았지만 Vercel이 최초 배포를 자동으로 `production`에 지정했다.
최신 배포는 아래 제외 규칙을 수정한 뒤 생성했다.

사용자가 프로젝트의 현재·향후 모든 배포에 적용되는 인증 보호 해제를 명시적으로 승인했다.
2026-10-22 20:30:12 KST에 프로젝트 API를 수정한 뒤 다시 읽었다.
기존 `all_except_custom_domains`에서 `ssoProtection: null`로 바뀐 것을 확인했다.
비밀번호 보호와 IP 보호도 없었다.
이전 자동 승인 거부 이후 사용자 승인을 받아 공개 설정을 적용했다.
로그인 없는 실제 브라우저 접속은 Chrome 연결이 복구되면 확인한다.

배포 URL에 직접 HTTP 요청하는 검사는 실행하지 않았다.
배포 상태와 원격 빌드 로그로 완료를 확인했다.

## 압축 업로드 제외 규칙

최초 배포의 압축 입력에 원본 캐시와 중간 폴더가 포함된 것을 추가 검사에서 확인했다.
설치된 Vercel CLI 58.1.0은 끝에 `/`가 붙은 폴더 규칙의 자식만 제외했다.
이때 남은 빈 폴더 항목을 tar가 다시 재귀로 포장했다.
환경 파일은 직접 파일 규칙으로 제외된 것을 확인했다.

`.vercelignore`의 폴더 규칙에서 끝의 `/`를 제거했다.
수정 후 실제 CLI의 `buildFileTree` 결과와 각 폴더의 재귀 경로를 검사했다.
원본 캐시, 임시 폴더, 로컬 빌드, 환경 파일과 Git 설정은 0개였다.
원격 빌드에 필요한 입력 파일은 모두 포함했다.
검사 시 전체 소스는 6,480개 파일, 365,222,289바이트였다.
공개 첨부는 6,453개, 342,669,552바이트로 일치했다.
환경 파일의 값은 읽거나 출력하지 않았다.

CLI 구현 근거는 `buildFileTree`, 빈 폴더 재추가, `createTgzFiles`의 `entries` 전달이다.
[설치된 CLI 소스](/opt/homebrew/lib/node_modules/vercel/dist/chunks/chunk-DKS4XDVC.js:46143)에서 이 흐름을 확인했다.
공식 제외 규칙의 폴더 예시도 끝의 `/`를 사용하지 않는다.
[Vercel 제외 규칙](https://vercel.com/docs/deployments/vercel-ignore)

다음 명령은 해당 CLI 버전에서 금지 경로가 직접 입력에 남는지 다시 확인한다.
정상 출력은 `[]`다.
전체 검사에서는 디렉터리 입력을 재귀로 펼친 뒤 같은 조건을 검사했다.

```sh
node --input-type=module -e 'import {require_dist} from "/opt/homebrew/lib/node_modules/vercel/dist/chunks/chunk-DKS4XDVC.js"; const {fileList}=await require_dist().buildFileTree(process.cwd(),{isDirectory:true},()=>{}); console.log(fileList.map(p=>p.slice(process.cwd().length+1)).filter(p=>/^(?:\.tmp|dist|content\/raw|public\/content|docs|tests|\.vercel|\.git|\.env)(?:\/|$|\.)/.test(p)));'
```

배포 후 Chrome 문서 복원과 전용 탭 생성을 다시 시도했다.
두 호출 모두 `No such file or directory (os error 2)`로 시작하지 못했다.
임시 경로가 복구된 뒤 전용 Chrome 탭 생성을 다시 시도했다.
이번에는 `The browser access host is unavailable`을 반환했다.
앱 목록은 실행 중인 Chrome을 확인했지만 브라우저 목록은 비어 있었다.
Chrome 탭의 상태·스크린샷·입력을 확인할 연결이 없어 화면·실제 입력 검증은 여전히 미완료다.


## 공개 전환 후 검증 제한

공개 설정을 적용한 뒤 최신 배포의 `Ready` 상태를 다시 확인했다.
전용 Chrome 탭 생성은 계속 `The browser access host is unavailable`을 반환했다.
연결 복구 설정을 확인하려고 앱에 접근했지만 도구가 안전 제한으로 거부했다.
앱 접근 제한을 우회하지 않았다.

사용자가 Chrome 연결을 복구하면 익명 접속, Claude 화면 비교와 작성 흐름을 검증한다.
공식 절차는 앱의 `Settings > Computer Use`에서 Chrome 연결 상태를 확인하도록 안내한다.
Chrome은 확장을 설치한 프로필을 사용해야 한다.
[공식 Chrome 연결 복구 안내](https://learn.chatgpt.com/docs/chrome-extension#troubleshooting)


## Chrome 연결 확인 이후 재개

사용자가 Chrome 연결 완료를 알린 뒤 전용 탭 생성을 다시 시도했다.
첫 상태 조회는 native pipe 시작 실패와 browser host 오류를 반환했다.
도구 세션을 초기화하자 앱 목록은 복구됐지만 브라우저 목록은 비어 있었다.
초기화 후 전용 탭 생성도 `The browser access host is unavailable`을 반환했다.

공식 복구 절차의 다음 단계는 새 ChatGPT Work 또는 Codex 채팅에서 브라우저를 다시 선택하는 것이다.
같은 프로젝트의 새 채팅에서 `@Chrome`을 선택하고 이 문서를 읽어 재개한다.
새 채팅에서도 연결하지 못하면 앱 재시작 또는 공식 지원 확인이 필요하다.
[공식 채팅 연결 복구 절차](https://learn.chatgpt.com/docs/chrome-extension#troubleshooting)

재개할 검증은 다음과 같다.

1. 최신 배포를 Chrome 전용 탭으로 열고 로그인 없이 글을 읽는지 확인한다.
2. Claude 공식 블로그와 목록·상세 화면의 배치, 서체, 간격과 반응형을 비교한다.
3. 실제 원문의 검색, 필터, 페이지 계층, 목차와 내부 링크를 확인한다.
4. 글쓰기에서 슬래시 메뉴, 블록 변환, 복제·이동, 코드 언어·줄바꿈·캡션을 확인한다.
5. 한글 작성, 자동 저장 후 새로고침, Markdown 가져오기와 내보내기를 확인한다.
6. Chrome 탭의 상태·스크린샷·입력 API로 결과를 기록한다.
7. 차이를 수정하면 해당 동작 검사와 빌드를 실행하고 Vercel에 다시 배포한다.

프로젝트의 현재·향후 모든 배포에 대한 인증 보호 해제는 사용자 승인 후 이미 적용했다.
같은 보호 해제 승인을 다시 요청할 필요는 없다.
화면 검증을 통과하기 전에는 Claude 화면 일치나 전체 목표 완료를 주장하지 않는다.
