"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type PreviewPage = {
  type?: string;
  title?: string;
  html: string;
  chapter_number?: number | null;
  part?: number;
  parts?: number;
};

type Labels = {
  prev: string;
  next: string;
  jump: string;
  empty: string;
};

type ViewMode = "single" | "spread";
type ZoomId = "fit" | "75" | "100" | "125";
type SurfaceId = "print" | "tablet" | "phone";

type OutlineItem = {
  key: string;
  label: string;
  index: number;
  type: string;
};

type Props = {
  pages: PreviewPage[];
  css?: Record<string, string | number> | null;
  labels: Labels;
  bookTitle?: string;
  loading?: boolean;
  onOpenFormat?: () => void;
  onRefresh?: () => void;
};

const PREFS_KEY = "bs.preview.prefs.v1";
const FRONT_MATTER = new Set(["cover", "title", "toc"]);

const ZOOM_SCALE: Record<Exclude<ZoomId, "fit">, number> = {
  "75": 0.75,
  "100": 1,
  "125": 1.25,
};

const SURFACE_SIZE: Record<Exclude<SurfaceId, "print">, { w: number; h: number }> = {
  tablet: { w: 480, h: 640 },
  phone: { w: 320, h: 568 },
};

type Prefs = {
  viewMode: ViewMode;
  zoom: ZoomId;
  surface: SurfaceId;
  outlineOpen: boolean;
};

function loadPrefs(): Prefs {
  if (typeof window === "undefined") {
    return { viewMode: "single", zoom: "fit", surface: "print", outlineOpen: true };
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return { viewMode: "single", zoom: "fit", surface: "print", outlineOpen: true };
    }
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      viewMode: parsed.viewMode === "spread" ? "spread" : "single",
      zoom:
        parsed.zoom === "75" || parsed.zoom === "100" || parsed.zoom === "125"
          ? parsed.zoom
          : "fit",
      surface:
        parsed.surface === "tablet" || parsed.surface === "phone"
          ? parsed.surface
          : "print",
      outlineOpen: parsed.outlineOpen !== false,
    };
  } catch {
    return { viewMode: "single", zoom: "fit", surface: "print", outlineOpen: true };
  }
}

function pageLabel(page: PreviewPage, index: number, fallback: string): string {
  if (page.type === "cover") return fallback;
  if (page.type === "title") return page.title || fallback;
  if (page.type === "toc") return page.title || "TOC";
  const title = (page.title || "").trim();
  if (title) {
    if (page.parts && page.parts > 1 && page.part) {
      return `${title} · ${page.part}/${page.parts}`;
    }
    return title;
  }
  return `${index + 1}`;
}

function buildOutline(pages: PreviewPage[], coverLabel: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const seen = new Set<string>();
  pages.forEach((page, index) => {
    const type = page.type || "chapter";
    const base =
      type === "cover"
        ? "cover"
        : type === "title"
          ? "title"
          : type === "toc"
            ? "toc"
            : `ch:${page.chapter_number ?? page.title ?? index}`;
    if (seen.has(base)) return;
    seen.add(base);
    items.push({
      key: base,
      label: pageLabel(page, index, coverLabel),
      index,
      type,
    });
  });
  return items;
}

function PreviewSheet({
  page,
  index,
  css,
  runningHeader,
  showPageNumber,
  side,
}: {
  page: PreviewPage;
  index: number;
  css?: Record<string, string | number> | null;
  runningHeader: string;
  showPageNumber: boolean;
  side?: "left" | "right" | "single";
}) {
  const isFront = FRONT_MATTER.has(page.type || "");
  const header = !isFront && runningHeader ? runningHeader : "";
  const footer = !isFront && showPageNumber;

  return (
    <article
      className="preview-page kindle-page"
      data-page={index + 1}
      data-type={page.type || "chapter"}
      data-side={side || "single"}
      data-page-number={String(css?.page_number || "centro")}
      data-drop-cap={css?.drop_cap ? "true" : "false"}
    >
      {header ? <header className="preview-running-header">{header}</header> : null}
      <div
        className="preview-page-inner"
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
      {footer ? (
        <footer
          className="preview-page-num"
          data-align={css?.page_number === "centro" ? "center" : "outer"}
          data-side={side || "single"}
        >
          {index + 1}
        </footer>
      ) : null}
    </article>
  );
}

export function KindleReader({
  pages,
  css,
  labels,
  bookTitle,
  loading = false,
  onOpenFormat,
  onRefresh,
}: Props) {
  const t = useTranslations("studio");
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [index, setIndex] = useState(0);
  const [focus, setFocus] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

  const total = pages.length;
  const safeIndex = total ? Math.min(Math.max(index, 0), total - 1) : 0;
  const step = prefs.viewMode === "spread" ? 2 : 1;

  useEffect(() => {
    setIndex(0);
  }, [pages]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const go = useCallback(
    (next: number) => {
      if (!total) return;
      setIndex(Math.min(Math.max(next, 0), total - 1));
    },
    [total],
  );

  const goStep = useCallback(
    (delta: number) => {
      go(safeIndex + delta * step);
    },
    [go, safeIndex, step],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape" && focus) {
        event.preventDefault();
        setFocus(false);
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goStep(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goStep(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        go(0);
      } else if (event.key === "End") {
        event.preventDefault();
        go(total - 1);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        setFocus((v) => !v);
      } else if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        setPrefs((p) => ({ ...p, outlineOpen: !p.outlineOpen }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, go, goStep, total]);

  const pageWidth = useMemo(() => {
    if (prefs.surface === "print") return Number(css?.width_px || 420);
    return SURFACE_SIZE[prefs.surface].w;
  }, [css?.width_px, prefs.surface]);

  const pageHeight = useMemo(() => {
    if (prefs.surface === "print") return Number(css?.height_px || 600);
    return SURFACE_SIZE[prefs.surface].h;
  }, [css?.height_px, prefs.surface]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const measure = () => {
      const pad = 48;
      const availableW = Math.max(160, el.clientWidth - pad);
      const availableH = Math.max(200, el.clientHeight - pad);
      const spread = prefs.viewMode === "spread";
      const gap = spread ? 14 : 0;
      const needW = spread ? pageWidth * 2 + gap : pageWidth;
      const scaleW = availableW / needW;
      const scaleH = availableH / pageHeight;
      setFitScale(Math.min(1, scaleW, scaleH));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageHeight, pageWidth, prefs.viewMode, total, focus]);

  const zoomScale = prefs.zoom === "fit" ? fitScale : ZOOM_SCALE[prefs.zoom];

  const style = useMemo(
    () =>
      ({
        "--preview-width": `${pageWidth}px`,
        "--preview-height": `${pageHeight}px`,
        "--preview-padding":
          prefs.surface === "print"
            ? String(css?.padding || "1.5rem")
            : prefs.surface === "phone"
              ? "1.1rem 1rem"
              : "1.35rem 1.2rem",
        "--preview-font": String(css?.font_family || "Georgia, serif"),
        "--preview-size": String(css?.font_size || "11pt"),
        "--preview-leading": String(css?.line_height || 1.5),
        "--preview-indent": `${css?.indent_em ?? 1.5}em`,
        "--preview-gap": `${css?.paragraph_gap_pt ?? 0}pt`,
        "--preview-zoom": String(zoomScale),
      }) as CSSProperties,
    [css, pageHeight, pageWidth, prefs.surface, zoomScale],
  );

  const runningHeader =
    css?.running_header && css.running_header !== "none"
      ? String(css.running_header_text || "").trim()
      : "";
  const showPageNumber = css?.page_number !== "sem";
  const outline = useMemo(
    () => buildOutline(pages, t("previewOutlineCover")),
    [pages, t],
  );
  const leftPage = total ? pages[safeIndex] : null;
  const rightPage =
    prefs.viewMode === "spread" && total > safeIndex + 1 ? pages[safeIndex + 1] : null;
  const progress = total ? ((safeIndex + 1) / total) * 100 : 0;
  const formatLabel = String(css?.format_label || "").replace(/\n/g, " · ");
  const fontLabel = String(css?.font_label || "").replace(/\n/g, " · ");

  function patchPrefs(partial: Partial<Prefs>) {
    setPrefs((prev) => ({ ...prev, ...partial }));
  }

  if (loading && !total) {
    return (
      <div className="kindle-reader kindle-reader--empty" style={style}>
        <p className="muted kindle-empty">{t("previewLoading")}</p>
      </div>
    );
  }

  if (!total || !leftPage) {
    return (
      <div className="kindle-reader kindle-reader--empty" style={style}>
        <div className="kindle-empty-card">
          <h2>{t("previewEmptyTitle")}</h2>
          <p className="muted">{labels.empty}</p>
          {onOpenFormat ? (
            <button type="button" className="btn btn-ghost" onClick={onOpenFormat}>
              {t("previewOpenFormat")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const chromeHidden = focus;

  return (
    <div
      className="kindle-reader"
      style={style}
      data-focus={focus ? "true" : "false"}
      data-surface={prefs.surface}
      data-view={prefs.viewMode}
    >
      {!chromeHidden ? (
        <header className="kindle-toolbar">
          <div className="kindle-toolbar__left">
            <button
              type="button"
              className="btn btn-ghost btn-compact kindle-tool"
              data-active={prefs.outlineOpen}
              onClick={() => patchPrefs({ outlineOpen: !prefs.outlineOpen })}
              aria-pressed={prefs.outlineOpen}
            >
              {t("previewOutline")}
            </button>
            <div className="kindle-toolbar__meta">
              <strong>{bookTitle || leftPage.title || t("previewTitle")}</strong>
              <span className="muted">
                {[formatLabel, fontLabel, t("previewPageOf", { current: safeIndex + 1, total })]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>

          <div className="kindle-toolbar__center" role="group" aria-label={t("previewViewMode")}>
            <button
              type="button"
              className="kindle-seg"
              data-active={prefs.viewMode === "single"}
              onClick={() => patchPrefs({ viewMode: "single" })}
            >
              {t("previewSingle")}
            </button>
            <button
              type="button"
              className="kindle-seg"
              data-active={prefs.viewMode === "spread"}
              onClick={() => patchPrefs({ viewMode: "spread" })}
            >
              {t("previewSpread")}
            </button>
          </div>

          <div className="kindle-toolbar__right">
            <label className="kindle-select">
              <span className="sr-only">{t("previewSurface")}</span>
              <select
                value={prefs.surface}
                onChange={(e) => patchPrefs({ surface: e.target.value as SurfaceId })}
                aria-label={t("previewSurface")}
              >
                <option value="print">{t("previewSurfacePrint")}</option>
                <option value="tablet">{t("previewSurfaceTablet")}</option>
                <option value="phone">{t("previewSurfacePhone")}</option>
              </select>
            </label>
            <label className="kindle-select">
              <span className="sr-only">{t("previewZoom")}</span>
              <select
                value={prefs.zoom}
                onChange={(e) => patchPrefs({ zoom: e.target.value as ZoomId })}
                aria-label={t("previewZoom")}
              >
                <option value="fit">{t("previewZoomFit")}</option>
                <option value="75">75%</option>
                <option value="100">100%</option>
                <option value="125">125%</option>
              </select>
            </label>
            {onRefresh ? (
              <button
                type="button"
                className="btn btn-ghost btn-compact kindle-tool"
                onClick={onRefresh}
                disabled={loading}
              >
                {loading ? t("previewRefreshing") : t("previewRefresh")}
              </button>
            ) : null}
            {onOpenFormat ? (
              <button
                type="button"
                className="btn btn-ghost btn-compact kindle-tool"
                onClick={onOpenFormat}
              >
                {t("previewOpenFormat")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-compact kindle-tool"
              onClick={() => setFocus(true)}
              title={t("previewFocusHint")}
            >
              {t("previewFocus")}
            </button>
          </div>
        </header>
      ) : (
        <button
          type="button"
          className="kindle-focus-exit"
          onClick={() => setFocus(false)}
        >
          {t("previewExitFocus")}
        </button>
      )}

      <div
        className="kindle-body"
        data-outline={prefs.outlineOpen && !chromeHidden ? "true" : "false"}
      >
        {prefs.outlineOpen && !chromeHidden ? (
          <aside className="kindle-outline" aria-label={t("previewOutline")}>
            <p className="kindle-outline__title">{t("previewOutline")}</p>
            <nav className="kindle-outline__list">
              {outline.map((item, outlineIndex) => {
                const nextIndex = outline[outlineIndex + 1]?.index ?? total;
                const active = safeIndex >= item.index && safeIndex < nextIndex;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="kindle-outline__item"
                    data-active={active ? "true" : "false"}
                    onClick={() => go(item.index)}
                  >
                    <span className="kindle-outline__type">{item.type}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <p className="muted kindle-outline__hint">{t("previewShortcuts")}</p>
          </aside>
        ) : null}

        <div className="kindle-main">
          <div className="kindle-stage" ref={stageRef}>
            <button
              type="button"
              className="kindle-tap kindle-tap-prev"
              aria-label={labels.prev}
              disabled={safeIndex <= 0}
              onClick={() => goStep(-1)}
            />
            <div className="kindle-spread" data-mode={prefs.viewMode}>
              <PreviewSheet
                page={leftPage}
                index={safeIndex}
                css={css}
                runningHeader={runningHeader}
                showPageNumber={showPageNumber}
                side={prefs.viewMode === "spread" ? "left" : "single"}
              />
              {prefs.viewMode === "spread" ? (
                rightPage ? (
                  <PreviewSheet
                    page={rightPage}
                    index={safeIndex + 1}
                    css={css}
                    runningHeader={runningHeader}
                    showPageNumber={showPageNumber}
                    side="right"
                  />
                ) : (
                  <div className="kindle-page kindle-page--blank" aria-hidden />
                )
              ) : null}
            </div>
            <button
              type="button"
              className="kindle-tap kindle-tap-next"
              aria-label={labels.next}
              disabled={safeIndex >= total - 1}
              onClick={() => goStep(1)}
            />
          </div>

          {!chromeHidden ? (
            <footer className="kindle-scrubber">
              <button
                type="button"
                className="btn btn-ghost btn-compact kindle-nav"
                disabled={safeIndex <= 0}
                onClick={() => goStep(-1)}
              >
                ← {labels.prev}
              </button>
              <label className="kindle-scrubber__track">
                <span className="sr-only">{labels.jump}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, total - 1)}
                  step={1}
                  value={safeIndex}
                  onChange={(e) => go(Number(e.target.value))}
                  aria-valuetext={t("previewPageOf", {
                    current: safeIndex + 1,
                    total,
                  })}
                />
                <span
                  className="kindle-scrubber__fill"
                  style={{ width: `${progress}%` }}
                  aria-hidden
                />
              </label>
              <div className="kindle-scrubber__jump">
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
                          ? ` · ${pageLabel(item, i, t("previewOutlineCover")).slice(0, 40)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-compact kindle-nav"
                disabled={safeIndex >= total - 1}
                onClick={() => goStep(1)}
              >
                {labels.next} →
              </button>
            </footer>
          ) : null}
        </div>
      </div>
    </div>
  );
}
