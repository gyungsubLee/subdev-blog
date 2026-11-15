# main에서 운영 블로그를 자동 배포한다

`main` 푸시가 `Deploy main`을 시작한다. 검사에 실패하면 기존 운영 주소를 유지한다.
운영 주소는 https://subdev-blog-cms-gyungsublee.vercel.app 다.

## 실행 순서

1. 실행을 시작한 정확한 SHA와 콘텐츠 서브모듈을 checkout한다.
2. 현재 main과 다른 실행, 수동 helper 호출, 미커밋 소스를 거부한다.
3. 의존성을 설치하고 Vercel에서 사용할 산출물을 빌드한다. 커밋·콘텐츠 커밋·Actions 실행 ID와 시도 번호를 기록한다.
4. `npm run check`, `npm run check:content`를 실행한다. 기존 native preview 검사가 빌드 파일을 사용하므로 빌드 다음에 검사한다.
5. 운영 주소를 바꾸지 않는 미리보기로 산출물을 업로드한다.
6. 프로젝트 ID·READY 상태·배포 메타데이터·공개 build-info·진입 JavaScript·공개 API를 검사한다.
7. 원격 main을 다시 읽는다. 다른 SHA면 운영 연결을 건너뛴다.
8. 같은 main이면 운영 주소를 연결하고, 운영 build-info가 같은 실행의 SHA인지 확인한다.

워크플로는 `blog-main-production` 그룹으로 직렬 실행한다. 진행 중인 운영 주소 변경은 취소하지 않는다.
새 커밋이 생기면 이전 대기 실행 대신 최신 실행을 처리한다. 이미 실행한 이전 SHA도 연결 직전 검사에서 중단한다.

## 설정

- 저장소 변수 `BLOG_PRODUCTION_ALIAS`: `subdev-blog-cms-gyungsublee.vercel.app`
- 기존 비밀값: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `production` GitHub 환경: `main` 브랜치만 허용한다.
- 기존 `CMS_PREVIEW_ALIAS` 저장소 변수는 제거한다. 미정의 값은 이전 콘텐츠 워크플로에서 빈 값으로 읽힌다. 과거 콘텐츠 워크플로를 재실행해도 운영 주소를 연결하지 않게 한다.
- 기존 버전 태그 빌드와 콘텐츠 게시 흐름은 유지한다. 콘텐츠 게시의 설치 토큰이 main을 갱신하면 같은 자동 배포가 실행된다.
- Vercel Git 자동 배포는 끈다. Actions 검사를 통과하기 전에 별도 배포가 운영 주소를 바꾸지 않게 한다.

운영 복구는 main의 수정 커밋으로 한다. `workflow_dispatch`도 main에서만 실행하며 최신 SHA 확인을 거친다.
`vercel deploy --prod`, `vercel promote`, `vercel alias set`을 로컬에서 실행하지 않는다.
저장소 지침과 helper는 수동 우회를 거부한다. Vercel 소유자의 직접 관리자 API 권한까지 제거하는 설정은 아니다.

## 완료 근거

Actions 실행 URL, 실행 SHA, 운영 `/build-info.json`의 commit·runId·runAttempt를 함께 확인한다.
워크플로가 성공했다는 사실과 실제 브라우저에서 확인한 화면을 구분해 기록한다.
