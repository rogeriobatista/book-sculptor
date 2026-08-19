import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing");
  const common = await getTranslations("common");

  const path = [
    { title: t("path1Title"), body: t("path1Body") },
    { title: t("path2Title"), body: t("path2Body") },
    { title: t("path3Title"), body: t("path3Body") },
  ];

  const formats = [
    t("formatDocx"),
    t("formatPdf"),
    t("formatEpub"),
  ];

  const studio = [
    { title: t("studio1Title"), body: t("studio1Body") },
    { title: t("studio2Title"), body: t("studio2Body") },
    { title: t("studio3Title"), body: t("studio3Body") },
  ];

  return (
    <div className="landing">
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
            <a href="#studio" className="btn btn-ghost">
              {t("ctaSecondary")}
            </a>
          </div>
        </div>
      </section>

      <section className="landing-section landing-audience">
        <div className="landing-inner">
          <h2>{t("audienceTitle")}</h2>
          <p className="landing-lead">{t("audienceBody")}</p>
        </div>
      </section>

      <section className="landing-section landing-path">
        <div className="landing-inner">
          <h2>{t("pathTitle")}</h2>
          <ol className="path-list">
            {path.map((step, index) => (
              <li key={step.title} className="path-item" style={{ animationDelay: `${index * 80}ms` }}>
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
        </div>
      </section>

      <section className="landing-section landing-formats">
        <div className="landing-inner landing-formats-grid">
          <div>
            <h2>{t("formatsTitle")}</h2>
            <p className="landing-lead">{t("formatsBody")}</p>
          </div>
          <ul className="format-list">
            {formats.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      </section>

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
          </div>
        </div>
      </section>

      <section className="landing-section landing-final">
        <div className="landing-inner landing-final-inner">
          <h2>{t("finalTitle")}</h2>
          <p className="landing-lead">{t("finalBody")}</p>
          <Link href="/books/new" className="btn btn-primary">
            {t("finalCta")}
          </Link>
        </div>
      </section>
    </div>
  );
}
