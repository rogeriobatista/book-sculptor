"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import {
  type Book,
  clientApiBlobUrl,
  clientApiFetch,
  isAbortError,
} from "@/lib/client-api";
import {
  PUBLISH_LIMITS,
  SOCIAL_ART_FORMATS,
  SOCIAL_PLATFORMS,
  counterTone,
  type PublicationProfile,
  type PublishQueueJob,
  type SocialArtAsset,
} from "@/lib/publication";
import { useAuthenticatedMediaUrl } from "@/lib/use-authenticated-media";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  book: Book;
  canUseAi: boolean;
  canEdit: boolean;
  profile: PublicationProfile;
  onProfileChange: (profile: PublicationProfile) => void;
  onOpenIntegrations?: () => void;
};

const SOCIAL_FORMATS = [
  { id: "instagram_post", ratio: "1:1", w: 1080, h: 1080 },
  { id: "instagram_story", ratio: "9:16", w: 1080, h: 1920 },
  { id: "x_post", ratio: "16:9", w: 1200, h: 675 },
  { id: "facebook", ratio: "1.91:1", w: 1200, h: 628 },
] as const;

export function SocialPublishingPanel({
  book,
  canUseAi,
  canEdit,
  profile,
  onProfileChange,
  onOpenIntegrations,
}: Props) {
  const t = useTranslations("studio");
  const toast = useToast();
  const { getTokenRef } = useStableAuth();
  const coverSrc = useAuthenticatedMediaUrl(book.cover_url);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [quote, setQuote] = useState(profile.short_description || "");
  const [selectedFormats, setSelectedFormats] = useState<string[]>([...SOCIAL_ART_FORMATS]);
  const [assets, setAssets] = useState<SocialArtAsset[]>([]);
  const [queueAssetId, setQueueAssetId] = useState<string>("");
  const [socialTab, setSocialTab] = useState<"artwork" | "posts">("artwork");

  const loadAssets = useCallback(async () => {
    const token = await getTokenRef.current();
    const rows = await clientApiFetch<SocialArtAsset[]>(
      `/api/v1/books/${book.id}/publication/social-art`,
      token,
    );
    setAssets(rows);
  }, [book.id, getTokenRef]);

  useEffect(() => {
    const ac = new AbortController();
    loadAssets().catch((err) => {
      if (!isAbortError(err) && !ac.signal.aborted) setAssets([]);
    });
    return () => ac.abort();
  }, [loadAssets]);

  useEffect(() => {
    setQuote(profile.short_description || profile.social_posts[0]?.text || "");
  }, [profile]);

  function toggleFormat(formatId: string) {
    setSelectedFormats((prev) =>
      prev.includes(formatId) ? prev.filter((id) => id !== formatId) : [...prev, formatId],
    );
  }

  async function generateArt() {
    if (!canEdit) return;
    if (!book.cover_url) {
      toast.error(t("publishNoCover"));
      return;
    }
    if (!selectedFormats.length) {
      toast.error(t("publishArtSelectFormat"));
      return;
    }
    setBusy(true);
    const loadingId = toast.loading(t("publishArtGenerating"));
    try {
      const token = await getTokenRef.current();
      const rows = await clientApiFetch<SocialArtAsset[]>(
        `/api/v1/books/${book.id}/publication/social-art/generate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            formats: selectedFormats,
            quote,
            include_title: true,
          }),
        },
      );
      setAssets((prev) => [...rows, ...prev]);
      toast.update(loadingId, { tone: "success", title: t("publishArtGenerated") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("publishArtFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(assetId: string) {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(
        `/api/v1/books/${book.id}/publication/social-art/${assetId}`,
        token,
        { method: "DELETE" },
      );
      setAssets((prev) => prev.filter((item) => item.id !== assetId));
      if (queueAssetId === assetId) setQueueAssetId("");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAsset(asset: SocialArtAsset) {
    try {
      const token = await getTokenRef.current();
      const blobUrl = await clientApiBlobUrl(asset.url, token);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${book.title || "book"}-${asset.format_id}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success(t("publishArtDownloaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishArtDownloadFailed"));
    }
  }

  async function generatePosts() {
    if (!canUseAi) {
      toast.error(t("upgradeAi"));
      return;
    }
    setBusy(true);
    const loadingId = toast.loading(t("publishGenerating"));
    try {
      const token = await getTokenRef.current();
      const updated = await clientApiFetch<PublicationProfile>(
        `/api/v1/books/${book.id}/publication/generate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ kind: "social_posts", hint }),
        },
      );
      onProfileChange(updated);
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

  async function savePosts() {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      const updated = await clientApiFetch<PublicationProfile>(
        `/api/v1/books/${book.id}/publication`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ social_posts: profile.social_posts }),
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

  async function queuePost(index: number, publishNow: boolean) {
    const post = profile.social_posts[index];
    if (!post?.text.trim()) return;
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch<PublishQueueJob>(
        `/api/v1/books/${book.id}/publication/publish-queue`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            platform: post.platform || "instagram",
            post_text: post.text,
            social_asset_id: queueAssetId || null,
            publish_now: publishNow,
          }),
        },
      );
      toast.success(publishNow ? t("publishPosted") : t("publishQueuedDraft"));
      onOpenIntegrations?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishScheduleFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyPost(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("publishCopied", { field: t("publishSocialPostsTitle") }));
    } catch {
      toast.error(t("publishCopyFailed"));
    }
  }

  return (
    <div className="publish-section publish-section--tabbed">
      <header className="publish-section-head">
        <h2>{t("publishSocialTitle")}</h2>
        <p className="muted">{t("publishSocialLead")}</p>
      </header>

      <div className="publish-subnav" role="tablist" aria-label={t("publishSocialSubnav")}>
        <button
          type="button"
          role="tab"
          className="publish-subnav-tab"
          aria-selected={socialTab === "artwork"}
          data-active={socialTab === "artwork"}
          data-filled={assets.length > 0}
          onClick={() => setSocialTab("artwork")}
        >
          {t("publishSocialTab_artwork")}
        </button>
        <button
          type="button"
          role="tab"
          className="publish-subnav-tab"
          aria-selected={socialTab === "posts"}
          data-active={socialTab === "posts"}
          data-filled={profile.social_posts.length > 0}
          onClick={() => setSocialTab("posts")}
        >
          {t("publishSocialTab_posts")}
        </button>
      </div>

      {socialTab === "artwork" ? (
      <section className="settings-card publish-tab-panel">
        <div className="settings-card__head">
          <h3 className="settings-card__title">{t("publishArtTitle")}</h3>
          <p className="settings-card__lead">{t("publishArtLead")}</p>
        </div>

        <div className="publish-art-format-picker">
          {SOCIAL_FORMATS.map((format) => (
            <label key={format.id} className="publish-art-format-option">
              <input
                type="checkbox"
                checked={selectedFormats.includes(format.id)}
                disabled={!canEdit || busy}
                onChange={() => toggleFormat(format.id)}
              />
              <span>
                {t(`publishFormat_${format.id}`)} · {format.ratio}
              </span>
            </label>
          ))}
        </div>

        <label className="team-field">
          <span>{t("publishArtQuote")}</span>
          <input
            type="text"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            placeholder={t("publishArtQuotePlaceholder")}
            disabled={!canEdit || busy}
          />
        </label>

        <div className="publish-generate-row">
          <button
            type="button"
            className="btn btn-primary btn-compact"
            disabled={busy || !canEdit || !book.cover_url}
            onClick={() => void generateArt()}
          >
            {t("publishArtGenerate")}
          </button>
        </div>

        {assets.length > 0 ? (
          <div className="publish-art-gallery" aria-label={t("publishArtGallery")}>
            {assets.map((asset) => (
              <SocialArtCard
                key={asset.id}
                asset={asset}
                selected={queueAssetId === asset.id}
                canEdit={canEdit}
                busy={busy}
                onSelect={() => setQueueAssetId(asset.id)}
                onDownload={() => void downloadAsset(asset)}
                onRemove={() => void removeAsset(asset.id)}
              />
            ))}
          </div>
        ) : (
          <div className="publish-social-formats" aria-label={t("publishSocialFormats")}>
            {SOCIAL_FORMATS.map((format) => (
              <div key={format.id} className="publish-format-card" data-ratio={format.id}>
                <div
                  className="publish-format-preview"
                  style={{ aspectRatio: `${format.w} / ${format.h}` }}
                >
                  {coverSrc ? (
                    <img src={coverSrc} alt="" className="publish-format-cover" />
                  ) : (
                    <span className="muted">{t("publishNoCover")}</span>
                  )}
                </div>
                <p className="publish-format-label">
                  {t(`publishFormat_${format.id}`)} · {format.ratio}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
      ) : (
      <section className="settings-card publish-tab-panel">
        <div className="settings-card__head">
          <h3 className="settings-card__title">{t("publishSocialPostsTitle")}</h3>
          <p className="settings-card__lead">{t("publishSocialPostsLead")}</p>
        </div>

        <label className="team-field">
          <span>{t("publishHintLabel")}</span>
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder={t("publishSocialHintPlaceholder")}
            disabled={busy || !canEdit}
          />
        </label>

        <div className="publish-generate-row">
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !canEdit || !canUseAi}
            onClick={() => void generatePosts()}
          >
            {t("publishGenerateSocial")}
          </button>
        </div>

        {queueAssetId ? (
          <p className="muted publish-field-hint">{t("publishArtAttachedHint")}</p>
        ) : null}

        {profile.social_posts.length > 0 ? (
          <ul className="publish-post-list">
            {profile.social_posts.map((post, index) => {
              const tone = counterTone(
                post.text.length,
                PUBLISH_LIMITS.socialPostSoft,
                2000,
              );
              return (
                <li key={`${post.platform}-${index}`} className="publish-post-item">
                  <div className="publish-post-head">
                    {canEdit ? (
                      <select
                        value={post.platform}
                        onChange={(e) => {
                          const next = [...profile.social_posts];
                          next[index] = { ...post, platform: e.target.value };
                          onProfileChange({ ...profile, social_posts: next });
                        }}
                      >
                        {SOCIAL_PLATFORMS.map((platform) => (
                          <option key={platform} value={platform}>
                            {t(`publishPlatform_${platform}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="publish-post-platform">{post.platform}</span>
                    )}
                    <span className="publish-counter" data-tone={tone}>
                      {post.text.length}/{PUBLISH_LIMITS.socialPostSoft}
                    </span>
                  </div>
                  {canEdit ? (
                    <textarea
                      rows={3}
                      value={post.text}
                      onChange={(e) => {
                        const next = [...profile.social_posts];
                        next[index] = { ...post, text: e.target.value };
                        onProfileChange({ ...profile, social_posts: next });
                      }}
                    />
                  ) : (
                    <p>{post.text}</p>
                  )}
                  {canEdit ? (
                    <div className="publish-post-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={busy || !post.text.trim()}
                        onClick={() => void copyPost(post.text)}
                      >
                        {t("publishCopy")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={busy || !post.text.trim()}
                        onClick={() => void queuePost(index, false)}
                      >
                        {t("publishQueueDraft")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={busy || !post.text.trim()}
                        onClick={() => void queuePost(index, true)}
                      >
                        {t("publishPostNow")}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{t("publishSocialEmpty")}</p>
        )}

        {canEdit && profile.social_posts.length > 0 ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void savePosts()}
          >
            {t("publishSaveCopy")}
          </button>
        ) : null}
      </section>
      )}
    </div>
  );
}

function SocialArtCard({
  asset,
  selected,
  canEdit,
  busy,
  onSelect,
  onDownload,
  onRemove,
}: {
  asset: SocialArtAsset;
  selected: boolean;
  canEdit: boolean;
  busy: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("studio");
  const src = useAuthenticatedMediaUrl(asset.url);

  return (
    <figure className="publish-art-card" data-selected={selected}>
      {src ? (
        <img src={src} alt="" className="publish-art-image" loading="lazy" />
      ) : (
        <div className="publish-art-placeholder muted">…</div>
      )}
      <figcaption>
        <span>{t(`publishFormat_${asset.format_id}`)}</span>
        <div className="publish-art-actions">
          {canEdit ? (
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={busy}
              onClick={onSelect}
            >
              {selected ? t("publishArtSelected") : t("publishArtUseInQueue")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy}
            onClick={onDownload}
          >
            {t("publishArtDownload")}
          </button>
          {canEdit ? (
            <button
              type="button"
              className="btn btn-ghost btn-compact danger"
              disabled={busy}
              onClick={onRemove}
            >
              {t("publishArtDelete")}
            </button>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}
