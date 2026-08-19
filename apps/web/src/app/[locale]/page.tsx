import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing");
  const p = await getTranslations("pricing");
  const common = await getTranslations("common");

  const path = [
    { title: t("path1Title"), body: t("path1Body") },
    { title: t("path2Title"), body: t("path2Body") },
    { title: t("path3Title"), body: t("path3Body") },
  ];

  const features = [
    { title: t("feature1Title"), body: t("feature1Body") },
    { title: t("feature2Title"), body: t("feature2Body") },
    { title: t("feature3Title"), body: t("feature3Body") },
    { title: t("feature4Title"), body: t("feature4Body") },
    { title: t("feature5Title"), body: t("feature5Body") },
    { title: t("feature6Title"), body: t("feature6Body") },
  ];

  const examples = [
    {
      tag: t("example1Tag"),
      title: t("example1Title"),
      steps: [t("example1Step1"), t("example1Step2"), t("example1Step3")],
      cta: t("example1Cta"),
      href: "/books/new" as const,
    },
    {
      tag: t("example2Tag"),
      title: t("example2Title"),
      steps: [t("example2Step1"), t("example2Step2"), t("example2Step3")],
      cta: t("example2Cta"),
      href: "/books/new" as const,
    },
    {
      tag: t("example3Tag"),
      title: t("example3Title"),
      steps: [t("example3Step1"), t("example3Step2"), t("example3Step3")],
      cta: t("example3Cta"),
      href: "/pricing" as const,
    },
    {
      tag: t("example4Tag"),
      title: t("example4Title"),
      steps: [t("example4Step1"), t("example4Step2"), t("example4Step3")],
      cta: t("example4Cta"),
      href: "/books/new" as const,
    },
  ];

  const plans = [
    {
      key: "free" as const,
      name: p("free"),
      price: p("priceFree"),
      period: "",
      blurb: p("freeBlurb"),
      highlight: false,
    },
    {
      key: "pro" as const,
      name: p("pro"),
      price: p("pricePro"),
      period: p("perMonth"),
      blurb: p("proBlurb"),
      highlight: true,
    },
    {
      key: "studio" as const,
      name: p("studio"),
      price: p("priceStudio"),
      period: p("perMonth"),
      blurb: p("studioBlurb"),
      highlight: false,
    },
  ];

  const formats = [t("formatDocx"), t("formatPdf"), t("formatEpub")];

  const studio = [
    { title: t("studio1Title"), body: t("studio1Body") },
    { title: t("studio2Title"), body: t("studio2Body") },
    { title: t("studio3Title"), body: t("studio3Body") },
  ];

  const reasons = [
    { title: t("reason1Title"), body: t("reason1Body") },
    { title: t("reason2Title"), body: t("reason2Body") },
    { title: t("reason3Title"), body: t("reason3Body") },
    { title: t("reason4Title"), body: t("reason4Body") },
  ];

  return (
    <div className="landing">
      {/* —— Hero —— */}
      <section className="hero">
        <div className="hero-atmosphere" aria-hidden="true">
          <div className="hero-manuscript" />
        </div>
        <div className="hero-content">
          <p className="hero-kicker">{common("appName")}</p>
          <h1 className="hero-headline">{t("headline")}</h1>
          <p className="hero-subhead">{t("subhead")}</p>
          <div className="cta-group">
            <Link href="/books/new" className="btn btn-primary">
              {t("cta")}
            </Link>
            <a href="#examples" className="btn btn-ghost">
              {t("ctaSecondary")}
            </a>
          </div>
          <p className="hero-note muted">{t("heroNote")}</p>
        </div>
      </section>

      {/* —— Audience + quick CTA —— */}
      <section className="landing-section landing-audience">
        <div className="landing-inner landing-split">
          <div>
            <h2>{t("audienceTitle")}</h2>
            <p className="landing-lead">{t("audienceBody")}</p>
          </div>
          <div className="landing-inline-cta">
            <Link href="/books/new" className="btn btn-primary">
              {t("audienceCta")}
            </Link>
          </div>
        </div>
      </section>

      {/* —— Feature grid —— */}
      <section className="landing-section landing-features">
        <div className="landing-inner">
          <header className="landing-section-head">
            <h2>{t("featuresTitle")}</h2>
            <p className="landing-lead">{t("featuresLead")}</p>
          </header>
          <div className="landing-features-grid">
            {features.map((item) => (
              <article key={item.title} className="landing-feature-card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* —— Mid CTA band —— */}
      <section className="landing-cta-band" aria-label={t("midCtaTitle")}>
        <div className="landing-inner landing-cta-band-inner">
          <div>
            <h2>{t("midCtaTitle")}</h2>
            <p>{t("midCtaBody")}</p>
          </div>
          <Link href="/books/new" className="btn btn-primary">
            {t("midCtaButton")}
          </Link>
        </div>
      </section>

      {/* —— How it works —— */}
      <section className="landing-section landing-path">
        <div className="landing-inner">
          <h2>{t("pathTitle")}</h2>
          <p className="landing-lead">{t("pathLead")}</p>
          <ol className="path-list">
            {path.map((step, index) => (
              <li
                key={step.title}
                className="path-item"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <span className="path-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="landing-section-cta">
            <Link href="/books/new" className="btn btn-primary">
              {t("pathCta")}
            </Link>
          </div>
        </div>
      </section>

      {/* —— Use-case examples —— */}
      <section id="examples" className="landing-section landing-examples">
        <div className="landing-inner">
          <header className="landing-section-head">
            <h2>{t("examplesTitle")}</h2>
            <p className="landing-lead">{t("examplesLead")}</p>
          </header>
          <div className="landing-examples-grid">
            {examples.map((item) => (
              <article key={item.title} className="landing-example-card">
                <p className="landing-example-tag">{item.tag}</p>
                <h3>{item.title}</h3>
                <ol className="landing-example-steps">
                  {item.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <Link href={item.href} className="btn btn-ghost landing-example-cta">
                  {item.cta}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* —— Pricing teaser —— */}
      <section id="pricing" className="landing-section landing-pricing-teaser">
        <div className="landing-inner">
          <header className="landing-section-head landing-section-head-center">
            <h2>{t("pricingTeaserTitle")}</h2>
            <p className="landing-lead">{t("pricingTeaserLead")}</p>
          </header>
          <div className="landing-pricing-grid">
            {plans.map((plan) => (
              <article
                key={plan.key}
                className={`landing-plan-card${plan.highlight ? " landing-plan-featured" : ""}`}
              >
                {plan.highlight ? (
                  <p className="landing-plan-ribbon">{p("popular")}</p>
                ) : null}
                <h3>{plan.name}</h3>
                <div className="landing-plan-price">
                  <span>{plan.price}</span>
                  {plan.period ? <small>{plan.period}</small> : null}
                </div>
                <p className="landing-plan-blurb">{plan.blurb}</p>
              </article>
            ))}
          </div>
          <div className="landing-pricing-footer">
            <Link href="/pricing" className="btn btn-primary">
              {t("pricingTeaserCta")}
            </Link>
            <p className="muted">{t("pricingTeaserNote")}</p>
          </div>
        </div>
      </section>

      {/* —— Formats —— */}
      <section className="landing-section landing-formats">
        <div className="landing-inner landing-formats-grid">
          <div>
            <h2>{t("formatsTitle")}</h2>
            <p className="landing-lead">{t("formatsBody")}</p>
            <Link href="/books/new" className="btn btn-primary landing-formats-cta">
              {t("formatsCta")}
            </Link>
          </div>
          <ul className="format-list">
            {formats.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* —— Studio —— */}
      <section id="studio" className="landing-section landing-studio">
        <div className="landing-inner">
          <p className="studio-kicker">Studio</p>
          <h2>{t("studioTitle")}</h2>
          <p className="landing-lead">{t("studioBody")}</p>
          <div className="studio-features">
            {studio.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <div className="cta-group studio-cta">
            <Link href="/pricing" className="btn btn-primary">
              {t("studioCta")}
            </Link>
            <Link href="/books/new" className="btn btn-ghost landing-studio-ghost">
              {t("studioCtaSecondary")}
            </Link>
          </div>
        </div>
      </section>

      {/* —— Why subscribe —— */}
      <section className="landing-section landing-reasons">
        <div className="landing-inner">
          <header className="landing-section-head">
            <h2>{t("subscribeTitle")}</h2>
            <p className="landing-lead">{t("subscribeLead")}</p>
          </header>
          <ul className="landing-reasons-grid">
            {reasons.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </li>
            ))}
          </ul>
          <div className="landing-section-cta">
            <Link href="/pricing" className="btn btn-primary">
              {t("subscribeCta")}
            </Link>
            <Link href="/sign-in" className="btn btn-ghost">
              {t("subscribeSignIn")}
            </Link>
          </div>
        </div>
      </section>

      {/* —— Final CTA —— */}
      <section className="landing-section landing-final">
        <div className="landing-inner landing-final-inner">
          <h2>{t("finalTitle")}</h2>
          <p className="landing-lead">{t("finalBody")}</p>
          <div className="cta-group">
            <Link href="/books/new" className="btn btn-primary">
              {t("finalCta")}
            </Link>
            <Link href="/pricing" className="btn btn-ghost">
              {t("finalCtaSecondary")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
