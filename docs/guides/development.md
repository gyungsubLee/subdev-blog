# 개발과 검증 실행 안내

프로젝트 루트에서 명령을 실행한다. package.json과 잠금 파일은 하나만 사용한다.
구조와 책임은 [폴더 구조 기준](../architecture/project-structure.md)을 따른다.

## 개발과 빌드

```sh
npm ci
npm run dev
npm run build
npm run preview
```

Vite root는 app/web이다. 환경 파일은 프로젝트 루트에서 읽는다.
웹 빌드는 dist/web에 출력한다. 웹 빌드는 dist/native를 지우지 않는다.
개발 및 빌드 전에 서버 목록을 app/server/generated/content-catalog.json에 생성한다.
콘텐츠 원본은 content 서브모듈에서 읽는다. 공개 API는 같은 커밋의 본문과 첨부 URL을 반환한다.

## 검사

```sh
npm run check
npm run check:content
npm run check:native
```

check는 버전, TypeScript, 네 영역의 Node 검사를 실행한다.
check:content는 실제 콘텐츠 원본을 검사한다. check:native는 Python unittest로 앱 조립과 Swift 탐색을 검사한다.
Node 서버 검사는 로컬 포트를 연다. 네이티브 검사는 macOS와 Apple command-line tools가 필요하다.
검사 출력과 종료 코드를 함께 확인한다. 기존 실패와 실행 환경의 제한을 구분한다.

## 네이티브 앱

```sh
npm run build:native
python3 app/native/build.py --skip-web-build
```

두 번째 명령은 이미 검증한 dist/web을 재사용할 때 실행한다.
결과는 dist/native/Second Brain.app이다. 기존 native/dist의 실행 중인 앱 번들은 자동으로 삭제하지 않는다.
앱은 프로젝트 루트와 설치된 Node를 사용한다. 프로젝트나 Node 경로를 바꾸면 앱을 다시 빌드한다.

## 과거 호환 도구

```sh
npm run export:static
```

이 명령만 과거 형식의 dist/static/content 정적 출력을 만든다.
일반 웹 root에는 해당 출력을 포함하지 않는다. 정적 출력의 원자적 교체와 복구 검사는 유지한다.
과거 수집 및 자산 검사 명령은 이관 전 백업 checkout의 데이터가 필요하다.
정식 앱에서는 중복된 public/notion 자산과 매핑 파일을 제거했다.
포스팅 첨부는 콘텐츠 저장소의 같은 커밋에 고정한 URL로 제공한다.
과거 수집 도구는 이관 전 백업 checkout에서만 사용한다.

## 배포

루트 vercel.json은 dist/web을 제공한다. 루트 api/index.js는 app/server/api/index.js를 연결한다.
함수는 app/server/generated/content-catalog.json을 포함한다.
원본 content, 웹 공개 자산, 네이티브 앱, 검사와 문서는 함수 번들에서 제외한다.
루트 scripts의 게시 도구와 GitHub workflow는 기존 게시 및 충돌 검사 계약을 유지한다.
운영 배포는 이 구조 변경 작업의 범위에 포함하지 않는다.
