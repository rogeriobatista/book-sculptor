"use client";

import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { BookAiUsagePanel } from "@/components/BookAiUsagePanel";
import { BookGeneralSettingsForm } from "@/components/BookGeneralSettingsForm";
import { BookStylePanel } from "@/components/BookStylePanel";
import { useToast } from "@/components/ToastProvider";
import { type Book, clientApiFetch } from "@/lib/client-api";
import { useAiUsage } from "@/lib/use-ai-usage";
import { useAppAuth } from "@/lib/use-app-auth";

type SettingsTab = "general" | "ai-voice" | "ai-usage";

type Props = {
  book: Book;
  canEdit: boolean;
  canUseAi: boolean;
  onSaved: (book: Book) => void;
};

export function BookSettingsPanel({ book, canEdit, canUseAi, onSaved }: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("books");
  const s = useTranslations("studio");
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [busy, setBusy] = useState(false);
  const { data: usageData, loading: usageLoading, error: usageError, refresh: refreshUsage } = useAiUsage(
    book.id,
    activeTab === "ai-usage",
  );

  const tabs: {
    id: SettingsTab;
    label: string;
    hint: string;
  }[] = [
    {
      id: "general",
      label: s("settingsTabGeneral"),
      hint: s("settingsTabGeneralHint"),
    },
    {
      id: "ai-voice",
      label: s("settingsTabAiVoice"),
      hint: s("settingsTabAiVoiceHint"),
    },
    {
      id: "ai-usage",
      label: s("settingsTabAiUsage"),
      hint: s("settingsTabAiUsageHint"),
    },
  ];

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  async function saveGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const loadingId = toast.loading(s("notifySaving"));
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Book>(`/api/v1/books/${book.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          title: String(form.get("title") || book.title),
          author: String(form.get("author") || ""),
          locale: String(form.get("locale") || book.locale),
          settings: book.settings || {},
        }),
      });
      onSaved(updated);
      toast.update(loadingId, { tone: "success", title: s("notifySaved") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifySaveFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="book-settings">
      <header className="book-settings__header">
        <div>
          <h2 className="book-settings__title">{t("settings")}</h2>
          <p className="book-settings__subtitle">{book.title}</p>
        </div>
      </header>

      <div className="book-settings__shell">
        <nav className="book-settings__nav" aria-label={t("settings")}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="book-settings__nav-item"
              data-active={activeTab === tab.id}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section
          className="book-settings__panel studio-isolated panel"
          role="tabpanel"
          aria-label={active.label}
        >
          {activeTab === "general" ? (
            <BookGeneralSettingsForm
              book={book}
              canEdit={canEdit}
              busy={busy}
              onSubmit={(e) => void saveGeneral(e)}
            />
          ) : null}

          {activeTab === "ai-voice" ? (
            <BookStylePanel
              book={book}
              canEdit={canEdit}
              embedded
              onSaved={onSaved}
            />
          ) : null}

          {activeTab === "ai-usage" ? (
            <BookAiUsagePanel
              data={usageData}
              loading={usageLoading}
              error={usageError}
              bookTitle={book.title}
              onOpenVoiceSettings={() => setActiveTab("ai-voice")}
              onRetry={() => void refreshUsage()}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
