from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Locale = Literal["en", "pt-BR", "es"]
Plan = Literal["free", "pro", "studio"]


class UserOut(BaseModel):
    id: str
    email: str
    ui_locale: Locale
    plan: Plan


class UserUpdate(BaseModel):
    ui_locale: Optional[Locale] = None


class BookCreate(BaseModel):
    title: str = "Untitled"
    author: str = ""
    locale: Locale = "en"
    mode: Literal["book", "chapter"] = "book"


class BookUpdate(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    locale: Optional[Locale] = None
    mode: Optional[Literal["book", "chapter"]] = None
    settings: Optional[dict[str, Any]] = None


class BookOut(BaseModel):
    id: str
    title: str
    author: str
    locale: str
    mode: str
    settings: dict[str, Any]
    chapter_count: int = 0
    my_role: str = "owner"
    cover_url: Optional[str] = None
    cover_source: Optional[str] = None
    cover_prompt: Optional[str] = None


class CoverGenerateBody(BaseModel):
    prompt: str = Field(default="", max_length=2000)
    style: str = Field(default="literary")  # literary | bold | minimal | fantasy


class ChapterCreate(BaseModel):
    title: str = ""
    kind: str = "chapter"
    number: Optional[int] = None
    parent_id: Optional[str] = None
    content_text: str = ""
    content_json: Optional[dict[str, Any]] = None


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    kind: Optional[str] = None
    number: Optional[int] = None
    parent_id: Optional[str] = None
    full_label: Optional[str] = None
    content_text: Optional[str] = None
    content_json: Optional[dict[str, Any]] = None
    position: Optional[int] = None


class ChapterOut(BaseModel):
    id: str
    book_id: str
    parent_id: Optional[str] = None
    position: int
    kind: str
    number: Optional[int]
    title: str
    full_label: str
    content_text: str
    content_json: dict[str, Any]


class ReorderBody(BaseModel):
    order: list[str] = Field(description="Chapter ids in desired order")


class ExportCreate(BaseModel):
    format: Literal["docx", "epub", "pdf"] = "pdf"


class ExportOut(BaseModel):
    id: str
    book_id: str
    format: str
    status: str
    download_url: Optional[str] = None
    watermark: bool = True
    error: Optional[str] = None


class CheckoutBody(BaseModel):
    plan: Literal["pro", "studio"] = "pro"
    ui_locale: Optional[Locale] = None


class CheckoutOut(BaseModel):
    url: str
