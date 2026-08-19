from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.db_models import Book, BookMember, User


def get_owned_book(session: Session, user: User, book_id: str) -> Book:
    book = session.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found.")
    if book.owner_id == user.id:
        return book
    membership = session.exec(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user.id,
        )
    ).first()
    if not membership:
        raise HTTPException(403, "Not allowed to access this book.")
    return book


def get_book_role(session: Session, user: User, book: Book) -> str:
    if book.owner_id == user.id:
        return "owner"
    membership = session.exec(
        select(BookMember).where(
            BookMember.book_id == book.id,
            BookMember.user_id == user.id,
        )
    ).first()
    return membership.role if membership else "viewer"


def assert_can_edit(session: Session, user: User, book: Book) -> None:
    if book.owner_id == user.id:
        return
    membership = session.exec(
        select(BookMember).where(
            BookMember.book_id == book.id,
            BookMember.user_id == user.id,
        )
    ).first()
    if not membership or membership.role not in {"owner", "editor"}:
        raise HTTPException(403, "Not allowed to edit this book.")


def plan_allows_new_book(session: Session, user: User) -> None:
    if user.plan in {"pro", "studio"}:
        return
    count = len(session.exec(select(Book).where(Book.owner_id == user.id)).all())
    if count >= 1:
        raise HTTPException(
            402,
            "Free plan allows 1 book. Upgrade to Pro for more.",
        )


def export_needs_watermark(user: User) -> bool:
    return user.plan == "free"
