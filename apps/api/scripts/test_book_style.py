"""Smoke tests for book voice profile (Phase 2)."""

from __future__ import annotations

import httpx

from app.services.book_style import BookStyleProfile, merge_book_settings_json, parse_style_profile

BASE = "http://127.0.0.1:8000"
HEADERS = {"Authorization": "Bearer dev:user_style:style@example.com"}


def test_parse_and_merge() -> None:
    profile = parse_style_profile(
        {
            "genre": "Fantasy",
            "tone": "Lyrical",
            "pov": "third_limited",
            "prior_chapter_count": 3,
        }
    )
    assert profile.genre == "Fantasy"
    assert profile.prior_chapter_count == 3
    merged = merge_book_settings_json(
        {"style_id": "prosa_literaria", "ai_style": {"genre": "Old"}},
        {"font_id": "garamond", "ai_style": profile.model_dump()},
    )
    assert merged["font_id"] == "garamond"
    assert merged["ai_style"]["genre"] == "Fantasy"
    block = profile.to_prompt_block("en")
    assert "Genre: Fantasy" in block
    print("unit checks ok")


def main() -> None:
    test_parse_and_merge()
    client = httpx.Client(base_url=BASE, headers=HEADERS, timeout=60.0)
    book = client.post(
        "/api/v1/books",
        json={"title": "Voice Test", "author": "QA", "locale": "en", "mode": "book"},
    )
    book.raise_for_status()
    book_id = book.json()["id"]

    updated = client.patch(
        f"/api/v1/books/{book_id}",
        json={
            "settings": {
                "style_id": "prosa_literaria",
                "ai_style": {
                    "genre": "Literary fantasy",
                    "tone": "Warm and lyrical",
                    "pov": "third_limited",
                    "use_prior_chapters": True,
                    "prior_chapter_count": 2,
                },
            }
        },
    )
    updated.raise_for_status()
    ai_style = updated.json()["settings"]["ai_style"]
    assert ai_style["genre"] == "Literary fantasy"
    print("saved ai_style", ai_style)

    ch1 = client.post(
        f"/api/v1/books/{book_id}/chapters",
        json={
            "title": "Opening",
            "kind": "chapter",
            "content_text": "The river ran silver under a cold moon.",
        },
    )
    ch1.raise_for_status()
    ch2 = client.post(
        f"/api/v1/books/{book_id}/chapters",
        json={
            "title": "Crossing",
            "kind": "chapter",
            "content_text": "She stepped onto the bridge without looking back.",
        },
    )
    ch2.raise_for_status()

    ai = client.post(
        "/api/v1/ai/chapter",
        json={
            "book_id": book_id,
            "chapter_id": ch2.json()["id"],
            "action": "consistent",
            "selection": "She stepped onto the bridge without looking back.",
            "prompt": "",
        },
    )
    print("consistent action", ai.status_code)
    if ai.status_code == 402:
        print("skipped live AI (free plan)")
    else:
        ai.raise_for_status()
        assert ai.json().get("text")

    client.delete(f"/api/v1/books/{book_id}").raise_for_status()
    print("book voice tests passed")


if __name__ == "__main__":
    main()
