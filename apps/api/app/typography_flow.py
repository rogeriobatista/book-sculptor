"""Helpers for body/section detection and drop-cap placement."""

from __future__ import annotations

from app.structure import PART_PREFIX


def looks_like_section_heading(text: str) -> bool:
    """True for short part/section labels stored as body (e.g. 'Parte I — …')."""
    clean = " ".join((text or "").split())
    if not clean or len(clean) > 140:
        return False
    return PART_PREFIX.match(clean) is not None


def is_section_paragraph(style: str | None, text: str) -> bool:
    if style == "section":
        return True
    return looks_like_section_heading(text)


def is_prose_opener(text: str) -> bool:
    """Body text long enough to receive a drop cap / chapter-open indent."""
    clean = " ".join((text or "").split())
    if not clean or looks_like_section_heading(clean):
        return False
    words = clean.split()
    return len(words) >= 6 or len(clean) >= 36


def previous_breaks_indent(paragraphs: list, index: int) -> bool:
    """Chapter start or paragraph after a section heading → flush-left opener."""
    if index <= 0:
        return True
    prev = paragraphs[index - 1]
    return is_section_paragraph(getattr(prev, "style", None), getattr(prev, "text", ""))


def first_drop_cap_index(paragraphs: list) -> int | None:
    """Index of the first real prose paragraph suitable for a drop cap."""
    for index, para in enumerate(paragraphs):
        style = getattr(para, "style", None)
        text = getattr(para, "text", "") or ""
        if style == "dialogue":
            continue
        if is_section_paragraph(style, text):
            continue
        if is_prose_opener(text):
            return index
    return None
