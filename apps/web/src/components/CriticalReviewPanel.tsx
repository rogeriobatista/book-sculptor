"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientApiFetch, isAbortError } from "@/lib/client-api";
import {
  loadCritiqueDismissed,
  saveCritiqueDismissed,
} from "@/lib/critique-session";
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
  score?: number;
  counts_by_category?: Record<string, number>;
  findings: CriticalFinding[];
  chapter_count?: number;
  char_count?: number;
  chapters_reviewed?: number;
  partial?: boolean;
};

const CATEGORIES = [
  "spelling",
  "grammar",
  "cohesion",
  "organization",
  "incoherence",
  "style",
] as const;

export type CritiqueFilterKey = "all" | (typeof CATEGORIES)[number];

type Props = {
  bookId: string;
  chapterId: string;
  canUseAi: boolean;
  canEdit: boolean;
  selectionQuote: string;
  result: CriticalReviewResult | null;
  dismissed: Set<string>;
  filter: CritiqueFilterKey;
  activeFindingId?: string | null;
  onResultChange: (result: CriticalReviewResult | null) => void;
  onDismissedChange: (dismissed: Set<string>) => void;
  onFilterChange: (filter: CritiqueFilterKey) => void;
  onJumpToQuote: (quote: string) => void;
  onPromoted?: () => void;
  onFindingsChange?: (findings: CriticalFinding[]) => void;
  onActiveFindingChange?: (findingId: string | null) => void;
  onApplyFix?: (finding: CriticalFinding) => boolean | Promise<boolean>;
};

function scoreTone(score: number): "excellent" | "good" | "fair" | "weak" {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 55) return "fair";
  return "weak";
}

export function CriticalReviewPanel({
  bookId,
  chapterId,
  canUseAi,
  canEdit,
  selectionQuote,
  result,
  dismissed,
  filter,
  activeFindingId = null,
  onResultChange,
  onDismissedChange,
  onFilterChange,
  onJumpToQuote,
  onPromoted,
  onFindingsChange,
  onActiveFindingChange,
  onApplyFix,
}: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const [scope, setScope] = useState<"chapter" | "book" | "selection">("chapter");
  const [selectedCats, setSelectedCats] = useState<string[]>([...CATEGORIES]);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const hydrateGen = useRef(0);

  useEffect(() => {
    if (!canUseAi) return;
    const gen = ++hydrateGen.current;
    let cancelled = false;

    async function hydrate() {
      setHydrating(true);
      try {
        const token = await getToken();
        const params = new URLSearchParams({ book_id: bookId });
        if (chapterId) params.set("chapter_id", chapterId);
        const latest = await clientApiFetch<CriticalReviewResult | null>(
          `/api/v1/ai/critical-review/latest?${params}`,
          token,
        );
        if (cancelled || gen !== hydrateGen.current) return;
        if (!latest?.job_id) {
          onResultChange(null);
          onDismissedChange(new Set());
          onFilterChange("all");
          onActiveFindingChange?.(null);
          return;
        }
        onResultChange(latest);
        onDismissedChange(loadCritiqueDismissed(latest.job_id));
        onFilterChange("all");
        onActiveFindingChange?.(null);
      } catch {
        if (cancelled || gen !== hydrateGen.current) return;
        // Keep any in-memory result if the network fails.
      } finally {
        if (!cancelled && gen === hydrateGen.current) setHydrating(false);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
    // Reload only when the chapter/book scope changes — not when setter identities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [bookId, chapterId, canUseAi]);

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
    hydrateGen.current += 1;
    setHydrating(false);
    setBusy(true);
    const loadingId = toast.loading(
      scope === "book" ? t("critiqueRunningBook") : t("critiqueRunning"),
    );
    const controller = new AbortController();
    const timeoutMs = scope === "book" ? 160_000 : 100_000;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = await getToken();
      const payload = await clientApiFetch<CriticalReviewResult>(
        "/api/v1/ai/critical-review",
        token,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            book_id: bookId,
            chapter_id: chapterId,
            scope,
            categories: selectedCats,
            selection: scope === "selection" ? selectionQuote : "",
          }),
        },
      );
      onResultChange(payload);
      const empty = new Set<string>();
      onDismissedChange(empty);
      if (payload.job_id) saveCritiqueDismissed(payload.job_id, empty);
      onFilterChange("all");
      onActiveFindingChange?.(null);
      toast.update(loadingId, {
        tone: "success",
        title: t("critiqueDone", { count: payload.findings.length }),
        description: payload.partial ? t("critiquePartialNote") : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const timedOut =
        isAbortError(err) ||
        /\(504\)/.test(message) ||
        /timed out/i.test(message);
      if (timedOut) {
        toast.update(loadingId, {
          tone: "error",
          title: t("critiqueTimedOut"),
          description: t("critiqueTimedOutHint"),
        });
      } else {
        toast.update(loadingId, {
          tone: "error",
          title: t("critiqueFailed"),
          description: message || undefined,
        });
      }
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
    }
  }, [
    bookId,
    canUseAi,
    chapterId,
    getToken,
    onActiveFindingChange,
    onDismissedChange,
    onFilterChange,
    onResultChange,
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

  function dismissFinding(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    onDismissedChange(next);
    if (result?.job_id) saveCritiqueDismissed(result.job_id, next);
    if (activeFindingId === id) onActiveFindingChange?.(null);
  }

  async function handleApplyFix(finding: CriticalFinding) {
    if (!canEdit || !finding.suggested_fix || !onApplyFix) return;
    if (finding.chapter_id && finding.chapter_id !== chapterId) {
      toast.error(t("critiqueWrongChapter"));
      return;
    }
    setBusy(true);
    try {
      const ok = await onApplyFix(finding);
      if (!ok) {
        toast.error(t("reviewPassageNotFound"));
        return;
      }
      dismissFinding(finding.id);
      toast.success(t("critiqueFixPending"));
    } finally {
      setBusy(false);
    }
  }

  const openFindings = useMemo(
    () => result?.findings.filter((f) => !dismissed.has(f.id)) ?? [],
    [dismissed, result],
  );

  useEffect(() => {
    onFindingsChange?.(openFindings);
  }, [openFindings, onFindingsChange]);

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: openFindings.length };
    for (const cat of CATEGORIES) counts[cat] = 0;
    for (const finding of openFindings) {
      counts[finding.category] = (counts[finding.category] || 0) + 1;
    }
    return counts;
  }, [openFindings]);

  const visibleFindings = useMemo(
    () =>
      filter === "all"
        ? openFindings
        : openFindings.filter((f) => f.category === filter),
    [filter, openFindings],
  );

  const score = result?.score ?? (result ? 100 : null);
  const tone = score == null ? null : scoreTone(score);

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

      {hydrating && !result ? (
        <p className="muted">{t("critiqueRestoring")}</p>
      ) : null}

      {result && score != null && tone ? (
        <div className="critique-results">
          <div className="critique-score-row">
            <div
              className="critique-score-ring"
              data-tone={tone}
              style={{ ["--score" as string]: score }}
              role="img"
              aria-label={t("critiqueScoreLabel", { score })}
            >
              <span className="critique-score-value">{score}</span>
            </div>
            <div className="critique-score-copy">
              <p className="critique-score-title">{t("critiqueScoreTitle")}</p>
              <p className="critique-summary">{result.summary}</p>
              {result.partial ? (
                <p className="muted critique-partial">{t("critiquePartialNote")}</p>
              ) : null}
            </div>
          </div>

          {openFindings.length > 0 ? (
            <div className="critique-filters" role="tablist" aria-label={t("critiqueFiltersLabel")}>
              <button
                type="button"
                role="tab"
                aria-selected={filter === "all"}
                className="critique-filter-pill"
                data-active={filter === "all"}
                onClick={() => onFilterChange("all")}
              >
                {t("critiqueFilterAll")} ({filterCounts.all})
              </button>
              {CATEGORIES.map((cat) => {
                const count = filterCounts[cat] || 0;
                if (!count) return null;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={filter === cat}
                    className="critique-filter-pill"
                    data-cat={cat}
                    data-active={filter === cat}
                    onClick={() => onFilterChange(cat)}
                  >
                    {t(`critiqueCat_${cat}`)} ({count})
                  </button>
                );
              })}
            </div>
          ) : null}

          {visibleFindings.length === 0 ? (
            <p className="muted">{t("critiqueNoFindings")}</p>
          ) : (
            <ul className="critique-findings">
              {visibleFindings.map((finding) => {
                const isActive = activeFindingId === finding.id;
                const canActHere =
                  !finding.chapter_id || finding.chapter_id === chapterId;
                return (
                  <li
                    key={finding.id}
                    className="critique-finding"
                    data-severity={finding.severity}
                    data-cat={finding.category}
                    data-active={isActive}
                    id={`critique-finding-${finding.id}`}
                  >
                    <button
                      type="button"
                      className="critique-finding-select"
                      onClick={() => {
                        onActiveFindingChange?.(finding.id);
                        if (canActHere) onJumpToQuote(finding.quote);
                      }}
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
                          <strong>{t("critiqueSuggestedFix")}</strong>{" "}
                          {finding.suggested_fix}
                        </p>
                      ) : null}
                    </button>
                    <div className="critique-actions">
                      {canActHere && finding.suggested_fix && canEdit && onApplyFix ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy}
                          onClick={() => handleApplyFix(finding)}
                        >
                          {t("critiqueApplyFix")}
                        </button>
                      ) : null}
                      {canActHere ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            onActiveFindingChange?.(finding.id);
                            onJumpToQuote(finding.quote);
                          }}
                        >
                          {t("reviewGoToPassage")}
                        </button>
                      ) : null}
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
                        onClick={() => dismissFinding(finding.id)}
                      >
                        {t("critiqueDismiss")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
