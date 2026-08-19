import { getTranslations, setRequestLocale } from "next-intl/server";
import { PricingActions } from "@/components/PricingActions";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");

  return (
    <div className="page stack">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("subtitle")}</p>
        </div>
      </header>
      <PricingActions />
    </div>
  );
}
