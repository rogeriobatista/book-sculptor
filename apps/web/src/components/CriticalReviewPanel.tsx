"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";
import { useToast } from "@/components/ToastProvider";

export type CriticalFinding = {
  id: string;
  category: string;
  severity: "minor" | "moderate" | "major";
  chapter_id?: string | null;
  chapter_label?: string;
  quote: string;
  message: string;
  suggested_fix?: string;
};

export type CriticalReviewResult = {
  job_id: string;
  scope: string;
  categories: string[];
  summary: string;
  findings: CriticalFinding[];
  chapter_count?: number;
  char_count?: number;
};

const CATEGORIES = [
  "spelling",
  "grammar",
  "cohesion",
  "organization",
  "incoherence",
  "style",
] as const;

type Props = {
  bookId: string;
  chapterId: string;
  canUseAi: boolean;
  canEdit: boolean;
  selectionQuote: string;
  onJumpToQuote: (quote: string) => void;
  onPromoted?: () => void;
};

export function CriticalReviewPanel({
  bookId,
  chapterId,
  canUseAi,
  canEdit,
  selectionQuote,
  onJumpToQuote,
  onPromoted,
}: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const [scope, setScope] = useState<"chapter" | "book" | "selection">("chapter");
  const [selectedCats, setSelectedCats] = useState<string[]>([...CATEGORIES]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CriticalReviewResult | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectionQuote.trim()) {
      setScope("selection");
    }
  }, [selectionQuote]);

  const toggleCategory = (cat: string) => {
    setSelectedCats((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const runReview = useCallback(async () => {
    if (!canUseAi) return;
    setBusy(true);
    const loadingId = toast.loading(t("critiqueRunning"));
    try {
      const token = await getToken();
      const payload = await clientApiFetch<CriticalReviewResult>(
        "/api/v1/ai/critical-review",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            book_id: bookId,
            chapter_id: chapterId,
            scope,
            categories: selectedCats,
            selection: scope === "selection" ? selectionQuote : "",
          }),
        },
      );
      setResult(payload);
      setDismissed(new Set());
      toast.update(loadingId, {
        tone: "success",
        title: t("critiqueDone", { count: payload.findings.length }),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("critiqueFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [
    bookId,
    canUseAi,
    chapterId,
    getToken,
    scope,
    selectedCats,
    selectionQuote,
    t,
    toast,
  ]);

  async function promoteFinding(finding: CriticalFinding, asSuggestion: boolean) {
    if (!canEdit) return;
    if (finding.chapter_id && finding.chapter_id !== chapterId) {
      toast.error(t("critiqueWrongChapter"));
      return;
    }
    setBusy(true);
    try {
      const token = await getToken();
      await clientApiFetch(
        `/api/v1/books/${bookId}/chapters/${chapterId}/comments`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            kind: asSuggestion && finding.suggested_fix ? "suggestion" : "comment",
            quote: finding.quote,
            body: `[${t(`critiqueCat_${finding.category}`)}] ${finding.message}`,
            proposed_text: asSuggestion ? finding.suggested_fix || undefined : undefined,
          }),
        },
      );
      toast.success(t("critiquePromoted"));
      onPromoted?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("critiquePromoteFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  const visibleFindings =
    result?.findings.filter((f) => !dismissed.has(f.id)) ?? [];

  if (!canUseAi) {
    return (
      <div className="critical-review-panel">
        <p className="editor-tools-notice">{t("critiqueProOnly")}</p>
      </div>
    );
  }

  return (
    <div className="critical-review-panel">
      <p className="editor-tools-tip">{t("critiqueLead")}</p>

      <fieldset className="critique-fieldset">
        <legend>{t("critiqueScopeLabel")}</legend>
        <div className="critique-scope">
          <label>
            <input
              type="radio"
              name="critique-scope"
              checked={scope === "chapter"}
              onChange={() => setScope("chapter")}
              disabled={busy}
            />
            {t("critiqueScopeChapter")}
          </label>
          <label>
            <input
              type="radio"
              name="critique-scope"
              checked={scope === "book"}
              onChange={() => setScope("book")}
              disabled={busy}
            />
            {t("critiqueScopeBook")}
          </label>
          {selectionQuote.trim() ? (
            <label>
              <input
                type="radio"
                name="critique-scope"
                checked={scope === "selection"}
                onChange={() => setScope("selection")}
                disabled={busy}
              />
              {t("critiqueScopeSelection")}
            </label>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="critique-fieldset">
        <legend>{t("critiqueCategoriesLabel")}</legend>
        <div className="critique-categories">
          {CATEGORIES.map((cat) => (
            <label key={cat} className="critique-cat">
              <input
                type="checkbox"
                checked={selectedCats.includes(cat)}
                onChange={() => toggleCategory(cat)}
                disabled={busy}
              />
              {t(`critiqueCat_${cat}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || selectedCats.length === 0}
        onClick={() => void runReview()}
      >
        {busy ? t("critiqueRunning") : t("critiqueRun")}
      </button>

      {result ? (
        <div className="critique-results">
          <p className="critique-summary">{result.summary}</p>
          {visibleFindings.length === 0 ? (
            <p className="muted">{t("critiqueNoFindings")}</p>
          ) : (
            <ul className="critique-findings">
              {visibleFindings.map((finding) => (
                <li
                  key={finding.id}
                  className="critique-finding"
                  data-severity={finding.severity}
                >
                  <div className="critique-finding-head">
                    <span className="critique-badge" data-cat={finding.category}>
                      {t(`critiqueCat_${finding.category}`)}
                    </span>
                    <span className="critique-severity">
                      {t(`critiqueSeverity_${finding.severity}`)}
                    </span>
                  </div>
                  {finding.chapter_label &&
                  finding.chapter_id &&
                  finding.chapter_id !== chapterId ? (
                    <p className="critique-chapter muted">{finding.chapter_label}</p>
                  ) : null}
                  <blockquote className="critique-quote">{finding.quote}</blockquote>
                  <p className="critique-message">{finding.message}</p>
                  {finding.suggested_fix ? (
                    <p className="critique-fix">
                      <strong>{t("critiqueSuggestedFix")}</strong> {finding.suggested_fix}
                    </p>
                  ) : null}
                  <div className="critique-actions">
                    {(!finding.chapter_id || finding.chapter_id === chapterId) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => onJumpToQuote(finding.quote)}
                      >
                        {t("reviewGoToPassage")}
                      </button>
                    )}
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void promoteFinding(finding, false)}
                        >
                          {t("critiqueAddComment")}
                        </button>
                        {finding.suggested_fix ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void promoteFinding(finding, true)}
                          >
                            {t("critiqueAddSuggestion")}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        setDismissed((prev) => new Set(prev).add(finding.id))
                      }
                    >
                      {t("critiqueDismiss")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
