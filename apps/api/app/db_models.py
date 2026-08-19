from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import Column, JSON, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return uuid4().hex


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(default_factory=_uuid, primary_key=True)
    clerk_id: str = Field(index=True, unique=True)
    email: str = Field(default="", index=True)
    ui_locale: str = Field(default="en")
    plan: str = Field(default="free")  # free | pro | studio
    stripe_customer_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class Subscription(SQLModel, table=True):
    __tablename__ = "subscriptions"

    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(index=True, foreign_key="users.id")
    stripe_subscription_id: Optional[str] = Field(default=None, index=True)
    stripe_price_id: Optional[str] = None
    status: str = Field(default="inactive")
    current_period_end: Optional[datetime] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class Book(SQLModel, table=True):
    __tablename__ = "books"

    id: str = Field(default_factory=_uuid, primary_key=True)
    owner_id: str = Field(index=True, foreign_key="users.id")
    title: str = Field(default="Untitled")
    author: str = Field(default="")
    locale: str = Field(default="en")
    mode: str = Field(default="book")  # book | chapter
    settings_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class Chapter(SQLModel, table=True):
    __tablename__ = "chapters"

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    position: int = Field(default=0, index=True)
    kind: str = Field(default="chapter")
    number: Optional[int] = None
    title: str = Field(default="")
    full_label: str = Field(default="")
    content_text: str = Field(default="", sa_column=Column(Text))
    content_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class ChapterVersion(SQLModel, table=True):
    __tablename__ = "chapter_versions"

    id: str = Field(default_factory=_uuid, primary_key=True)
    chapter_id: str = Field(index=True, foreign_key="chapters.id")
    book_id: str = Field(index=True, foreign_key="books.id")
    author_user_id: str = Field(index=True, foreign_key="users.id")
    title: str = Field(default="")
    content_text: str = Field(default="", sa_column=Column(Text))
    content_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)


class ChapterComment(SQLModel, table=True):
    __tablename__ = "chapter_comments"

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    chapter_id: str = Field(index=True, foreign_key="chapters.id")
    author_user_id: str = Field(index=True, foreign_key="users.id")
    kind: str = Field(default="comment")  # comment | suggestion
    status: str = Field(default="open")  # open | resolved | accepted | rejected
    quote: str = Field(default="", sa_column=Column(Text))
    body: str = Field(default="", sa_column=Column(Text))
    proposed_text: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class ChapterActivity(SQLModel, table=True):
    __tablename__ = "chapter_activities"

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    chapter_id: str = Field(index=True, foreign_key="chapters.id")
    user_id: str = Field(index=True, foreign_key="users.id")
    action: str = Field(default="edit")
    summary: str = Field(default="")
    meta_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)


class BookMember(SQLModel, table=True):
    __tablename__ = "book_members"
    __table_args__ = (UniqueConstraint("book_id", "user_id", name="uq_book_member"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    user_id: str = Field(index=True, foreign_key="users.id")
    role: str = Field(default="owner")  # owner | editor | viewer
    created_at: datetime = Field(default_factory=_utcnow)


class ExportJob(SQLModel, table=True):
    __tablename__ = "exports"

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    user_id: str = Field(index=True, foreign_key="users.id")
    format: str = Field(default="pdf")
    status: str = Field(default="queued")
    storage_key: Optional[str] = None
    download_url: Optional[str] = None
    error: Optional[str] = None
    watermark: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class AiJob(SQLModel, table=True):
    __tablename__ = "ai_jobs"

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    user_id: str = Field(index=True, foreign_key="users.id")
    chapter_id: Optional[str] = Field(default=None, index=True)
    status: str = Field(default="queued")
    prompt: str = Field(default="", sa_column=Column(Text))
    result_text: str = Field(default="", sa_column=Column(Text))
    locale: str = Field(default="en")
    tokens_used: int = Field(default=0)
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class MarketplaceListing(SQLModel, table=True):
    __tablename__ = "marketplace_listings"

    id: str = Field(default_factory=_uuid, primary_key=True)
    book_id: str = Field(index=True, foreign_key="books.id")
    seller_id: str = Field(index=True, foreign_key="users.id")
    title_i18n: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    description_i18n: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    price_cents: int = Field(default=0)
    currency: str = Field(default="usd")
    published: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
