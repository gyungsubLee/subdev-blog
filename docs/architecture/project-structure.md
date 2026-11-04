# 프로젝트 폴더 구조 기준

상태: 2026-11-04 사용자가 대화에서 승인한 구조를 구현한다.
목표: 제품 코드를 `app/`에 모으고 코드, 콘텐츠 원본, 생성 데이터의 소유 영역을 구분한다.

## 구조와 책임

```text
app/
  web/
    src/
      site/          # App, BlogView, 오류 경계, 라우팅과 공통 상태
      pages/         # 화면 조립
      features/      # 사용자 기능
      components/    # 공통 화면 요소
      shared/        # 웹 전용 코드
      config/
      styles/
      assets/
      main.tsx
    public/          # 앱 자체 정적 자산
    scripts/         # 웹 전용 도구
    index.html
  server/
    api/             # 배포 진입점 구현
    src/             # 인증, 요청 처리, GitHub 연동, 캐시
    scripts/         # 서버 목록 준비와 성능 측정
    generated/       # content-catalog.json, Git 제외
  content/
    src/             # 콘텐츠 검증, 변환, 저장
    scripts/         # 검사, 가져오기, 이관
  native/            # Swift 앱과 Python 빌드
  shared/            # 공용 문서 파서, 편집 문서 검증, 링크 처리
content/             # 기존 콘텐츠 Git 서브모듈 유지
  posts/<UUID>/      # 제목.md, 선택 editor.json, 형제 첨부파일
tests/
  web/
  server/
  content/
  native/
  support/
scripts/             # 버전 검사와 프로젝트 전체 배포 조정
docs/
  architecture/
  guides/
  superpowers/
  research/
dist/
  web/
  native/
```

루트 package.json, 잠금 파일, Vite, TypeScript, Vercel 설정을 유지한다.
패키지와 의존성을 추가하지 않는다. 각 영역의 scripts는 그 영역만 처리한다.
루트 scripts는 여러 영역의 검사 또는 배포를 조정한다.
서버는 scripts의 라이브러리를 가져오지 않는다. 공용 콘텐츠 로직은 app/content/src에서 제공한다.
웹 전용 shared와 실행 환경 사이의 app/shared를 구분한다.
페이지가 사용하는 분류 화면은 기능 영역에서 공유한다. 기능이 페이지를 가져오지 않게 한다.

## 콘텐츠와 공개 자산

콘텐츠 원본과 첨부파일은 기존 content 서브모듈에서 함께 관리한다.
현재 웹은 /api/public으로 글을 읽는다. 첨부 URL은 같은 콘텐츠 커밋의 GitHub raw 주소를 사용한다.
일반 개발 및 빌드는 public/content 복사본을 생성하지 않는다.
기존 정적 내보내기와 원자적 교체 검사는 명시적으로 실행하는 웹 도구로 보존한다.
이 도구는 일반 개발 및 빌드의 선행 작업에서 제외한다.
중복된 public/notion 자산과 매핑 파일은 공개 경로에서 제거한다.
포스팅 첨부파일은 content 서브모듈의 글 UUID 폴더에서만 관리한다.
2026-11-04 후속 지시에 따라 이전 호환 자산 보존 결정을 변경했다.
서버 목록은 변경된 글만 읽도록 돕는 생성 데이터다. 이를 삭제하거나 공개 폴더에 넣지 않는다.

## 배포와 실행

Vercel이 루트 api를 탐색해야 하면 최소 연결 파일만 루트에 둔다.
실제 진입점은 app/server/api에 둔다. 루트 연결 파일은 제품 로직을 갖지 않는다.
함수의 includeFiles는 app/server/generated/content-catalog.json을 가리킨다.
웹 빌드는 dist/web, 네이티브 빌드는 dist/native에 출력한다.
웹 빌드는 dist/native를 지우지 않는다. 네이티브 앱은 같은 루트에서 npm preview를 실행한다.
실행 중인 기존 앱을 종료하거나 기존 앱 번들을 덮어쓰지 않는다.

## 보존 계약

화면 구성, 문구, CSS 값, 반응형 동작과 사용자 기능을 유지한다.
기존 작업 트리의 수정과 삭제를 보존한다. 삭제 상태를 기록하고 배포에 필요한 루트 api 연결 파일만 최소 연결로 대체한다.
변경 전 파일을 로컬 증거 폴더에 보관하고 이동 경로를 기록한다.
콘텐츠 서브모듈 커밋과 원본 바이트를 유지한다.
캐시 한도, 지연 로딩, 요청 병합, 압축과 자원 정리를 유지한다.

## 완료 기준

경로 매핑과 import, 실행 명령, CI, 배포 설정, 문서가 같은 구조를 가리킨다.
기존 검사의 의미를 보존하며 분류된 검사 명령으로 실행한다.
새 구조와 일반 빌드의 중복 콘텐츠 생성 중단을 검사한다.
TypeScript, 전체 Node 검사, 콘텐츠 검사, Python 검사, 웹 및 네이티브 빌드를 확인한다.
소스와 자산 보존을 대조하고 기존 성능 측정 도구로 변경 전후를 비교한다.
Chrome 연결이 없으면 화면 검증과 실제 장비 성능은 미확인으로 기록한다.
운영 배포와 원격 게시를 실행하지 않는다.
