from __future__ import annotations

import base64
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlmodel import Session

from app.config import get_settings
from app.db_models import AiJob, Book, User
from app.services.ai_service import assert_quota
from app.storage import delete_key, put_bytes

settings = get_settings()

ALLOWED_COVER_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_COVER_BYTES = 8 * 1024 * 1024  # 8 MB
IMAGE_TOKEN_COST = 8_000

STYLE_HINTS = {
    "literary": "elegant literary fiction cover, refined typography space, muted atmospheric palette",
    "bold": "bold commercial bestseller cover, strong contrast, dramatic composition",
    "minimal": "minimal modern book cover, clean negative space, simple symbolic motif",
    "fantasy": "epic fantasy book cover, cinematic lighting, detailed atmosphere",
}


def _cover_key(user_id: str, book_id: str, ext: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"covers/{user_id}/{book_id}/cover-{stamp}.{ext}"


def clear_cover(book: Book) -> None:
    if book.cover_key:
        delete_key(book.cover_key)
    book.cover_key = None
    book.cover_url = None
    book.cover_source = None
    book.cover_prompt = None


def save_cover_bytes(
    book: Book,
    *,
    user_id: str,
    data: bytes,
    content_type: str,
    source: str,
    prompt: str | None = None,
) -> Book:
    ext = ALLOWED_COVER_TYPES.get(content_type.lower())
    if not ext:
        raise HTTPException(400, "Cover must be JPEG, PNG, or WebP.")
    if len(data) > MAX_COVER_BYTES:
        raise HTTPException(400, "Cover image is too large (max 8 MB).")
    if book.cover_key:
        delete_key(book.cover_key)
    key = _cover_key(user_id, book.id, ext)
    url = put_bytes(key, data, content_type)
    book.cover_key = key
    book.cover_url = url
    book.cover_source = source
    book.cover_prompt = (prompt or "").strip()[:2000] or None
    book.updated_at = datetime.now(timezone.utc)
    return book


def build_cover_prompt(
    *,
    title: str,
    author: str,
    user_prompt: str,
    style: str,
    language: str,
) -> str:
    style_hint = STYLE_HINTS.get(style, STYLE_HINTS["literary"])
    bits = [
        "Professional book cover artwork for a published novel.",
        f"Style: {style_hint}.",
        "Vertical portrait composition suitable for print and ebook cover.",
        "Do not include barcode, price, or publisher logos.",
        "Leave a calm area near the top or center for the title text overlay.",
        f"Book title: {title}.",
    ]
    if author:
        bits.append(f"Author: {author}.")
    if user_prompt.strip():
        bits.append(f"Creative direction: {user_prompt.strip()}")
    else:
        bits.append(
            f"Invent a fitting symbolic scene for the title in {language}, without readable text in the image."
        )
    bits.append("No readable text, letters, or watermarks in the image itself.")
    return " ".join(bits)


def generate_cover_image(
    session: Session,
    *,
    user: User,
    book: Book,
    prompt: str,
    style: str = "literary",
) -> AiJob:
    assert_quota(session, user, estimate=IMAGE_TOKEN_COST)
    if not settings.llm_live_enabled or not settings.resolved_llm_api_key:
        raise HTTPException(
            503,
            "AI cover generation requires a configured OpenAI API key.",
        )
    if not settings.is_openai_cloud:
        raise HTTPException(
            503,
            "Cover generation currently requires the OpenAI Images API.",
        )

    language = {
        "en": "English",
        "pt-BR": "Brazilian Portuguese",
        "es": "Spanish",
    }.get(book.locale or "en", "English")

    full_prompt = build_cover_prompt(
        title=book.title or "Untitled",
        author=book.author or "",
        user_prompt=prompt,
        style=style,
        language=language,
    )

    job = AiJob(
        book_id=book.id,
        user_id=user.id,
        chapter_id=None,
        status="processing",
        prompt=full_prompt,
        locale=book.locale or "en",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    try:
        image_bytes, content_type = _call_openai_image(full_prompt)
        save_cover_bytes(
            book,
            user_id=user.id,
            data=image_bytes,
            content_type=content_type,
            source="ai",
            prompt=prompt.strip() or full_prompt[:500],
        )
        session.add(book)
        job.status = "done"
        job.result_text = book.cover_url or ""
        job.tokens_used = IMAGE_TOKEN_COST
        job.error = None
    except HTTPException as exc:
        job.status = "failed"
        job.error = str(exc.detail)
        session.add(job)
        session.commit()
        raise
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)
        session.add(job)
        session.commit()
        raise HTTPException(502, f"Cover generation failed: {exc}") from exc

    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def _call_openai_image(prompt: str) -> tuple[bytes, str]:
    headers = {
        "Authorization": f"Bearer {settings.resolved_llm_api_key}",
        "Content-Type": "application/json",
    }
    model = (settings.llm_image_model or "dall-e-3").strip()
    payload = {
        "model": model,
        "prompt": prompt[:3900],
        "n": 1,
        "size": "1024x1792" if model.startswith("dall-e") else "1024x1536",
        "response_format": "b64_json",
    }
    if model.startswith("dall-e"):
        payload["quality"] = "standard"

    url = f"{settings.resolved_llm_base_url}/images/generations"
    with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
        response = client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            detail = response.text[:400]
            raise HTTPException(502, f"Image API error ({response.status_code}): {detail}")
        data = response.json()

    items = data.get("data") or []
    if not items:
        raise HTTPException(502, "Image API returned no image.")
    b64 = items[0].get("b64_json")
    if not b64:
        # Some gateways only return a URL
        image_url = items[0].get("url")
        if not image_url:
            raise HTTPException(502, "Image API response missing image data.")
        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            img = client.get(image_url)
            img.raise_for_status()
            ctype = img.headers.get("content-type", "image/png").split(";")[0].strip()
            return img.content, ctype if ctype in ALLOWED_COVER_TYPES else "image/png"

    return base64.b64decode(b64), "image/png"
