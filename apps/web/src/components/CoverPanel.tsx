"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { type Book, clientApiFetch } from "@/lib/client-api";
import { useAuthenticatedMediaUrl } from "@/lib/use-authenticated-media";
import { useAppAuth } from "@/lib/use-app-auth";
import { useToast } from "@/components/ToastProvider";

type Props = {
  book: Book;
  onSaved: (book: Book) => void;
};

const STYLES = ["literary", "bold", "minimal", "fantasy"] as const;

export function CoverPanel({ book, onSaved }: Props) {
  const { getToken } = useAppAuth();
  const coverSrc = useAuthenticatedMediaUrl(book.cover_url);
  const toast = useToast();
  const t = useTranslations("studio");
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState(book.cover_prompt || "");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("literary");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setPrompt(book.cover_prompt || "");
  }, [book.id, book.cover_prompt]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    const loadingId = toast.loading(t("coverUploading"));
    try {
      const token = await getToken();
      const body = new FormData();
      body.append("file", file);
      const updated = await clientApiFetch<Book>(
        `/api/v1/books/${book.id}/cover`,
        token,
        { method: "POST", body },
      );
      onSaved(updated);
      toast.update(loadingId, { tone: "success", title: t("coverUploaded") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("coverUploadFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    setGenerating(true);
    const loadingId = toast.loading(t("coverGenerating"));
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Book>(
        `/api/v1/books/${book.id}/cover/generate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ prompt, style }),
        },
      );
      onSaved(updated);
      toast.update(loadingId, { tone: "success", title: t("coverGenerated") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("coverGenerateFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  }

  async function onRemove() {
    setRemoving(true);
    const loadingId = toast.loading(t("coverRemoving"));
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Book>(
        `/api/v1/books/${book.id}/cover`,
        token,
        { method: "DELETE" },
      );
      onSaved(updated);
      setPrompt("");
      toast.update(loadingId, { tone: "success", title: t("coverRemoved") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("coverRemoveFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRemoving(false);
    }
  }

  const busy = uploading || generating || removing;
  const sourceLabel =
    book.cover_source === "ai"
      ? t("coverSourceAi")
      : book.cover_source === "upload"
        ? t("coverSourceUpload")
        : null;

  return (
    <section className="cover-panel">
      <header className="format-panel-head">
        <h2>{t("coverTitle")}</h2>
        <p className="muted">{t("coverLead")}</p>
      </header>

      <div className="cover-layout">
        <div className="cover-preview-frame" aria-live="polite">
          {coverSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverSrc} alt={t("coverAlt", { title: book.title })} />
          ) : (
            <div className="cover-placeholder">
              <span>{t("coverEmpty")}</span>
            </div>
          )}
          {sourceLabel ? <p className="cover-source muted">{sourceLabel}</p> : null}
        </div>

        <div className="cover-actions">
          <div className="cover-upload">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? t("coverUploading") : t("coverUpload")}
            </button>
            <p className="muted cover-hint">{t("coverUploadHint")}</p>
          </div>

          <form className="cover-ai" onSubmit={onGenerate}>
            <label>
              {t("coverPrompt")}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t("coverPromptPlaceholder")}
                disabled={busy}
              />
            </label>
            <label>
              {t("coverStyle")}
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as (typeof STYLES)[number])}
                disabled={busy}
              >
                {STYLES.map((id) => (
                  <option key={id} value={id}>
                    {t(`coverStyle_${id}`)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {generating ? t("coverGenerating") : t("coverGenerate")}
            </button>
            <p className="muted cover-hint">{t("coverAiHint")}</p>
          </form>

          {coverSrc ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              {t("coverRemove")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
