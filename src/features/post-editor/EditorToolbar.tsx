import { useState } from "react";
import { site } from "../../config/site";
import { editorConfig } from "./config";
import EditorShortcuts from "./EditorShortcuts";
import "./editor.css";

type EditorToolbarProps = {
  title: string;
  status: string;
  error: string;
  onClose: () => void;
  onImport: (file: File | undefined) => Promise<void>;
  onExportMarkdown: () => void;
  onExportBackup: () => void;
  onSave: () => void;
};

export default function EditorToolbar({
  title,
  status,
  error,
  onClose,
  onImport,
  onExportMarkdown,
  onExportBackup,
  onSave,
}: EditorToolbarProps) {
  const [help, setHelp] = useState(false);

  return (
    <>
      <header className="editor-header">
        <button className="editor-back" onClick={onClose}>
          ← 기록으로
        </button>
        <span className="editor-breadcrumb">
          {site.name} <span>/</span> {title || editorConfig.untitledTitle}
        </span>
        <button
          className="editor-help"
          onClick={() => setHelp(!help)}
          aria-expanded={help}
        >
          단축키
        </button>
      </header>
      <div className="editor-actions">
        <span role="status">{status}</span>
        <label className="editor-file">
          불러오기
          <input
            type="file"
            accept=".md,.markdown,.json"
            onChange={(event) => {
              void onImport(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <button onClick={onExportMarkdown}>.md 내보내기</button>
        <button onClick={onExportBackup}>원본 백업</button>
        <button className="editor-save" onClick={onSave}>
          초안 저장
        </button>
      </div>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      {help ? <EditorShortcuts onClose={() => setHelp(false)} /> : null}
    </>
  );
}
