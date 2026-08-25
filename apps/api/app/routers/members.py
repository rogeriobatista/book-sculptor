from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.access import get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import BookMember, User

router = APIRouter(tags=["members"])

# Studio plan seat budget (owner does not count toward the limit).
STUDIO_COLLABORATOR_LIMIT = 10

ROLE_ORDER = {"owner": 0, "editor": 1, "viewer": 2}


class InviteBody(BaseModel):
    email: str
    role: str = "editor"  # editor | viewer


class UpdateRoleBody(BaseModel):
    role: str = Field(description="editor | viewer")


def _display_name(email: str) -> str:
    local = (email or "").split("@", 1)[0].strip()
    if not local:
        return "Member"
    parts = [p for p in local.replace(".", " ").replace("_", " ").split() if p]
    if not parts:
        return local
    return " ".join(part.capitalize() for part in parts)


def _member_payload(row: BookMember, member: User | None, *, current_user_id: str) -> dict:
    email = member.email if member else ""
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {
        "id": row.id,
        "user_id": row.user_id,
        "email": email,
        "display_name": _display_name(email),
        "role": row.role,
        "created_at": created.isoformat(),
        "is_you": row.user_id == current_user_id,
    }


def _sort_members(items: list[dict]) -> list[dict]:
    return sorted(
        items,
        key=lambda item: (
            ROLE_ORDER.get(item.get("role", ""), 9),
            (item.get("email") or "").lower(),
        ),
    )


def _build_summary(members: list[dict]) -> dict:
    editors = sum(1 for m in members if m["role"] == "editor")
    viewers = sum(1 for m in members if m["role"] == "viewer")
    seats_used = editors + viewers
    return {
        "total": len(members),
        "editors": editors,
        "viewers": viewers,
        "seats_used": seats_used,
        "seats_limit": STUDIO_COLLABORATOR_LIMIT,
    }


def _assert_owner(book, user: User) -> None:
    if book.owner_id != user.id:
        raise HTTPException(403, "Only the owner can manage collaborators.")


def _collaborator_count(session: Session, book_id: str) -> int:
    rows = session.exec(select(BookMember).where(BookMember.book_id == book_id)).all()
    return sum(1 for row in rows if row.role in {"editor", "viewer"})


@router.get("/books/{book_id}/members")
def list_members(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    rows = session.exec(select(BookMember).where(BookMember.book_id == book_id)).all()
    members: list[dict] = []
    my_role = "viewer"
    for row in rows:
        member = session.get(User, row.user_id)
        payload = _member_payload(row, member, current_user_id=user.id)
        members.append(payload)
        if row.user_id == user.id:
            my_role = row.role

    if book.owner_id == user.id:
        my_role = "owner"

    members = _sort_members(members)
    is_owner = book.owner_id == user.id
    return {
        "members": members,
        "summary": _build_summary(members),
        "my_role": my_role,
        "is_owner": is_owner,
        "can_manage": is_owner and user.plan == "studio",
    }


@router.post("/books/{book_id}/members")
def invite_member(
    book_id: str,
    body: InviteBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    _assert_owner(book, user)
    if user.plan != "studio":
        raise HTTPException(402, "Collaboration requires the Studio plan.")

    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email required.")
    if email == (user.email or "").strip().lower():
        raise HTTPException(400, "You are already on this book.")

    invitee = session.exec(select(User).where(User.email == email)).first()
    if not invitee:
        raise HTTPException(
            404,
            "User not found. They must sign up before being invited.",
        )
    if invitee.id == book.owner_id:
        raise HTTPException(400, "The book owner is already on the team.")

    role = body.role if body.role in {"editor", "viewer"} else "viewer"
    existing = session.exec(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == invitee.id,
        )
    ).first()
    if existing:
        if existing.role == "owner":
            raise HTTPException(400, "Cannot change the owner role.")
        existing.role = role
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return _member_payload(existing, invitee, current_user_id=user.id)

    if _collaborator_count(session, book_id) >= STUDIO_COLLABORATOR_LIMIT:
        raise HTTPException(
            400,
            f"Collaborator limit reached ({STUDIO_COLLABORATOR_LIMIT}). Remove someone to invite another.",
        )

    row = BookMember(book_id=book_id, user_id=invitee.id, role=role)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _member_payload(row, invitee, current_user_id=user.id)


@router.patch("/books/{book_id}/members/{member_id}")
def update_member_role(
    book_id: str,
    member_id: str,
    body: UpdateRoleBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    _assert_owner(book, user)
    if user.plan != "studio":
        raise HTTPException(402, "Collaboration requires the Studio plan.")

    role = body.role if body.role in {"editor", "viewer"} else None
    if not role:
        raise HTTPException(400, "Role must be editor or viewer.")

    row = session.get(BookMember, member_id)
    if not row or row.book_id != book_id:
        raise HTTPException(404, "Member not found.")
    if row.role == "owner" or row.user_id == book.owner_id:
        raise HTTPException(400, "Cannot change the owner role.")

    row.role = role
    session.add(row)
    session.commit()
    session.refresh(row)
    member = session.get(User, row.user_id)
    return _member_payload(row, member, current_user_id=user.id)


@router.delete("/books/{book_id}/members/{member_id}")
def remove_member(
    book_id: str,
    member_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    _assert_owner(book, user)
    row = session.get(BookMember, member_id)
    if not row or row.book_id != book_id:
        raise HTTPException(404, "Member not found.")
    if row.role == "owner" or row.user_id == book.owner_id:
        raise HTTPException(400, "Cannot remove the book owner.")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.post("/books/{book_id}/members/leave")
def leave_book(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    if book.owner_id == user.id:
        raise HTTPException(400, "Owners cannot leave their own book. Transfer ownership first.")
    row = session.exec(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user.id,
        )
    ).first()
    if not row:
        raise HTTPException(404, "You are not a member of this book.")
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
    from app.db_models import Chapter, ChapterVersion, User as UserModel

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
                "email": getattr(session.get(UserModel, r.author_user_id), "email", ""),
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
