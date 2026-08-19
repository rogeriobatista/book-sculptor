import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewBookForm } from "@/components/NewBookForm";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function NewBookPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("books");

  return (
    <div className="page stack">
      <header className="page-head">
        <div>
          <h1>{t("create")}</h1>
          <p className="muted">{t("createMetaLead")}</p>
        </div>
      </header>
      <NewBookForm />
    </div>
  );
}
