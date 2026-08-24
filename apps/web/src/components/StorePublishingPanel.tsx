"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import { type PublicationProfile } from "@/lib/publication";
import { clientApiFetch } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  bookId: string;
  canEdit: boolean;
  profile: PublicationProfile;
  onProfileChange: (profile: PublicationProfile) => void;
  onExportEpub?: () => void;
};

export function StorePublishingPanel({
  bookId,
  canEdit,
  profile,
  onProfileChange,
  onExportEpub,
}: Props) {
  const t = useTranslations("studio");
  const toast = useToast();
  const { getTokenRef } = useStableAuth();
  const [busy, setBusy] = useState(false);

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
      toast.success(t("publishSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publish-section">
      <header className="publish-section-head">
        <h2>{t("publishStoresTitle")}</h2>
        <p className="muted">{t("publishStoresLead")}</p>
      </header>

      <ol className="publish-checklist">
        <li>{t("publishCheckSynopsis")}</li>
        <li>{t("publishCheckCover")}</li>
        <li>{t("publishCheckEpub")}</li>
        <li>{t("publishCheckMetadata")}</li>
      </ol>

      {onExportEpub ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExportEpub}>
          {t("publishExportEpub")}
        </button>
      ) : null}

      <ul className="publish-store-list">
        {profile.store_targets.map((store, index) => (
          <li key={store.platform} className="publish-store-item">
            <div className="publish-store-head">
              <strong>{t(`publishStore_${store.platform}`)}</strong>
              {canEdit ? (
                <select
                  value={store.status}
                  onChange={(e) => {
                    const next = [...profile.store_targets];
                    next[index] = {
                      ...store,
                      status: e.target.value as typeof store.status,
                    };
                    onProfileChange({ ...profile, store_targets: next });
                  }}
                >
                  <option value="not_started">{t("publishStoreStatus_not_started")}</option>
                  <option value="in_progress">{t("publishStoreStatus_in_progress")}</option>
                  <option value="published">{t("publishStoreStatus_published")}</option>
                </select>
              ) : (
                <span className="review-status-pill" data-status={store.status}>
                  {t(`publishStoreStatus_${store.status}`)}
                </span>
              )}
            </div>
            {canEdit ? (
              <textarea
                rows={2}
                value={store.notes}
                placeholder={t("publishStoreNotesPlaceholder")}
                onChange={(e) => {
                  const next = [...profile.store_targets];
                  next[index] = { ...store, notes: e.target.value };
                  onProfileChange({ ...profile, store_targets: next });
                }}
              />
            ) : store.notes ? (
              <p className="muted">{store.notes}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void saveStores()}
        >
          {t("publishSaveProgress")}
        </button>
      ) : null}
    </div>
  );
}
