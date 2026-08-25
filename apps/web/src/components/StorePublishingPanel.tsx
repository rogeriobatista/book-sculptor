"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import { type Book, type ExportJob, clientApiFetch } from "@/lib/client-api";
import {
  STORE_HELP_URLS,
  computePublicationReadiness,
  type PublicationProfile,
  type StoreTarget,
} from "@/lib/publication";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  book: Book;
  bookId: string;
  canEdit: boolean;
  profile: PublicationProfile;
  onProfileChange: (profile: PublicationProfile) => void;
  onExportEpub?: () => void;
  onGoToSection?: (section: "synopsis" | "covers" | "exports") => void;
};

export function StorePublishingPanel({
  book,
  bookId,
  canEdit,
  profile,
  onProfileChange,
  onExportEpub,
  onGoToSection,
}: Props) {
  const t = useTranslations("studio");
  const toast = useToast();
  const { getTokenRef } = useStableAuth();
  const [busy, setBusy] = useState(false);
  const [hasReadyEpub, setHasReadyEpub] = useState(false);
  const [activePlatform, setActivePlatform] = useState(
    () => profile.store_targets[0]?.platform || "kdp",
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profile.store_targets.some((store) => store.platform === activePlatform)) {
      setActivePlatform(profile.store_targets[0]?.platform || "kdp");
    }
  }, [activePlatform, profile.store_targets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const rows = await clientApiFetch<ExportJob[]>(
          `/api/v1/books/${bookId}/exports`,
          token,
        );
        if (cancelled) return;
        setHasReadyEpub(
          rows.some(
            (job) =>
              job.format === "epub" &&
              job.status === "ready" &&
              !job.watermark,
          ),
        );
      } catch {
        if (!cancelled) setHasReadyEpub(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, getTokenRef]);

  const readiness = useMemo(
    () =>
      computePublicationReadiness({
        profile,
        hasCover: Boolean(book.cover_url),
        hasReadyEpub,
      }),
    [book.cover_url, hasReadyEpub, profile],
  );

  const publishedCount = profile.store_targets.filter(
    (store) => store.status === "published",
  ).length;

  const activeIndex = profile.store_targets.findIndex(
    (store) => store.platform === activePlatform,
  );
  const activeStore = activeIndex >= 0 ? profile.store_targets[activeIndex] : null;
  const help = activeStore ? STORE_HELP_URLS[activeStore.platform] || "" : "";

  async function saveStores() {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      const updated = await clientApiFetch<PublicationProfile>(
        `/api/v1/books/${bookId}/publication`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ store_targets: profile.store_targets }),
        },
      );
      onProfileChange(updated);
      setDirty(false);
      toast.success(t("publishSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function updateStore(index: number, patch: Partial<StoreTarget>) {
    const next = [...profile.store_targets];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    onProfileChange({ ...profile, store_targets: next });
    setDirty(true);
  }

  return (
    <div className="publish-section publish-section--tabbed">
      <header className="publish-section-head">
        <h2>{t("publishStoresTitle")}</h2>
        <p className="muted">{t("publishStoresLead")}</p>
      </header>

      <details className="publish-ready-disclosure">
        <summary className="publish-ready-summary">
          <div>
            <strong>{t("publishReadyTitle")}</strong>
            <span className="muted">
              {t("publishReadyLead", { done: readiness.done, total: readiness.total })}
            </span>
          </div>
          <div
            className="publish-score"
            data-tone={readiness.score >= 85 ? "ok" : readiness.score >= 50 ? "warn" : "low"}
          >
            <strong>{readiness.score}%</strong>
            <span>{t("publishReadyScore")}</span>
          </div>
        </summary>
        <div className="publish-ready-disclosure__body">
          <div className="publish-score-bar" aria-hidden>
            <span style={{ width: `${readiness.score}%` }} />
          </div>
          <ul className="publish-ready-list">
            {readiness.items.map((item) => (
              <li key={item.id} data-done={item.done}>
                <span className="publish-ready-mark" aria-hidden>
                  {item.done ? "✓" : "○"}
                </span>
                <span>{t(`publishReady_${item.id}`)}</span>
                {!item.done && onGoToSection ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => {
                      if (item.id === "cover") onGoToSection("covers");
                      else if (item.id === "epub") onGoToSection("exports");
                      else onGoToSection("synopsis");
                    }}
                  >
                    {t("publishReadyFix")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="publish-ready-actions">
            {onExportEpub ? (
              <button type="button" className="btn btn-ghost btn-compact" onClick={onExportEpub}>
                {t("publishExportEpub")}
              </button>
            ) : null}
            <span className="muted">
              {t("publishStorePublishedCount", { count: publishedCount })}
            </span>
          </div>
        </div>
      </details>

      <div className="publish-subnav" role="tablist" aria-label={t("publishStoresSubnav")}>
        {profile.store_targets.map((store) => (
          <button
            key={store.platform}
            type="button"
            role="tab"
            className="publish-subnav-tab"
            aria-selected={activePlatform === store.platform}
            data-active={activePlatform === store.platform}
            data-filled={store.status !== "not_started"}
            onClick={() => setActivePlatform(store.platform)}
          >
            {t(`publishStoreShort_${store.platform}`)}
          </button>
        ))}
      </div>

      {activeStore && activeIndex >= 0 ? (
        <section className="settings-card publish-tab-panel" role="tabpanel">
          <div className="publish-field-head">
            <div className="settings-card__head">
              <h3 className="settings-card__title">
                {t(`publishStore_${activeStore.platform}`)}
              </h3>
              <p className="settings-card__lead">
                {t(`publishStoreTip_${activeStore.platform}`)}
              </p>
            </div>
            <span
              className="publish-store-status-pill"
              data-status={activeStore.status}
            >
              {t(`publishStoreStatus_${activeStore.status}`)}
            </span>
          </div>

          {canEdit ? (
            <>
              <label className="team-field">
                <span>{t("publishStoreStatusLabel")}</span>
                <select
                  value={activeStore.status}
                  onChange={(e) =>
                    updateStore(activeIndex, {
                      status: e.target.value as StoreTarget["status"],
                    })
                  }
                >
                  <option value="not_started">{t("publishStoreStatus_not_started")}</option>
                  <option value="in_progress">{t("publishStoreStatus_in_progress")}</option>
                  <option value="published">{t("publishStoreStatus_published")}</option>
                </select>
              </label>
              <label className="team-field">
                <span>{t("publishStoreNotesLabel")}</span>
                <textarea
                  rows={4}
                  value={activeStore.notes}
                  placeholder={t(`publishStoreNotes_${activeStore.platform}`)}
                  onChange={(e) => updateStore(activeIndex, { notes: e.target.value })}
                />
              </label>
            </>
          ) : activeStore.notes ? (
            <p className="muted">{activeStore.notes}</p>
          ) : (
            <p className="muted">{t("publishStoreNoNotes")}</p>
          )}

          <div className="publish-store-footer">
            {help ? (
              <a
                className="btn btn-ghost btn-compact"
                href={help}
                target="_blank"
                rel="noreferrer"
              >
                {t("publishStoreGuide")}
              </a>
            ) : null}
            {canEdit && profile.short_description ? (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => {
                  void navigator.clipboard.writeText(profile.short_description);
                  toast.success(
                    t("publishCopied", { field: t("publishShortDescription") }),
                  );
                }}
              >
                {t("publishCopyPitch")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <div className="publish-form-footer publish-form-footer--sticky">
          {dirty ? (
            <span className="muted">{t("publishUnsaved")}</span>
          ) : (
            <span className="muted">{t("publishAllSaved")}</span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => void saveStores()}
          >
            {t("publishSaveProgress")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
