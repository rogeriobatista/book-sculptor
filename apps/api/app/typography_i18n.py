from __future__ import annotations

from app.i18n_labels import normalize_locale, t
from app.models import Book, Chapter


def book_locale(book: Book | None = None, locale: str | None = None) -> str:
    if locale:
        return normalize_locale(locale)
    if book is not None:
        return normalize_locale(getattr(book, "locale", None))
    return "pt-BR"


def kind_label(
    chapter: Chapter,
    *,
    literary: bool = True,
    locale: str | None = None,
) -> str:
    loc = normalize_locale(locale)
    if chapter.kind in {"dedication", "prologue", "epilogue", "afterword", "appendix"}:
        return t(chapter.kind, loc)
    if chapter.number is not None and chapter.kind == "chapter":
        base = f"{t('chapter', loc)} {chapter.number}"
        return base if literary else base.upper()
    return ""


def toc_title(book: Book | None = None, locale: str | None = None) -> str:
    return t("toc", book_locale(book, locale))
