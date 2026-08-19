from __future__ import annotations

import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session, select
from sqlalchemy import delete

from app.db_models import Book as BookRow
from app.db_models import Chapter as ChapterRow
from app.db_models import ChapterVersion
from app.db_models import User
from app.extractors import extract_blocks
from app.i18n_labels import format_chapter_label, normalize_locale, t
from app.services.book_builder import content_json_from_text, text_from_domain_chapter
from app.services.structure_ai import classify_structure_headings
from app.structure import build_chapter_from_file, detect_structure


def _domain_from_file(
    book: BookRow,
    path: Path,
    filename: str,
    *,
    session: Session | None = None,
    user: User | None = None,
    use_ai_structure: bool = False,
):
    """Parse one PDF/DOCX into a domain Book (possibly many chapters)."""
    if book.mode == "chapter":
        return build_chapter_from_file(path)

    blocks = extract_blocks(path)
    logical = Path(filename)

    refine = None
    if use_ai_structure and session is not None and user is not None and user.plan != "free":

        def refine(candidates, toc=None):  # noqa: ANN001
            return classify_structure_headings(
                session,
                user=user,
                book=book,
                candidates=candidates,
                locale=book.locale,
                toc=toc,
            )

    domain = detect_structure(
        blocks,
        logical,
        refine_headings=refine,
        source_file=path,
    )
    stem = logical.stem.replace("_", " ").replace("-", " ").strip()
    stem = re.sub(r"^\d+\s*", "", stem).strip() or stem
    if not domain.title or domain.title.lower() in {
        "conteúdo",
        "content",
        "contenido",
    }:
        domain.title = stem or t("manuscript", normalize_locale(book.locale))
    if domain.title.endswith((".", "!", "?")) and stem:
        domain.title = stem
    return domain


def _clear_chapters(session: Session, book_id: str) -> None:
    existing = session.exec(select(ChapterRow).where(ChapterRow.book_id == book_id)).all()
    for row in existing:
        session.execute(
            delete(ChapterVersion).where(ChapterVersion.chapter_id == row.id)
        )
    session.flush()
    for row in existing:
        session.delete(row)
    session.commit()


def _next_position(session: Session, book_id: str) -> int:
    current = session.exec(select(ChapterRow).where(ChapterRow.book_id == book_id)).all()
    return len(current)


def _persist_domain_chapters(
    session: Session,
    book: BookRow,
    domain,
    *,
    start_position: int,
) -> list[ChapterRow]:
    locale = normalize_locale(book.locale)
    created: list[ChapterRow] = []
    for index, chapter in enumerate(domain.chapters):
        text = text_from_domain_chapter(chapter)
        label = format_chapter_label(
            chapter.kind, chapter.number, chapter.title, locale
        )
        row = ChapterRow(
            book_id=book.id,
            position=start_position + index,
            kind=chapter.kind,
            number=chapter.number,
            title=chapter.title,
            full_label=label,
            content_text=text,
            content_json=content_json_from_text(text),
        )
        session.add(row)
        created.append(row)
    return created


def import_manuscript_bytes(
    session: Session,
    book: BookRow,
    filename: str,
    content: bytes,
    *,
    replace: bool = True,
    user: User | None = None,
    use_ai_structure: bool = False,
) -> list[ChapterRow]:
    return import_files_into_book(
        session,
        book,
        [(filename, content)],
        replace=replace,
        user=user,
        use_ai_structure=use_ai_structure,
    )


def import_multi_files_as_chapters(
    session: Session,
    book: BookRow,
    files: list[tuple[str, bytes]],
    *,
    replace: bool = True,
    user: User | None = None,
    use_ai_structure: bool = False,
) -> list[ChapterRow]:
    """Import one or more PDF/DOCX files; detect chapter structure inside each."""
    return import_files_into_book(
        session,
        book,
        files,
        replace=replace,
        user=user,
        use_ai_structure=use_ai_structure,
    )


def import_files_into_book(
    session: Session,
    book: BookRow,
    files: list[tuple[str, bytes]],
    *,
    replace: bool = True,
    user: User | None = None,
    use_ai_structure: bool = False,
) -> list[ChapterRow]:
    if not files:
        raise ValueError("No files to import.")

    locale = normalize_locale(book.locale)
    for filename, _ in files:
        suffix = Path(filename).suffix.lower()
        if suffix not in {".pdf", ".docx"}:
            raise ValueError("Only PDF (.pdf) or Word (.docx) files are supported.")

    if replace:
        _clear_chapters(session, book.id)

    created: list[ChapterRow] = []
    next_pos = 0 if replace else _next_position(session, book.id)

    with tempfile.TemporaryDirectory(prefix="bs-import-") as tmp:
        for index, (filename, content) in enumerate(files, start=1):
            suffix = Path(filename).suffix.lower() or ".docx"
            # Avoid OS path issues with accents / long names from uploads.
            path = Path(tmp) / f"upload_{index}{suffix}"
            path.write_bytes(content)
            domain = _domain_from_file(
                book,
                path,
                filename,
                session=session,
                user=user,
                use_ai_structure=use_ai_structure,
            )
            domain.locale = locale

            if not domain.chapters:
                raise ValueError(
                    f"No chapters detected in “{Path(filename).name}”. "
                    "Check that the file has readable text."
                )

            if index == 1:
                if not book.title or book.title in {
                    "Untitled",
                    "Sem título",
                    "Sin título",
                }:
                    book.title = domain.title or t("manuscript", locale)
                if domain.author and not book.author:
                    book.author = domain.author

            batch = _persist_domain_chapters(
                session, book, domain, start_position=next_pos
            )
            created.extend(batch)
            next_pos += len(batch)
            session.flush()

        book.updated_at = datetime.now(timezone.utc)
        session.add(book)
        session.commit()
        for row in created:
            session.refresh(row)
    return created
