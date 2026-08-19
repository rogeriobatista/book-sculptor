"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";
import { Link } from "@/i18n/navigation";
import { type Book, clientApiFetch } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";

export function BooksList() {
  const { isSignedIn, getTokenRef } = useStableAuth();
  const t = useTranslations("books");
  const common = useTranslations("common");
  const dash = useTranslations("dashboard");
  const toast = useToast();
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const data = await clientApiFetch<Book[]>("/api/v1/books", token);
        if (!cancelled) setBooks(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getTokenRef]);

  async function deleteBook(bookId: string) {
    setBusyId(bookId);
    const loadingId = toast.loading(t("notifyDeleting"));
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}`, token, { method: "DELETE" });
      setBooks((prev) => prev.filter((book) => book.id !== bookId));
      toast.update(loadingId, { tone: "success", title: t("notifyDeleted") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("notifyDeleteFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  if (!isSignedIn) {
    return <p className="muted">{dash("empty")}</p>;
  }

  if (loading) return <p className="muted">{dash("loading")}</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!books.length) {
    return (
      <div className="panel empty-state">
        <p className="muted">{dash("empty")}</p>
        <Link href="/books/new" className="btn btn-primary">
          {dash("newBook")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="list-stack">
        {books.map((book) => (
            <li key={book.id} className="book-row-card">
              <Link
                href={{ pathname: "/books/[bookId]", params: { bookId: book.id } }}
                className="book-row"
              >
                <strong>{book.title}</strong>
                <p className="muted">
                  {book.author || "—"} · {book.locale} · {book.chapter_count}{" "}
                  {t("chapters")}
                </p>
              </Link>
              <div className="book-row-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-compact danger"
                  disabled={Boolean(busyId)}
                  onClick={() => setPendingDelete(book)}
                >
                  {t("deleteBook")}
                </button>
              </div>
            </li>
        ))}
      </ul>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title={t("deleteBookTitle")}
        description={t("deleteBookConfirm", {
          title: pendingDelete?.title || t("title"),
        })}
        confirmLabel={t("deleteBook")}
        cancelLabel={common("cancel")}
        busy={Boolean(busyId)}
        danger
        onClose={() => {
          if (!busyId) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          setPendingDelete(null);
          void deleteBook(id);
        }}
      />
    </>
  );
}
