# 즉시 백그라운드 저장 실측

5초 저장 대기를 제거했다. 준비된 제목 저장 3회의 클릭→전송 시작 중앙값은 **5,018→15.1ms**다. 클릭→GitHub 저장 확인 중앙값은 **6.682→1.619초**다. 관측한 감소율은 **75.8%**다.

각 제목 저장은 실제 OAuth·CSRF owner 세션에서 GitHub `POST /graphql` mutation **1회**로 완료했다. 초기 준비 조회와 공개 작업을 저장 요청 수에 섞지 않았다.

## 수정한 흐름

`sync-core.mjs`는 IndexedDB transaction 완료 뒤 0ms 전송을 예약한다. 저장 버튼은 원격 응답을 기다리지 않는다. 전송 중 들어온 수정은 이전 응답 뒤 기준 commit을 갱신하고 바로 전송한다. 기존 대기 데이터의 미래 `dueAt`도 저장을 늦추지 않는다.

lease·고정 payload·전송 의도 보관·요청 확인 파일·충돌 차단을 유지했다. 오류 재시도의 5·15·60초 대기는 유지했다. 401·403·409는 자동으로 반복 전송하지 않는다. 서버와 기존 공개 workflow는 이번 변경에서 수정하지 않았다.

## 실제 제목 저장

| 표본 | 기기 저장 ms | 클릭→전송 시작 ms | 클릭→저장 확인 초 | 서버 POST 초 | GitHub 요청/쓰기 |
|---|---:|---:|---:|---:|---:|
| 1 | 2.0 | 12.0 | 1.534 | 1.504 | 1/1 |
| 2 | 11.2 | 15.1 | 1.631 | 1.570 | 1/1 |
| 3 | 7.0 | 38.3 | 1.619 | 1.573 | 1/1 |
| 중앙값 | 7.0 | 15.1 | 1.619 | 1.570 | 1/1 |

서버 POST 중앙값은 이전 1.599초와 비슷하다. 이번 감소의 주된 이유는 저장 전 5초 대기 제거다. 기기 저장 이후 전송 예약은 0ms다. 실제 전송 시점에는 브라우저 스케줄링과 transaction 비용이 포함된다.

새 글 생성에는 원본 commit·tree·분류 준비 3회와 mutation 1회가 필요했다. 준비 조회를 포함한 생성 클릭→전송 시작은 783.6ms, 클릭→저장 확인은 5.140초였다. 대용량 fallback과 읽기 복구도 추가 호출이 생길 수 있다. 모든 저장이 한 번이라고 일반화하지 않는다.

## 화면 측정의 제한

측정 페이지의 독립 IndexedDB 읽기 중앙값은 206.8ms다. 두 번의 animation frame을 포함한 화면 반영 중앙값은 249.6ms다. 이전 화면 중앙값 151.2ms보다 늘었다. 첫 표본은 1,300.5ms였다. 이 값을 제외하거나 기준을 낮추지 않았다.

같은 프로젝트·측정 방식·글 크기·기기에서 비교했다. 시점별 Chrome·CPU·네트워크 부하는 통제하지 못했다. 화면 지연 증가의 원인을 이 표본만으로 확정하지 못했다. 전체 React 편집기의 화면 성능을 유지했다고 주장하지 않는다. 제품 UI는 수정하지 않았다.

## 유지한 동작과 검사

- 같은 시각의 즉시 예약 검사 2개가 변경 전에 실패했다. 변경 후 코어 16개가 통과했다.
- 중복 coordinator, 전송 중 추가 수정, 고정 payload, 이전 dueAt 복원, 재시도와 충돌 검사를 포함한다.
- 복구·관리 복구·클라이언트 계약 14개가 통과했다.
- TypeScript와 production build가 통과했다. 기존 bundle·동적 import 경고는 남았다.
- 읽기 전용 독립 코드 검토에서 차단할 문제를 발견하지 않았다.
- 분석기 자체 검사와 요청 범위의 diff 검사를 통과했다.

겹치는 검사 수를 합산하지 않는다. 서버 HTTP 검사는 이번 클라이언트 예약 변경으로 영향이 없어 다시 실행하지 않았다. 이전 실제 수락 요청의 읽기 복구는 mutation 0회로 확인했다. 이번에는 실제 응답 유실을 다시 주입하지 않았다. [이전 복구 증거](../2026-11-05-single-request/recovery.json).

전체 suite·전체 React 편집기·브라우저 대용량 큐 메모리·실제 24시간 방치는 미검증이다. 기존 Node 대용량 큐 메모리 한계를 해결한 작업은 아니다.

## 증거

[구조화 분석](analysis.json), [실제 API trace](live-report.json), [전체 측정 표](measurement-tables.md), [검사 기록](verification.json), [소스 해시](measurement-source-hashes.json), [변경 diff](implementation.patch), [독립 검토](review.md), [실행 계획](../../superpowers/plans/2026-11-05-immediate-save.md).



## 공개 완료와 정리

기존 공개 workflow 5회가 모두 성공했다. 각 원본과 공개 인덱스의 commit·제목 또는 삭제가 일치했다.

| 작업 | 원본 commit | workflow |
|---|---|---|
| 임시 글 생성 | `c1312dbcc922361bd9c62dc96c5e4c066b5b4abd` | [success](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41970491762) |
| 제목 수정 1 | `ed95e2a2377f41ec44a530048a1bf3fcc9a58d5a` | [success](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41970672053) |
| 제목 수정 2 | `c8d805a6b41a1ff600ce6764b2f94e3327f13b43` | [success](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41970897322) |
| 제목 수정 3 | `b722e467d7bf177d68b6aa904e11162997921176` | [success](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41971073337) |
| 임시 글 삭제 | `8df22ff2f3c4fcb809ce81151bbafcf60ef27bff` | [success](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41971291508) |

기존 파일 10,297개의 SHA와 글 3,032개가 모두 일치했다. 새 요청 확인 파일 5개만 남겨 전체 파일은 10,302개다. 확인 파일 bytes는 요청 해시·부모 commit과 모두 일치했다.

generator pin은 `e763d9adf0e07f77a1b0177895674f08922f9122`로 같다. 앱 main은 `27441173f257769add825aea596f7080d282e1ca`로 같다. 앱 배포·native rebuild·staging·commit·push는 하지 않았다.

작업 소유 서버 PID 66585와 64692번 listener·탭을 닫았다. 기존 5173번 preview PID 20697은 다른 실행이므로 유지했다.

![임시 글 원본과 공개 삭제 확인](deleted.png)
