"""Smoke tests for chapter hierarchy (parts → nested chapters)."""

from __future__ import annotations

import httpx

BASE = "http://127.0.0.1:8000"
HEADERS = {"Authorization": "Bearer dev:user_hierarchy:hierarchy@example.com"}


def main() -> None:
    client = httpx.Client(base_url=BASE, headers=HEADERS, timeout=30.0)
    print("health", client.get("/health").json())

    book = client.post(
        "/api/v1/books",
        json={
            "title": "Hierarchy Test",
            "author": "QA",
            "locale": "en",
            "mode": "book",
        },
    )
    book.raise_for_status()
    book_id = book.json()["id"]
    print("book", book_id)

    part = client.post(
        f"/api/v1/books/{book_id}/chapters",
        json={"title": "Book One", "kind": "part", "content_text": ""},
    )
    part.raise_for_status()
    part_id = part.json()["id"]
    assert part.json()["parent_id"] is None
    print("part", part_id, part.json()["full_label"])

    child = client.post(
        f"/api/v1/books/{book_id}/chapters",
        json={
            "title": "Opening",
            "kind": "chapter",
            "parent_id": part_id,
            "content_text": "Once upon a time.",
        },
    )
    child.raise_for_status()
    assert child.json()["parent_id"] == part_id
    print("child", child.json()["id"], "under", part_id)

    listing = client.get(f"/api/v1/books/{book_id}/chapters")
    listing.raise_for_status()
    rows = listing.json()
    assert len(rows) == 2
    print("listed", [(r["kind"], r.get("parent_id")) for r in rows])

    invalid = client.post(
        f"/api/v1/books/{book_id}/chapters",
        json={
            "title": "Nested part",
            "kind": "part",
            "parent_id": part_id,
            "content_text": "",
        },
    )
    assert invalid.status_code == 400, invalid.text
    print("reject nested part: ok")

    client.delete(f"/api/v1/books/{book_id}/chapters/{part_id}").raise_for_status()
    after = client.get(f"/api/v1/books/{book_id}/chapters").json()
    assert after[0]["parent_id"] is None
    print("orphan after part delete: ok")

    client.delete(f"/api/v1/books/{book_id}").raise_for_status()
    print("hierarchy tests passed")


if __name__ == "__main__":
    main()
