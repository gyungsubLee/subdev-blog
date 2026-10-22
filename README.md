# Second Brain

현재 버전은 `v0.1.0`이다. [변경 기록](CHANGELOG.md)에 구현 기능과 검증 한계를 기록한다.

공개 Notion 블로그를 Markdown으로 보관하고 웹에서 읽고 쓰는 예시다. 배포 대상은 Vercel이다. 사용자 승인에 따라 프로젝트의 현재·향후 모든 배포에서 인증 보호를 해제했다.

[배포한 블로그](https://notion2md-blog-6mrigosj8-gyungsublees-projects.vercel.app)는 로그인 없이 공개하도록 설정했다.
수집 결과와 검증 범위는 [수집·배포 기록](docs/MIGRATION.md)에 있다.

## 로컬 실행

```sh
npm ci
npm run dev
```

개발 서버는 명령 출력의 주소에서 연다. 수집한 원문은 `content/posts.json`에 있다.

## 수집한 지식

저장 위치는 `/Users/igyeongseob/Knowledge/SecondBrain/notion-blog`다.

LLM은 `index.md`에서 주제를 찾고 필요한 글을 읽는다. `pages.md`는 전체 계층을 보여준다.
각 글은 원본 ID, URL, 부모 ID, 날짜와 데이터베이스 속성을 frontmatter에 보존한다.
이미지와 첨부 파일의 원본은 `assets`에 보관한다.
웹 이미지는 별도로 최적화하며 원본을 바꾸지 않는다. 내부 링크는 상대 경로를 사용한다.

`manifest.json`에서 접근 불가 항목과 자산 실패를 확인한다.
`notion-records.json`은 원본 블록을 확인할 때 사용한다.

```sh
npm run export
npm run check:export
```

수집기는 캐시를 사용해 중단한 작업을 재개한다. 새 원문을 수집하려면 `npm run export -- --refresh`를 실행한다.
Notion의 공개 API는 비공식 인터페이스다. 공개하지 않은 페이지는 이 수집기의 범위에 포함하지 않는다.

## 글 작성과 발행

웹 상단의 `글쓰기`에서 작성한다. 빈 줄에 `/`를 입력하면 블록 메뉴가 열린다.
초안은 해당 브라우저의 localStorage에 저장한다. 공개 사이트에 바로 발행하지 않는다.

`초안 저장`과 자동 저장은 브라우저 안에서만 동작한다.
`.md 내보내기`는 이식용 파일을 만든다. `원본 백업`은 토글과 코드 설정을 포함한 블록 JSON을 보존한다.
저장 공간이 부족하면 화면의 글을 파일로 내보낸다.

작성한 Markdown을 공개 글에 넣으려면 다음 명령을 실행한다.

```sh
npm run import:md -- /absolute/path/article.md
npm run build
TMPDIR="$PWD/.tmp" vercel deploy --archive=tgz --yes --no-wait --scope gyungsublees-projects
```

원문을 편집해서 내보낸 파일에는 원본 식별자가 있다.
이 파일을 가져오면 웹 표시를 갱신한다. 수집한 원본 Markdown은 덮어쓰지 않는다.
새 글은 `content/written`에 저장하며 원문을 다시 수집해도 유지한다.

이 예시에는 서버 계정, 여러 기기 간 초안 동기화, 웹에서 공개 발행하는 기능이 없다.
작성 흐름과 검증 범위는 [Notion 작성 UX](docs/notion-writing-ux.md)에 있다.

## 검사와 빌드

```sh
npm run check
npm run check:export
npm run check:assets
npm run build
```

`check`는 TypeScript와 DOM 기반 동작 검사를 실행한다.
`check:export`는 수집한 Markdown, 부모 관계, 로컬 링크와 첨부 파일을 검사한다.

연결된 Chrome 도구가 시작 오류를 반환했다. 화면 비교, 모바일 실제 배치와 실제 한글 입력은 아직 검증하지 못했다.
DOM 검사는 실제 브라우저 검증을 대신하지 않는다.

## 버전과 빌드 산출물

버전의 기준은 `package.json`이다. `package-lock.json`과 Git 태그를 같은 버전으로 맞춘다.
`npm run check:version`은 두 파일의 버전을 검사한다. 태그 빌드에서는 `v<버전>`과 태그도 비교한다.

`v*` 태그를 푸시하면 GitHub Actions가 검사와 빌드를 실행한다.
수동 실행은 저장소의 Actions에서 검사와 빌드를 실행한다.
태그 빌드는 산출물을 업로드한다. 이름에는 버전, 전체 커밋 SHA, 실행 ID와 재시도 번호가 들어간다.
산출물은 7일 동안 보관한다.

빌드는 `dist/build-info.json`에 버전과 빌드 출처를 기록한다.
GitHub Actions에서는 커밋 SHA, 실행 ID, 실행 번호, 재시도 번호와 workflow 이름을 기록한다.
로컬 빌드에서 제공하지 않은 출처 값은 `null`이다.

Git에는 코드, 문서, `content/posts.json`과 웹용 첨부 파일을 보관한다.
수집한 원본 Markdown, API 캐시, 임시 파일과 환경 파일은 로컬 보관 대상으로 구분한다.

## 구현

- React와 Vite로 블로그를 만든다.
- 목록 요약을 먼저 받고 선택한 글의 본문을 따로 받는다.
- BlockNote를 필요할 때 불러와 편집기를 연다.
- 입력 규칙과 키맵은 Notion 문서를 기준으로 보완했다.
- Markdown의 HTML은 sanitize를 통과한 뒤 표시한다.
- 초안이 손상됐거나 저장에 실패하면 기존 데이터를 덮어쓰지 않는다.

[디자인 근거](docs/design-reference.md)는 Claude 공식 블로그의 정보 구조와 화면 검증 제한을 기록한다.
