"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import { clientApiFetch, isAbortError } from "@/lib/client-api";
import {
  PUBLISH_LIMITS,
  counterTone,
  emptyPublicationProfile,
  joinKeywords,
  splitKeywords,
  type PublicationGenerateKind,
  type PublicationProfile,
} from "@/lib/publication";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  bookId: string;
  canUseAi: boolean;
  canEdit: boolean;
  profile: PublicationProfile;
  onProfileChange: (profile: PublicationProfile) => void;
};

type SynopsisTab = "pitch" | "synopsis" | "back_cover" | "metadata";

const SYNOPSIS_TABS: SynopsisTab[] = ["pitch", "synopsis", "back_cover", "metadata"];

function FieldCounter({
  length,
  soft,
  hard,
  label,
}: {
  length: number;
  soft: number;
  hard: number;
  label: string;
}) {
  const tone = counterTone(length, soft, hard);
  return (
    <span className="publish-counter" data-tone={tone} title={label}>
      {length}/{soft}
      {length > soft ? ` · max ${hard}` : ""}
    </span>
  );
}

function tabFilled(tab: SynopsisTab, draft: PublicationProfile): boolean {
  if (tab === "pitch") return draft.short_description.trim().length >= 40;
  if (tab === "synopsis") return draft.synopsis.trim().length >= 200;
  if (tab === "back_cover") return draft.back_cover.trim().length >= 80;
  const keywords = splitKeywords(draft.keywords);
  return (
    keywords.length >= PUBLISH_LIMITS.keywordsRecommendedMin &&
    draft.categories.trim().length > 0
  );
}

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
  const [keywordInput, setKeywordInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<SynopsisTab>("pitch");
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const keywords = useMemo(() => splitKeywords(draft.keywords), [draft.keywords]);
  const dirty = useMemo(
    () =>
      draft.short_description !== profile.short_description ||
      draft.synopsis !== profile.synopsis ||
      draft.back_cover !== profile.back_cover ||
      draft.keywords !== profile.keywords ||
      draft.categories !== profile.categories,
    [draft, profile],
  );

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
      if (kind === "synopsis") setTab("synopsis");
      if (kind === "back_cover") setTab("back_cover");
      if (kind === "keywords") setTab("metadata");
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

  function addKeyword(raw: string) {
    const nextParts = splitKeywords(raw);
    if (!nextParts.length) return;
    const merged = [...keywords];
    for (const part of nextParts) {
      if (merged.length >= PUBLISH_LIMITS.keywordsMax) break;
      if (!merged.some((item) => item.toLowerCase() === part.toLowerCase())) {
        merged.push(part);
      }
    }
    setDraft((prev) => ({ ...prev, keywords: joinKeywords(merged) }));
    setKeywordInput("");
  }

  function removeKeyword(index: number) {
    const next = keywords.filter((_, i) => i !== index);
    setDraft((prev) => ({ ...prev, keywords: joinKeywords(next) }));
  }

  function onKeywordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addKeyword(keywordInput);
    } else if (event.key === "Backspace" && !keywordInput && keywords.length) {
      removeKeyword(keywords.length - 1);
    }
  }

  async function copyField(label: string, value: string) {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("publishCopied", { field: label }));
    } catch {
      toast.error(t("publishCopyFailed"));
    }
  }

  return (
    <div className="publish-section publish-section--tabbed">
      <header className="publish-section-head">
        <h2>{t("publishSynopsisTitle")}</h2>
        <p className="muted">{t("publishSynopsisLead")}</p>
      </header>

      <div className="publish-subnav" role="tablist" aria-label={t("publishSynopsisSubnav")}>
        {SYNOPSIS_TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className="publish-subnav-tab"
            data-active={tab === item}
            data-filled={tabFilled(item, draft)}
            onClick={() => setTab(item)}
          >
            {t(`publishSynopsisTab_${item}`)}
          </button>
        ))}
      </div>

      <details
        className="publish-ai-disclosure"
        open={aiOpen}
        onToggle={(e) => setAiOpen(e.currentTarget.open)}
      >
        <summary>
          <span>{t("publishAiAssistTitle")}</span>
          <span className="muted">{t("publishAiAssistSummary")}</span>
        </summary>
        <div className="publish-ai-disclosure__body">
          <p className="muted publish-field-hint">{t("publishAiAssistLead")}</p>
          <label className="team-field">
            <span>{t("publishHintLabel")}</span>
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
              className="btn btn-ghost btn-compact"
              disabled={busy || !canEdit || !canUseAi}
              onClick={() => void generate("synopsis")}
            >
              {t("publishGenerateSynopsis")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={busy || !canEdit || !canUseAi}
              onClick={() => void generate("back_cover")}
            >
              {t("publishGenerateBackCover")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={busy || !canEdit || !canUseAi}
              onClick={() => void generate("keywords")}
            >
              {t("publishGenerateKeywords")}
            </button>
          </div>
        </div>
      </details>

      <form className="publish-form publish-form--tabbed" onSubmit={onSubmit}>
        <section className="settings-card publish-tab-panel" role="tabpanel">
          {tab === "pitch" ? (
            <>
              <div className="publish-field-head">
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("publishShortDescription")}</h3>
                  <p className="settings-card__lead">{t("publishShortHint")}</p>
                </div>
                <div className="publish-field-meta">
                  <FieldCounter
                    length={draft.short_description.length}
                    soft={PUBLISH_LIMITS.shortDescriptionSoft}
                    hard={PUBLISH_LIMITS.shortDescriptionHard}
                    label={t("publishShortDescription")}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={!draft.short_description.trim()}
                    onClick={() =>
                      void copyField(t("publishShortDescription"), draft.short_description)
                    }
                  >
                    {t("publishCopy")}
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                value={draft.short_description}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, short_description: e.target.value }))
                }
                placeholder={t("publishShortPlaceholder")}
                disabled={!canEdit || busy}
                maxLength={PUBLISH_LIMITS.shortDescriptionHard}
              />
            </>
          ) : null}

          {tab === "synopsis" ? (
            <>
              <div className="publish-field-head">
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("publishSynopsisField")}</h3>
                  <p className="settings-card__lead">{t("publishSynopsisHint")}</p>
                </div>
                <div className="publish-field-meta">
                  <FieldCounter
                    length={draft.synopsis.length}
                    soft={PUBLISH_LIMITS.synopsisSoft}
                    hard={PUBLISH_LIMITS.synopsisHard}
                    label={t("publishSynopsisField")}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={!canEdit || !canUseAi || busy}
                    onClick={() => void generate("synopsis")}
                  >
                    {t("publishGenerateSynopsis")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={!draft.synopsis.trim()}
                    onClick={() => void copyField(t("publishSynopsisField"), draft.synopsis)}
                  >
                    {t("publishCopy")}
                  </button>
                </div>
              </div>
              <textarea
                className="publish-textarea--tall"
                rows={12}
                value={draft.synopsis}
                onChange={(e) => setDraft((prev) => ({ ...prev, synopsis: e.target.value }))}
                placeholder={t("publishSynopsisPlaceholder")}
                disabled={!canEdit || busy}
              />
            </>
          ) : null}

          {tab === "back_cover" ? (
            <>
              <div className="publish-field-head">
                <div className="settings-card__head">
                  <h3 className="settings-card__title">{t("publishBackCoverField")}</h3>
                  <p className="settings-card__lead">{t("publishBackCoverHint")}</p>
                </div>
                <div className="publish-field-meta">
                  <FieldCounter
                    length={draft.back_cover.length}
                    soft={PUBLISH_LIMITS.backCoverSoft}
                    hard={PUBLISH_LIMITS.backCoverHard}
                    label={t("publishBackCoverField")}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={!canEdit || !canUseAi || busy}
                    onClick={() => void generate("back_cover")}
                  >
                    {t("publishGenerateBackCover")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={!draft.back_cover.trim()}
                    onClick={() => void copyField(t("publishBackCoverField"), draft.back_cover)}
                  >
                    {t("publishCopy")}
                  </button>
                </div>
              </div>
              <textarea
                className="publish-textarea--tall"
                rows={10}
                value={draft.back_cover}
                onChange={(e) => setDraft((prev) => ({ ...prev, back_cover: e.target.value }))}
                placeholder={t("publishBackCoverPlaceholder")}
                disabled={!canEdit || busy}
              />
            </>
          ) : null}

          {tab === "metadata" ? (
            <>
              <div className="settings-card__head">
                <h3 className="settings-card__title">{t("publishDiscoveryTitle")}</h3>
                <p className="settings-card__lead">{t("publishDiscoveryLead")}</p>
              </div>

              <div className="publish-keywords-block">
                <div className="publish-field-head">
                  <span className="field-label">{t("publishKeywords")}</span>
                  <div className="publish-field-meta">
                    <span
                      className="publish-counter"
                      data-tone={
                        keywords.length > PUBLISH_LIMITS.keywordsMax
                          ? "over"
                          : keywords.length < PUBLISH_LIMITS.keywordsRecommendedMin
                            ? "warn"
                            : "ok"
                      }
                    >
                      {keywords.length}/{PUBLISH_LIMITS.keywordsMax}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={!canEdit || !canUseAi || busy}
                      onClick={() => void generate("keywords")}
                    >
                      {t("publishGenerateKeywords")}
                    </button>
                  </div>
                </div>
                <p className="muted publish-field-hint">{t("publishKeywordsHint")}</p>
                <div className="publish-keyword-chips">
                  {keywords.map((word, index) => (
                    <button
                      key={`${word}-${index}`}
                      type="button"
                      className="publish-keyword-chip"
                      disabled={!canEdit || busy}
                      onClick={() => removeKeyword(index)}
                      title={t("publishKeywordRemove")}
                    >
                      {word}
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                  {canEdit ? (
                    <input
                      type="text"
                      className="publish-keyword-input"
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={onKeywordKeyDown}
                      onBlur={() => {
                        if (keywordInput.trim()) addKeyword(keywordInput);
                      }}
                      placeholder={
                        keywords.length >= PUBLISH_LIMITS.keywordsMax
                          ? t("publishKeywordsFull")
                          : t("publishKeywordsPlaceholder")
                      }
                      disabled={busy || keywords.length >= PUBLISH_LIMITS.keywordsMax}
                    />
                  ) : null}
                </div>
              </div>

              <label className="team-field">
                <span>{t("publishCategories")}</span>
                <input
                  type="text"
                  value={draft.categories}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, categories: e.target.value }))
                  }
                  placeholder={t("publishCategoriesPlaceholder")}
                  disabled={!canEdit || busy}
                />
              </label>
              <p className="muted publish-field-hint">{t("publishCategoriesHint")}</p>
            </>
          ) : null}
        </section>

        {canEdit ? (
          <div className="publish-form-footer publish-form-footer--sticky">
            {dirty ? <span className="muted">{t("publishUnsaved")}</span> : (
              <span className="muted">{t("publishAllSaved")}</span>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
              {busy ? t("publishSaving") : t("publishSaveCopy")}
            </button>
          </div>
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
