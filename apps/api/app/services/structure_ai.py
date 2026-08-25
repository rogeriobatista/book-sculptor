"""AI-assisted manuscript structure classification (hybrid refine step)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session

from app.config import get_settings
from app.db_models import AiJob, Book, User
from app.i18n_labels import normalize_locale
from app.services.ai_service import (
    LOCALE_NAMES,
    assert_quota,
    model_for_plan,
    usage_total_tokens,
    _chat_completion,
)

settings = get_settings()

_VALID_KINDS = {"prologue", "chapter", "epilogue", "part", "other", "skip"}
_VALID_LEVELS = {"major", "section"}


def classify_structure_headings(
    session: Session,
    *,
    user: User,
    book: Book,
    candidates: list[dict[str, Any]],
    locale: str | None = None,
    toc: list[Any] | None = None,
) -> list[dict[str, Any]]:
    """Classify ambiguous heading candidates. Returns refined candidate dicts.

    Each candidate should include: index, text, heuristic_kind, confidence,
    and optional context_before / context_after.
    High-confidence candidates are returned unchanged.
    Optional ``toc`` is a list of TocEntry (or dicts) from the manuscript sumário.
    """
    if not candidates:
        return []

    ambiguous = [c for c in candidates if c.get("confidence") != "high"]
    if not ambiguous:
        return candidates

    # Free plan / missing quota → keep heuristics
    try:
        assert_quota(session, user, estimate=max(400, 80 * len(ambiguous)))
    except HTTPException:
        return candidates

    loc = normalize_locale(locale or book.locale)
    language = LOCALE_NAMES.get(loc, "English")

    payload = [
        {
            "index": c["index"],
            "text": c.get("text") or "",
            "heuristic": c.get("heuristic_kind") or "unknown",
            "level": c.get("level") or "major",
            "before": (c.get("context_before") or "")[:180],
            "after": (c.get("context_after") or "")[:180],
        }
        for c in ambiguous[:80]
    ]

    toc_hint = ""
    if toc:
        lines: list[str] = []
        for entry in toc[:80]:
            if hasattr(entry, "title"):
                level = getattr(entry, "level", 1)
                kind = getattr(entry, "kind", None) or "?"
                title = getattr(entry, "title", "")
            elif isinstance(entry, dict):
                level = entry.get("level", 1)
                kind = entry.get("kind") or "?"
                title = entry.get("title") or ""
            else:
                continue
            lines.append(f"L{level} [{kind}] {title}")
        if lines:
            toc_hint = (
                "Document table of contents / sumário (use to decide part vs chapter "
                "and whether Parte is a book division or an in-chapter section):\n"
                + "\n".join(lines)
                + "\n"
            )

    system = (
        f"You are an expert book editor for manuscripts in {language}. "
        "Classify each candidate line as a structural heading in a novel/non-fiction book. "
        "Return ONLY valid JSON (no markdown fences) with this shape:\n"
        '{"items":[{"index":0,"kind":"chapter","level":"major","number":1,"title":"..."}]}\n'
        "kind must be one of: prologue, chapter, epilogue, part, other, skip.\n"
        "level must be major (starts a new chapter/unit) or section (subdivision inside a chapter).\n"
        "Rules:\n"
        "- Prólogo/Prefácio/Prologue → prologue, major.\n"
        "- Epílogo/Posfácio/Epilogue/Conclusão → epilogue, major.\n"
        "- Capítulo N / Chapter N / Cap. N → chapter, major.\n"
        "- Standalone literary titles like “A Noite da Traição” between body paragraphs → chapter, major.\n"
        "- Parte/Livro/Volume that divide the whole book → part, major.\n"
        "- Parte/seção numbered scenes inside a chapter (common in novels) → part, section.\n"
        "- If the sumário nests Parte under Capítulo, use part, section.\n"
        "- Book title, author, TOC, page numbers, running headers → skip.\n"
        "- Prefer the manuscript language for titles; strip the word Capítulo/Chapter from title when a separate number exists.\n"
        "Classify every provided index exactly once."
    )
    user_prompt = (
        f"Book title: {book.title or '(unknown)'}\n"
        f"{toc_hint}"
        f"Candidates JSON:\n{json.dumps(payload, ensure_ascii=False)}"
    )

    job = AiJob(
        book_id=book.id,
        user_id=user.id,
        chapter_id=None,
        status="processing",
        prompt=user_prompt[:8000],
        locale=loc,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    by_index = {c["index"]: dict(c) for c in candidates}

    try:
        if not settings.llm_live_enabled:
            refined = _offline_refine(ambiguous)
            tokens = max(1, len(ambiguous) * 10)
        else:
            text, tokens = _chat_completion(
                model=model_for_plan(user.plan),
                system=system,
                user_prompt=user_prompt,
                temperature=0.1,
            )
            refined = _parse_items(text)

        for item in refined:
            idx = item.get("index")
            if idx not in by_index:
                continue
            kind = str(item.get("kind") or "").lower().strip()
            if kind not in _VALID_KINDS:
                continue
            level = str(item.get("level") or "").lower().strip()
            if level not in _VALID_LEVELS:
                level = "section" if kind == "part" else "major"
                if kind == "skip":
                    level = "section"
            title = str(item.get("title") or by_index[idx].get("text") or "").strip()
            number = item.get("number")
            if number is not None:
                try:
                    number = int(number)
                except (TypeError, ValueError):
                    number = by_index[idx].get("number")
            by_index[idx].update(
                {
                    "kind": kind,
                    "level": level,
                    "title": title,
                    "number": number,
                    "ai_refined": True,
                }
            )

        job.status = "ready"
        job.result_text = json.dumps(refined, ensure_ascii=False)[:8000]
        job.tokens_used = usage_total_tokens(tokens)
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)[:800]
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        return candidates

    return [by_index[c["index"]] for c in candidates]


def _parse_items(text: str) -> list[dict[str, Any]]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def _offline_refine(ambiguous: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Lightweight offline rules when the LLM is not configured."""
    out: list[dict[str, Any]] = []
    for c in ambiguous:
        text = (c.get("text") or "").strip()
        low = text.lower()
        kind = c.get("heuristic_kind") or "other"
        level = c.get("level") or "major"
        number = c.get("number")
        title = text
        if re.match(r"^(?:prólogo|prologo|prologue|prefácio|prefacio)\b", low):
            kind, level = "prologue", "major"
        elif re.match(r"^(?:epílogo|epilogo|epilogue|posfácio|posfacio|conclusão)\b", low):
            kind, level = "epilogue", "major"
        elif re.match(
            r"^(?:capítulo|capitulo|chapter)\s+(?:\d|[ivxlcdm])|"
            r"^cap\.\s*(?:\d|[ivxlcdm])|"
            r"^cap\s+(?:\d|[ivxlcdm])",
            low,
        ):
            kind, level = "chapter", "major"
        elif re.match(r"^(?:parte|part|livro|volume)\b", low):
            # Default: in-chapter section unless TOC already promoted to major
            kind = "part"
            level = c.get("level") or "section"
            if level not in {"major", "section"}:
                level = "section"
        elif kind in {None, "unknown", "other"} and 1 <= len(text.split()) <= 10:
            kind, level = "chapter", "major"
        out.append(
            {
                "index": c["index"],
                "kind": kind,
                "level": level,
                "number": number,
                "title": title,
            }
        )
    return out
