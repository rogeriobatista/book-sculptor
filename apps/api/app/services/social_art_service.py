"""Generate platform-sized social images from book covers."""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont
from sqlmodel import Session, select

from app.db_models import Book, PublicationSocialAsset, User
from app.storage import delete_key, get_bytes, put_bytes

SOCIAL_FORMATS: dict[str, tuple[int, int]] = {
    "instagram_post": (1080, 1080),
    "instagram_story": (1080, 1920),
    "x_post": (1200, 675),
    "facebook": (1200, 628),
}


def _asset_key(user_id: str, book_id: str, format_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"social/{user_id}/{book_id}/{format_id}-{stamp}.jpg"


def _load_cover_image(book: Book) -> Image.Image:
    if not book.cover_key:
        raise HTTPException(400, "Upload or generate a cover first.")
    raw = get_bytes(book.cover_key)
    if not raw:
        raise HTTPException(400, "Cover file not found in storage.")
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "Invalid cover image.") from exc


def _crop_resize(img: Image.Image, width: int, height: int) -> Image.Image:
    target_ratio = width / height
    iw, ih = img.size
    current_ratio = iw / ih if ih else 1
    if current_ratio > target_ratio:
        new_w = int(ih * target_ratio)
        left = (iw - new_w) // 2
        box = (left, 0, left + new_w, ih)
    else:
        new_h = int(iw / target_ratio)
        top = (ih - new_h) // 2
        box = (0, top, iw, top + new_h)
    cropped = img.crop(box)
    return cropped.resize((width, height), Image.Resampling.LANCZOS)


def _draw_quote_overlay(canvas: Image.Image, quote: str, title: str) -> Image.Image:
    if not quote.strip() and not title.strip():
        return canvas
    draw = ImageDraw.Draw(canvas, "RGBA")
    w, h = canvas.size
    bar_h = max(80, int(h * 0.22))
    overlay = Image.new("RGBA", (w, bar_h), (0, 0, 0, 160))
    canvas.paste(overlay, (0, h - bar_h), overlay)

    try:
        font = ImageFont.truetype("arial.ttf", max(18, int(bar_h * 0.14)))
        title_font = ImageFont.truetype("arialbd.ttf", max(20, int(bar_h * 0.16)))
    except OSError:
        font = ImageFont.load_default()
        title_font = font

    y = h - bar_h + 12
    if title.strip():
        draw.text((20, y), title.strip()[:80], fill=(255, 255, 255, 255), font=title_font)
        y += int(bar_h * 0.22)
    text = quote.strip()[:220]
    if text:
        draw.text((20, y), text, fill=(240, 240, 240, 255), font=font)
    return canvas


def generate_social_assets(
    session: Session,
    *,
    user: User,
    book: Book,
    formats: list[str],
    quote: str = "",
    include_title: bool = True,
) -> list[PublicationSocialAsset]:
    if not formats:
        raise HTTPException(400, "Select at least one format.")
    cover = _load_cover_image(book)
    title = book.title if include_title else ""
    created: list[PublicationSocialAsset] = []

    for format_id in formats:
        if format_id not in SOCIAL_FORMATS:
            continue
        width, height = SOCIAL_FORMATS[format_id]
        canvas = _crop_resize(cover, width, height)
        canvas = _draw_quote_overlay(canvas, quote, title)

        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=90, optimize=True)
        data = buf.getvalue()
        key = _asset_key(user.id, book.id, format_id)
        url = put_bytes(key, data, "image/jpeg")

        row = PublicationSocialAsset(
            book_id=book.id,
            user_id=user.id,
            format_id=format_id,
            storage_key=key,
            url=url,
            quote_text=quote.strip()[:500],
            width=width,
            height=height,
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        created.append(row)

    if not created:
        raise HTTPException(400, "No valid formats selected.")

    session.commit()
    for row in created:
        session.refresh(row)
    return created


def list_social_assets(session: Session, *, book_id: str) -> list[dict[str, Any]]:
    rows = session.exec(
        select(PublicationSocialAsset)
        .where(PublicationSocialAsset.book_id == book_id)
        .order_by(PublicationSocialAsset.created_at.desc())
        .limit(40)
    ).all()
    return [
        {
            "id": row.id,
            "format_id": row.format_id,
            "url": row.url,
            "quote_text": row.quote_text,
            "width": row.width,
            "height": row.height,
            "created_at": row.created_at,
        }
        for row in rows
    ]


def delete_social_asset(session: Session, *, book_id: str, asset_id: str, user_id: str) -> None:
    row = session.get(PublicationSocialAsset, asset_id)
    if not row or row.book_id != book_id or row.user_id != user_id:
        raise HTTPException(404, "Asset not found.")
    if row.storage_key:
        delete_key(row.storage_key)
    session.delete(row)
    session.commit()
