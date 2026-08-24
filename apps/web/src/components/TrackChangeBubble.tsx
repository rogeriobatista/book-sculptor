"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { ChapterCommentItem } from "@/components/ChapterReviewPanel";

type Props = {
  comment: ChapterCommentItem;
  anchor: { top: number; left: number };
  canEdit: boolean;
  busy?: boolean;
  onAccept: (commentId: string) => void;
  onReject: (commentId: string) => void;
  onClose: () => void;
};

export function TrackChangeBubble({
  comment,
  anchor,
  canEdit,
  busy = false,
  onAccept,
  onReject,
  onClose,
}: Props) {
  const t = useTranslations("studio");
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const el = panelRef.current;
      if (!el || el.contains(event.target as Node)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const proposed = comment.proposed_text?.trim() || "";

  return (
    <div
      ref={panelRef}
      className="track-change-bubble"
      role="dialog"
      aria-label={t("trackChangeTitle")}
      style={{ top: anchor.top, left: anchor.left }}
    >
      <p className="track-change-bubble-label">{t("trackChangeTitle")}</p>
      {comment.quote ? (
        <p className="track-change-original">
          <span className="muted">{t("trackChangeOriginal")}</span> {comment.quote}
        </p>
      ) : null}
      {proposed ? (
        <p className="track-change-proposed">
          <span className="muted">{t("trackChangeProposed")}</span> {proposed}
        </p>
      ) : null}
      {comment.body ? <p className="track-change-note muted">{comment.body}</p> : null}
      {canEdit ? (
        <div className="track-change-bubble-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => onAccept(comment.id)}
          >
            {t("reviewAccept")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm danger"
            disabled={busy}
            onClick={() => onReject(comment.id)}
          >
            {t("reviewReject")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
