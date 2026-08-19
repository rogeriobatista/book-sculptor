import { setRequestLocale } from "next-intl/server";
import { BookWorkspace } from "@/components/BookWorkspace";

type Props = {
  params: Promise<{ locale: string; bookId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function BookDetailPage({ params, searchParams }: Props) {
  const { locale, bookId } = await params;
  const { tab = "write" } = await searchParams;
  setRequestLocale(locale);
  const active = [
    "write",
    "format",
    "preview",
    "team",
    "settings",
  ].includes(tab || "")
    ? (tab as string)
    : "write";

  return (
    <div className="page page-studio">
      <BookWorkspace bookId={bookId} locale={locale} tab={active} />
    </div>
  );
}
