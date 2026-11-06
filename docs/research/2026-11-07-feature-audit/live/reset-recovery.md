# 실패한 편집본의 원본 복귀

카테고리와 글 편집기에 기존 원본 복귀 버튼을 다시 표시하도록 수정했다. 보관한 `failed` 상태를 복원해도 같은 버튼을 사용할 수 있다.

기준일은 2026-11-07이다. 제품 소스 변경은 버튼 표시 조건 두 줄뿐이다. 기존 사용자 변경과 다른 담당자의 변경은 유지했다.

## 원인과 수정

두 화면은 보관한 `publication`을 복원하지만 일시적인 `error`는 복원하지 않는다. 기존 버튼은 `error` 또는 완료 상태에서만 표시했다. 따라서 `publication.state='failed'`를 복원하면 버튼이 사라졌다.

`ManagedCategories.tsx`와 `ManagedPostEditor.tsx`의 버튼 표시 조건에 `failed`를 추가했다. 제품 문구, CSS와 버튼 구성은 그대로다. `accepted`, `dirty`, 실패 처리기와 확인 대화상자 조건도 바꾸지 않았다.

## 회귀 검사

카테고리 검사는 실제 테스트 전송이 `409`를 반환한 뒤 컴포넌트를 다시 연다. 글 편집기 검사는 같은 `409` 실패 이벤트를 받은 뒤 컴포넌트를 다시 연다. 두 검사 모두 일시적인 오류 문구가 없는 복원 상태를 확인한다.

두 화면 모두 원본 복귀를 취소하면 보관한 문자열 전체가 유지되는지 검사한다. 글 편집기는 Markdown 원문, 코드 설명, 줄바꿈 설정, `blocksChanged`와 `requestId`도 확인한다. 확인을 선택하면 원본을 한 번 읽고 원본으로 돌아가며 실패한 편집본을 게시하지 않는지 검사한다.

## 실행 근거

- [RED 로그](reset-recovery-red.log): 회귀 검사 2개가 기존 원본 복귀 버튼을 찾는 단언에서 실패했다. 외부 제한은 180초, 동시 실행은 2개였다. 종료 코드는 `1`이며 6.7초가 걸렸다.
- [GREEN 로그](reset-recovery-green.log): 두 대상 파일의 검사 48개가 통과했다. 실패, 취소와 건너뛴 검사는 없었다. 종료 코드는 `0`이며 외부 감시 기준으로 42.8초가 걸렸다.
- 담당 파일 네 개의 `git diff --check`는 통과했다.

RED와 GREEN 모두 외부 시간 제한이나 출력 제한에 도달하지 않았다. 검사에서 기존 `background-sync.mjs`의 중복 `updatedAt` 경고가 나왔으며 범위 밖이므로 수정하지 않았다.

실행 명령은 기존 외부 감시 스크립트를 사용한다. 감시 스크립트는 180초 또는 출력 16 MiB를 넘으면 실행 그룹을 종료한다.

```text
python3 .tmp/run-verification.py reset-recovery-red 180 node --test --test-concurrency=2 --test-name-pattern='a failed (category|editor) save restores reset' tests/web/managed-categories.test.mjs tests/web/managed-block-editor.test.mjs
python3 .tmp/run-verification.py reset-recovery-green 180 node --test --test-concurrency=2 tests/web/managed-categories.test.mjs tests/web/managed-block-editor.test.mjs
```

## 소스 동결

제품 소스 두 줄을 수정한 뒤 소스를 동결했다. 이후 제품 소스와 테스트를 추가로 수정하지 않았다. 아래 SHA-256은 GREEN 검사 전후에 일치했다.

```text
b19679027720c7de73a882c7cc266dd660652c082006d40f1333984c762d9cea  app/web/src/features/content-management/ManagedCategories.tsx
e56c8a32262de11719ac1b5bce97fb697cef6be33bb454e642e0c617da4aa12b  app/web/src/features/content-management/ManagedPostEditor.tsx
2634e4aedd252ca4f07c85c44657d5d1137409c9fa2ee43cb8b49694d3bc2431  tests/web/managed-categories.test.mjs
48d5296cd4047a86be57533cc877144495d4be6e180ad05d9729547e7f59c9a6  tests/web/managed-block-editor.test.mjs
```

이 담당자는 빌드, TypeScript 검사, GUI와 원격 쓰기를 실행하지 않았다. 상위 담당자가 후속 검증을 진행한다. 이 변경은 표시 조건만 바꾸므로 네트워크, 캐시, 계산과 렌더링 경로의 성능 비교는 실행하지 않았다.
