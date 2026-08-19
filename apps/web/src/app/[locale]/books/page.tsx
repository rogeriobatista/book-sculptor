import { getTranslations, setRequestLocale } from "next-intl/server";
import { BooksList } from "@/components/BooksList";
import { Link } from "@/i18n/navigation";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function BooksPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("books");
  const dash = await getTranslations("dashboard");

  return (
    <div className="page stack">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{dash("lead")}</p>
        </div>
        <Link href="/books/new" className="btn btn-primary">
          {t("create")}
        </Link>
      </header>
      <BooksList />
    </div>
  );
}
