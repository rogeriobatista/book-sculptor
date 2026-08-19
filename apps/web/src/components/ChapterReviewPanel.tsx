"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";

export type ChapterCommentItem = {
  id: string;
  kind: "comment" | "suggestion";
  status: string;
  quote: string;
  body: string;
  proposed_text?: string | null;
  created_at: string;
  author: { user_id: string; email: string };
};

export type ChapterVersionItem = {
  id: string;
  title: string;
  created_at: string;
  preview: string;
  author: { user_id: string; email: string };
};

export type ChapterActivityItem = {
  id: string;
  action: string;
  summary: string;
  created_at: string;
  author: { user_id: string; email: string };
};

type Props = {
  bookId: string;
  chapterId: string;
  canEdit: boolean;
  selectionQuote: string;
  onRestored: () => void;
  onClearSelection: () => void;
  embedded?: boolean;
  onMeta?: (meta: { openCount: number }) => void;
  onCommentsChange?: (comments: ChapterCommentItem[]) => void;
  onJumpToQuote?: (quote: string) => void;
};

type Tab = "comments" | "history" | "activity";

export function ChapterReviewPanel({
  bookId,
  chapterId,
  canEdit,
  selectionQuote,
  onRestored,
  onClearSelection,
  embedded = false,
  onMeta,
  onCommentsChange,
  onJumpToQuote,
}: Props) {
  const { getToken } = useAppAuth();
  const t = useTranslations("studio");
  const [tab, setTab] = useState<Tab>("comments");
  const [comments, setComments] = useState<ChapterCommentItem[]>([]);
  const [versions, setVersions] = useState<ChapterVersionItem[]>([]);
  const [activity, setActivity] = useState<ChapterActivityItem[]>([]);
  const [draft, setDraft] = useState("");
  const [suggestionText, setSuggestionText] = useState("");
  const [mode, setMode] = useState<"comment" | "suggestion">("comment");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const [c, v, a] = await Promise.all([
      clientApiFetch<ChapterCommentItem[]>(
        `/api/v1/books/${bookId}/chapters/${chapterId}/comments`,
        token,
      ),
      clientApiFetch<ChapterVersionItem[]>(
        `/api/v1/books/${bookId}/chapters/${chapterId}/versions`,
        token,
      ),
      clientApiFetch<ChapterActivityItem[]>(
        `/api/v1/books/${bookId}/chapters/${chapterId}/activity`,
        token,
      ),
    ]);
    setComments(c);
    setVersions(v);
    setActivity(a);
  }, [bookId, chapterId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onMeta?.({ openCount: comments.filter((item) => item.status === "open").length });
  }, [comments, onMeta]);

  useEffect(() => {
    onCommentsChange?.(comments);
  }, [comments, onCommentsChange]);

  async function submitReview() {
    if (!draft.trim()) return;
    if (mode === "suggestion" && !canEdit) return;
    setBusy(true);
    try {
      const token = await getToken();
      await clientApiFetch(
        `/api/v1/books/${bookId}/chapters/${chapterId}/comments`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            kind: mode,
            quote: selectionQuote,
            body: draft.trim(),
            proposed_text: mode === "suggestion" ? suggestionText.trim() : undefined,
          }),
        },
      );
      setDraft("");
      setSuggestionText("");
      onClearSelection();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updateComment(id: string, status: string) {
    setBusy(true);
    try {
      const token = await getToken();
      await clientApiFetch(
        `/api/v1/books/${bookId}/chapters/${chapterId}/comments/${id}`,
        token,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      await load();
      if (status === "accepted") onRestored();
    } finally {
      setBusy(false);
    }
  }

  async function restoreVersion(versionId: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      const token = await getToken();
      await clientApiFetch(
        `/api/v1/books/${bookId}/chapters/${chapterId}/versions/${versionId}/restore`,
        token,
        { method: "POST" },
      );
      await load();
      onRestored();
    } finally {
      setBusy(false);
    }
  }

  const openCount = comments.filter((item) => item.status === "open").length;

  return (
    <div
      className={embedded ? "chapter-review-panel chapter-review-embedded" : "chapter-review-panel"}
    >
      <div className="chapter-review-tabs" role="tablist" aria-label={t("reviewSubTabsLabel")}>
        {(["comments", "history", "activity"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className="chapter-review-tab"
            data-active={tab === item}
            aria-selected={tab === item}
            onClick={() => setTab(item)}
          >
            {t(`reviewTab_${item}`)}
          </button>
        ))}
      </div>

      {tab === "comments" ? (
        <div className="chapter-review-body">
          <ol className="review-steps" aria-label={t("reviewStepsLabel")}>
            <li data-done={selectionQuote ? "true" : "false"}>
              <span className="review-step-num">1</span>
              {t("reviewStepSelect")}
            </li>
            <li data-done={draft.trim() ? "true" : "false"}>
              <span className="review-step-num">2</span>
              {t("reviewStepWrite")}
            </li>
            <li>
              <span className="review-step-num">3</span>
              {t("reviewStepSubmit")}
            </li>
          </ol>

          {selectionQuote ? (
            <blockquote className="review-selection">
              <span className="field-label">{t("reviewSelectedPassage")}</span>
              “{selectionQuote.slice(0, 220)}
              {selectionQuote.length > 220 ? "…" : ""}”
              <button
                type="button"
                className="btn btn-ghost btn-compact review-clear-selection"
                onClick={onClearSelection}
              >
                {t("reviewClearSelection")}
              </button>
            </blockquote>
          ) : (
            <p className="muted review-hint">{t("reviewSelectHint")}</p>
          )}

          <div className="review-mode" role="radiogroup" aria-label={t("reviewModeLabel")}>
            <label className="review-mode-option" data-active={mode === "comment"}>
              <input
                type="radio"
                name="review-mode"
                checked={mode === "comment"}
                onChange={() => setMode("comment")}
              />
              <span>
                <strong>{t("reviewComment")}</strong>
                <span className="muted">{t("reviewCommentDesc")}</span>
              </span>
            </label>
            <label
              className="review-mode-option"
              data-active={mode === "suggestion"}
              data-disabled={!canEdit}
            >
              <input
                type="radio"
                name="review-mode"
                checked={mode === "suggestion"}
                onChange={() => setMode("suggestion")}
                disabled={!canEdit}
              />
              <span>
                <strong>{t("reviewSuggestion")}</strong>
                <span className="muted">{t("reviewSuggestionDesc")}</span>
              </span>
            </label>
          </div>

          <label className="field-block">
            <span className="field-label">{t("reviewFeedbackLabel")}</span>
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("reviewCommentPlaceholder")}
              disabled={busy}
            />
          </label>
          {mode === "suggestion" ? (
            <label className="field-block">
              <span className="field-label">{t("reviewProposedLabel")}</span>
              <textarea
                rows={2}
                value={suggestionText}
                onChange={(e) => setSuggestionText(e.target.value)}
                placeholder={t("reviewSuggestionPlaceholder")}
                disabled={busy}
              />
            </label>
          ) : null}
          <div className="editor-tools-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy ||
                !draft.trim() ||
                (mode === "suggestion" && !suggestionText.trim())
              }
              onClick={() => void submitReview()}
            >
              {t("reviewSubmit")}
            </button>
          </div>

          {comments.length > 0 ? (
            <div className="review-thread-head">
              <h4>{t("reviewThreadTitle")}</h4>
              {openCount > 0 ? (
                <span className="editor-tools-badge">{openCount}</span>
              ) : null}
            </div>
          ) : null}

          <ul className="review-list">
            {comments.map((item) => (
              <li key={item.id} className="review-item" data-kind={item.kind} data-status={item.status}>
                <p className="review-item-meta">
                  <strong>{item.author.email || t("reviewUnknown")}</strong>
                  <span className="review-status-pill" data-status={item.status}>
                    {item.status === "open"
                      ? t("reviewStatus_open")
                      : item.status === "resolved"
                        ? t("reviewStatus_resolved")
                        : item.status === "accepted"
                          ? t("reviewStatus_accepted")
                          : item.status === "rejected"
                            ? t("reviewStatus_rejected")
                            : item.status}
                  </span>
                </p>
                {item.quote ? (
                  <button
                    type="button"
                    className="review-quote-link"
                    onClick={() => onJumpToQuote?.(item.quote)}
                  >
                    “{item.quote.slice(0, 120)}{item.quote.length > 120 ? "…" : ""}”
                  </button>
                ) : null}
                <p className="review-item-body">{item.body}</p>
                {item.proposed_text ? (
                  <p className="review-proposed">
                    <span className="muted">{t("reviewProposed")}:</span> {item.proposed_text.slice(0, 160)}
                  </p>
                ) : null}
                <div className="review-actions">
                  {item.quote ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={busy}
                      onClick={() => onJumpToQuote?.(item.quote)}
                    >
                      {t("reviewGoToPassage")}
                    </button>
                  ) : null}
                  {item.kind === "comment" && item.status === "open" ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={busy}
                      onClick={() => void updateComment(item.id, "resolved")}
                    >
                      {t("reviewResolve")}
                    </button>
                  ) : null}
                  {item.kind === "suggestion" && item.status === "open" && canEdit ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={busy}
                        onClick={() => void updateComment(item.id, "accepted")}
                      >
                        {t("reviewAccept")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact danger"
                        disabled={busy}
                        onClick={() => void updateComment(item.id, "rejected")}
                      >
                        {t("reviewReject")}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="chapter-review-body">
          <p className="muted editor-tools-tip">{t("reviewHistoryHint")}</p>
          <ul className="review-list">
          {versions.map((item) => (
            <li key={item.id} className="review-item">
              <p className="review-item-meta">
                <strong>{item.author.email || t("reviewUnknown")}</strong>
                <span className="muted"> · {new Date(item.created_at).toLocaleString()}</span>
              </p>
              <p className="muted">{item.preview || "—"}</p>
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busy}
                  onClick={() => void restoreVersion(item.id)}
                >
                  {t("reviewRestore")}
                </button>
              ) : null}
            </li>
          ))}
          </ul>
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="chapter-review-body">
          <p className="muted editor-tools-tip">{t("reviewActivityHint")}</p>
          <ul className="review-list">
          {activity.map((item) => (
            <li key={item.id} className="review-item">
              <p className="review-item-meta">
                <strong>{item.author.email || t("reviewUnknown")}</strong>
                <span className="muted"> · {item.action}</span>
              </p>
              <p>{item.summary}</p>
              <p className="muted">{new Date(item.created_at).toLocaleString()}</p>
            </li>
          ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
