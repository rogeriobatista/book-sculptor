"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ImportMode = "append" | "replace";

export type ImportConfirmPayload = {
  files: File[];
  mode: ImportMode;
  useAiStructure: boolean;
};

type Labels = {
  title: string;
  lead: string;
  pickFiles: string;
  dropHint: string;
  selected: string;
  tocHint: string;
  modeLabel: string;
  append: string;
  appendHint: string;
  replace: string;
  replaceHint: string;
  aiStructure: string;
  aiStructureHint: string;
  aiStructureUpgrade: string;
  cancel: string;
  confirm: string;
  emptyBookNote: string;
};

type Props = {
  open: boolean;
  chapterCount: number;
  busy?: boolean;
  canUseAi?: boolean;
  labels: Labels;
  onClose: () => void;
  onConfirm: (payload: ImportConfirmPayload) => void;
};

export function ImportManuscriptModal({
  open,
  chapterCount,
  busy = false,
  canUseAi = false,
  labels,
  onClose,
  onConfirm,
}: Props) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<ImportMode>(
    chapterCount > 0 ? "append" : "replace",
  );
  const [useAiStructure, setUseAiStructure] = useState(canUseAi);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setMode(chapterCount > 0 ? "append" : "replace");
    setUseAiStructure(canUseAi);
    setDragOver(false);
  }, [open, chapterCount, canUseAi]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const fileSummary = useMemo(() => {
    if (!files.length) return null;
    return files.map((file) => `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`);
  }, [files]);

  if (!open) return null;

  function takeFiles(list: FileList | File[] | null) {
    const next = list ? Array.from(list) : [];
    const allowed = next.filter((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith(".pdf") || name.endsWith(".docx");
    });
    setFiles(allowed);
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">
              {labels.title}
            </h2>
            <p className="muted modal-lead">{labels.lead}</p>
          </div>
          <button
            type="button"
            className="modal-x"
            aria-label={labels.cancel}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div
          className="import-dropzone"
          data-active={dragOver}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            takeFiles(event.dataTransfer.files);
          }}
        >
          <p className="import-drop-title">{labels.dropHint}</p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {labels.pickFiles}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            hidden
            disabled={busy}
            onChange={(event) => {
              takeFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {fileSummary ? (
          <div className="import-file-list">
            <p className="import-file-label">{labels.selected}</p>
            <ul>
              {fileSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="import-toc-hint muted">{labels.tocHint}</p>

        <fieldset className="import-mode" disabled={busy || chapterCount === 0}>
          <legend>{labels.modeLabel}</legend>
          {chapterCount === 0 ? (
            <p className="muted">{labels.emptyBookNote}</p>
          ) : null}
          <label className="import-mode-option" data-active={mode === "append"}>
            <input
              type="radio"
              name="import-mode"
              value="append"
              checked={mode === "append"}
              disabled={chapterCount === 0}
              onChange={() => setMode("append")}
            />
            <span>
              <strong>{labels.append}</strong>
              <span className="muted">{labels.appendHint}</span>
            </span>
          </label>
          <label className="import-mode-option" data-active={mode === "replace"}>
            <input
              type="radio"
              name="import-mode"
              value="replace"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            <span>
              <strong>{labels.replace}</strong>
              <span className="muted">{labels.replaceHint}</span>
            </span>
          </label>
        </fieldset>

        <label className="import-ai-option" data-disabled={!canUseAi}>
          <input
            type="checkbox"
            checked={canUseAi && useAiStructure}
            disabled={busy || !canUseAi}
            onChange={(event) => setUseAiStructure(event.target.checked)}
          />
          <span>
            <strong>{labels.aiStructure}</strong>
            <span className="muted">
              {canUseAi ? labels.aiStructureHint : labels.aiStructureUpgrade}
            </span>
          </span>
        </label>

        <footer className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || files.length === 0}
            onClick={() =>
              onConfirm({
                files,
                mode: chapterCount === 0 ? "replace" : mode,
                useAiStructure: canUseAi && useAiStructure,
              })
            }
          >
            {labels.confirm}
          </button>
        </footer>
      </div>
    </div>
  );
}
