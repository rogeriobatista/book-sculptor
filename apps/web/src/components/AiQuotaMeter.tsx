"use client";

import { useTranslations } from "next-intl";
import type { AiQuota } from "@/lib/use-ai-quota";

type Props = {
  quota: AiQuota;
  compact?: boolean;
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
}

export function AiQuotaMeter({ quota, compact = false }: Props) {
  const t = useTranslations("studio");

  if (!quota.allowed) {
    return (
      <p className="ai-quota-meter ai-quota-meter--locked">
        {t("upgradeAi")}
      </p>
    );
  }

  const percent = Math.min(100, quota.percent_used);
  const tone = quota.exceeded ? "danger" : quota.warning ? "warn" : "ok";

  return (
    <div
      className={`ai-quota-meter${compact ? " ai-quota-meter--compact" : ""}`}
      data-tone={tone}
      role="status"
      aria-label={t("aiQuotaLabel")}
    >
      <div className="ai-quota-meter__header">
        <span className="ai-quota-meter__label">{t("aiQuotaLabel")}</span>
        <span className="ai-quota-meter__value">
          {t("aiQuotaUsed", {
            used: formatTokens(quota.used),
            limit: formatTokens(quota.limit),
          })}
        </span>
      </div>
      <div className="ai-quota-meter__track" aria-hidden>
        <div
          className="ai-quota-meter__fill"
          style={{ width: `${percent}%` }}
        />
      </div>
      {quota.warning && !quota.exceeded ? (
        <p className="ai-quota-meter__hint">{t("aiQuotaWarning")}</p>
      ) : null}
      {quota.exceeded ? (
        <p className="ai-quota-meter__hint">{t("aiQuotaExceeded")}</p>
      ) : null}
    </div>
  );
}
