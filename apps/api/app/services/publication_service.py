from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import Session, select

from app.db_models import AiJob, Book, Chapter, User
from app.i18n_labels import normalize_locale
from app.services.ai_service import (
    LOCALE_NAMES,
    _chat_completion,
    assert_quota,
    model_for_plan,
    settings as ai_settings,
)
from app.services.publication_profile import (
    PublicationProfile,
    SocialPostDraft,
    merge_publication_into_settings,
    publication_profile_from_book,
)

GenerateKind = str

MAX_EXCERPT_CHARS = 14_000


def manuscript_excerpt(session: Session, book_id: str, *, max_chars: int = MAX_EXCERPT_CHARS) -> str:
    rows = session.exec(
        select(Chapter)
        .where(Chapter.book_id == book_id)
        .order_by(Chapter.position.asc())
    ).all()
    parts: list[str] = []
    total = 0
    for chapter in rows:
        if chapter.kind == "part":
            continue
        text = (chapter.content_text or "").strip()
        if not text:
            continue
        title = (chapter.title or "Chapter").strip()
        chunk = f"\n\n## {title}\n\n{text}"
        if total + len(chunk) > max_chars:
            remaining = max_chars - total
            if remaining > 300:
                parts.append(chunk[:remaining] + "\n\n[…]")
            break
        parts.append(chunk)
        total += len(chunk)
    return "".join(parts).strip()


def _offline_publication(kind: GenerateKind, book: Book, language: str) -> dict:
    title = book.title or "Untitled"
    if kind == "synopsis":
        return {
            "synopsis": (
                f"A compelling story set in the world of “{title}”. "
                f"Written in {language}, this manuscript invites readers into vivid scenes "
                "and memorable characters. (Enable live AI for a tailored synopsis.)"
            ),
            "short_description": f"An unforgettable read — {title}.",
        }
    if kind == "back_cover":
        return {
            "back_cover": (
                f"Discover {title} — a journey of tension, heart, and discovery. "
                "Perfect for readers who love immersive literary fiction."
            ),
        }
    if kind == "social_posts":
        return {
            "social_posts": [
                SocialPostDraft(
                    platform="instagram",
                    text=f"New work in progress: {title} ✨ #amwriting #bookstagram",
                ).model_dump(),
                SocialPostDraft(
                    platform="x",
                    text=f"Drafting “{title}” — follow along for updates. #WritingCommunity",
                ).model_dump(),
            ],
        }
    if kind == "keywords":
        return {"keywords": "fiction, literary, novel, ebook, audiobook"}
    raise HTTPException(400, "Unknown generation kind.")


def run_publication_generate(
    session: Session,
    *,
    user: User,
    book: Book,
    kind: GenerateKind,
    hint: str = "",
) -> PublicationProfile:
    assert_quota(session, user, estimate=2500)
    locale = normalize_locale(book.locale)
    language = LOCALE_NAMES.get(locale, "English")
    excerpt = manuscript_excerpt(session, book.id)
    if not excerpt:
        raise HTTPException(400, "Add chapter content before generating publication copy.")

    profile = publication_profile_from_book(book)
    system = (
        f"You are a book marketing copywriter. Write in {language}. "
        "Be vivid, accurate to the manuscript, and ready for publication. "
        "Do not invent major plot points absent from the excerpt."
    )

    if kind == "synopsis":
        user_prompt = (
            f"Book title: {book.title}\nAuthor: {book.author or 'Unknown'}\n"
            f"Extra guidance: {hint.strip() or 'None'}\n\n"
            f"Manuscript excerpt:\n{excerpt[:MAX_EXCERPT_CHARS]}\n\n"
            "Return JSON with keys: synopsis (250-400 words), short_description (max 280 chars)."
        )
        expected_keys = {"synopsis", "short_description"}
    elif kind == "back_cover":
        user_prompt = (
            f"Book title: {book.title}\nAuthor: {book.author or 'Unknown'}\n"
            f"Synopsis so far: {profile.synopsis[:1200] or 'None'}\n"
            f"Guidance: {hint.strip() or 'None'}\n\n"
            f"Manuscript excerpt:\n{excerpt[:9000]}\n\n"
            "Return JSON with key: back_cover (150-220 words, no spoilers beyond excerpt)."
        )
        expected_keys = {"back_cover"}
    elif kind == "social_posts":
        user_prompt = (
            f"Book title: {book.title}\n"
            f"Short description: {profile.short_description or profile.synopsis[:280]}\n"
            f"Guidance: {hint.strip() or 'None'}\n\n"
            "Return JSON with key social_posts: array of 4 items "
            "{platform, text} for instagram, x, facebook, linkedin. "
            "Each text under 280 chars, include 1-2 hashtags."
        )
        expected_keys = {"social_posts"}
    elif kind == "keywords":
        user_prompt = (
            f"Book title: {book.title}\n"
            f"Categories hint: {profile.categories or 'fiction'}\n"
            f"Synopsis: {profile.synopsis[:1500] or excerpt[:1500]}\n\n"
            "Return JSON with keys: keywords (comma-separated, max 12), "
            "categories (BISAC-style, comma-separated, max 5)."
        )
        expected_keys = {"keywords", "categories"}
    else:
        raise HTTPException(400, "Unknown generation kind.")

    job = AiJob(
        book_id=book.id,
        user_id=user.id,
        status="processing",
        prompt=user_prompt[:8000],
        locale=locale,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    try:
        if not ai_settings.llm_live_enabled:
            payload = _offline_publication(kind, book, language)
        else:
            text, tokens = _chat_completion(
                model=model_for_plan(user.plan),
                system=system + " Reply with valid JSON only.",
                user_prompt=user_prompt,
                temperature=0.65,
            )
            job.tokens_used = tokens
            payload = _parse_json_payload(text)
            if not expected_keys.intersection(payload.keys()):
                raise ValueError("Model returned unexpected JSON shape.")
        job.status = "ready"
        job.result_text = json.dumps(payload, ensure_ascii=False)[:8000]
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)
        session.add(job)
        session.commit()
        raise HTTPException(502, f"Generation failed: {exc}") from exc

    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()

    profile = _apply_generation(profile, kind, payload)
    book.settings_json = merge_publication_into_settings(book.settings_json, profile)
    session.add(book)
    session.commit()
    session.refresh(book)
    return publication_profile_from_book(book)


def _parse_json_payload(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Expected JSON object.")
    return data


def _apply_generation(profile: PublicationProfile, kind: GenerateKind, payload: dict) -> PublicationProfile:
    if kind == "synopsis":
        profile.synopsis = str(payload.get("synopsis") or profile.synopsis).strip()[:8000]
        profile.short_description = str(
            payload.get("short_description") or profile.short_description
        ).strip()[:500]
    elif kind == "back_cover":
        profile.back_cover = str(payload.get("back_cover") or profile.back_cover).strip()[:8000]
    elif kind == "social_posts":
        posts_raw = payload.get("social_posts") or []
        posts: list[SocialPostDraft] = []
        if isinstance(posts_raw, list):
            for item in posts_raw:
                if isinstance(item, dict) and str(item.get("text") or "").strip():
                    posts.append(
                        SocialPostDraft(
                            platform=str(item.get("platform") or "instagram"),
                            text=str(item.get("text") or "").strip()[:500],
                            status="draft",
                        )
                    )
        if posts:
            profile.social_posts = posts[:20]
    elif kind == "keywords":
        profile.keywords = str(payload.get("keywords") or profile.keywords).strip()[:500]
        profile.categories = str(payload.get("categories") or profile.categories).strip()[:500]
    return profile
