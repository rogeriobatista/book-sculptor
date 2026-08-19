"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";

export function PricingActions() {
  const { getToken, isSignedIn } = useAppAuth();
  const locale = useLocale();
  const t = useTranslations("pricing");
  const [error, setError] = useState<string | null>(null);

  async function checkout(plan: "pro" | "studio") {
    setError(null);
    if (!isSignedIn) {
      setError("Sign in to subscribe.");
      return;
    }
    try {
      const token = await getToken();
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
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  async function portal() {
    setError(null);
    try {
      const token = await getToken();
      const data = await clientApiFetch<{ url: string }>(
        "/api/v1/billing/portal",
        token,
        { method: "POST" },
      );
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  const plans = [
    { key: "free" as const, blurbKey: "freeBlurb" as const, featured: false },
    { key: "pro" as const, blurbKey: "proBlurb" as const, featured: false },
    { key: "studio" as const, blurbKey: "studioBlurb" as const, featured: true },
  ];

  return (
    <>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article
            key={plan.key}
            className={`panel price-card stack${plan.featured ? " price-card-featured" : ""}`}
          >
            <h2>{t(plan.key)}</h2>
            <p className="muted">{t(plan.blurbKey)}</p>
            {plan.key === "free" ? (
              <button type="button" className="btn btn-ghost" disabled>
                {t("current")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => checkout(plan.key)}
              >
                {t("subscribe")}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="muted" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="btn btn-ghost" onClick={portal}>
          {t("manageBilling")}
        </button>
      </p>
      {error ? <p className="muted">{error}</p> : null}
    </>
  );
}
