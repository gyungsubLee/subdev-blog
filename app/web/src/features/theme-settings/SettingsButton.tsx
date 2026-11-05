import Button from "../../components/button/Button";
import { useEffect, useId, useRef, useState } from "react";
import HeaderAction from "../../components/header-action/HeaderAction";
import {
  accents,
  applyThemeSettings,
  DEFAULT_SETTINGS,
  palettes,
  getThemeState,
  saveThemeSettings,
  type ThemeSettings,
} from "./theme";
import "./theme-settings.css";

export default function SettingsButton() {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <HeaderAction
        type="button"
        className="settings-trigger"
        aria-label="설정"
        title="설정"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(true)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m9 3-.7 2.4-2 .9-2.3-.6-2 3.5 1.6 1.8v2.1L2 15l2 3.5 2.3-.6 2 .9L9 21h4l.7-2.2 2-.9 2.3.6 2-3.5-1.6-1.9V11L20 9.2l-2-3.5-2.3.6-2-.9L13 3H9Z" />
          <circle cx="11" cy="12" r="3" />
        </svg>
      </HeaderAction>
      {open && <SettingsDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [{ settings, persisted }, setThemeState] = useState(getThemeState);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  function update(next: ThemeSettings) {
    applyThemeSettings(next);
    const saved = saveThemeSettings(next);
    setThemeState({ settings: next, persisted: saved });
  }

  const dark = palettes.find(palette => palette.id === settings.palette)?.dark ?? false;

  return (
    <dialog
      ref={dialog}
      id={id}
      className="theme-settings-dialog"
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-description"}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onClose={onClose}
    >
      <div className="theme-settings-heading">
        <h2 id={id + "-title"}>설정</h2>
        <Button type="button" className="settings-close" aria-label="설정 닫기" onClick={close}>
          ×
        </Button>
      </div>
      <p id={id + "-description"}>색상은 바로 적용되며 이 브라우저에 저장합니다.</p>
      <label className="settings-label" htmlFor={id + "-palette"}>전체 색상 팔레트</label>
      <select
        id={id + "-palette"}
        value={settings.palette}
        onChange={event => update({ ...settings, palette: event.target.value as ThemeSettings["palette"] })}
      >
        {palettes.map(palette => <option value={palette.id} key={palette.id}>{palette.name}</option>)}
      </select>
      <fieldset className="settings-accents">
        <legend>강조색</legend>
        <label className="settings-accent-option settings-accent-default">
          <input
            type="radio"
            name={id + "-accent"}
            value="palette"
            checked={settings.accent === "palette"}
            onChange={() => update({ ...settings, accent: "palette" })}
          />
          팔레트 기본색
        </label>
        <div className="settings-accent-grid">
          {accents.map(accent => (
            <label className="settings-accent-option" key={accent.id}>
              <input
                type="radio"
                name={id + "-accent"}
                value={accent.id}
                checked={settings.accent === accent.id}
                onChange={() => update({ ...settings, accent: accent.id })}
              />
              <span className="settings-swatch" aria-hidden="true" style={{ backgroundColor: dark ? accent.dark : accent.light }} />
              {accent.name}
            </label>
          ))}
        </div>
      </fieldset>
      {!persisted && <p className="settings-storage-error" role="status">브라우저에 저장하지 못했습니다. 새로고침 전까지 적용됩니다.</p>}
      <div className="theme-settings-actions">
        <Button type="button" className="settings-reset" onClick={() => update({ ...DEFAULT_SETTINGS })}>기본값으로</Button>
        <Button type="button" className="settings-done" onClick={close}>닫기</Button>
      </div>
    </dialog>
  );
}
