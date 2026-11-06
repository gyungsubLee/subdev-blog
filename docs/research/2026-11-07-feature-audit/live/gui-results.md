# 실제 GUI 검사 결과

실제 카테고리 복구·수정·삭제와 삭제 이후 새 저장을 확인했다. 테스트 카테고리 A와 B를 정리했고 기존 48개로 돌아왔다.
Chrome에서 전체 글 3,032개와 삭제 글 부재를 확인했다. 루트의 네이티브 AX 근거에서도 같은 결과를 확인했다.
Chrome 로그아웃과 검사 탭 정리를 완료했다. 기준일은 2026-11-07 KST다.
이 문서는 GUI 검사 결과다. 원격 원본의 최종 SHA 비교와 앱·서버 종료는 루트의 별도 근거를 따른다.

## 검사 환경과 소유권

- 실행 앱: `.tmp/live-feature-audit/Second Brain Audit.app`
- 원본 주소: `http://127.0.0.1:55173`
- 사용한 전용 Chrome 탭: `1490591923`, `1490591926`. 마지막 inventory에서 두 탭 모두 없었다.
- 루트는 기존 탭 `1490591873`, `1490591904`를 닫았다. 뒤의 inventory에서 `1490591923`도 없어졌다.
- 이 담당자는 GUI와 이 보고서·근거 파일만 수정한다. 소스 수정·빌드·자동 검사는 루트 담당이다.
- 테스트 카테고리 A와 후속 테스트 B만 수정·삭제한다. 기존 카테고리 48개와 글은 수정하지 않는다.
- 캐시와 로컬 저장소를 지우지 않는다. UI·문구·스타일을 바꾸지 않는다.

## 저장 충돌과 복구 중 관찰한 상태

1. 전용 Chrome 탭을 만들었다. 로그인 유지, 카테고리 49개와 `Audit-20261107-live-v2(0)`를 확인했다.
2. A의 이름을 `Audit-20261107-live-v3`로 바꾸고 확인했다. 저장 전 삭제 버튼이 비활성화됐다.
3. 변경사항 저장을 1회 눌렀다. UI는 `저장 확인 중`을 거쳐 `Atomic source save rejected`를 표시했다.
4. 오류 후 로컬 v3와 미저장 상태는 남았다. 변경사항 저장은 활성화됐고 삭제는 비활성화 상태였다.
5. 같은 요청을 반복하지 않았다. 루트의 원격 읽기는 HEAD `4cc628a0e8ae81e80415e550a71155f8291b64af`와 A의 v2 이름을 확인했다.
6. 기존 `최신 원본으로 다시 시작` 버튼과 확인창 승인을 각각 1회 실행했다. 이후 AX와 화면 캡처가 연결 시간 초과를 보고했다.
7. 확인창 재조회는 대화상자 없음으로 끝났다. 원본 재시작의 실제 완료 여부는 확인하지 못했다.
8. 탭 닫기도 시간 초과를 보고했다. 새 inventory에서 기존 탭 `1490591923`이 남아 있음을 확인했다.
9. 승인된 복구 탭 `1490591926`을 만들었다. AX·화면 캡처가 다시 동작했다.
10. 복구 탭에는 v3 로컬 편집과 미저장 상태가 남았다. 실행 취소는 비활성화됐고 저장 확인 중을 표시했다.

이 시점에는 원격 v2와 로컬 v3가 달라 새 저장이나 삭제를 실행하지 않았다. 캐시와 로컬 저장소는 끝까지 보존했다.
루트는 최초 저장 실패를 오래된 sourceBase의 409 보호 경로로 판단했다. 이 담당자는 서버 응답 본문을 직접 읽지 않았다.

## 삭제 글 부재와 실패 상태 확인

루트는 `index-C4Sh0lOL.js`와 `ManagedPostEditor-NIcmLagP.js` 빌드 성공을 알렸다.
이 담당자는 같은 탭에서 캐시를 유지하고 새로고침했다. 만료된 로그인은 기존 권한의 OAuth로 다시 연결했다.

- v3 복구 편집에서 저장을 1회 눌렀다. 즉시 변화가 없었지만 지연 처리 뒤 `Atomic source save rejected`를 표시했다.
- 카테고리 화면으로 돌아오자 게시 상태가 `저장 실패`와 `저장 재시도`로 바뀌었다. 저장 확인 중 문구 잔류는 해소됐다.
- 첫 복귀 상태에서는 최신 원본 재시작 버튼이 없었다. 뒤의 fresh AX에서는 오류 본문과 재시작 버튼이 함께 나타났다.
- 이 동작을 저장의 무반응으로 판정하지 않는다. 루트는 5초 debounce 뒤 확인 경로가 실행됐다고 설명했다.
- 콘텐츠 관리에서 전체 3,032개, 공개 3,032개, 초안 0개를 확인했다.
- 검색 `20261107-native-crud`는 빈 결과와 0개를 표시했다.

Chrome 근거: [삭제 글 부재 화면](gui-chrome-ghost-absent.png), [전체 AX](gui-chrome-ghost-absent-ax.txt).
카테고리 실패 근거: [복구 버튼 화면](gui-category-failed-reset-visible-bottom.png), [전체 AX](gui-category-failed-reset-visible-ax.txt).

루트는 Audit 앱의 도구 모음 새로고침과 기존 권한 OAuth 재로그인을 실행했다.
이 담당자는 루트가 저장한 AX를 읽고 `55173/#/content`, 전체·공개 3,032개와 같은 검색의 빈 결과를 확인했다.
네이티브 직접 조작자는 루트다. [글 수 AX](native-final-count-ax.txt), [삭제 글 부재 AX](native-final-absent-ax.txt)를 근거로 삼는다.

실패 근거: [스크린샷](gui-category-save-rejected.png), [전체 AX 상태](gui-category-save-rejected-ax.txt).
복구 근거: [스크린샷](gui-category-recovery-v3.png), [전체 AX 상태](gui-category-recovery-v3-ax.txt).

## 도구에서 관찰한 제한

- 기존 Chrome 탭 연결은 루트 세션 소유권 때문에 거부됐다. 승인된 별도 탭 생성 후 AX와 입력이 동작했다.
- Audit 앱의 정확한 경로로 실행한 `cua.getApp`은 775.9초 뒤 `user-aborted`를 반환했다. 루트가 응답 없는 호출을 중단했다.
- 이 중단은 사용자의 거절이나 취소가 아니다. 그 호출에서 저장·삭제 입력은 실행하지 않았다.
- Chrome 연결 오류는 `CDP command Emulation.setFocusEmulationEnabled`의 10초 시간 초과다. 탭 inventory는 계속 동작했다.
- 중복 원본 앱 종료와 최종 빌드 뒤 Audit의 `cua.getApp`을 1회 재시도했다. `timeout_ms=30000`을 명시했지만 반환하지 않았다.
- 루트가 이 호출을 중단했고 도구는 121.8초 뒤 `user-aborted`를 반환했다. 네이티브 입력은 실행하지 않았다.
- 뒤의 inventory는 Second Brain 1개 실행 중을 표시했다. macOS inventory는 창과 정확한 경로를 제공하지 않았다.
- 위의 연결 실패만으로 네이티브의 글 수나 삭제 글 부재를 판정하지 않았다.
- 루트가 네이티브 검사 소유권을 받았다. 루트 세션의 exact Audit 연결은 0.63초로 성공했다고 알렸다.
- 이 담당자는 뒤의 네이티브 검사를 실행하지 않는다. 루트의 결과는 별도 근거로 기록한다.
- Chrome의 최신 원본 재시작 확인창에서 `getJsDialog()`는 `confirm`을 반환했다. `accept()`는 같은 CDP focus 시간 초과로 끝났다.
- 루트에 정확한 탭 `1490591926`과 URL을 전달했다. 브라우저 확인창만 네이티브 AX로 처리하는 복구를 요청했다.
- 루트는 같은 bundle ID의 원본 실패 앱을 종료했다고 알렸다. Audit 앱 종료도 루트 담당이다.
- 프로젝트 context 검사는 `missing/oversized entry point: .project-context/INDEX.md`로 끝났다. 이 담당자는 context를 수정하지 않았다.

## 실제 카테고리 복구와 정리

루트가 Chrome의 기존 재시작 확인창만 네이티브 AX로 처리했다. 이 담당자는 같은 탭의 fresh AX에서 복구 결과를 확인했다.
A는 `Audit-20261107-live-v2(0)`로 돌아왔고 저장한 상태·저장 비활성화·삭제 활성화를 표시했다.

이 담당자는 A의 이름을 v3로 바꾸고 저장했다. 원본 저장 완료와 미저장 상태 해제, 삭제 활성화를 확인했다.
실제 원본 커밋은 [c30bdaf2997d182c36739fbca033a5f980fedcd0](https://github.com/gyungsubLee/subdev-blog-content/commit/c30bdaf2997d182c36739fbca033a5f980fedcd0)이다.
[저장 상태 화면](gui-category-a-save-clean.png), [전체 AX](gui-category-a-save-clean-ax.txt)를 저장했다.

A 삭제 확인창에서 이름을 확인하고 삭제 확정을 1회 눌렀다. 목록은 48개와 저장한 상태로 돌아왔다.
삭제 커밋은 [ba5e4c21472d56f406c9d5ada63249699612bb73](https://github.com/gyungsubLee/subdev-blog-content/commit/ba5e4c21472d56f406c9d5ada63249699612bb73)이다.
[삭제 화면](gui-category-a-delete.png), [전체 AX](gui-category-a-delete-ax.txt)를 저장했다.

같은 화면을 유지하며 B `Audit-20261107-after-delete(0)`를 추가하고 저장했다. 새로고침이나 캐시 삭제는 하지 않았다.
B 저장도 미저장 상태 해제와 삭제 활성화를 확인했다. 삭제 후 다음 저장 회귀를 실제로 검사한 결과다.
B 저장 커밋은 [2b9bbfe23b3f79295ed9642df9cdaaeb30e209a7](https://github.com/gyungsubLee/subdev-blog-content/commit/2b9bbfe23b3f79295ed9642df9cdaaeb30e209a7)이다.
[후속 저장 화면](gui-category-b-save-clean.png), [전체 AX](gui-category-b-save-clean-ax.txt)를 저장했다.

B 이름을 확인한 앱 삭제 모달에서 삭제 확정을 1회 눌렀다. 목록은 다시 48개와 저장한 상태로 돌아왔다.
B 삭제 커밋은 [a6628433e88419b76b02822715e8836c0e80125d](https://github.com/gyungsubLee/subdev-blog-content/commit/a6628433e88419b76b02822715e8836c0e80125d)이다.
[B 삭제 화면](gui-category-b-delete.png), [전체 AX](gui-category-b-delete-ax.txt)를 저장했다.

## 최신 빌드와 검사 환경 정리

루트는 재시작 버튼 조건을 보완한 `index-Co9rylJr.js`와 `ManagedPostEditor-CQglSYy2.js` 빌드 성공을 알렸다.
모든 원격 쓰기가 끝난 뒤 같은 탭에서 새로고침했다. 캐시와 로컬 저장소를 지우지 않았다.

- 카테고리 48개, 저장한 상태와 저장 비활성화를 확인했다. A와 B는 없었고 `테스트용 카테고리 추가(0)`는 남았다.
- 이전 저장 실패 배너는 없었다. [최종 화면](gui-category-final-48.png), [전체 AX](gui-category-final-48-ax.txt)를 저장했다.
- 로그아웃 1회 뒤 `로그인이 필요합니다`와 로그인 링크를 확인했다. 관리 메뉴와 로그아웃 버튼은 사라졌다.
- [로그아웃 화면](gui-chrome-logout.png), [전체 AX](gui-chrome-logout-ax.txt)를 저장했다.
- 탭 `1490591926`을 닫았다. fresh inventory에서 `1490591926`과 `1490591923` 부재를 확인했다.

## 이 보고서의 판정 범위

- 이 담당자는 제품 소스·UI·문구·CSS를 수정하지 않았다. 테스트 카테고리 A와 B 외의 원격 항목은 수정하지 않았다.
- GUI 검사는 카테고리 저장·삭제와 삭제 이후 저장, 원격 충돌 때 편집 보존, 삭제 글 부재와 로그아웃을 확인했다.
- 프레임 시간이나 응답 시간의 전후 비교는 실행하지 않았다. 이 결과만으로 성능 동등성을 판정하지 않는다.
- 기존 원격 파일과 카테고리 순서의 최종 SHA 비교는 별도 담당의 근거를 따른다.
- 네이티브 로그아웃·앱 메뉴 종료·소유 서버 종료 확인은 루트 담당이다.
