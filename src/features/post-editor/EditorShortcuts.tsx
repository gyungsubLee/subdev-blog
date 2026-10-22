const shortcuts = [
  ["/", "블록 메뉴 열기"],
  ["# · ## · ### + Space", "제목 1 · 2 · 3"],
  ["- + Space / [] + Space", "글머리 목록 / 체크박스"],
  ['> + Space / " + Space', "토글 / 인용"],
  ["``` + Space", "코드블록"],
  ["⌘/Ctrl + B · I · U · E", "굵게 · 기울임 · 밑줄 · 코드"],
  ["⌘/Ctrl + K", "링크"],
  ["⌘⌥ + 0–8 / Ctrl⇧ + 0–8", "블록 종류 바꾸기"],
  ["Tab / Shift + Tab", "들여쓰기 / 내어쓰기"],
  ["⌘/Ctrl + D", "블록 복제"],
  ["⌘/Ctrl + Shift + ↑/↓", "블록 이동"],
  ["⌘/Ctrl + S", "이 브라우저에 초안 저장"],
];

export default function EditorShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <aside className="editor-shortcuts" aria-label="작성 단축키">
      <div className="editor-shortcuts-heading">
        <strong>익숙한 방식으로 쓰세요.</strong>
        <button onClick={onClose} aria-label="단축키 닫기">
          ×
        </button>
      </div>
      <dl>
        {shortcuts.map(([key, value]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <a
        href="https://www.notion.com/help/keyboard-shortcuts"
        target="_blank"
        rel="noreferrer"
      >
        Notion 공식 단축키 ↗
      </a>
    </aside>
  );
}
