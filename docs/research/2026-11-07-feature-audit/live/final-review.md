# 실제 저장 흐름 최종 통합 검토

최신 명세 판정과 코드 품질 판정은 한정 검토 범위에서 `통과`다. 동결한 소스에서 네 P2와 후속 잔여 문제를 해결했다. 새 Critical 또는 Important 발견 사항은 없다.

이 문서는 2026-11-07의 최초 검토와 후속 검토를 함께 보관한다. 아래 과거 발견 사항은 당시 소스의 기록이다. 최신 상태는 다음 누적 판정 절을 따른다.

검토자는 `.tmp/live-feature-audit/final-live-review.patch`와 현재 소스를 새로 읽었다. `code-review` 스킬과 STE-KO의 `문서` 표면을 적용했다. STE-KO는 `/Users/igyeongseob/Develop/10_harness/STE-KO/skills/ste-ko/SKILL.md`에서 읽었다.

검토는 소스와 기록을 읽는 작업이다. 테스트, 빌드, 네트워크, GUI 작업을 실행하지 않았다. 소스와 테스트도 수정하지 않았다. 이 문서만 검토자가 작성했다.

## 최신 두 줄 검토와 누적 판정

기존 원본 복귀 버튼의 표시 조건 두 줄도 `통과`다. 새 Critical 또는 Important 발견 사항은 없다. 실패 상태를 복원한 화면에서도 기존 원본 복귀 흐름을 사용할 수 있다.

위치는 `ManagedCategories.tsx:318`과 `ManagedPostEditor.tsx:1227`이다. 각 배열에 `failed`만 추가했다. 버튼 구성, 문구, CSS와 동기화 코어는 이번 추가분에서 바꾸지 않았다. `accepted`, `dirty`와 확인 대화상자의 조건도 유지한다.

두 `reopenSource`는 `failed`를 확인 없이 지워도 되는 완료 상태로 취급하지 않는다. 사용자가 취소하면 저장소를 지우기 전에 돌아간다. 사용자가 확인하면 기존 복구본 해제와 원본 요청 경로를 사용한다. 실패한 편집본을 다시 게시하는 변경은 없다.

카테고리 회귀 검사는 실제 테스트 전송의 `409` 뒤 화면을 다시 연다. 글 편집기 검사는 `409` 실패 이벤트 뒤 화면을 다시 연다. 두 검사 모두 일시적인 `error`가 사라지고 보관한 `failed`만 남은 상태를 확인한다. 이는 버튼이 사라진 원인을 직접 검사한다.

취소 경로는 복구 문자열 전체가 같은지 확인한다. 글 편집기는 Markdown 원문, 코드 설명, 줄바꿈 설정, `blocksChanged`와 `requestId`도 확인한다. 확인 경로는 원본 요청 1회, 원본 복귀와 재게시 없음까지 검사한다. 카테고리는 실패한 전송 보관함의 해제도 검사하므로 이번 조건 변경의 회귀 범위는 충분하다.

### 검사별 입력 결합

[전체 검사](full-node.log)는 검사 664개 통과를 기록했다. 외부 실행 시간 156.71초는 상위 담당자가 전달했다. 이 실행은 이번 두 줄 수정 전이다. [전체 입력 기록](full-node-inputs.json)의 소스 해시는 카테고리 `1af7e051…`와 글 편집기 `3eb865b7…`이며 현재 해시와 다르다. 따라서 현재 소스 전체를 664개로 다시 검사했다고 쓰지 않는다.

[원본 복귀 RED](reset-recovery-red.log)는 두 회귀 검사가 버튼 존재 단언에서 실패한 기록이다. [GREEN](reset-recovery-green.log)은 영향받는 두 테스트 파일의 검사 48개 통과를 기록한다. 외부 실행 시간은 42.8초이며 로그 내부 실행 시간은 42.69초다.

[수정 기록](reset-recovery.md)은 GREEN 전후 해시가 같았다고 기록한다. 검토자가 현재 파일을 읽어 계산한 SHA-256도 네 값과 모두 같았다.

```text
b19679027720c7de73a882c7cc266dd660652c082006d40f1333984c762d9cea  app/web/src/features/content-management/ManagedCategories.tsx
e56c8a32262de11719ac1b5bce97fb697cef6be33bb454e642e0c617da4aa12b  app/web/src/features/content-management/ManagedPostEditor.tsx
2634e4aedd252ca4f07c85c44657d5d1137409c9fa2ee43cb8b49694d3bc2431  tests/web/managed-categories.test.mjs
48d5296cd4047a86be57533cc877144495d4be6e180ad05d9729547e7f59c9a6  tests/web/managed-block-editor.test.mjs
```

상위 담당자는 전체 입력 기록의 44개 파일 중 바뀐 파일이 위 네 개뿐이라고 전달했다. 검토자는 이 비교 전체를 중복 실행하지 않았다. 해시 일치는 기록과 파일 바이트의 결합 근거다. 검사 순서는 담당자의 실행 기록과 소스 동결 선언에 근거한다.

[수정 후 빌드](build-reset-final.log)는 `tsc -b && vite build`와 새 `index-Co9rylJr.js` 산출물을 기록한다. 종료 코드 `0`과 전체 실행 시간 46.90초는 상위 담당자가 전달했다. 상위 담당자가 기록한 해당 산출물의 SHA-256은 `9783a32f968379320478f60f09ac0bb1ed043fb6d2780e676accb7419350554e`다. 검토자는 빌드와 산출물 해시 계산을 중복 실행하지 않았다.

앞선 `build-final.log`와 75.25초 기록은 이전 빌드의 근거로 남긴다. 최신 원격 비교와 전체 결합 기록은 상위 담당자가 별도로 작성한다. 이 검토는 코드와 제공된 실행 기록에 한정하며 GUI 일치와 실제 장치 성능을 새로 측정하지 않았다.

## 직전 한정 재검토 기록

구현자가 두 잔여 수정의 소스를 동결한 뒤 해당 경로를 다시 읽었다. 추가로 상위 담당자가 수정한 글 편집기와 카테고리 편집기의 실패 상태 처리도 검토했다. 다른 파일을 수정하거나 검사를 실행하지 않았다.

### P2-2 잔여 타이머: 해결

`background-sync.mjs:266`은 실패 처리 전에 현재 세션을 확인한다. 저장소 변경 callback 안과 그 변경을 기다린 뒤에도 같은 조건을 확인한다. 마지막 저장소 읽기 뒤인 278행은 취소 또는 세션 교체가 있으면 재예약 전에 돌아간다.

`schedulePublications:195`도 현재 세션의 `scope`를 확인한 뒤 기존 타이머를 지운다. 따라서 이전 확인기가 새 세션의 타이머를 덮지 않는다. 이전 요청과 독자별 취소, 새 세션의 공유 요청 구분도 유지한다.

해당 회귀 검사는 이전 확인기의 마지막 읽기를 멈춘 뒤 새 세션을 시작한다. 읽기를 다시 진행해도 새 세션의 1.5초 확인이 실행되는지 검사한다. [RED](ghost-block-timer-red.log)와 [GREEN](ghost-block-timer-green.log)을 읽었다.

### P2-4 잔여 블록 편집: 해결

`ManagedPostEditor.tsx:152`는 기존 불변 ProseMirror 문서의 참조를 보관한다. 변경 callback은 `eq`로 현재 문서를 비교하고 `blocksChanged` 불리언을 복구본에 기록한다. 큰 블록 배열을 기준값으로 추가 복사하거나 새 해시를 입력마다 만들지 않는다.

Markdown 표시를 위한 초기화는 `blocksChanged:false`다. 실제 이미지 너비 편집은 `true`이며, 같은 문서에서 undo로 초기 상태에 돌아오면 `false`가 된다. 이전 복구본이 실제 편집을 포함했다면 그 표시를 유지한다. 새 필드는 복구 경계에서 불리언인지 검사한다.

`ContentWorkspace.tsx:74`는 저장한 원본 블록이 있으면 기존 배열 비교를 사용한다. 원본 블록이 없으면 `blocksChanged`를 사용한다. 이전 형식에는 `updatedAt`과 공개 상태를 함께 확인해 미저장 편집을 보존한다. 이 이전 형식의 판정은 모호한 복구본을 보존하는 쪽이며 저장소 원문을 지우지 않는다.

회귀 검사는 실제 ProseMirror 이미지의 `previewWidth`를 바꾼다. Markdown이 그대로인데 블록 너비만 달라지는지 검사한다. 이어서 native undo, 관리 목록의 행 수와 복구 원문 보존을 확인한다. [최초 RED](ghost-block-red.log)와 [후속 GREEN](ghost-block-timer-green.log)을 읽었다.

### 실패 상태와 기존 보호: 통과

`ManagedCategories.tsx:195`와 `ManagedPostEditor.tsx:685`는 현재 공개 상태의 `requestId`를 실패 작업의 `clientRequestId`와 비교한다. 같은 요청이면 기존 실패 상태로 바꾸며, 뒤에 시작한 다른 요청의 상태는 유지한다. 편집 내용, 요청 재시도 식별자와 기존 오류 안내는 바꾸지 않는다.

카테고리 확인 원본의 버전 보호와 같은 요청만 정규화하는 조건은 유지한다. 공개 증명의 정확한 커밋 일치, 세션별 IO 중단, 독자별 대기 취소와 응답 후 상태 검사도 그대로다. 완료 이벤트는 공유 요청당 한 번이며 현재 적용 중인 같은 목록을 다시 요청하지 않는다.

캐시 선표시, 본문 지연 로딩, 순차 backlog와 진행 중 요청 병합도 유지한다. JSX의 화면 구조, CSS와 제품 문구를 추가하거나 바꾸지 않았다. 블록 비교가 실제 장치 입력 시간에 주는 영향은 측정하지 않았으므로 실행 성능이 같다고 단정하지 않는다.

### 최종 검사 상태와 한계

[블록·타이머 GREEN](ghost-block-timer-green.log)은 네 검사 통과, 종료 코드 `0`과 실행 시간 4.40초를 기록했다. 글 편집기의 현재 요청 실패와 뒤의 요청 보존 검사 두 개도 이 기록에 포함한다. 별도의 `ghost-editor-failure-green.log`는 검토 시점에 없었다.

[편집기 실패 RED](ghost-editor-failure-red.log)는 같은 요청의 실패 상태가 남지 않던 오류를 기록한다. [카테고리 실패 RED](category-failure-status-red.log)와 [GREEN](category-failure-status-green.log)도 읽었다. 카테고리 GREEN은 검사 17개 통과를 기록한다.

상위 담당자는 마지막 대상 다섯 개와 TypeScript 검사를 구현자가 실행 중이라고 전달했다. 이 최종 실행의 완료 결과는 아직 확인하지 못했다. 앞선 TypeScript 통과 기록을 새 소스 전체의 최종 검사로 대신하지 않는다. 전체 검사, 빌드와 실제 Chrome·Native 검증의 최종 판정은 각 실행 담당자가 맡는다.

## 앞선 한정 재검토 기록

상위 담당자가 네 P2와 `TS2353`을 수정했다고 전달한 뒤 현재 소스를 새로 읽었다. 새 UI, 문구와 CSS 변경은 없다. `recordReceipt`의 두 버전 보호와 확인 원본 재조회 뒤 편집본을 다시 읽는 동작도 유지한다.

### P2-1: 해결

`ContentWorkspace.tsx:85`는 기존 `isSourcePending` 계약을 재사용한다. 따라서 `published`에 과거 `publicationPending:true`가 남아 있어도 대기 상태로 판단하지 않는다. 공유 공개 확인도 `background-sync.mjs:233`에서 완료 결과의 `publicationPending`을 `false`로 정한다.

수정은 수락한 원본 확인 기록 자체를 바꾸지 않는다. `sourceOnly` 식별자와 후속 편집도 보존한다. legacy 완료 복구본과 source-only 공개 완료를 검사하는 회귀 코드가 각각 있다.

### P2-2: 데이터와 요청 중단은 해결, 타이머 재예약은 미해결

`syncSessionController`가 공유 IO를 소유한다. 로그아웃과 계정 전환은 해당 신호를 중단한다. 응답과 저장소 변경을 기다린 뒤 `isCurrentSync`를 확인하므로 이전 계정의 결과를 새 화면에 적용하지 않는다.

독자의 취소 신호는 `waitForPublication`에서 그 독자의 대기만 중단한다. 같은 공개 요청을 읽는 다른 독자의 IO는 유지한다. 요청별 30초 기한, 재검증 반복문의 전체 기한과 순차 요청도 유지했다. 두 취소 계약을 구분하는 회귀 코드를 읽었다.

다만 `background-sync.mjs:275`의 마지막 저장소 읽기 뒤에는 세션 일치 검사가 없다. 계정 전환으로 취소한 이전 확인기가 늦게 돌아오면 276행이 이전 `scope`의 타이머를 예약할 수 있다. 전역 타이머이므로 새 세션의 확인 타이머를 덮고 이전 backlog를 반복해서 예약하는 경로다. 이 Important 수준의 잔여 문제를 상위 담당자와 구현 담당자에게 전달했다.

### P2-3: 해결

공개 완료 이벤트를 공유 `refreshPublication:244`가 한 번 알린다. 기존 확인기는 이벤트를 중복해서 알리지 않는다. 같은 작업의 진행 중 Promise를 재사용하므로 여러 독자가 완료 이벤트를 중복해서 만들지 않는다.

`usePosts.ts:117`은 현재 적용 중인 목록과 같은 `publicCommit`의 완료 이벤트를 받아도 목록을 다시 요청하지 않는다. 다른 커밋의 이벤트는 기존 재요청 경로를 따른다. 요청 정리 시 진행 중 표시를 지우며, 캐시 처리와 목록 처리 모두 `await` 뒤 활성 상태를 확인한다.

실제 mount한 글 편집기와 카테고리 편집기의 회귀 코드를 읽었다. 두 검사는 완료 상태, 이벤트 1회, 공개 확인 1회와 목록 요청 1회를 함께 확인한다. 본문 지연 로딩은 기존 경로를 유지한다.

### P2-4: 표시 초기화는 해결, 원본 없는 후속 블록 편집은 미해결

`ContentWorkspace.tsx:80`은 원본에 `editor.blocks`가 있을 때만 블록을 비교한다. 이 조건은 Markdown 표시를 위해 만든 초기 블록을 변경으로 오인하지 않는다. 원본 블록으로 되돌린 경우도 완료 복구본을 표시하지 않는다.

그러나 같은 조건이 원본에 `editor.blocks`가 없는 실제 블록 편집까지 무시한다. Markdown이 같고 블록 속성만 바뀐 복구본은 관리 목록에서 사라질 수 있다. `change`는 실제 편집 때 `updatedAt`과 `requestId`를 바꾸지만 현재 판정은 이 구분 단서를 쓰지 않는다.

이미지의 `previewWidth`는 검토할 실제 속성 후보다. 설치한 BlockNote의 resize 동작은 이 속성을 저장한다. 현재 직렬화기는 이 속성 때문에 HTML을 선택하지 않으므로 변경 전후 Markdown이 같을 가능성이 있다. 이 속성의 실제 실행은 검토자가 확인하지 않았으며 구현 담당자에게 전달했다.

표시 초기화와 실제 후속 편집을 구분하는 회귀 검사가 필요하다. 이 잔여 문제의 수정과 새 동결 통보를 기다린다.

### 형식 계약과 검사 기록

`overlayContent`는 JSDoc에 `revalidate?: boolean`과 `signal?: AbortSignal`을 명시한다. 호출부의 `AbortSignal` 계약과 일치한다. [TypeScript 기록](ghost-tsc-green.log)은 `tsc -b`가 종료 코드 `0`으로 끝났음을 보고한다.

[리뷰 GREEN](ghost-review-green.log)은 관련 검사 11개 통과를 기록한다. [mount GREEN](ghost-mounted-green.log)은 편집기 통지와 요청 중복 방지 검사 2개 통과를 기록했다. [mount RED](ghost-mounted-red.log)는 수정 전 목록 요청이 2회였던 실패를 보존한다.

검토자는 이 검사를 재실행하지 않았다. 최신 잔여 수정 두 건의 검사는 아직 확인하지 못했다. 상위 담당자의 전체 검사와 빌드가 완료됐다는 최종 기록도 아직 받지 않았다. 앞선 통과 기록을 현재 전체 저장소의 통과로 해석하지 않는다.

## 검토 범위

패치의 소스 네 개와 관련 테스트 네 개를 검토했다.

- `ManagedCategories.tsx`: 현재 요청의 확인 원본을 채택하고 삭제 후 원본을 갱신한다.
- `background-sync.mjs`: 화면 밖 카테고리 확인을 복구하고 공개 상태를 재검증한다.
- `usePosts.ts`: 캐시를 먼저 표시하고 문서마다 공개 목록을 다시 읽는다.
- `ContentWorkspace.tsx`: 삭제한 글을 완료 복구본에서 다시 만들지 않으며 후속 편집을 유지한다.

공유 호출부, 서버의 `/api/publish` 응답, 편집기의 복구 기록도 읽었다. 승인한 UI와 제품 문구를 유지하는지 정적 diff로 확인했다. 앞선 문서·첨부 수정과 다른 담당자의 변경은 이번 패치 밖이다.

## 이전 P2 판정

[초기 검토](category-review.md)의 화면 이동 문제는 소스에서 해결했다. `background-sync.mjs:141`이 같은 `clientRequestId`의 `categories.save` 편집본에 확정 카테고리를 기록한다. 새 편집과 더 높은 `syncVersion`의 편집본에는 적용하지 않는다.

[화면 이동 RED](category-save-navigation-red.log), [복구 RED](category-recovery-red.log)와 [최종 GREEN](category-save-final-green.log)을 읽었다. 최종 기록은 관련 검사 26개 통과를 보고한다. 초기 검토 문서는 당시 판단 근거로 유지한다.

## 확인한 설계와 보호 동작

캐시 표시는 공개 확인 요청을 기다리지 않는다. 본문은 선택한 글만 읽는 기존 경로를 유지한다. 공개 목록 재검증은 성공한 문서 안에서 다시 mount할 때 다운로드를 반복하지 않는다.

공개 작업을 끝내는 조건은 `published` 증명과 `publicCommit === index.contentCommit`이다. 서버는 요청 ID 또는 원본 커밋을 확인하고 GitHub 비교 결과로 포함 관계를 증명한다. 클라이언트는 서로 다른 SHA만으로 커밋 순서를 추측하지 않는다. 증명이 없거나 다른 공개 커밋을 증명하면 저장 작업을 유지한다.

공유 `refreshPublication`은 같은 작업의 진행 중 Promise를 재사용한다. 새 재검증 반복문은 순차 요청과 30초 전체 기한을 사용한다. 저장 작업의 원본과 관리 복구본의 저장소 원문을 지우지 않는다. 후속 제목·본문·분류·태그·첨부·Blocknote 편집과 기존 편집 callback 계약을 유지하려는 구조다.

JSX, CSS와 제품 문구의 변경은 없다. 실제 장치의 표시 시간과 렌더링 시간은 측정하지 않았다.

## 최초 발견 사항과 근거

### P2-1 — 완료 복구본에 남은 `publicationPending`이 삭제 행을 다시 만든다

위치는 `app/web/src/features/content-management/ContentWorkspace.tsx:84`다. 완료 상태보다 `publicationPending:true`를 우선 인정한다.

실제 atomic 저장 응답은 `content.mjs:964`에서 `sourceOnly:true, publicationPending:true`를 포함한다. 공개 확인 응답은 `content.mjs:225`와 1036행에서 `state:'published'`를 주지만 `publicationPending`을 지우지 않는다. `background-sync.mjs:209`가 두 응답을 합치므로 복구본에 `state:'published', publicationPending:true`가 남는다.

이 상태에서 다른 화면이나 장치가 글을 삭제하면 공개 목록에서 글이 사라진다. 그러나 87행은 이 복구본을 대기 중으로 판단해 관리 행을 다시 만든다. 현재 완료 복구 검사의 `{state:'published'}`는 실제 응답 형태를 놓쳤다.

완료 상태와 대기 상태의 우선순위를 명확히 해야 한다. 실제 응답 형태로 저장, 공개 완료, 삭제 목록을 거치는 회귀 검사가 필요하다. 이 발견은 서버와 클라이언트 소스 흐름에 근거하며 실행 재현은 하지 않았다.

### P2-2 — 새 재검증 경로가 로그아웃 뒤에도 이전 계정 작업을 계속 읽는다

위치는 `app/web/src/features/content-management/background-sync.mjs:69`다. 반복문은 시작할 때 잡은 `scope`만 사용한다. 기존 `checkPublications:227`의 `started`와 현재 `context` 검사를 거치지 않는다.

이 경로의 신호는 `usePosts` effect가 소유한다. 그 effect는 세션 변경에 의존하지 않으므로 로그아웃해도 신호를 중단하지 않는다. `stopContentSync:348`은 기존 백그라운드 확인 신호만 중단하며 새 재검증을 중단하지 않는다.

따라서 로그아웃 후에도 이전 계정의 공개 확인 요청을 계속 보낸다. 반복문은 응답 후 이전 계정의 저장 작업을 공개 목록에 적용할 수도 있다. 기존 보호와 같은 중단·계정 일치 검사를 새 경로에도 적용해야 한다. 로그아웃 또는 계정 전환이 응답과 겹치는 검사가 필요하다.

### P2-3 — 새 재검증의 공개 완료가 열린 편집기에 전달되지 않는다

위치는 `app/web/src/features/content-management/background-sync.mjs:71`이다. `refreshPublication`은 공개 상태를 기록하지만 이벤트를 알리지 않는다. `publication` 이벤트는 `checkPublications:230`에만 남았다.

새 목록의 커밋과 증명이 같으면 `overlayContent:81`이 `publicApplied`도 기록한다. 다음 백그라운드 확인은 그 작업을 제외한다. 따라서 공개 확인과 목록 재검증이 겹치면 열린 편집기의 `saved` 표시가 `published`로 바뀌지 않을 수 있다.

`ManagedPostEditor:671`과 `ManagedCategories:191`은 해당 이벤트로 공개 상태를 갱신한다. 두 호출 경로가 같은 공개 완료 통지를 전달해야 한다. 이벤트를 중복해서 알리지 않는 회귀 검사도 필요하다. 기존 백그라운드 작업에서 직접 `onSaved`를 호출하지 않는 계약은 유지 대상이다.

### P2-4 — Markdown을 표시하려고 만든 블록도 후속 편집으로 판단한다

위치는 `app/web/src/features/content-management/ContentWorkspace.tsx:79`다. 원본에 `editor.blocks`가 없고 복구본에 `blocks`가 있으면 항상 변경으로 판단한다.

그러나 `ManagedPostEditor:162`는 Markdown 원본을 열 때 표시용 블록을 만든다. 1175행의 `onInitialize`는 실제 편집 없이 `draft.blocks`를 설정한다. 506행의 effect는 이 복구본을 보관한다.

따라서 Markdown 원본을 열었다 닫은 복구본도 삭제 후 관리 목록에 남는다. 실제 후속 Blocknote 편집을 보존하면서 초기 표시용 블록과 구분해야 한다. 현재 블록 회귀 검사는 원본에 `editor.blocks`가 있는 경우만 다룬다.

Critical 발견 사항과 Minor 발견 사항은 없다. 네 건은 상위 담당자와 구현 담당자에게 전달했다.

## 검사 근거와 한계

[초기 RED](ghost-initial-red.log), [추가 RED](ghost-followup-red.log), [추가 GREEN](ghost-followup-green.log)을 읽었다. legacy 행과 backlog의 두 실패가 각각 의도한 작은 단언에서 발생한 기록이다.

[최종 GREEN](ghost-final-green.log)은 대상 네 파일의 검사 48개 통과, 종료 코드 `0`, 실행 시간 33.23초를 보고한다. 캐시 선표시, 본문 지연 로딩, 정확한 공개 증명, 복구 원문, 후속 편집을 검사한다. 같은 작업의 요청 병합과 단일 재검증의 backlog 요청 상한도 검사한다.

이 기록은 위 네 발견 사항을 검사하지 않는다. 검토자는 전체 검사와 최종 빌드의 실행 소유자가 아니다. 실행 중인 상위 검사를 중복 실행하지 않았다. 실제 Chrome과 Native 확인도 상위 담당자가 맡는다.

## 판단을 보류한 범위

- Native 저장소의 정확한 재생성 원인은 직접 확인하지 않았다. 제공된 관찰과 세 코드 경로만 검토했다.
- 여러 탭의 모든 미저장 편집 충돌을 재설계하지 않는다. 기존 버전 보호와 확인 원본 선택을 유지하는지 검토했다.
- 기존 중복 `updatedAt` 경고는 이번 변경이 만들지 않았으므로 수정 대상으로 삼지 않았다.
- 전체 저장소의 다른 변경과 배포·원격 커밋 상태는 이번 읽기 전용 검토 범위 밖이다.

정적 검토의 수정 요구는 모두 해결했다. 상위 담당자는 동결한 소스의 최종 검사와 빌드 결과를 확인한 뒤 전체 작업의 완료를 판단해야 한다.
