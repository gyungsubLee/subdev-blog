import Button from "../../components/button/Button";
import { useState } from "react";
import HeaderAction from "../../components/header-action/HeaderAction";
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
  saveLabel?: string;
  disabled?: boolean;
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
  saveLabel = "초안 저장",
  disabled = false,
}: EditorToolbarProps) {
  const [help, setHelp] = useState(false);

  return (
    <>
      <header className="editor-header">
        <Button type="button" className="editor-back" onClick={onClose}>
          ← 기록으로
        </Button>
        <span className="editor-breadcrumb">
          {site.name} <span>/</span> {title || editorConfig.untitledTitle}
        </span>
        <HeaderAction
          type="button"
          className="editor-help"
          onClick={() => setHelp(!help)}
          aria-expanded={help}
        >
          단축키
        </HeaderAction>
      </header>
      <div className="editor-actions">
        <span role="status">{status}</span>
        <label className="editor-file">
          불러오기
          <input
            type="file"
            accept=".md,.markdown,.json"
            disabled={disabled}
            onChange={(event) => {
              void onImport(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <Button type="button" onClick={onExportMarkdown}>.md 내보내기</Button>
        <Button type="button" onClick={onExportBackup}>원본 백업</Button>
        <Button type="submit" className="editor-save" disabled={disabled} onClick={(event) => {
          if (!event.currentTarget.form) {
            event.preventDefault();
            onSave();
          }
        }}>
          {saveLabel}
        </Button>
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
