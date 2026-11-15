# 운영 배포

- 운영 주소는 `https://subdev-blog-cms-gyungsublee.vercel.app`다.
- 운영 배포는 `.github/workflows/deploy-main.yml`만 수행한다. 검증한 변경을 `main`에 푸시하고, 해당 SHA의 Actions 완료와 운영 `build-info.json`을 확인한다.
- 로컬 작업 디렉터리나 과거 배포를 `vercel deploy --prod`, `vercel promote`, `vercel alias set`, REST alias API로 운영에 직접 연결하지 않는다.
- 배포 문제는 Git에서 수정하고 새 커밋의 워크플로로 복구한다. 과거 실행을 재시도해 최신 main 확인을 우회하지 않는다.
- Vercel Git 자동 배포는 의도적으로 끈다. 검사 전 자동 승격과 Actions 배포가 경쟁하지 않게 한다.
- 콘텐츠 게시 워크플로는 검증·원본 게시·main gitlink 갱신·독립 미리보기를 담당한다. 운영 주소를 직접 변경하지 않는다.
- 여러 채팅의 수정은 합의한 파일만 커밋한다. 운영 UI에만 남은 미커밋 변경을 배포 묶음으로 덧씌우지 않는다. 유지할 운영 변경을 먼저 Git에 기록한다.
- 프로젝트 소유자가 Vercel 관리자 자격으로 직접 API를 호출하는 행위는 저장소 코드로 차단할 수 없다. 위 절차를 우회하지 않는다.
