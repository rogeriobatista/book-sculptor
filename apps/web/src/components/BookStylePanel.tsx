"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { type Book, clientApiFetch } from "@/lib/client-api";
import {
  DEFAULT_BOOK_STYLE,
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
  onSaved: (book: Book) => void;
};

export function BookStylePanel({ book, canEdit, onSaved }: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const common = useTranslations("common");
  const [draft, setDraft] = useState<BookStyleProfile>(() =>
    parseBookStyle(book.settings),
  );
  const [busy, setBusy] = useState(false);

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
    <form className="book-style-panel form-grid" onSubmit={(e) => void onSubmit(e)}>
      <div className="book-style-head">
        <h3>{t("bookStyleTitle")}</h3>
        <p className="muted book-style-lead">{t("bookStyleLead")}</p>
      </div>

      <label>
        {t("bookStyleGenre")}
        <input
          value={draft.genre}
          onChange={(e) => update("genre", e.target.value)}
          placeholder={t("bookStyleGenrePlaceholder")}
          disabled={!canEdit || busy}
        />
      </label>

      <label>
        {t("bookStyleTone")}
        <input
          value={draft.tone}
          onChange={(e) => update("tone", e.target.value)}
          placeholder={t("bookStyleTonePlaceholder")}
          disabled={!canEdit || busy}
        />
      </label>

      <label>
        {t("bookStylePov")}
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

      <label>
        {t("bookStyleAudience")}
        <input
          value={draft.audience}
          onChange={(e) => update("audience", e.target.value)}
          placeholder={t("bookStyleAudiencePlaceholder")}
          disabled={!canEdit || busy}
        />
      </label>

      <label>
        {t("bookStyleReferences")}
        <input
          value={draft.reference_authors}
          onChange={(e) => update("reference_authors", e.target.value)}
          placeholder={t("bookStyleReferencesPlaceholder")}
          disabled={!canEdit || busy}
        />
      </label>

      <label className="field-block">
        {t("bookStyleNotes")}
        <textarea
          rows={4}
          value={draft.style_notes}
          onChange={(e) => update("style_notes", e.target.value)}
          placeholder={t("bookStyleNotesPlaceholder")}
          disabled={!canEdit || busy}
        />
      </label>

      <label>
        {t("bookStyleAvoid")}
        <input
          value={draft.avoid_words}
          onChange={(e) => update("avoid_words", e.target.value)}
          placeholder={t("bookStyleAvoidPlaceholder")}
          disabled={!canEdit || busy}
        />
      </label>

      <fieldset className="book-style-fieldset">
        <legend>{t("bookStyleContextTitle")}</legend>
        <label className="book-style-check">
          <input
            type="checkbox"
            checked={draft.use_prior_chapters}
            onChange={(e) => update("use_prior_chapters", e.target.checked)}
            disabled={!canEdit || busy}
          />
          {t("bookStyleUsePrior")}
        </label>
        <label>
          {t("bookStylePriorCount")}
          <select
            value={draft.prior_chapter_count}
            onChange={(e) => update("prior_chapter_count", Number(e.target.value))}
            disabled={!canEdit || busy || !draft.use_prior_chapters}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {canEdit ? (
        <div className="book-style-actions">
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
        </div>
      ) : null}
    </form>
  );
}
