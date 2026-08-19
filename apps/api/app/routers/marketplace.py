from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.access import get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import MarketplaceListing
from app.i18n_labels import normalize_locale

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


class ListingBody(BaseModel):
    book_id: str
    title_i18n: dict[str, str]
    description_i18n: dict[str, str] = {}
    price_cents: int = 0
    currency: str = "usd"
    published: bool = False


@router.get("")
def list_published(
    locale: str = "en",
    session: Session = Depends(get_session),
) -> list[dict]:
    loc = normalize_locale(locale)
    rows = session.exec(
        select(MarketplaceListing).where(MarketplaceListing.published == True)  # noqa: E712
    ).all()
    return [_public(row, loc) for row in rows]


@router.post("")
def create_listing(
    body: ListingBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, body.book_id)
    if book.owner_id != user.id:
        raise HTTPException(403, "Only the owner can list this book.")
    row = MarketplaceListing(
        book_id=body.book_id,
        seller_id=user.id,
        title_i18n=body.title_i18n,
        description_i18n=body.description_i18n,
        price_cents=max(0, body.price_cents),
        currency=body.currency,
        published=body.published,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _public(row, normalize_locale(user.ui_locale))


@router.patch("/{listing_id}")
def update_listing(
    listing_id: str,
    body: ListingBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(MarketplaceListing, listing_id)
    if not row or row.seller_id != user.id:
        raise HTTPException(404, "Listing not found.")
    row.title_i18n = body.title_i18n
    row.description_i18n = body.description_i18n
    row.price_cents = max(0, body.price_cents)
    row.currency = body.currency
    row.published = body.published
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _public(row, normalize_locale(user.ui_locale))


def _public(row: MarketplaceListing, locale: str) -> dict[str, Any]:
    titles = row.title_i18n or {}
    descs = row.description_i18n or {}
    return {
        "id": row.id,
        "book_id": row.book_id,
        "title": titles.get(locale) or titles.get("en") or next(iter(titles.values()), ""),
        "description": descs.get(locale) or descs.get("en") or "",
        "title_i18n": titles,
        "description_i18n": descs,
        "price_cents": row.price_cents,
        "currency": row.currency,
        "published": row.published,
    }
