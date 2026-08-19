"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { clientApiFetch, isAbortError } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";

type PlanKey = "free" | "pro" | "studio";

type Me = {
  plan?: PlanKey;
};

const FREE_FEATURES = [
  "featBooksFree",
  "featEditor",
  "featPreview",
  "featExportWatermark",
  "featImport",
] as const;

const PRO_FEATURES = [
  "featBooksUnlimited",
  "featExportClean",
  "featAiQuota",
  "featCriticalReview",
  "featCoverAi",
  "featCoverUpload",
  "featTypography",
] as const;

const STUDIO_FEATURES = [
  "featEverythingPro",
  "featAiStronger",
  "featTeam",
  "featPriorityExport",
  "featQuotaStudio",
] as const;

const VALUE_PILLARS = [
  { title: "value1Title", body: "value1Body" },
  { title: "value2Title", body: "value2Body" },
  { title: "value3Title", body: "value3Body" },
] as const;

const COMPARE_ROWS = [
  { label: "cmpBooks", free: "cmpOne", pro: "cmpUnlimited", studio: "cmpUnlimited" },
  { label: "cmpExport", free: "cmpWatermark", pro: "cmpClean", studio: "cmpCleanPriority" },
  { label: "cmpAi", free: "cmpNo", pro: "cmpAiPro", studio: "cmpAiStudio" },
  { label: "cmpCritique", free: "cmpNo", pro: "cmpYes", studio: "cmpYes" },
  { label: "cmpCover", free: "cmpUploadOnly", pro: "cmpCoverFull", studio: "cmpCoverFull" },
  { label: "cmpTeam", free: "cmpNo", pro: "cmpNo", studio: "cmpYes" },
] as const;

export function PricingActions() {
  const { getTokenRef, isSignedIn } = useStableAuth();
  const locale = useLocale();
  const t = useTranslations("pricing");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PlanKey | "portal" | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PlanKey>("free");

  useEffect(() => {
    if (!isSignedIn) {
      setCurrentPlan("free");
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        const token = await getTokenRef.current();
        const me = await clientApiFetch<Me>("/api/v1/me", token, { signal: ac.signal });
        if (!ac.signal.aborted && me.plan) setCurrentPlan(me.plan);
      } catch {
        /* ignore */
      }
    })();
    return () => ac.abort();
  }, [isSignedIn, getTokenRef]);

  async function checkout(plan: "pro" | "studio") {
    setError(null);
    if (!isSignedIn) {
      setError(t("signInRequired"));
      return;
    }
    setBusy(plan);
    try {
      const token = await getTokenRef.current();
      const data = await clientApiFetch<{ url: string }>(
        "/api/v1/billing/checkout",
        token,
        {
          method: "POST",
          body: JSON.stringify({ plan, ui_locale: locale }),
        },
      );
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("checkoutError"));
      setBusy(null);
    }
  }

  async function portal() {
    setError(null);
    if (!isSignedIn) {
      setError(t("signInRequired"));
      return;
    }
    setBusy("portal");
    try {
      const token = await getTokenRef.current();
      const data = await clientApiFetch<{ url: string }>(
        "/api/v1/billing/portal",
        token,
        { method: "POST" },
      );
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("checkoutError"));
      setBusy(null);
    }
  }

  const plans: {
    key: PlanKey;
    priceKey: "priceFree" | "pricePro" | "priceStudio";
    periodKey?: "perMonth";
    blurbKey: "freeBlurb" | "proBlurb" | "studioBlurb";
    features: readonly string[];
    featured: boolean;
  }[] = [
    {
      key: "free",
      priceKey: "priceFree",
      blurbKey: "freeBlurb",
      features: FREE_FEATURES,
      featured: false,
    },
    {
      key: "pro",
      priceKey: "pricePro",
      periodKey: "perMonth",
      blurbKey: "proBlurb",
      features: PRO_FEATURES,
      featured: true,
    },
    {
      key: "studio",
      priceKey: "priceStudio",
      periodKey: "perMonth",
      blurbKey: "studioBlurb",
      features: STUDIO_FEATURES,
      featured: false,
    },
  ];

  return (
    <div className="pricing-page">
      <section className="pricing-hero">
        <p className="pricing-kicker">{t("kicker")}</p>
        <h1>{t("title")}</h1>
        <p className="pricing-lead">{t("subtitle")}</p>
      </section>

      <section className="pricing-values" aria-label={t("valuesLabel")}>
        {VALUE_PILLARS.map((item) => (
          <article key={item.title} className="pricing-value">
            <h2>{t(item.title)}</h2>
            <p>{t(item.body)}</p>
          </article>
        ))}
      </section>

      <section className="pricing-plans" aria-label={t("plansLabel")}>
        <div className="pricing-grid">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.key;
            return (
              <article
                key={plan.key}
                className={`price-card${plan.featured ? " price-card-featured" : ""}`}
                data-plan={plan.key}
              >
                {plan.featured ? (
                  <p className="price-card-ribbon">{t("popular")}</p>
                ) : null}
                <header className="price-card-head">
                  <h2>{t(plan.key)}</h2>
                  <p className="price-card-blurb">{t(plan.blurbKey)}</p>
                  <div className="price-card-amount">
                    <span className="price-amount">{t(plan.priceKey)}</span>
                    {plan.periodKey ? (
                      <span className="price-period">{t(plan.periodKey)}</span>
                    ) : null}
                  </div>
                </header>
                <ul className="price-features">
                  {plan.features.map((feat) => (
                    <li key={feat}>
                      <span className="price-check" aria-hidden="true">
                        ✓
                      </span>
                      {t(feat)}
                    </li>
                  ))}
                </ul>
                <div className="price-card-cta">
                  {plan.key === "free" ? (
                    isCurrent ? (
                      <button type="button" className="btn btn-ghost" disabled>
                        {t("current")}
                      </button>
                    ) : (
                      <Link href="/books/new" className="btn btn-ghost">
                        {t("startFree")}
                      </Link>
                    )
                  ) : isCurrent ? (
                    <button type="button" className="btn btn-ghost" disabled>
                      {t("current")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => void checkout(plan.key)}
                    >
                      {busy === plan.key ? t("redirecting") : t("subscribe")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="pricing-fineprint muted">{t("priceNote")}</p>
      </section>

      <section className="pricing-compare" aria-labelledby="pricing-compare-title">
        <div className="pricing-section-head">
          <h2 id="pricing-compare-title">{t("compareTitle")}</h2>
          <p className="muted">{t("compareLead")}</p>
        </div>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th scope="col">{t("compareFeature")}</th>
                <th scope="col">{t("free")}</th>
                <th scope="col">{t("pro")}</th>
                <th scope="col">{t("studio")}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{t(row.label)}</th>
                  <td>{t(row.free)}</td>
                  <td>{t(row.pro)}</td>
                  <td>{t(row.studio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pricing-why" aria-labelledby="pricing-why-title">
        <div className="pricing-section-head">
          <h2 id="pricing-why-title">{t("whyTitle")}</h2>
          <p className="muted">{t("whyLead")}</p>
        </div>
        <ul className="pricing-why-list">
          <li>
            <strong>{t("why1Title")}</strong>
            <span>{t("why1Body")}</span>
          </li>
          <li>
            <strong>{t("why2Title")}</strong>
            <span>{t("why2Body")}</span>
          </li>
          <li>
            <strong>{t("why3Title")}</strong>
            <span>{t("why3Body")}</span>
          </li>
        </ul>
      </section>

      <section className="pricing-footer-cta">
        <div>
          <h2>{t("finalTitle")}</h2>
          <p className="muted">{t("finalBody")}</p>
        </div>
        <div className="pricing-footer-actions">
          <Link href="/books/new" className="btn btn-primary">
            {t("startFree")}
          </Link>
          {isSignedIn ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy !== null}
              onClick={() => void portal()}
            >
              {busy === "portal" ? t("redirecting") : t("manageBilling")}
            </button>
          ) : (
            <Link href="/sign-in" className="btn btn-ghost">
              {t("signInCta")}
            </Link>
          )}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  );
}
