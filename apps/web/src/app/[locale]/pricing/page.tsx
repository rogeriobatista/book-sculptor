import { setRequestLocale } from "next-intl/server";
import { PricingActions } from "@/components/PricingActions";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="page page-pricing">
      <PricingActions />
    </div>
  );
}
