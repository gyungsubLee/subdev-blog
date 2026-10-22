# Notion 작성 UX

Notion의 핵심 블록 작성 흐름을 웹 편집기에 적용했다. 모든 Notion 기능과 화면의 동일성은 검증하지 않았다.

## 조사한 원문

- [Notion 단축키](https://www.notion.com/help/keyboard-shortcuts)
- [Notion 작성 기본](https://www.notion.com/help/writing-and-editing-basics)
- [Notion 코드블록](https://www.notion.com/help/code-blocks)
- [Notion 미디어](https://www.notion.com/help/images-files-and-media)
- [BlockNote 형식 변환](https://www.blocknotejs.org/docs/foundations/supported-formats)

확인일은 2026-10-22다. 원문은 외부 검색 도구로 읽었다. Chrome 화면 조사와 대조는 실행하지 못했다.

## 구현한 작성 흐름

| 입력 또는 도구 | 동작 | 검사 |
| --- | --- | --- |
| `/` | 블록 검색 메뉴 | DOM 통합 검사, 화면 실검증 대기 |
| 블록 핸들 | 블록 이동과 메뉴 | 화면 실검증 대기 |
| `# `, `## `, `### ` | 제목 | DOM 상태 검사 |
| `- `, `1. `, `a. `, `i. ` | 목록 | DOM 상태 검사 |
| `[] ` | 체크박스 | DOM 상태 검사 |
| `> ` | 토글 | DOM 상태 검사 |
| `" ` | 인용 | DOM 상태 검사 |
| 백틱 세 개와 공백 | 코드블록 | DOM 상태 검사 |
| Cmd+Option+0–8 | Mac 블록 변환 | 키 이벤트 검사 |
| Ctrl+Shift+0–8 | Windows 블록 변환 | 키 이벤트 검사 |
| Cmd 또는 Ctrl + E | 인라인 코드 | 선택 영역 검사 |
| Cmd 또는 Ctrl + D | 선택 블록 복제 | 중첩 내용과 새 ID 검사 |
| Cmd 또는 Ctrl + Shift + ↑·↓ | 블록 이동 | 순서 검사 |
| 코드 언어·줄바꿈·캡션 | 코드 도구 | 속성 보존과 DOM 검사 |
| 코드 복사 | 클립보드로 복사 | 실제 브라우저 검증 대기 |
| Cmd 또는 Ctrl + S | 브라우저 초안 저장 | 저장 계층 검사 |

숫자 0–8은 본문, 제목 1–3, 체크박스, 글머리 목록, 번호 목록, 토글, 코드에 대응한다.
페이지 생성에 해당하는 숫자 9는 구현하지 않았다.

선택 서식 도구막대, 링크, 표와 미디어 블록은 BlockNote의 기본 기능을 사용한다.
코드 구문 강조는 편집기에서 필요한 언어를 불러온다.
지원 언어는 JavaScript, TypeScript, Python, Go, Bash, JSON, HTML, CSS, SQL, Markdown, Java와 C++이다.

## 보존과 제한

블록 JSON은 중첩 구조와 코드 언어·캡션·줄바꿈 설정을 보존한다.
Markdown은 호환용 형식이며 블록 전용 속성을 모두 표현하지 못한다.
코드 본문·언어·캡션이 Markdown에 남는지는 별도로 검사했다.

한글 조합 중 변환 단축키를 막는 키 이벤트를 검사했다.
실제 한국어 입력기와 Chrome의 조합 동작은 아직 검증하지 못했다.

입력 규칙을 Backspace로 되돌리면 기본 라이브러리가 끝 공백을 추가할 수 있다.
공동 편집, 댓글, 데이터베이스 편집, Notion 전체 UI와 웹에서 공개 발행은 이 예시에 포함하지 않는다.

## 실행 근거

- `tests/notion-editor.test.mjs`: 입력, 키맵, 복제, 이동과 코드 설정
- `tests/drafts.test.mjs`: 초안 교체, 기존 데이터 보존과 저장 실패
- `tests/import-document.test.mjs`: Markdown 왕복과 가져오기 검증
- `tests/blog.test.mjs`: 안전한 HTML, 내부 링크와 글 본문 로딩
- `tests/editor-ui.test.mjs`: 실제 React 편집기의 저장, 가져오기, 내보내기와 슬래시 메뉴
