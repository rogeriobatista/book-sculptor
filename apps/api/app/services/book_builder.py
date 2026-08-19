from __future__ import annotations

from sqlmodel import Session, select

from app.db_models import Book as BookRow
from app.db_models import Chapter as ChapterRow
from app.i18n_labels import format_chapter_label, normalize_locale, t
from app.layout import LayoutSettings
from app.models import Book, Chapter, Paragraph


def settings_from_book(book: BookRow) -> LayoutSettings:
    raw = book.settings_json or {}
    try:
        return LayoutSettings.from_dict(raw)
    except Exception:  # noqa: BLE001
        return LayoutSettings()


def domain_book_from_rows(book: BookRow, chapters: list[ChapterRow]) -> Book:
    locale = normalize_locale(book.locale)
    domain_chapters: list[Chapter] = []
    for row in sorted(chapters, key=lambda c: c.position):
        paragraphs = _paragraphs_from_text(row.content_text)
        label = row.full_label or format_chapter_label(
            row.kind, row.number, row.title, locale
        )
        domain_chapters.append(
            Chapter(
                title=row.title or "",
                paragraphs=paragraphs,
                number=row.number,
                kind=(
                    row.kind
                    if row.kind
                    in {
                        "dedication",
                        "prologue",
                        "chapter",
                        "epilogue",
                        "afterword",
                        "appendix",
                        "other",
                    }
                    else "other"
                ),
                full_label=label,
            )
        )

    title = book.title or t("manuscript", locale)
    return Book(
        title=title,
        author=book.author or "",
        chapters=domain_chapters,
        source_path="",
        kind="chapter" if book.mode == "chapter" else "book",
        locale=locale,
    )


def load_domain_book(session: Session, book: BookRow) -> Book:
    chapters = list(
        session.exec(
            select(ChapterRow)
            .where(ChapterRow.book_id == book.id)
            .order_by(ChapterRow.position)
        ).all()
    )
    return domain_book_from_rows(book, chapters)


def _paragraphs_from_text(text: str) -> list[Paragraph]:
    chunks = [p.strip() for p in (text or "").replace("\r\n", "\n").split("\n\n")]
    paragraphs: list[Paragraph] = []
    for chunk in chunks:
        if not chunk:
            continue
        style = "dialogue" if chunk.lstrip().startswith(("—", "–", "-", "«")) else "body"
        paragraphs.append(Paragraph(text=chunk, style=style))  # type: ignore[arg-type]
    if not paragraphs and text.strip():
        paragraphs.append(Paragraph(text=text.strip(), style="body"))
    return paragraphs


def text_from_domain_chapter(chapter: Chapter) -> str:
    return "\n\n".join(p.text for p in chapter.paragraphs if p.text.strip())


def content_json_from_text(text: str) -> dict:
    """Minimal TipTap-compatible document."""
    paragraphs = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [""]
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": p}] if p else [],
            }
            for p in paragraphs
        ],
    }
