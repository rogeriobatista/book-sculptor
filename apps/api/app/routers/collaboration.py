from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.access import assert_can_edit, get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import Chapter, ChapterComment, ChapterVersion, User
from app.services.book_builder import content_json_from_text
from app.services.chapter_activity import log_chapter_activity

router = APIRouter(tags=["collaboration"])


class CommentCreate(BaseModel):
    kind: str = "comment"  # comment | suggestion
    quote: str = ""
    body: str = Field(min_length=1)
    proposed_text: str | None = None


class CommentUpdate(BaseModel):
    status: str | None = None  # open | resolved | accepted | rejected


def _author(session: Session, user_id: str) -> dict:
    user = session.get(User, user_id)
    return {
        "user_id": user_id,
        "email": user.email if user else "",
    }


def _comment_out(session: Session, row: ChapterComment) -> dict:
    return {
        "id": row.id,
        "book_id": row.book_id,
        "chapter_id": row.chapter_id,
        "kind": row.kind,
        "status": row.status,
        "quote": row.quote,
        "body": row.body,
        "proposed_text": row.proposed_text,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "author": _author(session, row.author_user_id),
    }


@router.get("/books/{book_id}/chapters/{chapter_id}/comments")
def list_comments(
    book_id: str,
    chapter_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    get_owned_book(session, user, book_id)
    chapter = session.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(404, "Chapter not found.")
    rows = session.exec(
        select(ChapterComment)
        .where(ChapterComment.chapter_id == chapter_id)
        .order_by(ChapterComment.created_at.desc())
    ).all()
    return [_comment_out(session, row) for row in rows]


@router.post("/books/{book_id}/chapters/{chapter_id}/comments")
def create_comment(
    book_id: str,
    chapter_id: str,
    body: CommentCreate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    chapter = session.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(404, "Chapter not found.")

    kind = body.kind if body.kind in {"comment", "suggestion"} else "comment"
    if kind == "suggestion":
        assert_can_edit(session, user, book)
        if not body.proposed_text or not body.proposed_text.strip():
            raise HTTPException(400, "Suggestions require proposed_text.")

    row = ChapterComment(
        book_id=book_id,
        chapter_id=chapter_id,
        author_user_id=user.id,
        kind=kind,
        status="open",
        quote=(body.quote or "").strip()[:2000],
        body=body.body.strip()[:8000],
        proposed_text=(body.proposed_text or "").strip()[:8000] or None,
    )
    session.add(row)
    log_chapter_activity(
        session,
        book_id=book_id,
        chapter_id=chapter_id,
        user_id=user.id,
        action="suggestion" if kind == "suggestion" else "comment",
        summary=body.body.strip()[:180],
        meta={"comment_id": row.id, "quote": row.quote[:120]},
    )
    session.commit()
    session.refresh(row)
    return _comment_out(session, row)


@router.patch("/books/{book_id}/chapters/{chapter_id}/comments/{comment_id}")
def update_comment(
    book_id: str,
    chapter_id: str,
    comment_id: str,
    body: CommentUpdate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    row = session.get(ChapterComment, comment_id)
    chapter = session.get(Chapter, chapter_id)
    if not row or not chapter or row.chapter_id != chapter_id or chapter.book_id != book_id:
        raise HTTPException(404, "Comment not found.")

    status = body.status
    if status not in {None, "open", "resolved", "accepted", "rejected"}:
        raise HTTPException(400, "Invalid status.")

    if status == "accepted" and row.kind == "suggestion":
        assert_can_edit(session, user, book)
        quote = (row.quote or "").strip()
        proposed = (row.proposed_text or "").strip()
        if not quote or not proposed:
            raise HTTPException(400, "Suggestion missing quote or proposed text.")
        text = chapter.content_text or ""
        if quote not in text:
            raise HTTPException(409, "Quoted text no longer exists in the chapter.")
        chapter.content_text = text.replace(quote, proposed, 1)
        chapter.content_json = content_json_from_text(chapter.content_text)
        chapter.updated_at = datetime.now(timezone.utc)
        session.add(chapter)
        session.add(
            ChapterVersion(
                chapter_id=chapter.id,
                book_id=book_id,
                author_user_id=user.id,
                title=chapter.title,
                content_text=chapter.content_text,
                content_json=chapter.content_json or {},
            )
        )
        row.status = "accepted"
        log_chapter_activity(
            session,
            book_id=book_id,
            chapter_id=chapter_id,
            user_id=user.id,
            action="accept_suggestion",
            summary=f"Applied suggestion: {row.body[:120]}",
            meta={"comment_id": row.id},
        )
    elif status:
        row.status = status
        if status == "resolved":
            log_chapter_activity(
                session,
                book_id=book_id,
                chapter_id=chapter_id,
                user_id=user.id,
                action="resolve_comment",
                summary=row.body[:180],
                meta={"comment_id": row.id},
            )
        elif status == "rejected":
            log_chapter_activity(
                session,
                book_id=book_id,
                chapter_id=chapter_id,
                user_id=user.id,
                action="reject_suggestion",
                summary=row.body[:180],
                meta={"comment_id": row.id},
            )

    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _comment_out(session, row)


@router.get("/books/{book_id}/chapters/{chapter_id}/activity")
def list_activity(
    book_id: str,
    chapter_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    from app.db_models import ChapterActivity

    get_owned_book(session, user, book_id)
    chapter = session.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(404, "Chapter not found.")
    rows = session.exec(
        select(ChapterActivity)
        .where(ChapterActivity.chapter_id == chapter_id)
        .order_by(ChapterActivity.created_at.desc())
        .limit(80)
    ).all()
    out = []
    for row in rows:
        out.append(
            {
                "id": row.id,
                "action": row.action,
                "summary": row.summary,
                "meta": row.meta_json or {},
                "created_at": row.created_at,
                "author": _author(session, row.user_id),
            }
        )
    return out


@router.get("/books/{book_id}/chapters/{chapter_id}/versions/{version_id}")
def get_version(
    book_id: str,
    chapter_id: str,
    version_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    get_owned_book(session, user, book_id)
    version = session.get(ChapterVersion, version_id)
    chapter = session.get(Chapter, chapter_id)
    if not version or not chapter or version.chapter_id != chapter_id or chapter.book_id != book_id:
        raise HTTPException(404, "Version not found.")
    return {
        "id": version.id,
        "title": version.title,
        "content_text": version.content_text,
        "content_json": version.content_json or {},
        "created_at": version.created_at,
        "author": _author(session, version.author_user_id),
    }
