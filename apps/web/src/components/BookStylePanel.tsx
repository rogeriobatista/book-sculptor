"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { type Book, clientApiFetch } from "@/lib/client-api";
import {
  DEFAULT_BOOK_STYLE,
  isBookStyleConfigured,
  mergeBookSettingsWithStyle,
  parseBookStyle,
  POV_OPTIONS,
  type BookStyleProfile,
} from "@/lib/book-style";
import { useAppAuth } from "@/lib/use-app-auth";
import { useToast } from "@/components/ToastProvider";

type Props = {
  book: Book;
  canEdit: boolean;
  embedded?: boolean;
  onSaved: (book: Book) => void;
};

export function BookStylePanel({ book, canEdit, embedded = false, onSaved }: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const [draft, setDraft] = useState<BookStyleProfile>(() =>
    parseBookStyle(book.settings),
  );
  const [busy, setBusy] = useState(false);
  const configured = isBookStyleConfigured(draft);

  useEffect(() => {
    setDraft(parseBookStyle(book.settings));
  }, [book.id, book.settings]);

  function update<K extends keyof BookStyleProfile>(key: K, value: BookStyleProfile[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    const loadingId = toast.loading(t("notifySaving"));
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Book>(`/api/v1/books/${book.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          settings: mergeBookSettingsWithStyle(book.settings, draft),
        }),
      });
      onSaved(updated);
      toast.update(loadingId, { tone: "success", title: t("bookStyleSaved") });
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

  function resetDraft() {
    setDraft({ ...DEFAULT_BOOK_STYLE });
  }

  return (
    <form
      className={`book-style-panel${embedded ? " book-style-panel--embedded" : ""}`}
      onSubmit={(e) => void onSubmit(e)}
    >
      {!embedded ? (
        <div className="book-style-head">
          <h3>{t("bookStyleTitle")}</h3>
          <p className="muted book-style-lead">{t("bookStyleLead")}</p>
        </div>
      ) : (
        <header className="book-style-embedded-head">
          <div>
            <h3>{t("bookStyleTitle")}</h3>
            <p className="muted book-style-lead">{t("bookStyleLead")}</p>
          </div>
          <div className="book-style-status" data-active={configured ? "true" : "false"}>
            <span className="book-style-status__dot" aria-hidden />
            <span>{configured ? t("bookStyleStatusActive") : t("bookStyleStatusInactive")}</span>
          </div>
        </header>
      )}

      <div className="book-style-cards">
        <section className="settings-card">
          <header className="settings-card__head">
            <h4 className="settings-card__title">{t("bookStyleSectionVoice")}</h4>
            <p className="settings-card__lead">{t("bookStyleSectionVoiceLead")}</p>
          </header>
          <div className="settings-field-grid">
            <label className="settings-field">
              <span className="settings-field__label">{t("bookStyleGenre")}</span>
              <input
                value={draft.genre}
                onChange={(e) => update("genre", e.target.value)}
                placeholder={t("bookStyleGenrePlaceholder")}
                disabled={!canEdit || busy}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("bookStyleTone")}</span>
              <input
                value={draft.tone}
                onChange={(e) => update("tone", e.target.value)}
                placeholder={t("bookStyleTonePlaceholder")}
                disabled={!canEdit || busy}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("bookStylePov")}</span>
              <select
                value={draft.pov}
                onChange={(e) => update("pov", e.target.value as BookStyleProfile["pov"])}
                disabled={!canEdit || busy}
              >
                {POV_OPTIONS.map((pov) => (
                  <option key={pov} value={pov}>
                    {t(`bookStylePov_${pov}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("bookStyleAudience")}</span>
              <input
                value={draft.audience}
                onChange={(e) => update("audience", e.target.value)}
                placeholder={t("bookStyleAudiencePlaceholder")}
                disabled={!canEdit || busy}
              />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card__head">
            <h4 className="settings-card__title">{t("bookStyleSectionStyle")}</h4>
            <p className="settings-card__lead">{t("bookStyleSectionStyleLead")}</p>
          </header>
          <div className="settings-field-stack">
            <label className="settings-field">
              <span className="settings-field__label">{t("bookStyleReferences")}</span>
              <input
                value={draft.reference_authors}
                onChange={(e) => update("reference_authors", e.target.value)}
                placeholder={t("bookStyleReferencesPlaceholder")}
                disabled={!canEdit || busy}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("bookStyleNotes")}</span>
              <textarea
                rows={4}
                value={draft.style_notes}
                onChange={(e) => update("style_notes", e.target.value)}
                placeholder={t("bookStyleNotesPlaceholder")}
                disabled={!canEdit || busy}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">{t("bookStyleAvoid")}</span>
              <input
                value={draft.avoid_words}
                onChange={(e) => update("avoid_words", e.target.value)}
                placeholder={t("bookStyleAvoidPlaceholder")}
                disabled={!canEdit || busy}
              />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card__head">
            <h4 className="settings-card__title">{t("bookStyleContextTitle")}</h4>
            <p className="settings-card__lead">{t("bookStyleContextLead")}</p>
          </header>

          <label className="settings-toggle-row">
            <span className="settings-toggle-row__copy">
              <span className="settings-toggle-row__label">{t("bookStyleUsePrior")}</span>
              <span className="settings-toggle-row__hint">{t("bookStyleUsePriorHint")}</span>
            </span>
            <input
              type="checkbox"
              className="settings-toggle-row__input"
              checked={draft.use_prior_chapters}
              onChange={(e) => update("use_prior_chapters", e.target.checked)}
              disabled={!canEdit || busy}
            />
          </label>

          {draft.use_prior_chapters ? (
            <div className="settings-subpanel">
              <label className="settings-field settings-field--inline">
                <span className="settings-field__label">{t("bookStylePriorCount")}</span>
                <select
                  value={draft.prior_chapter_count}
                  onChange={(e) => update("prior_chapter_count", Number(e.target.value))}
                  disabled={!canEdit || busy}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {t("bookStylePriorCountOption", { count: n })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </section>
      </div>

      {canEdit ? (
        <footer className="book-settings__footer book-style-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("saving") : t("bookStyleSave")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={resetDraft}
          >
            {t("bookStyleReset")}
          </button>
        </footer>
      ) : (
        <p className="book-settings__readonly">{t("readOnlyBadge")}</p>
      )}
    </form>
  );
}
