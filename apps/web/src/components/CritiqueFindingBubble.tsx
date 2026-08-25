"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { CriticalFinding } from "@/components/CriticalReviewPanel";

type Props = {
  finding: CriticalFinding;
  anchor: { top: number; left: number };
  canEdit: boolean;
  busy?: boolean;
  onJump: () => void;
  onApply: () => void;
  onSuggest: () => void;
  onDismiss: () => void;
  onClose: () => void;
};

export function CritiqueFindingBubble({
  finding,
  anchor,
  canEdit,
  busy = false,
  onJump,
  onApply,
  onSuggest,
  onDismiss,
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

  return (
    <div
      ref={panelRef}
      className="critique-finding-bubble"
      role="dialog"
      aria-label={t("critiqueBubbleTitle")}
      style={{ top: anchor.top, left: Math.min(anchor.left, window.innerWidth - 320) }}
    >
      <div className="critique-finding-bubble__head">
        <span className="critique-badge" data-cat={finding.category}>
          {t(`critiqueCat_${finding.category}`)}
        </span>
        <span className="critique-severity">
          {t(`critiqueSeverity_${finding.severity}`)}
        </span>
      </div>
      <p className="critique-finding-bubble__message">{finding.message}</p>
      {finding.suggested_fix ? (
        <p className="critique-finding-bubble__fix">
          <span className="muted">{t("critiqueSuggestedFix")}</span>{" "}
          {finding.suggested_fix}
        </p>
      ) : null}
      <div className="critique-finding-bubble__actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onJump}>
          {t("reviewGoToPassage")}
        </button>
        {canEdit && finding.suggested_fix ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onApply}
          >
            {t("critiqueApplyFix")}
          </button>
        ) : null}
        {canEdit && finding.suggested_fix ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onSuggest}
          >
            {t("critiqueAddSuggestion")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={onDismiss}
        >
          {t("critiqueDismiss")}
        </button>
      </div>
    </div>
  );
}
