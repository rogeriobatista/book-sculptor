"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

export type PreviewPage = {
  type?: string;
  title?: string;
  html: string;
};

type Labels = {
  prev: string;
  next: string;
  jump: string;
  empty: string;
};

type Props = {
  pages: PreviewPage[];
  css?: Record<string, string | number> | null;
  labels: Labels;
};

export function KindleReader({ pages, css, labels }: Props) {
  const t = useTranslations("studio");
  const [index, setIndex] = useState(0);
  const total = pages.length;
  const safeIndex = total ? Math.min(Math.max(index, 0), total - 1) : 0;
  const page = total ? pages[safeIndex] : null;

  useEffect(() => {
    setIndex(0);
  }, [pages]);

  const go = useCallback(
    (next: number) => {
      if (!total) return;
      setIndex(Math.min(Math.max(next, 0), total - 1));
    },
    [total],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        go(safeIndex + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(safeIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        go(0);
      } else if (event.key === "End") {
        event.preventDefault();
        go(total - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, safeIndex, total]);

  const style = useMemo(
    () =>
      ({
        "--preview-width": `${css?.width_px || 420}px`,
        "--preview-height": `${css?.height_px || 600}px`,
        "--preview-padding": String(css?.padding || "1.5rem"),
        "--preview-font": String(css?.font_family || "Georgia, serif"),
        "--preview-size": String(css?.font_size || "11pt"),
        "--preview-leading": String(css?.line_height || 1.5),
        "--preview-indent": `${css?.indent_em ?? 1.5}em`,
        "--preview-gap": `${css?.paragraph_gap_pt ?? 0}pt`,
      }) as CSSProperties,
    [css],
  );

  const runningHeader =
    css?.running_header && css.running_header !== "none"
      ? String(css.running_header_text || "").trim()
      : "";
  const showPageNumber = css?.page_number !== "sem";

  if (!total || !page) {
    return <p className="muted kindle-empty">{labels.empty}</p>;
  }

  const label = page.title || page.type || `${safeIndex + 1}`;

  return (
    <div className="kindle-reader" style={style}>
      <div className="kindle-toolbar">
        <button
          type="button"
          className="btn btn-ghost kindle-nav"
          disabled={safeIndex <= 0}
          onClick={() => go(safeIndex - 1)}
          aria-label={labels.prev}
        >
          ← {labels.prev}
        </button>

        <div className="kindle-page-controls">
          <label className="kindle-jump">
            <span className="muted">{labels.jump}</span>
            <select
              value={safeIndex}
              onChange={(event) => go(Number(event.target.value))}
              aria-label={labels.jump}
            >
              {pages.map((item, i) => (
                <option key={`${i}-${item.title || item.type || "page"}`} value={i}>
                  {i + 1}
                  {item.title || item.type
                    ? ` · ${(item.title || item.type || "").slice(0, 42)}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="kindle-page-of muted">
            {t("previewPageOf", { current: safeIndex + 1, total })}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost kindle-nav"
          disabled={safeIndex >= total - 1}
          onClick={() => go(safeIndex + 1)}
          aria-label={labels.next}
        >
          {labels.next} →
        </button>
      </div>

      <div className="kindle-stage">
        <button
          type="button"
          className="kindle-tap kindle-tap-prev"
          aria-label={labels.prev}
          disabled={safeIndex <= 0}
          onClick={() => go(safeIndex - 1)}
        />
        <article
          className="preview-page kindle-page"
          data-page={safeIndex + 1}
          data-page-number={String(css?.page_number || "centro")}
          data-drop-cap={css?.drop_cap ? "true" : "false"}
        >
          {runningHeader ? (
            <header className="preview-running-header">{runningHeader}</header>
          ) : null}
          <div
            className="preview-page-inner"
            dangerouslySetInnerHTML={{ __html: page.html }}
          />
          {showPageNumber ? (
            <footer className="preview-page-num">
              {safeIndex + 1}
            </footer>
          ) : (
            <footer className="preview-page-num preview-page-num--hidden" aria-hidden>
              {label}
            </footer>
          )}
        </article>
        <button
          type="button"
          className="kindle-tap kindle-tap-next"
          aria-label={labels.next}
          disabled={safeIndex >= total - 1}
          onClick={() => go(safeIndex + 1)}
        />
      </div>
    </div>
  );
}
