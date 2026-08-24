"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CoverPanel } from "@/components/CoverPanel";
import { PublicationExportsPanel } from "@/components/PublicationExportsPanel";
import { SocialIntegrationsPanel } from "@/components/SocialIntegrationsPanel";
import { SocialPublishingPanel } from "@/components/SocialPublishingPanel";
import { StorePublishingPanel } from "@/components/StorePublishingPanel";
import { SynopsisPanel, usePublicationProfile } from "@/components/SynopsisPanel";
import { type Book } from "@/lib/client-api";
import { type ExportFormat } from "@/components/ExportActions";
import { PUBLICATION_SECTIONS, type PublicationSection } from "@/lib/publication";

type Props = {
  book: Book;
  locale: string;
  canUseAi: boolean;
  canEdit: boolean;
  canExport: boolean;
  exportBusy?: boolean;
  onBookSaved: (book: Book) => void;
  onExport: (format: ExportFormat) => void;
};

export function PublicationHub({
  book,
  locale,
  canUseAi,
  canEdit,
  canExport,
  exportBusy = false,
  onBookSaved,
  onExport,
}: Props) {
  const t = useTranslations("studio");
  const { profile, setProfile, loading } = usePublicationProfile(book.id);
  const [section, setSection] = useState<PublicationSection>("synopsis");

  return (
    <div className="publication-hub">
      <header className="publication-hub-head">
        <div>
          <h2>{t("publishHubTitle")}</h2>
          <p className="muted">{t("publishHubLead")}</p>
        </div>
      </header>

      <nav className="publication-hub-nav" aria-label={t("publishNavLabel")}>
        {PUBLICATION_SECTIONS.map((item) => (
          <button
            key={item}
            type="button"
            className="publication-hub-tab"
            data-active={section === item}
            onClick={() => setSection(item)}
          >
            {t(`publishSection_${item}`)}
          </button>
        ))}
      </nav>

      <div className="publication-hub-body">
        {loading ? (
          <p className="muted">{t("publishLoading")}</p>
        ) : section === "synopsis" ? (
          <SynopsisPanel
            bookId={book.id}
            canUseAi={canUseAi}
            canEdit={canEdit}
            profile={profile}
            onProfileChange={setProfile}
          />
        ) : section === "social" ? (
          <SocialPublishingPanel
            book={book}
            canUseAi={canUseAi}
            canEdit={canEdit}
            profile={profile}
            onProfileChange={setProfile}
          />
        ) : section === "covers" ? (
          <CoverPanel book={book} onSaved={onBookSaved} />
        ) : section === "exports" ? (
          <PublicationExportsPanel
            bookId={book.id}
            canExport={canExport}
            busy={exportBusy}
            onExport={onExport}
          />
        ) : section === "stores" ? (
          <StorePublishingPanel
            bookId={book.id}
            canEdit={canEdit}
            profile={profile}
            onProfileChange={setProfile}
            onExportEpub={() => onExport("epub")}
          />
        ) : (
          <SocialIntegrationsPanel
            bookId={book.id}
            locale={locale}
            canEdit={canEdit}
            profile={profile}
            onProfileChange={setProfile}
          />
        )}
      </div>
    </div>
  );
}
