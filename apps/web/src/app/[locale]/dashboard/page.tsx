import { getTranslations, setRequestLocale } from "next-intl/server";
import { BooksList } from "@/components/BooksList";
import { Link } from "@/i18n/navigation";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");

  return (
    <div className="page stack">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("lead")}</p>
        </div>
        <Link href="/books/new" className="btn btn-primary">
          {t("newBook")}
        </Link>
      </header>
      <BooksList />
    </div>
  );
}
