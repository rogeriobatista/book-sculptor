"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { type Book, clientApiFetch, isAbortError } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";
import { useToast } from "@/components/ToastProvider";

type StyleOption = { id: string; label: string; description?: string };
type FormatOption = {
  id: string;
  label: string;
  width_cm?: number;
  height_cm?: number;
};
type FontOption = { id: string; label: string; css_family?: string };
type DensityOption = {
  id: string;
  label: string;
  margins_cm?: [number, number, number, number];
};
type SimpleOption = { id: string; label: string };

type LayoutPreset = {
  format_id: string;
  font_id: string;
  font_size: number;
  density: string;
  page_number: string;
  include_toc: boolean;
  typography_line_height: number;
  typography_indent_cm: number;
  typography_paragraph_spacing_pt: number;
  typography_skip_first_indent: boolean;
  typography_chapter_ornament: boolean;
  drop_cap: boolean;
  running_header: string;
};

type LayoutOptions = {
  formats?: FormatOption[];
  fonts?: FontOption[];
  styles?: StyleOption[];
  densities?: DensityOption[];
  page_numbers?: SimpleOption[];
  running_headers?: SimpleOption[];
  presets?: Record<string, LayoutPreset>;
};

type DraftSettings = {
  style_id: string;
  format_id: string;
  font_id: string;
  font_size: number;
  density: string;
  page_number: string;
  include_toc: boolean;
  typography_line_height: number;
  typography_indent_cm: number;
  typography_paragraph_spacing_pt: number;
  typography_skip_first_indent: boolean;
  typography_chapter_ornament: boolean;
  drop_cap: boolean;
  running_header: string;
};

type FormatTab = "presets" | "type" | "page" | "structure";

type Props = {
  book: Book;
  canEdit?: boolean;
  onSaved: (book: Book) => void;
  onOpenPreview?: () => void;
};

const FALLBACK_FONTS: Record<string, string> = {
  georgia: '"Georgia", "Times New Roman", serif',
  literata: '"Literata", "Georgia", serif',
  garamond: '"EB Garamond", "Garamond", "Times New Roman", serif',
  baskerville: '"Libre Baskerville", "Baskerville", "Georgia", serif',
};

function draftFromBook(book: Book): DraftSettings {
  const settings = book.settings || {};
  return {
    style_id: String(settings.style_id || "prosa_literaria"),
    format_id: String(settings.format_id || "medio"),
    font_id: String(settings.font_id || "garamond"),
    font_size: Number(settings.font_size || 11),
    density: String(settings.density || "padrao"),
    page_number: String(settings.page_number || "centro"),
    include_toc: settings.include_toc !== false,
    typography_line_height: Number(settings.typography_line_height || 1.4),
    typography_indent_cm: Number(settings.typography_indent_cm ?? 0.7),
    typography_paragraph_spacing_pt: Number(
      settings.typography_paragraph_spacing_pt ?? 0,
    ),
    typography_skip_first_indent: settings.typography_skip_first_indent !== false,
    typography_chapter_ornament: settings.typography_chapter_ornament !== false,
    drop_cap: Boolean(settings.drop_cap),
    running_header: String(settings.running_header || "none"),
  };
}

export function FormatPanel({
  book,
  canEdit = true,
  onSaved,
  onOpenPreview,
}: Props) {
  const { getTokenRef } = useStableAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const common = useTranslations("common");
  const [options, setOptions] = useState<LayoutOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<FormatTab>("presets");
  const [draft, setDraft] = useState<DraftSettings>(() => draftFromBook(book));

  useEffect(() => {
    setDraft(draftFromBook(book));
  }, [book.id, book.settings]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const token = await getTokenRef.current();
        const data = await clientApiFetch<LayoutOptions>(
          "/api/v1/books/options",
          token,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted) setOptions(data);
      } catch (err) {
        if (!isAbortError(err) && !ac.signal.aborted) setOptions(null);
      }
    })();
    return () => ac.abort();
  }, [getTokenRef]);

  const dirty = useMemo(() => {
    const saved = draftFromBook(book);
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [book, draft]);

  const selectedFormat = options?.formats?.find((item) => item.id === draft.format_id);
  const selectedFont = options?.fonts?.find((item) => item.id === draft.font_id);
  const selectedDensity = options?.densities?.find((item) => item.id === draft.density);
  const selectedStyle = options?.styles?.find((item) => item.id === draft.style_id);

  const fontFamily =
    selectedFont?.css_family ||
    FALLBACK_FONTS[draft.font_id] ||
    FALLBACK_FONTS.garamond;

  const pageAspect = useMemo(() => {
    const w = selectedFormat?.width_cm || 14;
    const h = selectedFormat?.height_cm || 21;
    return w / h;
  }, [selectedFormat]);

  const marginPad = useMemo(() => {
    const margins = selectedDensity?.margins_cm || [2.2, 2.2, 2.5, 2.0];
    const scale = 4.2;
    return `${margins[0] * scale}px ${margins[3] * scale}px ${margins[1] * scale}px ${margins[2] * scale}px`;
  }, [selectedDensity]);

  function patchDraft(partial: Partial<DraftSettings>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  function applyPreset(styleId: string) {
    const preset = options?.presets?.[styleId];
    if (!preset) {
      patchDraft({ style_id: styleId });
      return;
    }
    setDraft({
      style_id: styleId,
      format_id: preset.format_id,
      font_id: preset.font_id,
      font_size: preset.font_size,
      density: preset.density,
      page_number: preset.page_number,
      include_toc: preset.include_toc,
      typography_line_height: preset.typography_line_height,
      typography_indent_cm: preset.typography_indent_cm,
      typography_paragraph_spacing_pt: preset.typography_paragraph_spacing_pt,
      typography_skip_first_indent: preset.typography_skip_first_indent,
      typography_chapter_ornament: preset.typography_chapter_ornament,
      drop_cap: preset.drop_cap,
      running_header: preset.running_header,
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    const loadingId = toast.loading(t("notifySaving"));
    try {
      const token = await getTokenRef.current();
      const updated = await clientApiFetch<Book>(`/api/v1/books/${book.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          title: book.title,
          author: book.author,
          locale: book.locale,
          settings: {
            ...(book.settings || {}),
            ...draft,
          },
        }),
      });
      onSaved(updated);
      toast.update(loadingId, { tone: "success", title: t("notifySaved") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("notifySaveFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: FormatTab; label: string }[] = [
    { id: "presets", label: t("formatTabPresets") },
    { id: "type", label: t("formatTabType") },
    { id: "page", label: t("formatTabPage") },
    { id: "structure", label: t("formatTabStructure") },
  ];

  return (
    <div className="format-hub">
      <header className="format-panel-head">
        <div>
          <h2>{t("formatTitle")}</h2>
          <p className="muted">{t("formatLeadTypography")}</p>
        </div>
        {onOpenPreview ? (
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={onOpenPreview}
          >
            {t("formatOpenPreview")}
          </button>
        ) : null}
      </header>

      <div className="format-hub-layout">
        <form className="format-hub-controls" onSubmit={onSubmit}>
          <div className="publish-subnav" role="tablist" aria-label={t("formatSubnav")}>
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className="publish-subnav-tab"
                aria-selected={tab === item.id}
                data-active={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <section className="settings-card publish-tab-panel" role="tabpanel">
            {tab === "presets" ? (
              <>
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("formatPresetsTitle")}</h3>
                  <p className="settings-card__lead">{t("formatPresetsLead")}</p>
                </div>
                <div className="format-preset-grid">
                  {(
                    options?.styles || [
                      {
                        id: "prosa_literaria",
                        label: "Prosa Literária",
                        description: t("formatPresetLiteraryHint"),
                      },
                      {
                        id: "editorial",
                        label: "Editorial",
                        description: t("formatPresetEditorialHint"),
                      },
                      {
                        id: "compacto_digital",
                        label: "Compacto Digital",
                        description: t("formatPresetDigitalHint"),
                      },
                    ]
                  ).map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      className="format-preset-card"
                      data-active={draft.style_id === style.id}
                      disabled={!canEdit || busy}
                      onClick={() => applyPreset(style.id)}
                    >
                      <strong>{style.label}</strong>
                      <span className="muted">
                        {style.description || selectedStyle?.description || ""}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="muted publish-field-hint">{t("formatPresetApplyHint")}</p>
              </>
            ) : null}

            {tab === "type" ? (
              <>
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("formatTypographyTitle")}</h3>
                  <p className="settings-card__lead">{t("formatTypographyLead")}</p>
                </div>
                <div className="format-fields-grid">
                  <label className="team-field">
                    <span>{t("formatFont")}</span>
                    <select
                      value={draft.font_id}
                      disabled={!canEdit || busy}
                      onChange={(e) => patchDraft({ font_id: e.target.value })}
                    >
                      {(options?.fonts || [
                        { id: "garamond", label: "Garamond" },
                        { id: "georgia", label: "Georgia" },
                        { id: "literata", label: "Literata" },
                        { id: "baskerville", label: "Baskerville" },
                      ]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label.replace(/\n/g, " · ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="team-field">
                    <span>{t("formatFontSize")}</span>
                    <input
                      type="number"
                      min={10}
                      max={14}
                      value={draft.font_size}
                      disabled={!canEdit || busy}
                      onChange={(e) =>
                        patchDraft({
                          font_size: Math.min(14, Math.max(10, Number(e.target.value) || 11)),
                        })
                      }
                    />
                  </label>
                  <label className="team-field">
                    <span>{t("formatLineHeight")}</span>
                    <input
                      type="number"
                      min={1.15}
                      max={2}
                      step={0.05}
                      value={draft.typography_line_height}
                      disabled={!canEdit || busy}
                      onChange={(e) =>
                        patchDraft({
                          typography_line_height: Number(e.target.value) || 1.4,
                        })
                      }
                    />
                  </label>
                  <label className="team-field">
                    <span>{t("formatIndent")}</span>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={draft.typography_indent_cm}
                      disabled={!canEdit || busy}
                      onChange={(e) =>
                        patchDraft({
                          typography_indent_cm: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <label className="team-field">
                    <span>{t("formatParagraphSpacing")}</span>
                    <input
                      type="number"
                      min={0}
                      max={18}
                      step={1}
                      value={draft.typography_paragraph_spacing_pt}
                      disabled={!canEdit || busy}
                      onChange={(e) =>
                        patchDraft({
                          typography_paragraph_spacing_pt: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                </div>
                <label className="settings-toggle-row">
                  <span className="settings-toggle-row__copy">
                    <span className="settings-toggle-row__label">
                      {t("formatSkipFirstIndent")}
                    </span>
                    <span className="settings-toggle-row__hint">
                      {t("formatSkipFirstIndentHint")}
                    </span>
                  </span>
                  <input
                    className="settings-toggle-row__input"
                    type="checkbox"
                    checked={draft.typography_skip_first_indent}
                    disabled={!canEdit || busy}
                    onChange={(e) =>
                      patchDraft({ typography_skip_first_indent: e.target.checked })
                    }
                  />
                </label>
                <label className="settings-toggle-row">
                  <span className="settings-toggle-row__copy">
                    <span className="settings-toggle-row__label">{t("formatDropCap")}</span>
                    <span className="settings-toggle-row__hint">
                      {t("formatDropCapHint")}
                    </span>
                  </span>
                  <input
                    className="settings-toggle-row__input"
                    type="checkbox"
                    checked={draft.drop_cap}
                    disabled={!canEdit || busy}
                    onChange={(e) => patchDraft({ drop_cap: e.target.checked })}
                  />
                </label>
              </>
            ) : null}

            {tab === "page" ? (
              <>
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("formatPageTitle")}</h3>
                  <p className="settings-card__lead">{t("formatPageLead")}</p>
                </div>
                <div className="format-fields-grid">
                  <label className="team-field">
                    <span>{t("formatSize")}</span>
                    <select
                      value={draft.format_id}
                      disabled={!canEdit || busy}
                      onChange={(e) => patchDraft({ format_id: e.target.value })}
                    >
                      {(options?.formats || [
                        { id: "medio", label: "Médio · 14 × 21 cm" },
                        { id: "padrao", label: "Padrão · 15,5 × 23 cm" },
                        { id: "bolso", label: "Bolso · 11 × 18 cm" },
                        { id: "trade_6x9", label: "US Trade · 6 × 9 in" },
                        { id: "trade_55x85", label: "Digest · 5.5 × 8.5 in" },
                        { id: "tecnico", label: "Técnico · 21 × 29,7 cm" },
                      ]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label.replace(/\n/g, " · ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="team-field">
                    <span>{t("formatDensity")}</span>
                    <select
                      value={draft.density}
                      disabled={!canEdit || busy}
                      onChange={(e) => patchDraft({ density: e.target.value })}
                    >
                      {(options?.densities || [
                        { id: "compacto", label: "Compacto" },
                        { id: "padrao", label: "Padrão" },
                        { id: "espacoso", label: "Espaçoso" },
                      ]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selectedDensity?.margins_cm ? (
                  <p className="muted publish-field-hint">
                    {t("formatMarginsHint", {
                      top: selectedDensity.margins_cm[0],
                      bottom: selectedDensity.margins_cm[1],
                      inner: selectedDensity.margins_cm[2],
                      outer: selectedDensity.margins_cm[3],
                    })}
                  </p>
                ) : null}
              </>
            ) : null}

            {tab === "structure" ? (
              <>
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("formatStructureTitle")}</h3>
                  <p className="settings-card__lead">{t("formatStructureLead")}</p>
                </div>
                <div className="format-fields-grid">
                  <label className="team-field">
                    <span>{t("formatPageNumbers")}</span>
                    <select
                      value={draft.page_number}
                      disabled={!canEdit || busy}
                      onChange={(e) => patchDraft({ page_number: e.target.value })}
                    >
                      {(options?.page_numbers || [
                        { id: "externo", label: "Externo" },
                        { id: "centro", label: "Centro" },
                        { id: "sem", label: "Sem" },
                      ]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="team-field">
                    <span>{t("formatRunningHeader")}</span>
                    <select
                      value={draft.running_header}
                      disabled={!canEdit || busy}
                      onChange={(e) => patchDraft({ running_header: e.target.value })}
                    >
                      {(options?.running_headers || [
                        { id: "none", label: t("formatHeaderNone") },
                        { id: "title", label: t("formatHeaderTitle") },
                        { id: "author", label: t("formatHeaderAuthor") },
                      ]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="settings-toggle-row">
                  <span className="settings-toggle-row__copy">
                    <span className="settings-toggle-row__label">{t("formatToc")}</span>
                    <span className="settings-toggle-row__hint">
                      {t("formatTocHint")}
                    </span>
                  </span>
                  <input
                    className="settings-toggle-row__input"
                    type="checkbox"
                    checked={draft.include_toc}
                    disabled={!canEdit || busy}
                    onChange={(e) => patchDraft({ include_toc: e.target.checked })}
                  />
                </label>
                <label className="settings-toggle-row">
                  <span className="settings-toggle-row__copy">
                    <span className="settings-toggle-row__label">
                      {t("formatChapterOrnament")}
                    </span>
                    <span className="settings-toggle-row__hint">
                      {t("formatChapterOrnamentHint")}
                    </span>
                  </span>
                  <input
                    className="settings-toggle-row__input"
                    type="checkbox"
                    checked={draft.typography_chapter_ornament}
                    disabled={!canEdit || busy}
                    onChange={(e) =>
                      patchDraft({ typography_chapter_ornament: e.target.checked })
                    }
                  />
                </label>
              </>
            ) : null}
          </section>

          {canEdit ? (
            <div className="publish-form-footer publish-form-footer--sticky">
              {dirty ? (
                <span className="muted">{t("publishUnsaved")}</span>
              ) : (
                <span className="muted">{t("publishAllSaved")}</span>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
                {busy ? t("publishSaving") : common("save")}
              </button>
            </div>
          ) : (
            <p className="muted">{t("formatReadOnly")}</p>
          )}
        </form>

        <aside className="format-live-preview" aria-label={t("formatLivePreview")}>
          <div className="format-live-preview__meta">
            <strong>{t("formatLivePreview")}</strong>
            <span className="muted">
              {(selectedFormat?.label || draft.format_id).replace(/\n/g, " · ")} ·{" "}
              {draft.font_size}pt
            </span>
          </div>
          <div className="format-page-stage">
            <div
              className="format-page-sheet"
              style={{
                aspectRatio: `${pageAspect}`,
                fontFamily,
                fontSize: `${draft.font_size}pt`,
                lineHeight: draft.typography_line_height,
                padding: marginPad,
              }}
              data-page-number={draft.page_number}
            >
              {draft.running_header !== "none" ? (
                <div className="format-page-header">
                  {draft.running_header === "author"
                    ? book.author || t("formatHeaderAuthor")
                    : book.title}
                </div>
              ) : null}
              <div className="format-page-chapter">
                {t("formatSampleChapter")}
              </div>
              {draft.typography_chapter_ornament ? (
                <div className="format-page-ornament" aria-hidden>
                  * * *
                </div>
              ) : null}
              <p
                className="format-page-body"
                data-drop-cap={draft.drop_cap}
                style={{
                  textIndent: draft.typography_skip_first_indent
                    ? 0
                    : `${draft.typography_indent_cm}cm`,
                  marginBottom: `${draft.typography_paragraph_spacing_pt}pt`,
                }}
              >
                {t("formatSampleParagraph1")}
              </p>
              <p
                className="format-page-body"
                style={{
                  textIndent: `${draft.typography_indent_cm}cm`,
                  marginBottom: `${draft.typography_paragraph_spacing_pt}pt`,
                }}
              >
                {t("formatSampleParagraph2")}
              </p>
              {draft.page_number !== "sem" ? (
                <div
                  className="format-page-number"
                  data-align={draft.page_number === "centro" ? "center" : "outer"}
                >
                  12
                </div>
              ) : null}
            </div>
          </div>
          <p className="muted format-live-preview__hint">{t("formatLivePreviewHint")}</p>
        </aside>
      </div>
    </div>
  );
}
