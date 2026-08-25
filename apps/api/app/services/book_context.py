"""Assemble book-aware context for AI writing assistance."""

from __future__ import annotations

from sqlmodel import Session, select

from app.db_models import Book, Chapter
from app.services.book_style import BookStyleProfile
from app.services.publication_profile import parse_publication_profile

# Total character budget for all context blocks sent to the LLM.
CONTEXT_BUDGET = 18_000
OUTLINE_BUDGET = 2_500
SYNOPSIS_BUDGET = 1_200
PRIOR_BUDGET = 10_000
CURRENT_BUDGET = 8_000
SNIPPET_HEAD = 600
SNIPPET_TAIL = 2_800


def build_writing_context(
    session: Session,
    *,
    book: Book,
    chapter_id: str | None,
    profile: BookStyleProfile,
    selection: str = "",
    action: str = "generate",
) -> str:
    """Build a structured context block within a fixed token budget."""
    parts: list[str] = []
    remaining = CONTEXT_BUDGET

    synopsis = _book_synopsis(book)
    if synopsis:
        block = f"Book synopsis:\n{synopsis[:SYNOPSIS_BUDGET]}"
        parts.append(block)
        remaining -= len(block)

    outline = _book_outline(session, book.id, max_chars=min(OUTLINE_BUDGET, remaining))
    if outline:
        parts.append(outline)
        remaining -= len(outline)

    if profile.use_prior_chapters and profile.prior_chapter_count > 0 and chapter_id:
        prior = _prior_chapters_block(
            session,
            book_id=book.id,
            chapter_id=chapter_id,
            count=profile.prior_chapter_count,
            max_chars=min(PRIOR_BUDGET, remaining),
        )
        if prior:
            parts.append(prior)
            remaining -= len(prior)

    current = _current_chapter_block(
        session,
        book_id=book.id,
        chapter_id=chapter_id,
        selection=selection,
        action=action,
        max_chars=min(CURRENT_BUDGET, remaining),
    )
    if current:
        parts.append(current)

    if not parts:
        return ""
    return "\n\n".join(parts)


def _book_synopsis(book: Book) -> str:
    settings = book.settings_json if isinstance(book.settings_json, dict) else {}
    pub = parse_publication_profile(settings.get("publication"))
    synopsis = (pub.synopsis or "").strip()
    if synopsis:
        return synopsis
    short = (pub.short_description or "").strip()
    return short


def _book_outline(session: Session, book_id: str, *, max_chars: int) -> str:
    rows = list(
        session.exec(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.position)
        ).all()
    )
    if not rows:
        return ""

    lines: list[str] = []
    for row in rows:
        if row.kind == "part":
            label = row.title or "Part"
            lines.append(f"[Part] {label}")
            continue
        label = row.full_label or row.title or "Section"
        kind = row.kind if row.kind != "chapter" else ""
        prefix = f"({kind}) " if kind else ""
        lines.append(f"- {prefix}{label}")

    if not lines:
        return ""
    body = "Book structure:\n" + "\n".join(lines)
    if len(body) > max_chars:
        body = body[: max_chars - 1] + "…"
    return body


def _prior_chapters_block(
    session: Session,
    *,
    book_id: str,
    chapter_id: str,
    count: int,
    max_chars: int,
) -> str:
    rows = list(
        session.exec(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.position)
        ).all()
    )
    current_index = next((i for i, r in enumerate(rows) if r.id == chapter_id), -1)
    if current_index <= 0:
        return ""

    prior_rows = [r for r in rows[:current_index] if r.kind != "part"]
    if not prior_rows:
        prior_rows = [r for r in rows[:current_index] if (r.content_text or "").strip()]
    prior_rows = prior_rows[-count:]
    if not prior_rows:
        return ""

    blocks: list[str] = []
    total = 0
    for row in prior_rows:
        label = _chapter_label(row, rows)
        body = _smart_excerpt(row.content_text or "")
        if not body:
            continue
        block = f"### {label}\n{body}"
        if total + len(block) > max_chars:
            remaining = max_chars - total
            if remaining > 200:
                blocks.append(block[:remaining])
            break
        blocks.append(block)
        total += len(block)

    if not blocks:
        return ""
    return "Earlier manuscript excerpts (voice & continuity):\n\n" + "\n\n".join(blocks)


def _current_chapter_block(
    session: Session,
    *,
    book_id: str,
    chapter_id: str | None,
    selection: str,
    action: str,
    max_chars: int,
) -> str:
    db_text = ""
    label = "Current section"
    if chapter_id:
        row = session.get(Chapter, chapter_id)
        if row and row.book_id == book_id:
            db_text = (row.content_text or "").strip()
            label = _chapter_label(row, [])

    # Prefer the longer of DB content vs client selection (editor may be ahead of save).
    client_text = (selection or "").strip()
    if action == "finalize":
        text = client_text or db_text
        if not text:
            return ""
        excerpt = text[-max_chars:] if len(text) > max_chars else text
        prefix = "…\n" if len(text) > len(excerpt) else ""
        return f"Current chapter to conclude ({label}):\n{prefix}{excerpt}"

    if action in {"rewrite", "tone", "dialogue", "simplify", "consistent"}:
        text = client_text or db_text
        if not text:
            return ""
        return f"Passage to revise ({label}):\n{text[:max_chars]}"

    # continue / generate — tail context for continuity
    text = client_text or db_text
    if not text:
        return ""
    excerpt = text[-max_chars:] if len(text) > max_chars else text
    prefix = "…\n" if len(text) > len(excerpt) else ""
    return f"Current section text so far ({label}):\n{prefix}{excerpt}"


def _smart_excerpt(text: str) -> str:
    """For long chapters: keep opening (setting) + closing (recent events)."""
    body = text.strip()
    if not body:
        return ""
    limit = SNIPPET_HEAD + SNIPPET_TAIL
    if len(body) <= limit:
        return body
    head = body[:SNIPPET_HEAD].rsplit(" ", 1)[0]
    tail = body[-SNIPPET_TAIL:].lstrip()
    if not head.endswith("…"):
        head = head.rstrip() + "…"
    return f"{head}\n\n…\n\n{tail}"


def _chapter_label(row: Chapter, all_rows: list[Chapter]) -> str:
    if row.full_label:
        return row.full_label
    if row.parent_id and all_rows:
        parent = next((r for r in all_rows if r.id == row.parent_id), None)
        if parent and parent.title:
            return f"{parent.title} › {row.title or 'Section'}"
    return row.title or "Section"


# Backward-compatible alias used by older imports.
def prior_chapters_context(
    session: Session,
    *,
    book_id: str,
    chapter_id: str | None,
    profile: BookStyleProfile,
) -> str:
    book = session.get(Book, book_id)
    if not book:
        return ""
    return build_writing_context(
        session,
        book=book,
        chapter_id=chapter_id,
        profile=profile,
        selection="",
        action="continue",
    )
