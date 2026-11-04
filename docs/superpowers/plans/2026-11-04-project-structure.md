# 프로젝트 구조 변경 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 사용자가 문서 작성, 구현, 검증을 함께 요청했다. 이 세션에서 직접 구현한다.

**Goal:** 승인한 app 영역 구조와 site 명칭으로 코드, 도구, 검사, 빌드를 연결한다.
**Architecture:** 원본 기능을 보존하며 파일을 이동하고 상대 경로를 갱신한다. 일반 빌드의 정적 콘텐츠 복사를 서버 목록 준비와 분리한다.
**Tech Stack:** React, TypeScript, Vite, Node test, Swift, Python unittest.
**Spec:** docs/architecture/project-structure.md

## Global Constraints

- 콘텐츠 서브모듈과 기존 수정 바이트를 보존한다.
- UI와 실행 로직, 캐시, 지연 로딩을 유지한다.
- 의존성과 패키지를 추가하지 않는다.
- 공개 콘텐츠 복사를 일반 개발 및 빌드에서 제외한다.
- 기존 초안의 호환 자산을 보존한다.
- 전체 Node 검사의 실행 소유자는 이 세션이다. 중복 실행하지 않는다.
- 기존 사용자 수정이 섞여 있으므로 자동 커밋을 만들지 않는다.

## Review Focus

- 임시 checkout과 Git 없는 배포에서도 콘텐츠 커밋 검증을 유지한다.
- 경로가 바뀐 검사에서 원래 assertion과 실패 주입을 보존한다.
- 웹 빌드가 네이티브 결과를 삭제하지 않는다.
- Vercel 함수에 서버 목록이 포함되고 원본 콘텐츠는 제외된다.
- 기존 초안의 /notion URL과 정적 자산 바이트를 보존한다.

## Task 1: 기준과 변경 전 증거

**Files:** docs/architecture/project-structure.md, .tmp/structure-migration/*.
**Interfaces:** 현재 코드와 승인 구조를 입력으로 받아 경로 매핑과 변경 전 증거를 만든다.
- [x] 기존 작업 상태와 소스, 자산 해시를 보관한다.
- [x] 기존 전체 검사와 성능 측정을 기록한다.
- [x] tests/server/project-structure.test.mjs에 새 경로와 일반 빌드의 콘텐츠 복사 중단 검사를 쓴다.
- [x] 검사가 현재 구조에서 실패하는지 확인한다.

## Task 2: 영역 이동과 실행 연결

**Files:** app/**, tests/**, scripts/**, 루트 설정, .github/workflows/**.
**Interfaces:** API, 콘텐츠 처리 함수, 화면 동작의 공개 계약을 유지한다.
- [x] src를 app/web/src로 옮기고 app 폴더를 site로 바꾼다.
- [x] server, native, 공용 콘텐츠 코드와 도구를 소유 영역으로 이동한다.
- [x] 테스트를 web, server, content, native로 분류하고 support를 유지한다.
- [x] import와 임시 프로젝트 fixture 경로를 갱신한다.
- [x] 서버 목록 준비와 명시적 정적 내보내기를 분리한다.
- [x] Vite root, publicDir, 출력 경로, Vercel과 네이티브 빌드를 갱신한다.
- [x] 새 구조 검사와 TypeScript를 확인한다.

## Task 3: 검증과 문서 정합성

**Files:** README.md, docs/guides/**, docs/architecture/**, .project-context/**.
**Interfaces:** 새 명령과 경로에 대해 실행 증거와 미확인 항목을 제공한다.
- [x] 전체 Node 검사와 콘텐츠 검사를 실행한다.
- [x] Python 검사와 웹 및 네이티브 빌드를 실행한다.
- [x] 성능 전후, 원본 소스, 자산 바이트와 서브모듈 커밋을 대조한다.
- [ ] Chrome 연결을 통해 가능 범위의 로컬 화면을 확인한다.
- [x] 독립 검토에서 중요한 문제를 수정한다.
- [x] README와 실행 안내, 검증 결과 및 작업 상태를 갱신한다.


## 실행 중 확인한 사항

- 변경 전 전체 검사: 467개 중 463개 통과. 기존 편집기 실패 2개와 포트 권한 실패 2개를 구분했다.
- 포트 검사는 제한 밖에서 별도 실행해 3개 모두 통과했다.
- 첫 변경 후 전체 검사: 480개 중 478개 통과. 같은 편집기 실패 2개만 남았다.
- 실행 중 별도 수정이 함께 들어왔다. 색상과 스타일, 분류 코드 및 검사 추가의 소유자는 확인하지 못했다.
- 해당 수정은 보존했다. 이 작업이 UI 동일성을 검증했다고 쓰지 않는다.
- 독립 검토에서 workflow의 정적 콘텐츠 가정과 자산 도구의 이전 경로를 찾았다.
- workflow는 배포 파일 바이트와 공개 API의 커밋, 글 ID, 본문 revision을 확인하도록 바꿨다.
- 정적 내보내기는 dist/static/content에 격리했다. 일반 웹 빌드는 이를 포함하지 않는다.
- 이관 CLI의 기본 자산 경로도 수정했다. 이전 경로 실패와 수정 후 통과를 확인했다.
- macOS 임시 경로의 /var 별칭 때문에 새 CLI fixture가 실행되지 않았다. fixture를 realpath로 정규화했다.
- 공개 자산 6,455개는 이동 전후 SHA-256이 같았다. 콘텐츠 서브모듈은 깨끗한 기존 커밋을 유지한다.
- 성능 비교 3쌍에서 응답 바이트, 요청 수, 캐시 보유량이 모두 같았다.
- Chrome 탭 생성과 연결은 native pipe 오류로 실패했다. 실제 화면 비교는 미확인이다.


## 최종 상태

구조 구현을 완료했다. [검증 결과](../../research/2026-11-04-project-structure/verification.md)에 실행 결과와 실패를 구분했다.
최신 전체 실행은 487개 중 481개 통과다. 기존 편집기 실패 2개와 동시 테마 작업의 모듈 누락 4개가 남았다.
테마 작업은 이후에도 소스를 갱신했다. 최신 통합 상태의 검증을 완료했다고 주장하지 않는다.
새 macOS 앱 빌드와 서명 검증은 통과했다. 구조 변경 전후 Chrome 화면 비교는 미확인이다.
