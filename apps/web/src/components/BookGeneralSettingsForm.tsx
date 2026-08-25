"use client";

import { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { type Book } from "@/lib/client-api";

const LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "es", label: "Español" },
] as const;

type Props = {
  book: Book;
  canEdit: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function BookGeneralSettingsForm({ book, canEdit, busy, onSubmit }: Props) {
  const s = useTranslations("studio");
  const common = useTranslations("common");

  return (
    <form className="book-settings__form book-general-form" onSubmit={onSubmit}>
      <header className="book-style-embedded-head">
        <div>
          <h3>{s("settingsTabGeneral")}</h3>
          <p className="muted book-style-lead">{s("settingsTabGeneralHint")}</p>
        </div>
      </header>

      <div className="book-style-cards">
        <section className="settings-card">
          <header className="settings-card__head">
            <h4 className="settings-card__title">{s("settingsGeneralBookTitle")}</h4>
            <p className="settings-card__lead">{s("settingsGeneralBookLead")}</p>
          </header>
          <div className="settings-field-stack">
            <label className="settings-field">
              <span className="settings-field__label">{s("settingsBookTitle")}</span>
              <input
                name="title"
                defaultValue={book.title}
                placeholder={s("settingsBookTitlePlaceholder")}
                disabled={!canEdit || busy}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">{s("settingsBookAuthor")}</span>
              <input
                name="author"
                defaultValue={book.author}
                placeholder={s("settingsBookAuthorPlaceholder")}
                disabled={!canEdit || busy}
                autoComplete="name"
              />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card__head">
            <h4 className="settings-card__title">{s("settingsGeneralLanguageTitle")}</h4>
            <p className="settings-card__lead">{s("settingsGeneralLanguageLead")}</p>
          </header>
          <label className="settings-field settings-field--locale">
            <span className="settings-field__label">{s("settingsBookLocale")}</span>
            <select name="locale" defaultValue={book.locale} disabled={!canEdit || busy}>
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="settings-field__hint">{s("settingsBookLocaleHint")}</span>
          </label>
        </section>
      </div>

      {!canEdit ? (
        <p className="book-settings__readonly">{s("readOnlyBadge")}</p>
      ) : (
        <footer className="book-settings__footer">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? s("saving") : common("save")}
          </button>
        </footer>
      )}
    </form>
  );
}
