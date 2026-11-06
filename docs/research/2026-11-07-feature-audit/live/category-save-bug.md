# 카테고리 저장 후 편집 상태가 남는 오류

저장 확인을 받은 편집본이 서버 원본의 `sources`를 채택하지 않아 편집 상태가 남았다. 현재 요청의 저장 확인에만 서버 원본을 적용하도록 수정했다. 화면을 떠난 동안 받은 저장 확인도 같은 원본을 보관한다.

## 조사 범위

기준일은 2026-11-07이다. 담당 파일은 `ManagedCategories.tsx`, `background-sync.mjs`, `managed-categories.test.mjs`, `sync-recovery.test.mjs`다. 기존 카테고리 삭제 수정과 다른 담당자의 변경은 유지했다.

상위 담당자는 실제 Chrome에서 신규 카테고리를 저장한 뒤에도 저장 버튼이 켜지고 삭제 버튼이 꺼지는 현상을 전달했다. 원격 커밋 `8f3d7d0129d07ad9b16bf97d603dc51c233c9d63`은 저장 완료 상태였다. 이 문서의 작성자는 원격 저장이나 GUI를 직접 실행하지 않았다.

## 원인

1. `CategoryManager.tsx`는 신규 카테고리를 `sources:[]`로 만든다.
2. `ManagedCategories.tsx`는 이 값을 `categories.save` 작업으로 보낸다.
3. `content.mjs`는 신규 카테고리를 `{id:item.id, sources:[item.id]}`로 만든다. 기존 카테고리의 `sources`는 원본을 유지한다.
4. `withReceipt`는 실제 저장한 카테고리를 응답한다. `recordReceipt`는 이를 원본 캐시에 기록한다.
5. `ManagedCategories.tsx`의 `confirmed` 처리기는 `revision`과 `contentCommit`만 바꿨다. 편집본에는 `sources:[]`가 남았다.
6. `saved` 상태에서는 편집본과 원본을 비교한다. `sources`가 달라 저장 버튼이 켜지고 삭제 버튼이 꺼졌다.

기존 테스트 응답은 요청의 카테고리를 그대로 돌려줬다. 서버가 신규 `sources`를 정하는 동작을 생략해 오류를 놓쳤다.

## 수정

`confirmed` 처리기는 `clientRequestId`가 현재 편집본의 `requestId`와 같으면 `categories`도 확정 원본으로 바꾼다. 저장 중 사용자가 새 편집을 시작했다면 그 편집을 유지한다. 버전과 커밋은 기존 방식대로 갱신한다.

독립 검토는 응답 전에 화면을 떠나면 이 처리기가 실행되지 않는 경로를 발견했다. 실제 이벤트 흐름으로 이 경로의 실패를 재현했다. 공유 `recordReceipt`도 같은 `requestId`의 `categories.save` 편집본에만 `baseline.categories`를 기록하도록 수정했다. 따라서 화면이 없어도 원본과 같은 카테고리를 보관한다.

`recordReceipt`는 재시작 복구와 일반 저장 확인이 함께 사용한다. 두 경로 모두 `applyConfirmation`을 거친다. `ManagedPostEditor`의 글 작업은 `categories.save` 조건에 해당하지 않으므로 기존 원본 재구성과 편집 내용을 유지한다. 두 `syncVersion` 보호 조건, 원본 재조회 뒤 다시 읽기, Web Locks, 캐시 직렬화도 그대로다.

테스트 응답은 서버처럼 기존 원본을 유지하고 신규 카테고리에 `sources:[id]`를 준다. 응답 상태는 `saved`이며 `publicationPending:true`다.

JSX, CSS, 제품 문구는 바꾸지 않았다. 추가 네트워크 요청, 새 반복문이나 새 타이머도 없다.

## 실행한 검사

- [RED 기록](category-save-red.log): 신규 카테고리를 저장하는 회귀 검사 1개가 의도한 단언에서 실패했다. 저장 버튼의 `disabled`가 `false`였다.
- [GREEN 기록](category-save-green.log): `node --test --test-timeout=120000 tests/web/managed-categories.test.mjs`가 종료 코드 `0`으로 끝났다. 검사 15개가 통과했고 32.73초가 걸렸다.
- [화면 이동 RED 기록](category-save-navigation-red.log): 신규 저장 응답 전에 화면을 떠났다가 다시 열면 저장 버튼의 `disabled` 단언이 실패했다.
- [복구 RED 기록](category-recovery-red.log): 현재 요청의 카테고리 복구가 `sources:[]`로 실패했다. 후속 편집과 더 높은 버전의 원본을 보호하는 검사 2개는 통과했다.
- [최종 GREEN 기록](category-save-final-green.log): 두 대상 파일의 검사 26개가 종료 코드 `0`으로 끝났다. 실패는 없었고 39.02초가 걸렸다.
- 신규 회귀 검사는 저장 후 편집 상태, 삭제 버튼, `sources`, 재진입 상태를 확인한다. 저장 후 카테고리 요청이 추가되지 않는지도 확인했다.
- 별도 회귀 검사는 응답을 지연시킨 동안 만든 새 편집을 저장 확인 뒤에도 유지하는지 확인한다.
- 화면 이동 회귀 검사는 컴포넌트가 없는 동안 응답을 받은 뒤 편집본이 깨끗하게 복원되는지 확인했다. 복구 회귀 검사는 현재 요청, 후속 편집, 더 높은 `syncVersion`을 구분한다.
- 담당 파일의 `git diff --check`는 통과했다.

검사 중 기존 `background-sync.mjs`의 중복 `updatedAt` 경고가 나왔다. 요청 범위 밖이므로 수정하지 않았다. 전체 `git diff --check`는 다른 담당자가 수정한 `app/server/src/public-files.mjs`의 마지막 빈 줄을 보고했다.

## 검사와 연결한 파일

SHA-256 값은 최종 GREEN 검사의 소스와 테스트 바이트를 식별한다.

```text
74ea280b2378d85e0d88283f92e58346e622c4ba3e0fea0d142c6fad46ddd582  app/web/src/features/content-management/ManagedCategories.tsx
b1176d3fbc08259451ec9bb6ddce2f31bfe7e5d0a7778eee3a7f2b565d5e6b08  app/web/src/features/content-management/background-sync.mjs
c410a3265fe6b506ab7ce5936499340ebbf313aeac9752ba03baf0352087585f  tests/web/managed-categories.test.mjs
21dd7116ac64ce938d72172472cf0c184343ff12d0afafb859e5ce81baf86a21  tests/web/sync-recovery.test.mjs
```

## 남은 확인

상위 담당자가 빌드와 실제 Chrome에서 저장·삭제를 다시 확인한다. 이 담당자는 전체 검사와 실제 성능 측정을 실행하지 않았다. 카테고리를 다시 요청하지 않는 동작은 회귀 검사로 확인했지만, 실행 시간의 동등성은 측정하지 않았다.
