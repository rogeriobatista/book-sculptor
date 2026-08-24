"""Chapter hierarchy helpers (parts → nested chapters)."""

from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.db_models import Chapter
from app.i18n_labels import format_chapter_label, normalize_locale


def validate_parent_id(
    session: Session,
    *,
    book_id: str,
    parent_id: str | None,
    chapter_kind: str,
) -> str | None:
    if chapter_kind == "part" and parent_id:
        raise HTTPException(400, "Parts cannot be nested inside another section.")
    if not parent_id:
        return None
    parent = session.get(Chapter, parent_id)
    if not parent or parent.book_id != book_id:
        raise HTTPException(400, "Parent section not found.")
    if parent.kind != "part":
        raise HTTPException(400, "Only chapters can be placed inside a part.")
    return parent_id


def orphan_children(session: Session, part_id: str) -> None:
    rows = session.exec(select(Chapter).where(Chapter.parent_id == part_id)).all()
    for row in rows:
        row.parent_id = None
        session.add(row)


def renumber_book_chapters(session: Session, book_id: str, locale: str) -> None:
    """Renumber sequential chapter and part numbers in global position order."""
    loc = normalize_locale(locale)
    rows = session.exec(
        select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.position)
    ).all()
    chapter_n = 1
    part_n = 1
    for row in rows:
        if row.kind == "chapter":
            row.number = chapter_n
            row.full_label = format_chapter_label(row.kind, row.number, row.title, loc)
            chapter_n += 1
            session.add(row)
        elif row.kind == "part":
            row.number = part_n
            row.full_label = format_chapter_label(row.kind, row.number, row.title, loc)
            part_n += 1
            session.add(row)
        elif row.number is not None:
            row.number = None
            row.full_label = format_chapter_label(row.kind, None, row.title, loc)
            session.add(row)


def next_part_number(session: Session, book_id: str) -> int:
    rows = session.exec(select(Chapter).where(Chapter.book_id == book_id)).all()
    return max((c.number or 0 for c in rows if c.kind == "part"), default=0) + 1


def next_chapter_number(session: Session, book_id: str) -> int:
    rows = session.exec(select(Chapter).where(Chapter.book_id == book_id)).all()
    return max((c.number or 0 for c in rows if c.kind == "chapter"), default=0) + 1
