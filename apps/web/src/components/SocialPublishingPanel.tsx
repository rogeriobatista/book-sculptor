"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import { type Book, clientApiFetch, isAbortError } from "@/lib/client-api";
import {
  SOCIAL_ART_FORMATS,
  type PublicationProfile,
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
    } finally {
      setBusy(false);
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

  return (
    <div className="publish-section">
      <header className="publish-section-head">
        <h2>{t("publishSocialTitle")}</h2>
        <p className="muted">{t("publishSocialLead")}</p>
      </header>

      <h3 className="publish-subtitle">{t("publishArtTitle")}</h3>
      <p className="muted">{t("publishArtLead")}</p>

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

      <label className="field-block">
        <span className="field-label">{t("publishArtQuote")}</span>
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
          className="btn btn-primary btn-sm"
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
              canEdit={canEdit}
              busy={busy}
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

      <h3 className="publish-subtitle">{t("publishSocialPostsTitle")}</h3>

      <label className="field-block">
        <span className="field-label">{t("publishHintLabel")}</span>
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
          className="btn btn-ghost btn-sm"
          disabled={busy || !canEdit}
          onClick={() => void generatePosts()}
        >
          {t("publishGenerateSocial")}
        </button>
      </div>

      {profile.social_posts.length > 0 ? (
        <ul className="publish-post-list">
          {profile.social_posts.map((post, index) => (
            <li key={`${post.platform}-${index}`} className="publish-post-item">
              <span className="publish-post-platform">{post.platform}</span>
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
            </li>
          ))}
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
    </div>
  );
}

function SocialArtCard({
  asset,
  canEdit,
  busy,
  onRemove,
}: {
  asset: SocialArtAsset;
  canEdit: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("studio");
  const src = useAuthenticatedMediaUrl(asset.url);

  return (
    <figure className="publish-art-card">
      {src ? (
        <img src={src} alt="" className="publish-art-image" loading="lazy" />
      ) : (
        <div className="publish-art-placeholder muted">…</div>
      )}
      <figcaption>
        <span>{t(`publishFormat_${asset.format_id}`)}</span>
        {canEdit ? (
          <button type="button" className="btn btn-ghost btn-sm danger" disabled={busy} onClick={onRemove}>
            {t("publishArtDelete")}
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}
