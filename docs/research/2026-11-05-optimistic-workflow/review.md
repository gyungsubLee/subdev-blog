# 독립 검토 결과

독립 검토자는 원격 generator 두 파일의 변경을 승인했다. Critical 지적은 없었다. Important 지적 두 개를 재현하고 수정했다.

1. 이전 저장이 최신 canonical의 조상이면 공개 완료 뒤에도 `superseded`로 남았다. 서버의 GET 공개 판정을 검증한 ready 계보 기준으로 고쳤다. 원본 POST의 충돌 판정은 유지했다. `server-readiness-red.log`와 `server-readiness-green.log`에 증거가 있다.
2. 과거 `published` 또는 기존 `unchanged` 기록이 최신 공개 index보다 오래된 원본 기준을 선택했다. 공개 대기 중인 원본 기록만 기준을 덮게 고쳤다. `client-fresh-baseline-red.log`와 `client-fresh-baseline-green.log`에 증거가 있다.

변경 없음 요청의 공개 대기도 함께 검증했다. 새 응답의 `publicationPending:true`로 기존 기록과 구분한다. candidate가 없는 요청은 읽기 전용 원본 상태 GET을 사용한다. `client-unchanged-{red,green}.log`와 서버 readiness 검사에 증거가 있다.

검토자는 상태 참조의 전진, 응답 유실, 검증 후 공개, 원본 계보 재확인과 로그의 비밀 제외를 확인했다. 읽기 검토자는 검사나 원격 변경을 실행하지 않았다. 검사 실행자는 서버·공개 처리·클라이언트·루트 HTTP 및 빌드 대상으로 나눴다.

측정 화면은 실제 IndexedDB 큐와 서버를 호출한다. 전체 React 편집기의 화면 지연을 측정한 것은 아니다. 첫 측정 전에 클릭 시각을 준비 작업 앞으로 옮겼다. 제목 수정 payload도 편집기의 title·tags·category·Markdown·assets·editor 형태에 맞췄다.
