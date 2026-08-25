"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { AiUsageDashboard } from "@/lib/use-ai-usage";

type Props = {
  data: AiUsageDashboard | null;
  loading: boolean;
  error: string | null;
  bookTitle?: string;
  onOpenVoiceSettings?: () => void;
  onRetry?: () => void;
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

const CATEGORY_KEYS: Record<string, string> = {
  chapter: "usageCatWriting",
  writing: "usageCatWriting",
  critique: "usageCatCritique",
  cover: "usageCatCover",
  publication: "usageCatPublication",
  structure: "usageCatStructure",
};

const ACTION_KEYS: Record<string, string> = {
  generate: "usageActionGenerate",
  continue: "usageActionContinue",
  rewrite: "usageActionRewrite",
  tone: "usageActionTone",
  dialogue: "usageActionDialogue",
  simplify: "usageActionSimplify",
  finalize: "usageActionFinalize",
  consistent: "usageActionConsistent",
  start: "usageActionStart",
  outline: "usageActionOutline",
};

export function BookAiUsagePanel({
  data,
  loading,
  error,
  bookTitle,
  onOpenVoiceSettings,
  onRetry,
}: Props) {
  const t = useTranslations("studio");
  const format = useFormatter();

  if (loading && !data) {
    return <p className="muted ai-usage-loading">{t("usageLoading")}</p>;
  }

  if (!data) {
    return (
      <div className="ai-usage-panel">
        <p className="ai-usage-error">{t("usageLoadFailed")}</p>
        {error ? <p className="muted ai-usage-error-detail">{error}</p> : null}
        {onRetry ? (
          <button type="button" className="btn btn-ghost btn-compact" onClick={onRetry}>
            {t("usageRetry")}
          </button>
        ) : null}
      </div>
    );
  }

  const { quota, tokens, breakdown, daily, recent, projection, context, plan, book } =
    data;
  const percent = Math.min(100, quota.percent_used);
  const tone = quota.exceeded ? "danger" : quota.warning ? "warn" : "ok";
  const maxDaily = Math.max(1, ...daily.map((d) => d.tokens));

  const paceLabel =
    projection.pace === "over"
      ? t("usagePaceOver")
      : projection.pace === "heavy"
        ? t("usagePaceHeavy")
        : projection.pace === "on_track"
          ? t("usagePaceOnTrack")
          : t("usagePaceUnavailable");

  return (
    <div className="ai-usage-panel">
      <header className="book-style-embedded-head">
        <div>
          <h3>{t("settingsTabAiUsage")}</h3>
          <p className="muted book-style-lead">{t("settingsTabAiUsageHint")}</p>
        </div>
        <span className="ai-usage-plan-badge" data-plan={plan.id}>
          {t(`usagePlan_${plan.id}`)}
        </span>
      </header>

      {!quota.allowed ? (
        <div className="settings-info-card ai-usage-upgrade-card">
          <h4>{t("upgradeAi")}</h4>
          <p className="muted">{t("usageUpgradeLead")}</p>
          <Link href="/pricing" className="btn btn-primary btn-compact">
            {t("usageUpgradeCta")}
          </Link>
        </div>
      ) : (
        <>
          <section className="ai-usage-hero settings-card" data-tone={tone}>
            <div className="ai-usage-hero__stats">
              <div className="ai-usage-stat">
                <span className="ai-usage-stat__label">{t("usageRemaining")}</span>
                <strong className="ai-usage-stat__value">
                  {formatTokens(quota.remaining)}
                </strong>
                <span className="ai-usage-stat__hint">{t("usageTokensUnit")}</span>
              </div>
              <div className="ai-usage-stat">
                <span className="ai-usage-stat__label">{t("usageUsed")}</span>
                <strong className="ai-usage-stat__value">
                  {formatTokens(quota.used)}
                </strong>
                <span className="ai-usage-stat__hint">
                  {t("usageOfLimit", { limit: formatTokens(quota.limit) })}
                </span>
              </div>
              <div className="ai-usage-stat">
                <span className="ai-usage-stat__label">{t("usageResets")}</span>
                <strong className="ai-usage-stat__value">
                  {projection.days_until_reset}
                </strong>
                <span className="ai-usage-stat__hint">{t("usageDaysLeft")}</span>
              </div>
            </div>
            <div className="ai-quota-meter__track ai-usage-hero__bar" aria-hidden>
              <div className="ai-quota-meter__fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="ai-usage-hero__meta muted">
              {t("usageResetDate", {
                date: format.dateTime(new Date(quota.resets_at), {
                  month: "short",
                  day: "numeric",
                }),
              })}
              {" · "}
              {t("usageModel", { model: plan.model })}
            </p>
          </section>

          <div className="ai-usage-grid">
            <section className="settings-card">
              <header className="settings-card__head">
                <h4 className="settings-card__title">{t("usageProjectionTitle")}</h4>
                <p className="settings-card__lead">{paceLabel}</p>
              </header>
              <dl className="ai-usage-kv">
                <div>
                  <dt>{t("usageDailyAvg")}</dt>
                  <dd>{formatTokens(projection.daily_average)}</dd>
                </div>
                <div>
                  <dt>{t("usageProjectedEnd")}</dt>
                  <dd>{formatTokens(projection.projected_month_end)}</dd>
                </div>
                <div>
                  <dt>{t("usageInputOutput")}</dt>
                  <dd>
                    {formatTokens(tokens.input)} / {formatTokens(tokens.output)}
                  </dd>
                </div>
              </dl>
            </section>

            {book ? (
              <section className="settings-card">
                <header className="settings-card__head">
                  <h4 className="settings-card__title">{t("usageBookTitle")}</h4>
                  <p className="settings-card__lead">
                    {t("usageBookLead", { title: bookTitle || "" })}
                  </p>
                </header>
                <dl className="ai-usage-kv">
                  <div>
                    <dt>{t("usageBookTokens")}</dt>
                    <dd>{formatTokens(book.tokens)}</dd>
                  </div>
                  <div>
                    <dt>{t("usageBookJobs")}</dt>
                    <dd>{book.jobs}</dd>
                  </div>
                  <div>
                    <dt>{t("usageBookShare")}</dt>
                    <dd>{book.percent_of_month}%</dd>
                  </div>
                </dl>
              </section>
            ) : null}
          </div>

          <section className="settings-card">
            <header className="settings-card__head">
              <h4 className="settings-card__title">{t("usageBreakdownTitle")}</h4>
              <p className="settings-card__lead">{t("usageBreakdownLead")}</p>
            </header>
            {breakdown.length === 0 ? (
              <p className="muted ai-usage-empty">{t("usageNoActivity")}</p>
            ) : (
              <ul className="ai-usage-breakdown">
                {breakdown.map((item) => {
                  const labelKey = CATEGORY_KEYS[item.category] ?? "usageCatOther";
                  return (
                    <li key={item.category} className="ai-usage-breakdown__row">
                      <div className="ai-usage-breakdown__label">
                        <span>{t(labelKey)}</span>
                        <span className="muted">
                          {item.jobs} {t("usageJobs")}
                        </span>
                      </div>
                      <div className="ai-usage-breakdown__bar" aria-hidden>
                        <span style={{ width: `${Math.max(item.percent, 4)}%` }} />
                      </div>
                      <span className="ai-usage-breakdown__value">
                        {formatTokens(item.tokens)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="settings-card">
            <header className="settings-card__head">
              <h4 className="settings-card__title">{t("usageDailyTitle")}</h4>
              <p className="settings-card__lead">{t("usageDailyLead")}</p>
            </header>
            <div className="ai-usage-chart" role="img" aria-label={t("usageDailyTitle")}>
              {daily.map((point) => (
                <div key={point.date} className="ai-usage-chart__col">
                  <div
                    className="ai-usage-chart__bar"
                    style={{ height: `${Math.max(4, (point.tokens / maxDaily) * 100)}%` }}
                    title={`${point.date}: ${formatTokens(point.tokens)}`}
                  />
                  <span className="ai-usage-chart__label">
                    {format.dateTime(new Date(`${point.date}T12:00:00`), {
                      day: "numeric",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-card">
            <header className="settings-card__head">
              <h4 className="settings-card__title">{t("usageRecentTitle")}</h4>
              <p className="settings-card__lead">{t("usageRecentLead")}</p>
            </header>
            {recent.length === 0 ? (
              <p className="muted ai-usage-empty">{t("usageNoActivity")}</p>
            ) : (
              <ul className="ai-usage-recent">
                {recent.map((job) => {
                  const labelKey = CATEGORY_KEYS[job.category] ?? "usageCatOther";
                  const actionKey = job.action ? ACTION_KEYS[job.action] : null;
                  const actionLabel = actionKey ? t(actionKey) : null;
                  return (
                    <li key={job.id} className="ai-usage-recent__row">
                      <div className="ai-usage-recent__main">
                        <span className="ai-usage-recent__type">
                          {actionLabel ?? t(labelKey)}
                        </span>
                        <span className="muted ai-usage-recent__time">
                          {format.dateTime(new Date(job.created_at), {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <span className="ai-usage-recent__tokens">
                        {formatTokens(job.tokens_used)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="settings-card">
            <header className="settings-card__head">
              <h4 className="settings-card__title">{t("settingsAiContextTitle")}</h4>
              <p className="settings-card__lead">{t("settingsAiContextLead")}</p>
            </header>
            <dl className="ai-usage-kv ai-usage-kv--context">
              <div>
                <dt>{t("usageContextBudget")}</dt>
                <dd>~{formatTokens(context.estimated_tokens_per_request)}</dd>
              </div>
              <div>
                <dt>{t("usageContextPrior")}</dt>
                <dd>
                  {context.use_prior_chapters
                    ? t("usageContextPriorOn", { count: context.prior_chapter_count })
                    : t("usageContextPriorOff")}
                </dd>
              </div>
            </dl>
            <ul className="settings-info-list">
              <li>{t("settingsAiContextItem1")}</li>
              <li>{t("settingsAiContextItem2")}</li>
              <li>{t("settingsAiContextItem3")}</li>
            </ul>
            {onOpenVoiceSettings ? (
              <button
                type="button"
                className="btn btn-ghost btn-compact ai-usage-context-link"
                onClick={onOpenVoiceSettings}
              >
                {t("usageOpenVoiceSettings")}
              </button>
            ) : null}
          </section>

          <section className="settings-info-card ai-usage-tips">
            <h4>{t("usageTipsTitle")}</h4>
            <ul className="settings-info-list">
              <li>{t("usageTip1")}</li>
              <li>{t("usageTip2")}</li>
              <li>{t("usageTip3")}</li>
            </ul>
          </section>

          {(quota.warning || quota.exceeded) && plan.id !== "studio" ? (
            <div className="settings-info-card ai-usage-upgrade-card" data-tone="warn">
              <h4>{quota.exceeded ? t("aiQuotaExceeded") : t("aiQuotaWarning")}</h4>
              <p className="muted">{t("usageUpgradeNearLimit")}</p>
              <Link href="/pricing" className="btn btn-primary btn-compact">
                {t("usageUpgradeCta")}
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
