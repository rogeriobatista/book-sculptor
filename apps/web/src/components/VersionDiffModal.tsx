"use client";

import { useTranslations } from "next-intl";
import { diffLines } from "@/lib/text-diff";

type Props = {
  versionLabel: string;
  currentText: string;
  versionText: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function VersionDiffModal({
  versionLabel,
  currentText,
  versionText,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const t = useTranslations("studio");
  const lines = diffLines(currentText, versionText);
  const hasChanges = lines.some((line) => line.type !== "same");

  return (
    <div className="version-diff-overlay" role="presentation" onClick={onCancel}>
      <div
        className="version-diff-modal"
        role="dialog"
        aria-labelledby="version-diff-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="version-diff-header">
          <h3 id="version-diff-title">{t("versionDiffTitle")}</h3>
          <p className="muted">{versionLabel}</p>
        </header>

        <div className="version-diff-columns" aria-label={t("versionDiffTitle")}>
          <div className="version-diff-col">
            <p className="version-diff-col-label">{t("versionDiffCurrent")}</p>
          </div>
          <div className="version-diff-col">
            <p className="version-diff-col-label">{t("versionDiffVersion")}</p>
          </div>
        </div>

        <div className="version-diff-body">
          {hasChanges ? (
            <ol className="version-diff-lines">
              {lines.map((line, index) => (
                <li
                  key={`${line.type}-${index}`}
                  className="version-diff-line"
                  data-type={line.type}
                >
                  <span className="version-diff-gutter">
                    {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                  </span>
                  <span className="version-diff-text">{line.text || " "}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted version-diff-empty">{t("versionDiffNoChanges")}</p>
          )}
        </div>

        <footer className="version-diff-footer">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            {t("versionDiffCancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {t("versionDiffConfirmRestore")}
          </button>
        </footer>
      </div>
    </div>
  );
}
