# 삭제한 글을 다시 표시하는 경로 수정

코드에서 확인한 재생성 경로 세 개를 수정했다. 실제 Native 저장소에서 발생한 경로는 아직 특정하지 못했다.
이 문서는 2026-11-07 KST의 코드 변경과 회귀 검사 기록이다.
실제 Native 화면의 최종 판정은 별도 실행 담당자가 기록한다.

## 근거와 원인

- 실제 삭제 커밋은 `4cc628a0e8ae81e80415e550a71155f8291b64af`다.
- 테스트 UUID는 `da515d90-ccd2-4644-81d1-75c282c71a20`이다.
- 원격 공개 목록에는 테스트 글이 없었고, 글 수는 기준값 3,032개였다.
- Native 도구 모음에서 새로고침한 뒤에는 3,033개와 테스트 글이 남았다.
- 실제 실행 근거는 [원격 기록](remote-steps.json)과 [진행 기록](README.md)에 있다.

`usePosts`는 유효한 영구 캐시가 있으면 새 문서에서도 최초 index 요청을 생략했다.
따라서 `webView.reload()` 뒤에도 다른 브라우저의 삭제를 읽지 못했다.

`overlayContent`는 이전 공개 커밋과 index 커밋이 정확히 같아야 저장 작업을 적용 대상에서 제외했다.
중간 공개 커밋을 놓치면 후속 삭제 목록에도 이전 create/update 작업을 적용해 글을 다시 만들었다.

`ContentWorkspace`는 공개 목록에 없는 완료 복구 데이터를 공개 행으로 만들었다.
따라서 공개 목록이 정확해도 관리 목록에 이전 글이 추가될 수 있었다.

## 변경한 동작

`usePosts`는 캐시를 먼저 표시하고 새 문서에서 index를 한 번 재검증한다.
같은 문서에서 다시 mount하면 확인한 캐시를 사용한다.
선택한 글의 본문만 읽는 기존 지연 로딩과 effect 정리를 유지했다.

새 network index는 아직 끝나지 않은 저장 작업의 공개 상태를 확인한다.
기존 `/api/publish` 계약으로 요청 ID, candidate 커밋과 공개 커밋을 검증한다.
서버가 돌려준 `publicCommit`이 받은 index 커밋과 같을 때만 이전 작업의 적용을 끝낸다.
SHA가 다르다는 사실만으로 커밋 순서를 판단하지 않는다.

캐시 표시 경로는 공개 확인 요청을 만들지 않는다.
공개 확인은 순차로 실행하며 전체 재검증에 30초 기한을 둔다.
같은 batch의 동시 확인은 기존 background 확인과 Promise를 공유한다.
실패하거나 기한이 지나면 저장 작업을 유지한다.
기존 차단 상태와 실패 상태의 재시도 제한도 유지했다.

관리 목록은 공개 목록에 없고 추가 편집도 없는 완료 복구 데이터를 공개 행으로 만들지 않는다.
연결된 legacy 초안 행도 화면 목록에서만 제거한다.
복구 데이터와 legacy 초안의 저장소 원문은 삭제하지 않는다.
공개 생성이 pending인 저장 원본과 후속 제목·본문·태그·분류·Blocknote·첨부 편집은 계속 표시한다.
canonical ID와 `recoveryKey`, 기존 편집·삭제 callback 계약을 유지했다.
화면 구성·제품 문구·CSS는 유지했다. 편집 콜백의 인자만 연결했다.

## 후속 검토에서 보완한 계약

공개 완료 응답에는 원본 저장 때의 `publicationPending:true`가 없을 수 있다.
공유 완료 경로는 `published` 상태의 대기 표식을 false로 정규화한다.
관리 목록은 기존 `isSourcePending` 계약으로 이전 저장 데이터도 읽는다.
`published`에 남은 이전 대기 표식으로 완료 복구 행을 다시 만들지 않는다.

공개 확인 요청은 로그인한 동기화 세션이 소유한다.
로그아웃과 계정 교체는 이전 세션의 요청을 중단한다.
한 화면의 취소는 그 화면의 대기만 끝낸다. 다른 화면이 기다리는 공유 요청은 유지한다.
응답·저장·타이머 예약 전후에 같은 세션인지 확인한다.
이전 계정의 마지막 저장소 조회가 끝나도 새 계정의 공개 확인 타이머를 바꾸지 못한다.

공유 공개 확인은 완료 이벤트를 한 번 발행한다.
열린 글·카테고리 편집기가 원본 저장 완료에서 게시 완료로 바뀌는 회귀를 추가했다.
`usePosts`는 같은 공개 커밋을 이미 적용하는 중이면 그 이벤트 때문에 index를 다시 받지 않는다.

Markdown에서 blocks를 처음 만들면 추가 편집으로 취급하지 않는다.
이미지의 `previewWidth`는 Markdown이 같아도 blocks만 바꾸는 실제 편집이다.
이 편집은 boolean 표식 하나로 보존한다. 실제 undo로 원래 문서에 돌아오면 표식을 해제한다.
현재 편집기는 불변 ProseMirror 문서 참조를 비교한다.
blocks 원본을 복사해 저장하거나 입력할 때 hash를 추가로 계산하지 않는다.
새 표식이 없는 이전 편집은 `updatedAt`과 공개 상태를 보고 보수적으로 유지한다.

## 검사와 요청 수

- 첫 캐시 표시: network 응답 전에 기존 제목을 표시했다.
- 새 문서의 index 재검증: 변경 전 0회, 변경 후 1회였다.
- 같은 문서의 remount 추가 다운로드: 변경 전후 모두 0회였다.
- 목록만 연 상태의 본문 다운로드: 0회였다.
- 같은 저장 작업을 동시에 확인한 두 호출: 공개 확인 요청은 1회였다.
- 열린 글·카테고리 편집기와 fresh index를 함께 확인한 경우: index 1회, 공개 확인 1회, 완료 이벤트 1회였다.
- 저장 작업 두 개의 backlog: 요청은 2회였고 동시에 실행한 요청의 최댓값은 1이었다.
- 정확한 공개 커밋 증명이 있으면 삭제 목록에 이전 글을 추가하지 않았다.
- 다른 공개 커밋을 증명하면 기존 저장 작업을 유지했다.
- pending 저장 원본과 후속 편집, 손상된 복구 원문을 보존했다.
- 기존 생성·수정·삭제와 공개 본문 갱신 검사를 함께 실행했다.

최초 실패는 [초기 RED 발췌](ghost-initial-red.log)에 기록했다.
읽기 검토에서 찾은 legacy 행과 병렬 요청 문제는 [추가 RED](ghost-followup-red.log)에서 재현했다.
해당 두 검사의 [GREEN](ghost-followup-green.log)도 남겼다.
최종 대상 검사 전체 출력은 [최종 GREEN](ghost-final-green.log)에 있다.
최종 검사 91개가 통과했다. 종료 코드는 0이고 실행 시간은 33.85초였다.
대상은 기존 네 검사 파일과 `managed-block-editor.test.mjs`다.
최종 [TypeScript 검사](ghost-tsc-green.log)도 종료 코드 0이었다. 실행 시간은 6.07초였다.
검사 입력의 해시는 [검사 결합 정보](ghost-verification.json)에 기록했다.

후속 RED와 GREEN은 다음 파일에 남겼다.

- 공개 완료·세션 취소·초기 blocks: [RED](ghost-review-red.log), [GREEN](ghost-review-green.log)
- 열린 편집기와 중복 index: [RED](ghost-mounted-red.log), [GREEN](ghost-mounted-green.log)
- 실제 이미지 width 편집: [RED](ghost-block-red.log), [GREEN](ghost-block-timer-green.log)
- 이전 계정의 타이머 경합: [RED](ghost-block-timer-red.log), [GREEN](ghost-block-timer-green.log)
- root가 수정한 편집기 실패 상태: [RED](ghost-editor-failure-red.log), [GREEN](ghost-block-timer-green.log)

## blocks 표식의 비용 측정

같은 101-block 문서에서 문단 100개와 이미지 1개를 사용했다.
이미지 width만 200으로 바꿨고 Markdown 바이트는 같았다.
원본 저장 payload에서 추가된 크기는 boolean 한 값인 21바이트였다.
첫 전체 snapshot 모형은 100회씩 여섯 round를 측정했다.
중앙값은 변경 전 11.10ms, 변경 후 15.03ms였다.
이 차이만으로 성능 유지라고 판정하지 않았다.

실제 추가 연산을 분리해서 측정했다.
`editor.transact`와 문서 `eq` 20,000회의 평균은 0.001370ms였다.
직접 `eq`의 평균은 0.000912ms였다.
기존 blocks snapshot 100회의 평균은 0.1966ms였다.
기존 Markdown serializer 100회의 평균은 11.8906ms였다.
최종 JSON 1,000회의 평균은 변경 전 0.063632ms, 변경 후 0.063645ms였다.
이전 문서와 현재 문서의 첫 문단은 같은 불변 노드 참조를 공유했다.

분리한 추가 연산은 최초 전체 모형의 3.93ms 차이를 설명하지 못했다.
따라서 전체 모형의 차이를 실제 편집 지연으로 확정하지 않았다.
실제 장치의 입력 지연과 큰 문서의 처리량이 같은지는 아직 측정하지 않았다.
근거는 [전체 모형](ghost-block-performance.log)과 [분리 측정](ghost-block-performance-profile.log)에 있다.
재현용 [측정 스크립트](ghost-block-performance.mjs)도 보관했다.

검토 담당자는 `/root/live_ghost_fix/ghost_review`였다.
검토는 위 세 소스의 diff를 읽는 범위였다.
검토 담당자는 파일 수정, 검사 실행, GUI 조작과 네트워크 요청을 하지 않았다.

## 남은 확인

이 작업은 실제 Native 저장소를 읽거나 실제 GitHub 항목을 변경하지 않았다.
전체 저장소 검사, 최종 빌드와 실제 Chrome·Native 검사는 각 실행 담당자가 맡는다.
서버의 기존 공개 HEAD 캐시 기한 30초는 바꾸지 않았다.
실제 장치의 첫 표시 시간과 3,032개 목록의 렌더링 시간은 측정하지 않았다.
단위 검사의 요청 수만으로 실제 장치의 실행 성능이 같다고 단정하지 않는다.

검사 번들을 만들 때 기존 `postFromOperation`의 중복 `updatedAt` 경고를 관찰했다.
이 경고는 이번 변경 전에도 있었고 요청 범위 밖이므로 수정하지 않았다.

## 변경 파일과 소유권

- `app/web/src/site/usePosts.ts`: 문서별 재검증, effect 취소 확인, 같은 커밋의 중복 다운로드 방지
- `app/web/src/features/content-management/background-sync.mjs`: 정확한 공개 증명, 세션 수명, 공유 완료 이벤트와 타이머 보호
- `app/web/src/features/content-management/ContentWorkspace.tsx`: 완료 복구 행 제거와 후속 편집 보존
- `app/web/src/features/content-management/ManagedPostEditor.tsx`: blocks 변경 표식과 편집 콜백 연결
- `tests/web/public-client-cache.test.mjs`, `sync-recovery.test.mjs`, `content-workspace.test.mjs`, `app-flow.test.mjs`, `managed-block-editor.test.mjs`: 회귀 검사
- `tests/support/content-sync.mjs`, `tests/support/publication-ui.mjs`: 같은 번들의 API와 화면을 연결하는 검사 진입점

root는 두 편집기의 실패 상태 handler를 별도로 수정했다.
이 작업은 기존 업로드 guard와 카테고리 확인 경로를 보존했다.
실제 GitHub 변경, 최종 앱 빌드와 GUI 조작은 맡지 않았다.
