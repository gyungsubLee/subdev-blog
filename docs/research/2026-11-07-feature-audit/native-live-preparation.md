# 네이티브 앱 실조작 준비

2026-11-07 KST 기준으로 기존 실행 파일을 재사용하는 검사용 앱을 준비했다.
원본 앱의 `5173` 포트 충돌을 피해 검사용 앱은 `55173`을 사용한다.
실제 창 조작과 OAuth 검사는 상위 에이전트가 맡는다.

## 범위와 실행 소유자

- 하위 에이전트는 `app/native`, `tests/native`와 이 문서를 맡았다.
- 기존 화면, 네이티브 메뉴, 저장 데이터와 성능 보호 수단을 유지한다.
- GUI, Chrome, 실제 OAuth, 원격 쓰기와 전체 검사는 상위 에이전트가 맡는다.
- 이 준비 단계에서는 제품 코드, 원본 앱 번들, 환경 파일과 콘텐츠를 바꾸지 않았다.
- 상위 에이전트가 지정한 검사용 복사본에서 포트만 바꾸고 임시 서명했다.
- 기존 dirty 파일과 다른 에이전트의 변경을 보존했다.

## 원본 앱과 검사용 앱

원본 경로는 `/Users/igyeongseob/Develop/10_harness/subdev-blog/dist/native/Second Brain.app`이다.
`native/dist/Second Brain.app`은 버전 `0.1.0`인 이전 번들이다.

상위 에이전트가 실행할 검사용 경로는 다음과 같다.

`/Users/igyeongseob/Develop/10_harness/subdev-blog/.tmp/live-feature-audit/Second Brain Audit.app`

실행 파일은 이 번들의 `Contents/MacOS/SecondBrain`이다.
상위 에이전트는 실행 프로세스에 `CMS_ORIGIN=http://127.0.0.1:55173`을 전달한다.
준비 담당자는 GUI 실행을 하지 않았다.

| 항목 | 확인한 값 | 근거 |
|---|---|---|
| 프로젝트 | `/Users/igyeongseob/Develop/10_harness/subdev-blog` | 번들 설정의 `sourceRoot` |
| 버전 | `0.2.1` | `package.json`, 웹 `build-info.json`, 번들 `Info.plist`가 일치 |
| 번들 식별자 | `io.subdev.secondbrain` | 번들 `Info.plist` |
| 실행 파일 | `Contents/MacOS/SecondBrain` | 번들 `Info.plist`와 실제 파일 |
| 아키텍처 | `arm64` | `/usr/bin/file` |
| 최소 macOS | `14.0` | 번들 `Info.plist` |
| Node | `/opt/homebrew/bin/node` | 번들 설정의 `node` |
| 포트 | `5173` | 번들 설정의 `port` |
| 웹 빌드 | `dist/web`, `0.2.1` | `2026-11-07T02:39:58+09:00`에 갱신한 `build-info.json` |
| 네이티브 실행 파일 | `2026-11-05T14:24:20+09:00` | 파일 수정 시각 |
| Swift 소스 | `2026-11-04T20:27:19+09:00` | 파일 수정 시각 |

현재 `app/native`와 `tests/native`에는 Git diff가 없다.
상위 에이전트는 최신 웹 빌드의 검증을 완료했다고 전달했다.
번들은 웹 파일을 내장하지 않고 현재 프로젝트의 `dist/web`을 읽는다.
따라서 네이티브 소스와 설정을 유지하면 전체 앱 재빌드는 필요하지 않다.

`/usr/bin/codesign --verify --deep --strict`는 종료 코드 `0`을 반환했다.
이 검사는 서명 유효성을 확인한다. Apple 공증을 뜻하지 않는다.

## 시작 조건과 포트 충돌

`lsof -nP -iTCP:5173 -sTCP:LISTEN`은 PID `10232`의 `node`를 찾았다.
프로세스 작업 폴더는 `/Users/igyeongseob/Develop/08_side/storio_games/homepage`다.
준비 담당자는 이 프로세스를 중단하지 않았다.

네이티브 앱은 `vite preview --host 127.0.0.1 --port 5173 --strictPort`를 시작한다.
앱은 매 시작마다 만든 전용 토큰으로 `/__native/health`를 검사한다.
따라서 다른 서버를 재사용하지 않는다.

현재 번들을 그대로 실행하려면 `5173` 충돌을 먼저 해결해야 한다.
상위 에이전트는 원본 앱에서 예상한 포트 충돌 알림을 직접 확인했다고 전달했다.
상위 에이전트는 다른 프로젝트의 서버를 유지하고 검사용 복사본을 선택했다.
준비 담당자는 원본 앱을 복사한 뒤 `config.json`의 `port`만 `55173`으로 바꿨다.
복사본을 ad-hoc 서명했으며 `codesign --verify --deep --strict`가 종료 코드 `0`을 반환했다.
`Info.plist` 전체와 설정의 `sourceRoot`, `node`는 원본과 같다.
원본 포트는 `5173`으로 유지했다. 복사본 준비 직후 `55173`에는 리스너가 없었다.
상위 에이전트는 `55173`에서 실제 GitHub OAuth, 앱 세션 복귀와 검사용 글의 원격 생성을 완료했다고 전달했다.
준비 담당자는 이 원격 동작을 다시 실행하지 않았다.

앱은 시작 환경을 preview에 전달하며 `SECOND_BRAIN_NATIVE_TOKEN`만 추가한다.
`vite.config.ts`는 `loadEnv`로 읽은 `CMS_ORIGIN`을 API와 네이티브 로그인 기준 주소로 쓴다.
환경 파일의 비밀 값, 로그인 토큰과 cookie는 이 문서에 저장하지 않았다.

## 실행 흐름과 보호 수단

1. 앱은 설정, Node 실행 권한과 웹 빌드 존재를 검사한다.
2. 앱은 자기 소유 preview 프로세스를 시작한다.
3. 앱은 전용 health 응답을 확인한 뒤 기존 홈을 연다.
4. 앱을 종료하면 자기 소유 프로세스, 로그 핸들과 로그인 흐름을 정리한다.

서버 시작 기한은 30초다. health 요청 기한은 1초이며 확인 간격은 0.2초다.
로그인 요청 기한은 5초다. 완료 대기 기한은 600초이며 조회 간격은 1초다.
전송 실패와 서버 오류는 최대 두 번 재시도한다.
`401`, `403`, `410`은 같은 방식으로 재시도하지 않는다.

로그 경로는 `.tmp/native/server.log`다.
앱은 기본 WebKit 저장소를 사용하며 창 위치를 `Second BrainMainWindow`로 저장한다.
WebKit이 실제로 선택한 디스크 경로와 현재 cookie·초안 값은 열지 않았다.
사용자 콘텐츠를 앱 번들에 복사하지 않는 기존 조립 방식을 유지한다.

## 상위 에이전트가 실행할 검사

| 검사 | 조작 | 통과 근거 |
|---|---|---|
| 실제 창 | 정확한 번들을 실행한다. | `Second Brain` 창, 기존 화면, `0.2.1` 웹 빌드를 확인한다. |
| 뒤로 | 홈에서 기존 글을 연 뒤 툴바 또는 `⌘[`를 누른다. | 직전 화면으로 이동하고 기존 내용이 유지된다. |
| 앞으로 | 뒤로 이동한 뒤 툴바 또는 `⌘]`를 누른다. | 같은 글로 돌아간다. |
| 홈 | 글 또는 관리 화면에서 툴바나 `⇧⌘H`를 누른다. | 설정한 loopback origin의 기존 홈이 나온다. |
| 새로고침 | 읽기 화면에서 툴바 또는 `⌘R`을 누른다. | 같은 화면을 다시 표시하며 서버를 추가로 만들지 않는다. |
| 외부 링크 | 기존 글의 외부 HTTPS 링크를 누른다. | 기본 브라우저가 그 주소를 열고 앱의 원래 화면은 유지된다. |
| 로그인 복귀 | 기존 로그인 버튼으로 실제 GitHub 로그인을 완료한다. | 브라우저 완료 뒤 앱이 앞으로 나오며 인증한 관리 기능을 사용할 수 있다. |
| 실제 다운로드 | 기존 편집기의 `저장·내보내기`에서 `.md 내보내기`를 누른다. | 네이티브 저장 패널을 조작하고 저장한 실제 파일의 내용·크기를 확인한다. |
| 다운로드 취소 | 같은 저장 패널을 취소한다. | 기존 편집 내용이 유지되고 대상 파일이 생기지 않는다. |
| 앱 종료 | `⌘Q`로 종료한다. | 앱 소유 preview만 종료하고 기존 콘텐츠·초안은 유지한다. |
| 재실행 | 같은 번들을 다시 실행한다. | 기존 저장 상태와 창을 다시 읽고 하나의 preview만 시작한다. |

다운로드 파일은 준비 담당자가 만들지 않았다.
상위 에이전트는 task 전용 폴더에 저장하고 기존 파일을 덮어쓰지 않아야 한다.
로그인 중 새로고침은 기존 흐름을 취소하고 새 흐름을 시작하는 동작이다.
로그인 중 뒤로·앞으로·홈은 로그인 흐름을 취소한다.
이 동작도 실제 조작 결과와 구분해 기록해야 한다.

## 실행한 검사와 미확인 항목

- 번들 존재, 설정의 허용한 세 필드, 메타데이터와 파일 수정 시각을 읽었다.
- `file`, `codesign`, 포트 리스너와 프로세스 작업 폴더를 확인했다.
- 검사용 복사본의 설정 변경 키가 `port` 하나인지 확인했다.
- 원본과 검사용 복사본의 메타데이터와 파일 목록이 같은지 확인했다.
- 검사용 복사본의 재서명과 서명 검사를 실행했다.
- 소스에서 메뉴, 링크, 로그인, 다운로드와 프로세스 정리 흐름을 읽었다.
- 이 단계에서는 Python·Node 검사를 다시 실행하지 않았다.
- 네이티브 소스가 그대로이므로 이전 자동 검사 근거는 기존 `content-native.md`를 참조한다.
- 실제 창, OAuth 복귀, 파일 저장, 앱 종료와 재실행은 아직 확인하지 못했다.
- 실행 경로를 바꾸지 않아 전후 성능 검사를 새로 실행하지 않았다.
- 프로젝트 문맥 검사는 기존 `INDEX.md` 크기 초과로 실패했다. 문맥 파일은 바꾸지 않았다.

다음 행동은 상위 에이전트가 검사용 앱을 `55173` origin으로 실행하고 실제 조작을 검사하는 것이다.

## 다운로드 저장 버튼 조사

상위 에이전트는 실제 `.md 내보내기`에서 저장 패널을 열었다.
패널의 `Save` 버튼이 처음부터 비활성 상태였다고 보고했다.
기본 `Documents`, task 전용 폴더와 `/private/tmp`에서 같은 상태를 관찰했다.
실제 ASCII 키 입력으로 파일명을 바꾼 뒤에도 버튼은 비활성 상태였다.
이 결과는 실제 파일 저장 실패다. 패널을 열었다는 사실만으로 다운로드 통과를 주장하지 않는다.

현재 원인은 확인하지 못했다.
조사 담당자는 제품 수정, GUI 조작, 빌드와 새 다운로드를 실행하지 않았다.
상위 에이전트는 원본 시트 상태를 보존하고 다른 검사를 계속한다.

### 공식 계약과 현재 구현

`WKDownloadDelegate`와 `NSSavePanel`의 공식 계약은 `@MainActor`다.
현재 앱은 다운로드 delegate를 설정한 뒤 목적지 callback에서 저장 패널을 연다.
시트 완료 callback은 목적지 URL 또는 `nil`을 WebKit에 전달한다.
실제 callback의 스레드는 측정하지 않았다. 근거 없이 main queue 처리를 추가하지 않는다.
[WKDownloadDelegate](https://developer.apple.com/documentation/webkit/wkdownloaddelegate), [NSSavePanel](https://developer.apple.com/documentation/appkit/nssavepanel).

`allowedContentTypes`의 기본 빈 배열은 모든 파일 형식을 허용한다.
따라서 현재 `.md` 형식 지정이 없다는 사실은 버튼 비활성화의 근거가 아니다.
파일 형식을 추가하는 수정은 보류한다.
[allowedContentTypes](https://developer.apple.com/documentation/appkit/nssavepanel/allowedcontenttypes).

현재 WebKit 공개 소스는 목적지 완료 block에서 다운로드의 `Ref`를 보유한다.
앱의 시트 완료 closure도 `panel`을 캡처한다.
따라서 다운로드나 패널을 무조건 별도 속성에 보유하는 수정은 현재 근거가 약하다.
이 공개 소스를 설치한 WebKit 바이너리의 실행 증거로 취급하지 않는다.
[WebKit WKDownload.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKDownload.mm#L106).

WebKit은 기존 디렉터리 안의 아직 존재하지 않는 파일 URL을 요구한다.
이 검사는 패널 완료 뒤 전달한 목적지에 적용된다.
저장 버튼이 처음부터 비활성인 원인을 이 조건만으로 설명하지 못한다.
[목적지 callback 계약](https://developer.apple.com/documentation/webkit/wkdownloaddelegate/download(_:decidedestinationusing:suggestedfilename:completionhandler:)).

### 프로세스와 서명에서 확인한 사실

- 상위 에이전트는 검사용 앱을 `require_escalated`로 실행했다고 확인했다.
- 원본과 검사용 앱의 서명에는 entitlement 항목이 없었다.
- 두 번들 모두 `com.apple.security.app-sandbox`가 설정되지 않았다.
- 실행한 네이티브 앱은 PID `81221`, 자기 소유 preview는 PID `81288`이었다.
- preview의 `.tmp/native/server.log`는 40bytes, 1줄이었다.
- 그 로그에서 저장 패널, ViewBridge, sandbox 거절과 다운로드 오류 표시는 없었다.
- 네이티브 앱의 표준 출력과 오류는 상위 에이전트가 소유한 실행 세션의 파이프다.

조사 담당자는 실행 세션의 출력을 중복 소비하지 않았다.
서명이나 파일 접근 entitlement가 이번 원인이라고 확정할 근거는 없다.
앱 로그, cookie, 토큰과 OAuth URL을 문서에 복사하지 않았다.

### 다음 진단의 최소 범위

다음 다운로드를 시도하기 전에 상위 에이전트가 기존 앱 세션의 오류 출력을 확인한다.
`NSSavePanel`, `ViewBridge` 또는 XPC 오류가 있으면 그 오류부터 조사한다.
실행 중인 앱과 자식 프로세스를 정리하지 않고 같은 실행을 중복 시작하지 않는다.

추가 계측이 필요하면 검사용 복사본에서 다음 값만 기록한다.
제품 화면이나 원본 앱에는 진단 기능을 추가하지 않는다.

- 목적지 callback의 `Thread.isMainThread`.
- 제안한 파일명의 길이와 금지 문자 포함 여부.
- 패널의 형식 개수, `allowsOtherFileTypes`와 시트 연결 여부.
- 시트 완료 결과와 목적지 URL 존재 여부.
- 다운로드 완료 여부 또는 실패의 `NSError.domain`, `NSError.code`.

파일명, 파일 내용, 전체 경로, cookie와 토큰은 기록하지 않는다.
원인을 확인하기 전에는 강제 버튼 활성화, 파일 형식 추가와 객체 보유 변경을 적용하지 않는다.
다음 행동은 상위 에이전트가 기존 실행 세션의 오류를 확인한 뒤 한 번의 다운로드 재검사 조건을 정하는 것이다.
