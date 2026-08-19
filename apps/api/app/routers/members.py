from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.access import get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import BookMember, User

router = APIRouter(tags=["members"])


class InviteBody(BaseModel):
    email: str
    role: str = "editor"  # editor | viewer


@router.get("/books/{book_id}/members")
def list_members(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    get_owned_book(session, user, book_id)
    rows = session.exec(select(BookMember).where(BookMember.book_id == book_id)).all()
    out = []
    for row in rows:
        member = session.get(User, row.user_id)
        out.append(
            {
                "id": row.id,
                "user_id": row.user_id,
                "email": member.email if member else "",
                "role": row.role,
            }
        )
    return out


@router.post("/books/{book_id}/members")
def invite_member(
    book_id: str,
    body: InviteBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    if book.owner_id != user.id:
        raise HTTPException(403, "Only the owner can invite collaborators.")
    if user.plan != "studio":
        raise HTTPException(402, "Collaboration requires the Studio plan.")

    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email required.")
    invitee = session.exec(select(User).where(User.email == email)).first()
    if not invitee:
        raise HTTPException(
            404,
            "User not found. They must sign up before being invited.",
        )
    role = body.role if body.role in {"editor", "viewer"} else "viewer"
    existing = session.exec(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == invitee.id,
        )
    ).first()
    if existing:
        existing.role = role
        session.add(existing)
        session.commit()
        return {"id": existing.id, "user_id": invitee.id, "email": email, "role": existing.role}

    row = BookMember(book_id=book_id, user_id=invitee.id, role=role)
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"id": row.id, "user_id": invitee.id, "email": email, "role": row.role}


@router.delete("/books/{book_id}/members/{member_id}")
def remove_member(
    book_id: str,
    member_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    if book.owner_id != user.id:
        raise HTTPException(403, "Only the owner can remove collaborators.")
    row = session.get(BookMember, member_id)
    if not row or row.book_id != book_id:
        raise HTTPException(404, "Member not found.")
    if row.role == "owner" or row.user_id == book.owner_id:
        raise HTTPException(400, "Cannot remove the book owner.")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.get("/books/{book_id}/chapters/{chapter_id}/versions")
def list_versions(
    book_id: str,
    chapter_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[dict]:
    from app.db_models import Chapter, ChapterVersion, User

    get_owned_book(session, user, book_id)
    chapter = session.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(404, "Chapter not found.")
    rows = session.exec(
        select(ChapterVersion)
        .where(ChapterVersion.chapter_id == chapter_id)
        .order_by(ChapterVersion.created_at.desc())
        .limit(50)
    ).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "created_at": r.created_at,
            "author": {
                "user_id": r.author_user_id,
                "email": getattr(session.get(User, r.author_user_id), "email", ""),
            },
            "preview": (r.content_text or "")[:180],
        }
        for r in rows
    ]


@router.post("/books/{book_id}/chapters/{chapter_id}/versions/{version_id}/restore")
def restore_version(
    book_id: str,
    chapter_id: str,
    version_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    from app.access import assert_can_edit
    from app.db_models import Chapter, ChapterVersion
    from app.services.chapter_activity import log_chapter_activity

    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    chapter = session.get(Chapter, chapter_id)
    version = session.get(ChapterVersion, version_id)
    if not chapter or not version or chapter.book_id != book_id or version.chapter_id != chapter_id:
        raise HTTPException(404, "Version not found.")
    chapter.content_text = version.content_text
    chapter.content_json = version.content_json or {}
    chapter.title = version.title or chapter.title
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
    log_chapter_activity(
        session,
        book_id=book_id,
        chapter_id=chapter.id,
        user_id=user.id,
        action="restore",
        summary=f"Restored version from {version.created_at.isoformat()}",
        meta={"version_id": version.id},
    )
    session.commit()
    session.refresh(chapter)
    return {"ok": True, "chapter_id": chapter.id}
