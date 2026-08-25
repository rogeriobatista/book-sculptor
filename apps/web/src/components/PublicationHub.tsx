"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CoverPanel } from "@/components/CoverPanel";
import { PublicationExportsPanel } from "@/components/PublicationExportsPanel";
import { SocialIntegrationsPanel } from "@/components/SocialIntegrationsPanel";
import { SocialPublishingPanel } from "@/components/SocialPublishingPanel";
import { StorePublishingPanel } from "@/components/StorePublishingPanel";
import { SynopsisPanel, usePublicationProfile } from "@/components/SynopsisPanel";
import { type Book, type ExportJob, clientApiFetch } from "@/lib/client-api";
import { type ExportFormat } from "@/components/ExportActions";
import {
  PUBLICATION_SECTIONS,
  computePublicationReadiness,
  type PublicationSection,
} from "@/lib/publication";
import { useStableAuth } from "@/lib/use-app-auth";

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
  const { getTokenRef } = useStableAuth();
  const { profile, setProfile, loading } = usePublicationProfile(book.id);
  const [section, setSection] = useState<PublicationSection>("synopsis");
  const [hasReadyEpub, setHasReadyEpub] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const rows = await clientApiFetch<ExportJob[]>(
          `/api/v1/books/${book.id}/exports`,
          token,
        );
        if (cancelled) return;
        setHasReadyEpub(
          rows.some(
            (job) => job.format === "epub" && job.status === "ready" && !job.watermark,
          ),
        );
      } catch {
        if (!cancelled) setHasReadyEpub(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id, exportBusy, getTokenRef, section]);

  const readiness = useMemo(
    () =>
      computePublicationReadiness({
        profile,
        hasCover: Boolean(book.cover_url),
        hasReadyEpub,
      }),
    [book.cover_url, hasReadyEpub, profile],
  );

  return (
    <div className="publication-hub">
      <header className="publication-hub-head">
        <div className="publication-hub-head-copy">
          <h2>{t("publishHubTitle")}</h2>
          <p className="muted">{t("publishHubLead")}</p>
        </div>
        <div
          className="publish-hub-score"
          data-tone={
            readiness.score >= 85 ? "ok" : readiness.score >= 50 ? "warn" : "low"
          }
          title={t("publishReadyLead", {
            done: readiness.done,
            total: readiness.total,
          })}
        >
          <strong>{readiness.score}%</strong>
          <span>{t("publishHubReady")}</span>
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
            onOpenIntegrations={() => setSection("integrations")}
          />
        ) : section === "covers" ? (
          <CoverPanel book={book} canEdit={canEdit} onSaved={onBookSaved} />
        ) : section === "exports" ? (
          <PublicationExportsPanel
            bookId={book.id}
            canExport={canExport}
            busy={exportBusy}
            onExport={onExport}
          />
        ) : section === "stores" ? (
          <StorePublishingPanel
            book={book}
            bookId={book.id}
            canEdit={canEdit}
            profile={profile}
            onProfileChange={setProfile}
            onExportEpub={() => onExport("epub")}
            onGoToSection={(next) => setSection(next)}
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
