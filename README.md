# Second Brain

현재 버전은 `v0.2.0`이다. [변경 기록](CHANGELOG.md)에 구현 기능과 검증 한계를 기록한다.

공개 Notion 블로그를 Markdown 콘텐츠 저장소로 보관하고 웹에서 읽는다.
글과 카테고리 조회는 공개한다. 원본 생성·수정·삭제는 본인 GitHub 인증과 저장소 연결 확인 뒤 허용한다.
배포 대상은 Vercel이다. 사용자 승인에 따라 프로젝트의 현재·향후 모든 배포에서 인증 보호를 해제했다.

[배포한 블로그](https://notion2md-blog-ehkytcr6k-gyungsublees-projects.vercel.app)는 로그인 없이 공개하도록 설정했다.
수집 결과와 검증 범위는 [수집·배포 기록](docs/guides/MIGRATION.md)에 있다.
기존 글의 서식 수정과 실행한 검사는 [Markdown 표시 수정 기록](docs/research/markdown-rendering-repair.md)에 있다.

## 로컬 실행

```sh
git submodule update --init --recursive
npm ci
npm run dev
```

개발 서버는 명령 출력의 주소에서 연다. 원본은 `content/posts/<글 ID>/<실제 제목>.md`에 있다.
각 글의 이미지는 Markdown과 같은 폴더에 둔다. 본문은 `./이미지.webp` 같은 상대경로로 이미지를 참조한다.
빌드는 앱이 기록한 submodule 커밋을 기준 목록으로 사용한다. 빌드에서 원격 최신 브랜치를 자동으로 가져오지 않는다.
일반 글 조회는 `/api/public`이 콘텐츠 저장소의 기준 브랜치에서 읽는다.
글을 저장해도 앱을 다시 빌드하거나 배포하지 않는다. 이 전환 코드는 운영 전에 한 번 배포해야 한다.
콘텐츠 원격은 [subdev-blog-content](https://github.com/gyungsubLee/subdev-blog-content)다. 연결 검증 상태는 이전 기록에서 확인한다.
`content/posts.json`과 `content/written/`는 이전 입력이며 현재 빌드의 원본이 아니다.

## 기록과 카테고리

Second Brain 로고는 기존 홈 `#/`를 연다. 상단의 `기록`은 `#/records`를 연다.
기록 화면은 사이드바에서 분류를 탐색한다. 글 상세와 홈을 왕복해도 검색어·분류·표시 개수를 유지한다.

`카테고리 관리`는 GitHub 로그인과 저장소 연결 확인 뒤 `#/categories`를 연다. 로그인 전에는 관리 메뉴와 화면을 숨긴다.
기존 트리 UI에서 분류 추가·이름 변경·상위 분류 이동·순서 변경·삭제를 원본 `categories.json`에 저장한다.
공개 글의 분류 표시와 필터는 로그인 없이 사용할 수 있다.
기존 브라우저의 개인 분류 설정은 보존한다. 정식 카테고리를 표시하거나 저장할 때 개인 별칭으로 덮어쓰지 않는다.

## 이전 수집 보관본

다음은 기존 수집기의 보관 구조다. 현재 웹 빌드의 콘텐츠 submodule과 구분한다.
보관 위치는 `/Users/igyeongseob/Knowledge/SecondBrain/notion-blog`다.

LLM은 `index.md`에서 주제를 찾고 필요한 글을 읽는다. `pages.md`는 전체 계층을 보여준다.
각 글은 원본 ID, URL, 부모 ID, 날짜와 데이터베이스 속성을 frontmatter에 보존한다.
이미지와 첨부 파일의 원본은 `assets`에 보관한다.
웹 이미지는 별도로 최적화하며 원본을 바꾸지 않는다. 내부 링크는 상대 경로를 사용한다.

`manifest.json`에서 접근 불가 항목과 자산 실패를 확인한다.
`notion-records.json`은 원본 블록을 확인할 때 사용한다.

기존 `export`·`prepare:assets`와 Markdown 복구 CLI는 전환 뒤 쓰기를 중단한다.
`check:export`·`check:assets`는 이전 전 백업 환경을 검사하는 명령이다. 새 체크아웃의 필수 검사가 아니다.
수집·재변환 기능을 새 콘텐츠 구조에 연결하는 작업은 보류한다.
Notion의 공개 API는 비공식 인터페이스다. 공개하지 않은 페이지는 기존 수집 범위에 포함하지 않았다.

## 글 작성과 게시 범위

상단의 GitHub 아이콘이 있는 `로그인` 버튼으로 로그인한다. 서버가 본인 계정·App 설치·저장소·브랜치를 확인한다.
연결이 준비되면 `글쓰기`와 글 상세의 `수정`을 사용할 수 있다.
상단의 로그인 버튼은 글쓰기 버튼으로 바뀐다. 연결 재확인 버튼과 설정 오류 문구는 상단에 표시하지 않는다.
새 글과 편집 원본이 있는 글은 기존 노션형 블록 편집기로 작성한다.
저장하면 같은 글 폴더의 `<제목>.md`와 `editor.json`을 한 Git 커밋으로 기록한다.
`editor.json`은 블록 구조와 설정을 보존한다. Markdown은 같은 편집 내용에서 생성하며 블로그의 공개 본문으로 사용한다.
JSON이 없는 기존 글은 원문 Markdown으로 편집한다. 블록 편집 전환은 사용자가 선택한다.
제목만 수정하면 본문과 확장 메타데이터를 보존한다. 기존 블록 초안과 브라우저 자동 저장은 유지한다.

편집 JSON은 버전·글 ID·본문 SHA-256으로 Markdown과 연결한다. 원문이 외부에서 바뀌면 불일치를 알리고 덮어쓰기를 중단한다.
`editor.json`은 예약 파일이며 첨부 업로드와 공개 첨부에서 제외한다. 공개 콘텐츠 저장소에 저장한 원본 자체는 GitHub에서 공개된다.
저장 계약과 검증 기준은 [노션형 편집기 저장 설계](docs/superpowers/specs/2026-10-25-block-editor-storage-design.md)에 있다.

`원본 저장`은 콘텐츠 저장소의 `cms/requests/<요청 UUID>`에 후보 커밋을 만든다.
서버는 문서 형식·권한·수정 충돌을 확인하고 콘텐츠 브랜치를 fast-forward로 갱신한다.
저장 성공은 기준 브랜치에 커밋이 포함됐는지 확인한 뒤 표시한다. 앱 커밋·Actions 실행·Vercel 배포를 만들지 않는다.
응답을 잃으면 같은 요청 ID로 결과를 확인하고 재시도한다. 편집한 초안은 보존한다.
완료한 저장은 화면의 글 목록·본문·분류를 새 콘텐츠 커밋으로 다시 읽는다.
기존 `publish-content.yml`은 수동 작업용으로 남지만 웹 저장 경로에서 호출하지 않는다.
글 삭제는 하위 글·참조가 없을 때 허용한다. 카테고리 삭제는 하위 분류·직접 배정한 글이 없을 때 허용한다.
`group:unclassified`는 삭제하지 않는다. 첨부 하나의 최대 크기는 5MiB다.

`npm run import:md`는 새 정식 Markdown을 콘텐츠 submodule에 게시하는 명령이 아니다.
전환 뒤에는 기존 JSON 쓰기를 차단한다.
기존 작성 기능의 설명은 [Notion 작성 UX](docs/guides/notion-writing-ux.md)에 있다.

## GitHub 로그인과 저장 초기 설정

조회·저장 변경의 계약은 [설계서](docs/superpowers/specs/2026-10-25-github-runtime-content-design.md)에 있다.
아래 설정을 마치기 전에는 관리 기능을 차단한다. 공개 조회는 로그인 설정과 독립한다.

1. 본인 계정에 GitHub App을 등록한다. Webhook은 사용하지 않는다.
2. Repository permissions는 `Contents: Read and write`와 기본 `Metadata: Read-only`를 사용한다.
3. 사용자 access token 만료를 켠다. Callback URL은 `<CMS_ORIGIN>/api/auth/callback`으로 등록한다.
4. App을 `gyungsubLee/subdev-blog`와 `gyungsubLee/subdev-blog-content` 두 저장소에만 설치한다.
5. App ID·Client ID·Client secret·설치 ID와 본인 숫자 사용자 ID를 기록한다. 두 저장소의 숫자 ID와 브랜치명도 확인한다.
6. [.env.example](.env.example)을 `.env.local`로 복사하고 값을 채운다. `CMS_SESSION_KEY`는 예시 명령으로 새로 만든다.
7. Vercel에도 같은 서버 변수를 등록한다. HTTPS 주소를 사용하고 `CMS_ORIGIN`과 로그인하는 주소를 정확히 맞춘다.

기존 App의 `Actions: Read and write`는 호환하지만 웹 저장에 필수는 아니다. 관리 연결은 활성 workflow를 요구하지 않는다.
앱 브랜치는 저장소의 기본 브랜치를 사용한다. 콘텐츠 브랜치 보호는 App의 fast-forward 커밋을 허용해야 한다.
강제 푸시는 사용하지 않는다. 공개 읽기 토큰은 아래 공개 조회 설명을 따른다.
개발 주소는 `http://127.0.0.1:5173`이다. 개발 App이나 같은 주소의 Callback URL을 등록한다.
비밀값에는 `VITE_` 접두사를 붙이지 않는다. `CMS_SESSION_KEY`를 바꾸면 기존 로그인을 만료시킨다.

웹 저장에는 Actions secrets, App private key와 Vercel 배포 토큰이 필요하지 않다.
수동 게시 workflow를 사용할 때만 기존 Actions 설정을 유지한다.
`vercel.json`의 `git.deploymentEnabled:false`는 Git 푸시의 자동 배포를 막는다.
실제 로그인·권한 취소·원격 저장은 설정한 환경에서 별도로 확인한다.

## 콘텐츠 구조

`content/`는 별도 콘텐츠 Git 저장소의 고정 커밋을 가리킨다.
`categories.json`은 카테고리 계층을 정의한다. 각 글의 frontmatter는 ID·부모·순서·분류와 AI 메타데이터를 보관한다.
분류나 부모가 바뀌어도 글 폴더와 형제 이미지를 이동하지 않는다.
정식 글 조회는 콘텐츠 서브모듈의 글별 첨부를 사용한다. 중복된 `public/notion` 자산과 매핑 파일은 제거했다.

공개 API는 frontmatter를 본문과 분리한 뒤 허용한 공개 필드만 출력한다. 일반 빌드는 콘텐츠와 첨부파일의 정적 복사본을 생성하지 않는다.
AI 메타데이터와 원문 확장 필드는 원본에 보존하며 공개 목록·본문·다운로드에 포함하지 않는다.
공개 콘텐츠 저장소에서는 frontmatter를 읽을 수 있다. 비공개 메모와 로컬 LLM wiki는 저장소 밖에 둔다.
LLM wiki의 색인·근거 계약은 콘텐츠 저장소 문서에 보관한다. 생성기와 AI 실행 기능은 구현하지 않는다.

## 공개 콘텐츠 조회

`GET /api/public?kind=index`는 공개 글 목록·분류·콘텐츠 커밋을 반환한다.
`GET /api/public?kind=post&id=<UUID>&commit=<SHA>`는 같은 커밋의 본문을 반환한다.
첨부파일은 공개 콘텐츠 저장소의 같은 커밋에 고정한 raw 주소를 사용한다.
로그인 설정이 없어도 공개 조회는 동작한다. 서버는 저장소가 공개인지 확인하고 다른 저장소를 요청으로 받지 않는다.

서버는 기준 브랜치를 최대 30초 동안 캐시한다. 자신의 저장 직후에는 새 커밋을 기준으로 캐시를 다시 확인한다.
GitHub 오류와 제한 초과는 화면에 오류로 표시한다. 이전 빌드의 글로 몰래 대체하지 않는다.
서버 전용 `GITHUB_PUBLIC_TOKEN`을 설정하면 GitHub API의 인증된 호출 한도를 사용할 수 있다.
토큰은 콘텐츠 저장소의 읽기 권한만 부여한다. 토큰을 프런트엔드 설정이나 번들에 넣지 않는다.
토큰이 없으면 공개 읽기를 시도한다. 익명 한도 때문에 트래픽이 늘면 조회가 제한될 수 있다.

빌드는 서버 전용 `app/server/generated/content-catalog.json`에 원본 요약과 Git blob ID를 기록한다.
서버는 GitHub의 실제 트리와 이 기준을 비교해 바뀐 Markdown만 다시 읽는다. 본문은 요청한 글만 내려받는다.
이 파일은 서버 함수의 입력이며 `public/`와 앱 Git에 넣지 않는다. 원본 메타데이터를 공개 응답으로 내보내지 않는다.
함수 번들은 기준 목록만 포함한다. 원본 콘텐츠·공개 첨부·테스트·문서는 함수 번들에서 제외한다.
앱 릴리스 때 submodule 기준을 갱신하면 빌드 이후 변경분을 읽는 비용도 줄어든다.

## 검사와 빌드

```sh
npm run check
npm run check:content
npm run build
```

`check`는 TypeScript와 DOM 기반 동작 검사를 실행한다.
`check:content`는 선택한 콘텐츠의 글·부모·분류·첨부를 실제로 읽고 검사한다.
배포 빌드는 submodule이 없거나 커밋이 맞지 않으면 중단한다. 이전 JSON으로 자동 대체하지 않는다.
실행한 검사와 검증 한계는 [이전 기록](docs/guides/MIGRATION.md)에 구분해 적는다.
2026-10-24 KST에 새 체크아웃에서 검사 244개와 빌드를 통과했다. 글 3,032개·카테고리 47개·참조 첨부 7,255개를 확인했다.

## 버전과 빌드 산출물

버전의 기준은 `package.json`이다. `package-lock.json`과 Git 태그를 같은 버전으로 맞춘다.
`npm run check:version`은 두 파일의 버전을 검사한다. 태그 빌드에서는 `v<버전>`과 태그도 비교한다.

`v*` 태그를 푸시하면 GitHub Actions가 검사와 빌드를 실행한다.
수동 실행은 저장소의 Actions에서 검사와 빌드를 실행한다.
태그 빌드는 산출물을 업로드한다. 이름에는 버전, 전체 커밋 SHA, 실행 ID와 재시도 번호가 들어간다.
산출물은 7일 동안 보관한다.

빌드는 `dist/web/build-info.json`에 버전과 빌드 출처를 기록한다.
GitHub Actions에서는 커밋 SHA, 실행 ID, 실행 번호, 재시도 번호와 workflow 이름을 기록한다.
출처에는 앱 커밋과 `contentCommit`을 구분해 기록한다.
앱 밖 staging을 사용하는 로컬 검증의 콘텐츠 커밋은 `null`이다. Git 정보 없는 배포 입력은 `CONTENT_COMMIT_SHA`가 필요하다.

앱 Git에는 코드·문서와 콘텐츠 submodule의 gitlink를 보관한다. 정식 Markdown과 형제 첨부는 콘텐츠 Git에 보관한다.
서버 생성 데이터, 빌드 결과, 수집 캐시, 임시 파일과 환경 파일은 앱 Git에서 제외한다.

## 구현

소스는 화면 조립, 기능, 공통 컴포넌트와 공유 코드로 나눈다.

```text
app/
├── web/            # React 웹 앱. src/site가 전체 화면과 라우팅을 조합한다.
├── server/         # API, 인증, GitHub 연동, 캐시와 서버 생성 데이터
├── content/        # 콘텐츠 검증, 변환, 저장과 CLI
├── native/         # Swift macOS 앱과 빌드
└── shared/         # 실행 환경 사이의 공용 문서 처리
content/            # 글별 Markdown, 편집 데이터, 첨부파일 원본 서브모듈
tests/              # web, server, content, native, support
docs/               # 현재 구조, 실행 안내, 설계와 검증 기록
scripts/            # 프로젝트 전체 버전 검사와 배포 조정
dist/               # web, native 빌드 결과
```

[폴더 구조 기준](docs/architecture/project-structure.md)과 [실행 안내](docs/guides/development.md)를 따른다.
루트 `api/index.js`는 Vercel 탐색을 위한 연결 파일이다. 실제 진입점은 `app/server/api/index.js`다.
서버용 목록은 `app/server/generated/`에 생성한다. `app/web/public/`에는 앱 자체의 정적 자산만 둔다.
정적 콘텐츠 내보내기는 `npm run export:static`으로만 실행한다. 일반 개발 및 빌드는 이를 실행하지 않는다.


검색·분류·표시 개수의 상태는 `site/BlogView`에서 조합한다. 상세 화면을 열어도 이 상태를 유지한다.
CSS는 소유 페이지·기능·컴포넌트 옆에 둔다. 기능별 수치는 각 기능의 `config.ts`에 둔다.
기본 CSS는 앱보다 먼저 불러온다. 앱 로딩·오류 CSS는 편집기를 열기 전에도 불러온다.
공유 문서 코드는 DOM에 의존하지 않으므로 CLI에서도 사용한다.

- React와 Vite로 블로그를 만든다.
- 목록 요약을 먼저 받고 선택한 글의 본문을 따로 받는다.
- BlockNote를 필요할 때 불러와 편집기를 연다.
- 입력 규칙과 키맵은 Notion 문서를 기준으로 보완했다.
- Markdown의 HTML은 sanitize를 통과한 뒤 표시한다. 수식은 KaTeX로 표시한다.
- 초안이 손상됐거나 저장에 실패하면 기존 데이터를 덮어쓰지 않는다.

[디자인 근거](docs/architecture/design-reference.md)는 Claude 공식 블로그의 정보 구조와 화면 검증 제한을 기록한다.
