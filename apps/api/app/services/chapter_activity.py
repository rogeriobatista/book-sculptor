"""Chapter collaboration audit helpers."""

from __future__ import annotations

from sqlmodel import Session

from app.db_models import ChapterActivity


def log_chapter_activity(
    session: Session,
    *,
    book_id: str,
    chapter_id: str,
    user_id: str,
    action: str,
    summary: str,
    meta: dict | None = None,
) -> None:
    session.add(
        ChapterActivity(
            book_id=book_id,
            chapter_id=chapter_id,
            user_id=user_id,
            action=action,
            summary=summary[:500],
            meta_json=meta or {},
        )
    )
