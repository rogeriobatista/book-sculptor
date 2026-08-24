"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import { type Book, clientApiFetch, isAbortError } from "@/lib/client-api";
import {
  type PublicationGenerateKind,
  type PublicationProfile,
  emptyPublicationProfile,
} from "@/lib/publication";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  bookId: string;
  canUseAi: boolean;
  canEdit: boolean;
  profile: PublicationProfile;
  onProfileChange: (profile: PublicationProfile) => void;
};

export function SynopsisPanel({
  bookId,
  canUseAi,
  canEdit,
  profile,
  onProfileChange,
}: Props) {
  const t = useTranslations("studio");
  const toast = useToast();
  const { getTokenRef } = useStableAuth();
  const [draft, setDraft] = useState(profile);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  async function save(next: PublicationProfile) {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      const updated = await clientApiFetch<PublicationProfile>(
        `/api/v1/books/${bookId}/publication`,
        token,
        { method: "PATCH", body: JSON.stringify(next) },
      );
      onProfileChange(updated);
      setDraft(updated);
      toast.success(t("publishSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function generate(kind: PublicationGenerateKind) {
    if (!canUseAi) {
      toast.error(t("upgradeAi"));
      return;
    }
    setBusy(true);
    const loadingId = toast.loading(t("publishGenerating"));
    try {
      const token = await getTokenRef.current();
      const updated = await clientApiFetch<PublicationProfile>(
        `/api/v1/books/${bookId}/publication/generate`,
        token,
        { method: "POST", body: JSON.stringify({ kind, hint }) },
      );
      onProfileChange(updated);
      setDraft(updated);
      toast.update(loadingId, { tone: "success", title: t("publishGenerated") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("publishGenerateFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    void save(draft);
  }

  return (
    <div className="publish-section">
      <header className="publish-section-head">
        <h2>{t("publishSynopsisTitle")}</h2>
        <p className="muted">{t("publishSynopsisLead")}</p>
      </header>

      <label className="field-block">
        <span className="field-label">{t("publishHintLabel")}</span>
        <input
          type="text"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder={t("publishHintPlaceholder")}
          disabled={busy || !canEdit}
        />
      </label>

      <div className="publish-generate-row">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !canEdit}
          onClick={() => void generate("synopsis")}
        >
          {t("publishGenerateSynopsis")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !canEdit}
          onClick={() => void generate("back_cover")}
        >
          {t("publishGenerateBackCover")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !canEdit}
          onClick={() => void generate("keywords")}
        >
          {t("publishGenerateKeywords")}
        </button>
      </div>

      <form className="publish-form" onSubmit={onSubmit}>
        <label className="field-block">
          <span className="field-label">{t("publishShortDescription")}</span>
          <textarea
            rows={2}
            value={draft.short_description}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, short_description: e.target.value }))
            }
            disabled={!canEdit || busy}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("publishSynopsisField")}</span>
          <textarea
            rows={8}
            value={draft.synopsis}
            onChange={(e) => setDraft((prev) => ({ ...prev, synopsis: e.target.value }))}
            disabled={!canEdit || busy}
          />
        </label>
        <label className="field-block">
          <span className="field-label">{t("publishBackCoverField")}</span>
          <textarea
            rows={6}
            value={draft.back_cover}
            onChange={(e) => setDraft((prev) => ({ ...prev, back_cover: e.target.value }))}
            disabled={!canEdit || busy}
          />
        </label>
        <div className="publish-form-grid">
          <label className="field-block">
            <span className="field-label">{t("publishKeywords")}</span>
            <input
              type="text"
              value={draft.keywords}
              onChange={(e) => setDraft((prev) => ({ ...prev, keywords: e.target.value }))}
              disabled={!canEdit || busy}
            />
          </label>
          <label className="field-block">
            <span className="field-label">{t("publishCategories")}</span>
            <input
              type="text"
              value={draft.categories}
              onChange={(e) => setDraft((prev) => ({ ...prev, categories: e.target.value }))}
              disabled={!canEdit || busy}
            />
          </label>
        </div>
        {canEdit ? (
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("publishSaveCopy")}
          </button>
        ) : null}
      </form>
    </div>
  );
}

export function usePublicationProfile(bookId: string) {
  const { getTokenRef } = useStableAuth();
  const [profile, setProfile] = useState<PublicationProfile>(emptyPublicationProfile());
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const token = await getTokenRef.current();
      const data = await clientApiFetch<PublicationProfile>(
        `/api/v1/books/${bookId}/publication`,
        token,
        signal ? { signal } : {},
      );
      if (!signal?.aborted) setProfile(data);
      return data;
    },
    [bookId, getTokenRef],
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    load(ac.signal)
      .catch((err) => {
        if (!isAbortError(err) && !ac.signal.aborted) {
          setProfile(emptyPublicationProfile());
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [load]);

  return { profile, setProfile, loading, reload: load };
}
