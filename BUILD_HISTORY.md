# 빌드 이력

현재 공개 버전은 [v0.1.0](https://github.com/gyungsubLee/subdev-blog/releases/tag/v0.1.0)이다.
Git 태그, 소스 커밋, 빌드 실행과 내려받는 파일을 아래 기록으로 연결한다.
시각은 모두 한국 표준시(KST, UTC+09:00)다.

## v0.2.0 — 2026-11-05

`v0.2.0` 후보를 준비했다. 공개와 원격 산출물 검증 결과는 완료 뒤 이 항목에 추가한다.

| 항목 | 값 |
| --- | --- |
| 버전 기준 | `package.json`의 `0.2.0`; lockfile 두 필드 일치 |
| 태그 | `v0.2.0`, 새 주석 태그로 후보 소스를 고정 |
| 구현 보존 커밋 | `4755119`, 완료된 최적화·UI·복구 변경과 당시 원시 측정 근거 |
| 콘텐츠 pin | `9f99941c6b650c70f363208cd97c7191ef785a46`; 3,032글·48분류 |
| 로컬 동작 검사 | `npm run check`: 624/624개 통과 |
| 콘텐츠 검사 | `npm run check:content`: 오류 0개, 참조 첨부 7,255개 |
| HTTP E2E | `npm run check:e2e`: 6/6개 통과, 모의 GitHub |
| 네이티브 검사 | `npm run check:native`: 2/2개 통과 |
| 웹 빌드 | `npm run build` 성공, `build-info.json` 버전 확인 |
| 로컬 macOS 앱 | 기존 빌더 성공, 표시 버전 `0.2.0`, arm64, ad-hoc 서명 검증 |
| 로컬 실행 | 앱을 실행하거나 기존 앱 프로세스를 다시 시작하지 않음 |
| 증거 | [후보 검증](docs/releases/verification/candidate.json), [실행 결과](docs/releases/verification/local-results.json) |
| 최적화 상세 | [측정 조건·수치·원시 근거·제한](docs/releases/v0.2.0-performance.md) |

전체 검사는 버전만 바꾸기 전에 실행했다. 그 뒤 버전 검사와 웹 빌드를 다시 실행했다.
제품 소스의 해시를 대조했다. 태그 Actions 빌드는 고정한 소스를 별도로 검사한다.
과거 원시 로그의 공백과 실패 기록을 보존했다. 제품 코드의 공백 검사는 통과했다.
기존 `public-files.mjs`의 끝 공백과 콘텐츠 서브모듈의 미추적 `.github`는 커밋에서 제외했다.

### 포함한 변경과 실측

[변경 기록](CHANGELOG.md)의 `v0.2.0`과 [최적화 기록](docs/releases/v0.2.0-performance.md)에 누적 변경을 연결한다.
실제 목록 API 3.891→2.030초, 제목 저장의 서버 POST 6.122→1.599초를 기록했다.
즉시 전송 뒤 클릭→원본 확인은 6.682→1.619초였다. 각 값은 당시 3표본 중앙값이다.
카테고리 반복 조회와 별도 화면 반영의 증가, Node 큐 모델의 RSS 한계도 남겼다.
운영 성능과 새 UI 일치 검증으로 확대하지 않는다. main 병합과 운영 배포는 이번 릴리즈에 포함하지 않는다.

## v0.1.0 — 2026-10-22

| 항목 | 값 |
| --- | --- |
| 버전 기준 | `package.json`의 `0.1.0`; lockfile 두 버전 필드와 일치 |
| Git 태그 | [v0.1.0](https://github.com/gyungsubLee/subdev-blog/tree/v0.1.0), 주석 태그 |
| 태그 객체 SHA | `cf2cec40fb05c85910017b0a779efcc755e7e8dd` |
| 실제 소스 커밋 | [c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac](https://github.com/gyungsubLee/subdev-blog/commit/c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac) |
| 공개 릴리스 | [v0.1.0](https://github.com/gyungsubLee/subdev-blog/releases/tag/v0.1.0), 제목도 `v0.1.0` |
| Vercel 배포 | [배포한 블로그](https://notion2md-blog-6mrigosj8-gyungsublees-projects.vercel.app/) |
| 워크플로 | `Versioned build`, `.github/workflows/build.yml` |
| 채택한 빌드 | #2, 실행 `39777303217`, 시도 `2`, 태그 push |
| 빌드 작업 시각 | 2026-10-22 21:22:32 시작, 21:23:13 완료 |
| 검사 | 버전 일치·TypeScript·동작 검사 64/64개·웹 빌드·빌드 정보 6개 필드 일치 |
| 내려받기 | 릴리스의 `subdev-blog-v0.1.0-c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac-run39777303217-attempt2.zip` |
| ZIP 크기 | 377,538,089 bytes |
| ZIP SHA-256 | `c718deaaf4730301d48ce162e29dd171d97b93a6e0236a265defcdeaa7ab7175` |
| 빌드 정보 | 릴리스의 `subdev-blog-v0.1.0-build-info.json` |
| 체크섬 목록 | 릴리스의 `subdev-blog-v0.1.0-SHA256SUMS.txt` |

### 포함한 기능

- 공개 Notion 페이지 3,032개와 첨부 파일 6,453개를 보관한다.
- Markdown에 원본 식별자·속성·계층·내부 링크를 유지한다. LLM이 읽을 인덱스와 문맥 진입점을 제공한다.
- Claude 공식 블로그를 참고한 읽기 화면에 검색·카테고리·페이지 탐색·목차·Markdown 내려받기를 제공한다.
- 블록 편집기에 Notion 입력 규칙·단축키·코드블록 언어 선택·강조·복사·줄바꿈·캡션을 제공한다.
- 브라우저 초안을 자동 저장한다. Markdown과 중첩 블록 JSON을 가져오고 내보낸다.
- Markdown을 CLI로 가져와 웹용 글에 넣는다. 빌드 후 다시 배포하면 공개 사이트에 적용한다.
- 웹용 이미지와 원본 첨부 파일을 따로 보관한다. 빌드에 버전·전체 커밋·실행 정보를 기록한다.

상세 기능과 한계는 [v0.1.0 변경 기록](https://github.com/gyungsubLee/subdev-blog/blob/v0.1.0/CHANGELOG.md)에 고정한다.

### 빌드 실행 기록

같은 실행을 재시도하면 실행 ID와 빌드 번호는 유지되고 시도 번호만 증가한다.
#1과 #3은 수동 검증이며 릴리스 산출물을 업로드하지 않았다.

| 빌드 / 시도 | 소스 커밋 | 시작 → 완료 (2026-10-22 KST) | 결과 | 실행 근거 |
| --- | --- | --- | --- | --- |
| #1 / 1, 수동 | `c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac` | 21:17:14 → 21:17:54 | 검사 64/64개·빌드 성공, 산출물 없음 | [실행 39777085933](https://github.com/gyungsubLee/subdev-blog/actions/runs/39777085933/attempts/1) |
| #2 / 1, 태그 | `c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac` | 21:18:49 → 21:19:13 | 검사 63/64개, 검사 단계 실패로 빌드·업로드 건너뜀 | [실행 39777303217, 시도 1](https://github.com/gyungsubLee/subdev-blog/actions/runs/39777303217/attempts/1) |
| #2 / 2, 태그 재시도 | `c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac` | 21:22:32 → 21:23:13 | 검사 64/64개·빌드 성공, 릴리스에 사용 | [실행 39777303217, 시도 2](https://github.com/gyungsubLee/subdev-blog/actions/runs/39777303217/attempts/2) |
| #3 / 1, 후속 수동 검증 | `149c846c07fb3254fb1367fc1b42aba2f4a6193b` | 21:25:20 → 21:26:04 | 검사 64/64개·빌드 성공, 산출물 없음 | [실행 39778189849](https://github.com/gyungsubLee/subdev-blog/actions/runs/39778189849/attempts/1) |

시작·완료 시각은 GitHub API가 기록한 `build` 작업의 시각이다.

### 첫 실패와 후속 수정

첫 태그 빌드는 `large page tree only mounts expanded branches and keeps title links` 검사에서 실패했다.
검사가 링크 클릭 뒤 10ms만 기다려, JSDOM의 `hashchange` 이벤트 전에 React 화면을 읽은 것이 원인이다.
실패 위치는 `tests/blog.test.mjs:309:51`이며 오류는 `TypeError: Cannot read properties of null (reading 'textContent')`다.

시도 2는 소스나 태그를 바꾸지 않고 같은 커밋을 다시 검사해 통과했다.
이후 [149c846](https://github.com/gyungsubLee/subdev-blog/commit/149c846c07fb3254fb1367fc1b42aba2f4a6193b)에서 고정 대기를 실제 `toggle`·`hashchange` 이벤트 대기로 바꿨다.
이 커밋은 테스트만 바꾸며, 기존 `v0.1.0` 태그와 릴리스 ZIP에는 포함하지 않는다.
후속 소스 검증과 이미 공개한 빌드를 구분한다.

### 산출물 검증과 보관

ZIP은 웹 배포용 정적 빌드다. 본문은 JSON이며 웹용 자산은 342,669,552 bytes다.
원본 Markdown·LLM 인덱스와 전체 원본 첨부 수집본은 별도로 로컬에 보관한다.

[Actions 산출물 12425267683](https://github.com/gyungsubLee/subdev-blog/actions/runs/39777303217/artifacts/12425267683)의 ZIP을 받아 검사했다.
Actions 이름은 `second-brain-v0.1.0-c1af4994464d0cc5c7b4a2d2f5d00813e107f8ac-run39777303217-attempt2`다.

- 실제 ZIP의 SHA-256이 GitHub API digest와 일치한다.
- `build-info.json`의 버전·커밋·실행 ID·빌드 번호·시도 번호·워크플로가 해당 실행과 일치한다.
- 글 인덱스 3,032개와 본문 3,032개의 식별자가 일치한다.
- 자산 6,453개, 342,669,552 bytes와 비어 있지 않은 `index.html`을 확인했다.
- ZIP의 전체 파일 9,530개에서 CRC 오류가 없다.
- 릴리스에 같은 ZIP 바이트를 올렸다. 다시 빌드하거나 재압축하지 않았다.
- 릴리스에서 다시 내려받은 ZIP·빌드 정보·체크섬을 로컬 파일과 대조했다.

Actions 산출물은 7일 보관하며, 만료 시각은 2026-10-29 21:23:06 KST다.
공개 릴리스의 첨부 파일에는 Actions의 7일 보관 기간을 적용하지 않는다.

### 배포와 검증 범위

이 기록은 GitHub 소스·검사·정적 빌드와 릴리스 파일을 검증한 기록이다.
기존 Vercel 배포와 이 ZIP이 같은 빌드라는 주장은 하지 않는다.
실제 Chrome 화면, 모바일 배치, 클립보드 권한과 한글 입력기는 아직 검증하지 못했다.
수집에서 접근 불가 블록 6개와 외부 이미지 실패 23개를 기록했다.

## 다음 빌드를 기록하는 규칙

1. `package.json`, lockfile과 `vMAJOR.MINOR.PATCH` 태그의 버전을 맞춘다.
2. 태그가 가리키는 전체 소스 SHA로 검사와 빌드를 실행한다.
3. 실행 ID·빌드 번호·시도 번호와 실패·성공 결과를 함께 기록한다.
4. 채택한 산출물의 내장 빌드 정보와 실제 바이트의 SHA-256을 확인한다.
5. 해당 태그의 릴리스에 구현 기능·수정·호환성 영향·검사·파일·체크섬을 남긴다.
6. 이 문서에 버전별 실행을 추가하고, 실패 기록과 이미 공개한 태그·파일은 유지한다.

빌드 번호와 시도 번호는 제품 버전으로 사용하지 않는다.
공개한 파일의 내용이 바뀌면 다음 제품 버전과 새 태그를 사용한다.
