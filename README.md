# Second Brain

현재 버전은 `v0.1.0`이다. [변경 기록](CHANGELOG.md)에 구현 기능과 검증 한계를 기록한다.

공개 Notion 블로그를 Markdown 콘텐츠 저장소로 보관하고 웹에서 읽는다.
글과 카테고리 조회는 공개한다. 원본 생성·수정·삭제는 본인 GitHub 인증과 저장소 연결 확인 뒤 허용한다.
배포 대상은 Vercel이다. 사용자 승인에 따라 프로젝트의 현재·향후 모든 배포에서 인증 보호를 해제했다.

[배포한 블로그](https://notion2md-blog-ehkytcr6k-gyungsublees-projects.vercel.app)는 로그인 없이 공개하도록 설정했다.
수집 결과와 검증 범위는 [수집·배포 기록](docs/MIGRATION.md)에 있다.
기존 글의 서식 수정과 실행한 검사는 [Markdown 표시 수정 기록](docs/markdown-rendering-repair.md)에 있다.

## 로컬 실행

```sh
git submodule update --init --recursive
npm ci
npm run dev
```

개발 서버는 명령 출력의 주소에서 연다. 원본은 `content/posts/<글 ID>/<실제 제목>.md`에 있다.
각 글의 이미지는 Markdown과 같은 폴더에 둔다. 본문은 `./이미지.webp` 같은 상대경로로 이미지를 참조한다.
앱이 기록한 submodule 커밋을 사용한다. 빌드에서 원격 최신 브랜치를 자동으로 가져오지 않는다.
콘텐츠 원격은 [subdev-blog-content](https://github.com/gyungsubLee/subdev-blog-content)다. 연결 검증 상태는 이전 기록에서 확인한다.
`content/posts.json`과 `content/written/`는 이전 입력이며 현재 빌드의 원본이 아니다.

## 기록과 카테고리

Second Brain 로고는 기존 홈 `#/`를 연다. 상단의 `기록`은 `#/records`를 연다.
기록 화면은 사이드바에서 분류를 탐색한다. 글 상세와 홈을 왕복해도 검색어·분류·표시 개수를 유지한다.

`카테고리 관리`는 GitHub 로그인과 저장소 연결 확인 뒤 `#/categories`를 연다. 로그인 전에는 관리 메뉴와 화면을 숨긴다.
기존 트리 UI에서 분류 추가·이름 변경·상위 분류 이동·순서 변경·삭제를 원본 `categories.json`에 저장한다.
공개 글의 분류 표시와 필터는 로그인 없이 사용할 수 있다.
기존 브라우저의 개인 분류 설정은 보존한다. 정식 카테고리를 표시하거나 저장할 때 개인 별칭으로 덮어쓰지 않는다.
`페이지 탐색`은 기존 원문 계층을 사용한다.

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

상단의 GitHub 아이콘이 있는 `로그인` 버튼으로 로그인한다. 서버가 본인 계정·App 설치·저장소·브랜치·게시 workflow를 확인한다.
연결이 준비되면 `글쓰기`와 글 상세의 `수정`을 사용할 수 있다.
상단의 로그인 버튼은 글쓰기 버튼으로 바뀐다. 연결 재확인 버튼과 설정 오류 문구는 상단에 표시하지 않는다.
정식 글은 원문 Markdown으로 편집한다. 제목만 수정하면 본문과 확장 메타데이터를 보존한다.
기존 블록 초안과 브라우저 자동 저장은 유지한다. 기존 블록 초안은 기존 편집기로 연다.

`원본 저장`은 콘텐츠 저장소의 `cms/requests/<요청 UUID>`에 후보 커밋을 만든다.
`publish-content.yml`은 전체 콘텐츠를 검증한 뒤 원본 브랜치와 앱의 submodule 커밋을 순서대로 갱신한다.
앱 커밋은 검사와 빌드가 성공한 뒤 푸시한다. 이후 Vercel preview를 만들고 실제 응답의 앱·콘텐츠 SHA와 파일을 확인한다.
화면은 검증 중, 원본 저장 완료, 게시 대기, 게시 완료와 실패를 구분한다. 실패한 요청은 같은 요청으로 재시도한다.
글 삭제는 하위 글·참조가 없을 때 허용한다. 카테고리 삭제는 하위 분류·직접 배정한 글이 없을 때 허용한다.
`group:unclassified`는 삭제하지 않는다. 첨부 하나의 최대 크기는 5MiB다.

`npm run import:md`는 새 정식 Markdown을 콘텐츠 submodule에 게시하는 명령이 아니다.
전환 뒤에는 기존 JSON 쓰기를 차단한다.
기존 작성 기능의 설명은 [Notion 작성 UX](docs/notion-writing-ux.md)에 있다.

## GitHub 로그인과 게시 초기 설정

구현 계약은 [설계서](docs/superpowers/specs/2026-10-24-github-content-management-design.md)와 [실행 계획](docs/superpowers/plans/2026-10-24-github-content-management.md)에 있다.
아래 설정을 마치기 전에는 관리 기능을 차단한다. 공개 조회는 계속 동작한다.

1. 본인 계정에 GitHub App을 등록한다. Webhook은 사용하지 않는다.
2. Repository permissions를 `Contents: Read and write`, `Actions: Read and write`, 기본 `Metadata: Read-only`로 한정한다.
3. 사용자 access token 만료를 활성화한다. Callback URL은 `<CMS_ORIGIN>/api/auth/callback`으로 등록한다.
4. App을 `gyungsubLee/subdev-blog`와 `gyungsubLee/subdev-blog-content` 두 저장소에만 설치한다.
5. App ID·Client ID·Client secret·설치 ID와 본인 숫자 사용자 ID를 기록한다. 두 저장소의 숫자 ID와 실제 브랜치명도 확인한다.
6. [.env.example](.env.example)을 `.env.local`로 복사하고 값을 채운다. `CMS_SESSION_KEY`는 예시 명령으로 새로 만든다.
7. Vercel의 해당 환경에도 같은 서버 변수를 등록한다. 운영·preview 주소는 HTTPS를 사용하고 `CMS_ORIGIN`과 로그인하는 주소를 정확히 맞춘다.
8. 앱 저장소의 Actions에 아래 secrets와 variables를 등록한다. Private key는 Vercel 환경에 넣지 않는다.

| 위치 | 이름 |
| --- | --- |
| Actions secrets | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |
| Actions variables | `GITHUB_INSTALLATION_ID`, `GITHUB_APP_REPOSITORY_ID`, `GITHUB_CONTENT_REPOSITORY_ID`, `GITHUB_APP_BRANCH`, `GITHUB_CONTENT_BRANCH` |
| Vercel 서버 환경 | `.env.example`의 주석 처리하지 않은 모든 이름 |

앱 브랜치는 저장소의 기본 브랜치여야 한다. 해당 브랜치에 게시 workflow가 있어야 연결 확인을 통과한다.
브랜치 보호 규칙은 App의 정상 fast-forward 커밋을 허용해야 한다. 강제 푸시는 사용하지 않는다.
개발 주소는 `http://127.0.0.1:5173`이다. 별도 개발 App이나 해당 주소의 Callback URL을 등록하고 개발 서버를 다시 시작한다.
비밀값에는 `VITE_` 접두사를 붙이지 않는다. `CMS_SESSION_KEY`를 바꾸면 기존 로그인을 만료시킨다.

초기 게시 대상은 preview다. `vercel.json`의 `git.deploymentEnabled: false`로 Git 푸시의 자동 배포를 막고 Actions에서 preview를 만든다.
이 설정은 [Vercel의 Git 배포 설정](https://vercel.com/docs/project-configuration/git-configuration)을 따른다.
운영 배포 전환은 별도 승인 뒤 진행한다. 공개 preview 응답을 검사하므로 Vercel 인증 보호가 켜져 있으면 검증이 실패한다.
실제 GitHub 로그인·권한 취소·검증용 생성·수정·삭제·preview 검증은 App과 secrets를 등록한 환경에서 수행해야 한다.

## 콘텐츠 구조

`content/`는 별도 콘텐츠 Git 저장소의 고정 커밋을 가리킨다.
`categories.json`은 카테고리 계층을 정의한다. 각 글의 frontmatter는 ID·부모·순서·분류와 AI 메타데이터를 보관한다.
분류나 부모가 바뀌어도 글 폴더와 형제 이미지를 이동하지 않는다.
기존 브라우저 초안의 이미지 경로를 보존하려고 `public/notion/assets/`와 `public/notion/asset-map.json`을 유지한다.
정식 글 조회는 글별 첨부를 사용한다. 옛 공개 첨부의 중복 정리는 후속 작업이다.

빌드는 frontmatter를 본문과 분리한 뒤 허용한 공개 필드만 출력한다.
AI 메타데이터와 원문 확장 필드는 원본에 보존하며 공개 목록·본문·다운로드에 포함하지 않는다.
공개 콘텐츠 저장소에서는 frontmatter를 읽을 수 있다. 비공개 메모와 로컬 LLM wiki는 저장소 밖에 둔다.
LLM wiki의 색인·근거 계약은 콘텐츠 저장소 문서에 보관한다. 생성기와 AI 실행 기능은 구현하지 않는다.

## 검사와 빌드

```sh
npm run check
npm run check:content
npm run build
```

`check`는 TypeScript와 DOM 기반 동작 검사를 실행한다.
`check:content`는 선택한 콘텐츠의 글·부모·분류·첨부를 실제로 읽고 검사한다.
배포 빌드는 submodule이 없거나 커밋이 맞지 않으면 중단한다. 이전 JSON으로 자동 대체하지 않는다.
실행한 검사와 검증 한계는 [이전 기록](docs/MIGRATION.md)에 구분해 적는다.
2026-10-24 KST에 새 체크아웃에서 검사 244개와 빌드를 통과했다. 글 3,032개·카테고리 47개·참조 첨부 7,255개를 확인했다.

## 버전과 빌드 산출물

버전의 기준은 `package.json`이다. `package-lock.json`과 Git 태그를 같은 버전으로 맞춘다.
`npm run check:version`은 두 파일의 버전을 검사한다. 태그 빌드에서는 `v<버전>`과 태그도 비교한다.

`v*` 태그를 푸시하면 GitHub Actions가 검사와 빌드를 실행한다.
수동 실행은 저장소의 Actions에서 검사와 빌드를 실행한다.
태그 빌드는 산출물을 업로드한다. 이름에는 버전, 전체 커밋 SHA, 실행 ID와 재시도 번호가 들어간다.
산출물은 7일 동안 보관한다.

빌드는 `dist/build-info.json`에 버전과 빌드 출처를 기록한다.
GitHub Actions에서는 커밋 SHA, 실행 ID, 실행 번호, 재시도 번호와 workflow 이름을 기록한다.
출처에는 앱 커밋과 `contentCommit`을 구분해 기록한다.
앱 밖 staging을 사용하는 로컬 검증의 콘텐츠 커밋은 `null`이다. Git 정보 없는 배포 입력은 `CONTENT_COMMIT_SHA`가 필요하다.

앱 Git에는 코드·문서와 콘텐츠 submodule의 gitlink를 보관한다. 정식 Markdown과 형제 첨부는 콘텐츠 Git에 보관한다.
생성한 `public/content/`, 수집 캐시, 임시 파일과 환경 파일은 앱 Git에서 제외한다.

## 구현

소스는 화면 조립, 기능, 공통 컴포넌트와 공유 코드로 나눈다.

```text
src/
├── app/                 # 화면 전환, hash 구독, 데이터 요청과 상태 수명
├── pages/               # home, records, categories, post, write 화면 조립
├── features/
│   ├── post-search/     # 검색 입력과 검색어 상태
│   ├── post-category/   # 분류 선택과 분류 상태
│   ├── post-pagination/ # 표시 개수, 결과 개수와 더 보기
│   ├── post-list/       # 대표 글과 글 목록
│   ├── post-reader/     # Markdown, 코드 표시와 내부 링크
│   ├── page-explorer/   # 페이지 계층 탐색
│   └── post-editor/     # 작성, 자동 저장과 문서 가져오기·내보내기
├── components/          # 헤더·푸터, 대화상자, 그림과 아이콘
├── shared/              # 글 타입, 초안 저장, 문서 형식과 다운로드
├── config/              # 사이트 이름, 작성자와 소개 문구
└── styles/              # 공통 CSS 변수와 기본 규칙
```

검색·분류·표시 개수의 상태는 `BlogView`에서 조합한다. 상세 화면을 열어도 이 상태를 유지한다.
CSS는 소유 페이지·기능·컴포넌트 옆에 둔다. 기능별 수치는 각 기능의 `config.ts`에 둔다.
기본 CSS는 앱보다 먼저 불러온다. 앱 로딩·오류 CSS는 편집기를 열기 전에도 불러온다.
공유 문서 코드는 DOM에 의존하지 않으므로 CLI에서도 사용한다.

- React와 Vite로 블로그를 만든다.
- 목록 요약을 먼저 받고 선택한 글의 본문을 따로 받는다.
- BlockNote를 필요할 때 불러와 편집기를 연다.
- 입력 규칙과 키맵은 Notion 문서를 기준으로 보완했다.
- Markdown의 HTML은 sanitize를 통과한 뒤 표시한다. 수식은 KaTeX로 표시한다.
- 초안이 손상됐거나 저장에 실패하면 기존 데이터를 덮어쓰지 않는다.

[디자인 근거](docs/design-reference.md)는 Claude 공식 블로그의 정보 구조와 화면 검증 제한을 기록한다.
