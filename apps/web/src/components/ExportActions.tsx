"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type ExportFormat = "pdf" | "docx" | "epub";

type Props = {
  busy?: boolean;
  disabled?: boolean;
  variant?: "menu" | "cards";
  onExport: (format: ExportFormat) => void;
};

const FORMATS: { id: ExportFormat; labelKey: "exportPdf" | "exportDocx" | "exportEpub"; hintKey: "exportPdfHint" | "exportDocxHint" | "exportEpubHint" }[] = [
  { id: "pdf", labelKey: "exportPdf", hintKey: "exportPdfHint" },
  { id: "docx", labelKey: "exportDocx", hintKey: "exportDocxHint" },
  { id: "epub", labelKey: "exportEpub", hintKey: "exportEpubHint" },
];

export function ExportActions({
  busy = false,
  disabled = false,
  variant = "menu",
  onExport,
}: Props) {
  const t = useTranslations("studio");
  const common = useTranslations("common");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (variant === "cards") {
    return (
      <section className="export-cards" aria-label={common("export")}>
        <header className="export-cards-head">
          <h3>{t("exportTitle")}</h3>
          <p className="muted">{t("exportLead")}</p>
        </header>
        <div className="export-card-grid">
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="export-card"
              disabled={busy || disabled}
              onClick={() => onExport(item.id)}
            >
              <strong>{t(item.labelKey)}</strong>
              <span className="muted">{t(item.hintKey)}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || disabled}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {common("export")} ▾
      </button>
      {open ? (
        <div id={menuId} className="export-menu-panel" role="menu">
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="export-menu-item"
              disabled={busy || disabled}
              onClick={() => {
                setOpen(false);
                onExport(item.id);
              }}
            >
              <strong>{t(item.labelKey)}</strong>
              <span className="muted">{t(item.hintKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
