from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete
from sqlmodel import Session, select

from app.access import assert_can_edit, get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import Chapter, ChapterComment, ChapterActivity, ChapterVersion
from app.i18n_labels import CHAPTER_KINDS, format_chapter_label, normalize_locale
from app.schemas import ChapterCreate, ChapterOut, ChapterUpdate, ReorderBody
from app.services.book_builder import content_json_from_text
from app.services.chapter_activity import log_chapter_activity
from app.services.chapter_hierarchy import (
    next_chapter_number,
    next_part_number,
    orphan_children,
    renumber_book_chapters,
    validate_parent_id,
)

router = APIRouter(tags=["chapters"])


def _out(row: Chapter) -> ChapterOut:
    return ChapterOut(
        id=row.id,
        book_id=row.book_id,
        parent_id=row.parent_id,
        position=row.position,
        kind=row.kind,
        number=row.number,
        title=row.title,
        full_label=row.full_label,
        content_text=row.content_text,
        content_json=row.content_json or {},
    )


def _normalize_kind(kind: str | None) -> str:
    value = (kind or "chapter").strip().lower()
    if value not in CHAPTER_KINDS:
        raise HTTPException(400, f"Invalid section kind: {kind}")
    return value


@router.get("/books/{book_id}/chapters", response_model=list[ChapterOut])
def list_chapters(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[ChapterOut]:
    get_owned_book(session, user, book_id)
    rows = session.exec(
        select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.position)
    ).all()
    return [_out(r) for r in rows]


@router.post("/books/{book_id}/chapters", response_model=ChapterOut)
def create_chapter(
    book_id: str,
    body: ChapterCreate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> ChapterOut:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    existing = session.exec(select(Chapter).where(Chapter.book_id == book_id)).all()
    locale = normalize_locale(book.locale)
    text = body.content_text or ""
    kind = _normalize_kind(body.kind)
    parent_id = validate_parent_id(
        session,
        book_id=book_id,
        parent_id=body.parent_id,
        chapter_kind=kind,
    )
    number = body.number
    if kind == "chapter":
        if number is None:
            number = next_chapter_number(session, book_id)
    elif kind == "part":
        if number is None:
            number = next_part_number(session, book_id)
    else:
        number = None
    row = Chapter(
        book_id=book_id,
        parent_id=parent_id,
        position=len(existing),
        kind=kind,
        number=number,
        title=body.title,
        full_label=format_chapter_label(kind, number, body.title, locale),
        content_text=text,
        content_json=body.content_json or content_json_from_text(text),
    )
    session.add(row)
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    session.refresh(row)
    return _out(row)


@router.patch("/books/{book_id}/chapters/{chapter_id}", response_model=ChapterOut)
def update_chapter(
    book_id: str,
    chapter_id: str,
    body: ChapterUpdate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> ChapterOut:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    row = session.get(Chapter, chapter_id)
    if not row or row.book_id != book_id:
        raise HTTPException(404, "Chapter not found.")
    if body.title is not None:
        row.title = body.title
    kind_changed = False
    if body.kind is not None:
        new_kind = _normalize_kind(body.kind)
        if new_kind != row.kind:
            kind_changed = True
        row.kind = new_kind
        if new_kind != "chapter" and new_kind != "part":
            row.number = None
        if new_kind == "part":
            row.parent_id = None
            orphan_children(session, row.id)
    if "parent_id" in body.model_fields_set:
        if row.kind == "part":
            raise HTTPException(400, "Parts cannot be moved inside another part.")
        row.parent_id = validate_parent_id(
            session,
            book_id=book_id,
            parent_id=body.parent_id,
            chapter_kind=row.kind,
        )
    if body.number is not None and row.kind in {"chapter", "part"}:
        row.number = body.number
    if body.full_label is not None:
        row.full_label = body.full_label
    elif body.title is not None or body.kind is not None or body.number is not None:
        row.full_label = format_chapter_label(
            row.kind, row.number, row.title, book.locale
        )
    content_changed = False
    if body.content_text is not None:
        row.content_text = body.content_text
        if body.content_json is None:
            row.content_json = content_json_from_text(body.content_text)
        content_changed = True
    if body.content_json is not None:
        row.content_json = body.content_json
        content_changed = True
    if body.position is not None:
        row.position = body.position
    row.updated_at = datetime.now(timezone.utc)
    book.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.add(book)
    if content_changed:
        session.add(
            ChapterVersion(
                chapter_id=row.id,
                book_id=book_id,
                author_user_id=user.id,
                title=row.title,
                content_text=row.content_text,
                content_json=row.content_json or {},
            )
        )
        log_chapter_activity(
            session,
            book_id=book_id,
            chapter_id=row.id,
            user_id=user.id,
            action="edit",
            summary="Chapter content updated",
        )
    if kind_changed:
        session.flush()
        renumber_book_chapters(session, book_id, book.locale)
        session.refresh(row)
    session.commit()
    session.refresh(row)
    return _out(row)


@router.delete("/books/{book_id}/chapters/all")
def delete_all_chapters(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    """Remove every chapter (and versions) from the book."""
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    rows = session.exec(select(Chapter).where(Chapter.book_id == book_id)).all()
    for row in rows:
        _delete_chapter_row(session, row)
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    return {"ok": True, "deleted": len(rows)}


@router.delete("/books/{book_id}/chapters/{chapter_id}")
def delete_chapter(
    book_id: str,
    chapter_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    row = session.get(Chapter, chapter_id)
    if not row or row.book_id != book_id:
        raise HTTPException(404, "Chapter not found.")
    if row.kind == "part":
        orphan_children(session, row.id)
    _delete_chapter_row(session, row)
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    remaining = session.exec(
        select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.position)
    ).all()
    for index, chapter in enumerate(remaining):
        chapter.position = index
        session.add(chapter)
    if remaining:
        renumber_book_chapters(session, book_id, book.locale)
        session.commit()
    return {"ok": True}


def _delete_chapter_row(session: Session, row: Chapter) -> None:
    """Delete chapter versions then the chapter, avoiding FK / autoflush races."""
    session.execute(
        delete(ChapterVersion).where(ChapterVersion.chapter_id == row.id)
    )
    session.execute(
        delete(ChapterComment).where(ChapterComment.chapter_id == row.id)
    )
    session.execute(
        delete(ChapterActivity).where(ChapterActivity.chapter_id == row.id)
    )
    session.flush()
    session.delete(row)
    session.flush()


@router.post("/books/{book_id}/chapters/reorder", response_model=list[ChapterOut])
def reorder_chapters(
    book_id: str,
    body: ReorderBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[ChapterOut]:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    rows = session.exec(select(Chapter).where(Chapter.book_id == book_id)).all()
    by_id = {r.id: r for r in rows}
    if sorted(body.order) != sorted(by_id.keys()):
        raise HTTPException(400, "Invalid chapter order.")
    for index, chapter_id in enumerate(body.order):
        row = by_id[chapter_id]
        row.position = index
        session.add(row)
    renumber_book_chapters(session, book_id, book.locale)
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    ordered = [by_id[i] for i in body.order]
    return [_out(r) for r in ordered]
