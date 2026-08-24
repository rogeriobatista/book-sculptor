"""Prior-chapter context for AI copilot consistency."""

from __future__ import annotations

from sqlmodel import Session, select

from app.db_models import Chapter
from app.services.book_style import BookStyleProfile

MAX_PRIOR_CHARS = 10_000
MAX_CHAPTER_SNIPPET = 3_500


def prior_chapters_context(
    session: Session,
    *,
    book_id: str,
    chapter_id: str | None,
    profile: BookStyleProfile,
) -> str:
    if not profile.use_prior_chapters or profile.prior_chapter_count <= 0:
        return ""
    if not chapter_id:
        return ""

    rows = list(
        session.exec(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.position)
        ).all()
    )
    if not rows:
        return ""

    current_index = next((i for i, row in enumerate(rows) if row.id == chapter_id), -1)
    if current_index <= 0:
        return ""

    prior_rows = [r for r in rows[:current_index] if r.kind != "part"]
    if not prior_rows:
        prior_rows = [r for r in rows[:current_index] if (r.content_text or "").strip()]
    prior_rows = prior_rows[-profile.prior_chapter_count :]
    if not prior_rows:
        return ""

    blocks: list[str] = []
    total = 0
    for row in prior_rows:
        label = row.full_label or row.title or "Previous section"
        body = (row.content_text or "").strip()
        if not body:
            continue
        if len(body) > MAX_CHAPTER_SNIPPET:
            body = body[-MAX_CHAPTER_SNIPPET:]
            body = f"…\n{body}"
        block = f"### {label}\n{body}"
        if total + len(block) > MAX_PRIOR_CHARS:
            remaining = MAX_PRIOR_CHARS - total
            if remaining > 200:
                blocks.append(block[:remaining])
            break
        blocks.append(block)
        total += len(block)

    if not blocks:
        return ""
    return "Earlier manuscript excerpts for voice and continuity:\n\n" + "\n\n".join(blocks)
