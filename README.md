# Second Brain

[운영 블로그 열기](https://subdev-blog-cms-gyungsublee.vercel.app/#/records)

`main`에 푸시하면 같은 커밋을 검사·빌드하고 운영 블로그에 자동 배포합니다.
오래된 실행은 운영 주소를 변경하지 않습니다. [배포 절차](docs/guides/DEPLOYMENT.md)를 따릅니다.

GitHub의 Markdown 원본을 조회하고, 본인 인증 후 글과 카테고리를 관리하는 블로그다.
웹 앱과 API는 Vercel에 배포한다. GitHub Pages는 사용하지 않는다.

## 현재 운영 상태 — 2026-11-15

- 글 1,974개, 카테고리 48개, 참조 첨부 7,250개를 확인했다.
- 빈 글 1,047개와 본문 50자 이하 글 11개를 삭제했다. 원본 백업과 본문을 담은 임시 파일도 제거했다.
- 레거시 Vercel 배포 16개를 제거하고 현재 운영 배포 1개만 유지한다.
- 이전 `notion2md-blog.vercel.app` 주소는 제거했다. 로그인도 위 고정 운영 주소에서 시작한다.
- 현재 운영 앱 소스는 `dbeef2520d49099fa5e2e0b8187fe0a6adce4c69`다.
- 콘텐츠 정리 커밋은 `4f7b16770b71b89b987dd96e8b92cb97cf1c1201`이다.

[운영 배포 기록](docs/reports/2026-11-15-blog-publication.json)에 배포 ID, 소스 커밋과 확인 범위를 기록했다.
[배포 제거 결과](docs/reports/2026-11-15-legacy-deployments.md)와 [남은 짧은 글 69개](docs/reports/2026-11-15-short-posts.md)도 확인할 수 있다.

## 릴리즈와 배포

[GitHub 릴리즈 v0.2.1](https://github.com/gyungsubLee/subdev-blog/releases/tag/v0.2.1)의 설명은 현재 운영 상태로 갱신했다.
기존 태그와 첨부 3개는 2026-11-05 빌드다. 11월 15일 운영 재배포 산출물로 교체하지 않았다.
[릴리즈 설명](docs/releases/v0.2.1-notes.md), [빌드 이력](BUILD_HISTORY.md), [변경 기록](CHANGELOG.md)에서 두 시점의 근거를 구분한다.
과거 성능 수치는 [실측 기록](docs/releases/v0.2.0-performance.md)에 보존한다.

## 로컬 실행

```sh
git submodule update --init --recursive
npm ci
npm run dev
```

개발 서버 주소는 명령 출력에서 확인한다. 웹 앱의 기본 주소는 `http://127.0.0.1:5173`이다.
조회는 공개하지만 글과 카테고리 생성·수정·삭제에는 GitHub 로그인과 저장소 연결 확인이 필요하다.
서버 설정은 [.env.example](.env.example)을 참고한다. 비밀값에는 `VITE_` 접두사를 붙이지 않는다.

## 콘텐츠와 게시

[콘텐츠 저장소](https://github.com/gyungsubLee/subdev-blog-content)는 `content/` submodule로 연결한다.
원본은 `content/posts/<글 UUID>/<실제 제목>.md`이고 이미지와 첨부는 같은 폴더에 둔다.
블록 편집 원본이 있는 글은 `editor.json`도 보관한다.
글 ID와 폴더는 분류·부모 변경으로 바꾸지 않는다.

편집기는 원본과 편집 데이터를 같은 커밋에 저장한다. 공개 생성 작업이 완료되면 조회에 반영한다.
공개 API는 콘텐츠 저장소의 `public-ready/main`을 기준으로 준비된 목록과 본문을 읽는다.
글 저장마다 앱 전체를 다시 빌드하거나 배포하지 않는다.
빌드는 고정한 submodule 커밋으로 서버의 기준 목록을 생성한다.

공개 API는 허용한 필드만 반환한다. 원시 frontmatter와 편집 JSON은 공개 본문에 포함하지 않는다.
콘텐츠 Git 저장소 자체는 공개되어 있으므로 비공개 메모와 개인 wiki를 넣지 않는다.

## 프로젝트 구조

```text
app/web/       # React 웹 화면과 편집기
app/server/    # API, 인증, GitHub 연동과 캐시
app/content/   # 콘텐츠 검증·변환·저장 도구
app/native/    # Swift macOS 앱과 빌더
app/shared/    # 공통 문서 처리
content/       # 원본 콘텐츠 submodule
tests/         # 웹·서버·콘텐츠·네이티브 검사
docs/          # 설계·실측·릴리즈·운영 기록
scripts/       # 버전 검사와 배포 도구
```

[폴더 구조](docs/architecture/project-structure.md)와 [개발 안내](docs/guides/development.md)에 구현 경계를 기록했다.
루트 `api/index.js`는 Vercel 진입점이며 서버 구현은 `app/server/`에 있다.
기존 수집과 이관 과정은 [날짜별 이관 기록](docs/guides/MIGRATION.md)에 보관한다.

## 검사와 빌드

```sh
npm run check:content
npm run check
npm run build
```

2026-11-15 콘텐츠 검사 오류는 0개였고, 웹 배포 빌드는 성공했다.
브라우저에서 운영 목록 1,974개를 확인했다. 남은 원본 파일의 Git blob SHA도 삭제 전과 같았다.
새 배포의 실제 로그인·저장과 성능 비교는 다시 실행하지 않았다.
이후 문서 갱신에는 앱 코드 변경이 없으며 전체 앱 검사는 반복하지 않았다.

macOS 앱은 `npm run build:native`로 만든다. 최근 앱 재빌드·실행 기록은 2026-11-09이며 웹 배포와 구분한다.
