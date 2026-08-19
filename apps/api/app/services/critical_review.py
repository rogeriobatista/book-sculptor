"""AI-assisted critical manuscript review for professional editors."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import get_settings
from app.db_models import AiJob, Book, Chapter, User
from app.i18n_labels import format_chapter_label, normalize_locale
from app.services.ai_service import (
    LOCALE_NAMES,
    assert_quota,
    model_for_plan,
    _chat_completion,
)

settings = get_settings()

JOB_PREFIX = "[critical-review]"
MAX_CHAPTER_CHARS = 18_000
MAX_BOOK_CHARS = 32_000

CATEGORIES = {
    "spelling": "Spelling and typographic errors",
    "grammar": "Grammar, agreement, and syntax",
    "cohesion": "Cohesion, transitions, and flow between paragraphs",
    "organization": "Structure, pacing, and chapter/section organization",
    "incoherence": "Plot, logic, timeline, or factual inconsistencies",
    "style": "Clarity, tone, repetition, and stylistic issues",
}

_VALID_CATEGORIES = set(CATEGORIES)
_VALID_SEVERITIES = {"minor", "moderate", "major"}


def run_critical_review(
    session: Session,
    *,
    user: User,
    book: Book,
    chapter_id: str | None,
    scope: str,
    categories: list[str],
    selection: str = "",
) -> dict[str, Any]:
    """Analyze manuscript and return structured editorial findings."""
    cats = [c for c in categories if c in _VALID_CATEGORIES]
    if not cats:
        cats = list(_VALID_CATEGORIES)

    chapters, manuscript, chapter_map = _build_manuscript(
        session, book, chapter_id, scope, selection
    )
    if not manuscript.strip():
        raise HTTPException(400, "No manuscript text to review.")

    char_count = len(manuscript)
    token_estimate = max(2500, char_count // 3)
    assert_quota(session, user, estimate=token_estimate)

    locale = normalize_locale(book.locale)
    language = LOCALE_NAMES.get(locale, "English")
    cat_lines = "\n".join(f"- {key}: {CATEGORIES[key]}" for key in cats)

    system = (
        f"You are a senior literary editor reviewing a manuscript in {language}. "
        "Perform a professional critical review focused on the requested categories. "
        "Return ONLY valid JSON (no markdown fences) with this shape:\n"
        '{"summary":"2-4 sentence overall assessment","findings":[{'
        '"id":"f1","category":"spelling","severity":"minor|moderate|major",'
        '"chapter_id":"uuid or null","chapter_label":"Chapter 1",'
        '"quote":"exact excerpt copied verbatim from the manuscript (15-120 chars)",'
        '"message":"clear explanation for the author or editor",'
        '"suggested_fix":"replacement text when applicable, else empty string"'
        "}]}\n"
        f"Review categories to apply:\n{cat_lines}\n"
        "Rules:\n"
        "- quote MUST appear exactly in the manuscript (copy verbatim).\n"
        "- Prefer actionable, specific findings over vague praise.\n"
        "- Limit to the 12 most important findings.\n"
        "- Use chapter_id from [CHAPTER_ID:...] markers when scope is the full book.\n"
        "- severity: minor = polish; moderate = should fix; major = blocks quality.\n"
        "- For spelling/grammar with a clear fix, always provide suggested_fix.\n"
        "- Do not invent plot details not present in the text.\n"
        "- Write message and summary in the manuscript language."
    )

    user_prompt = (
        f"Book title: {book.title or '(untitled)'}\n"
        f"Author: {book.author or '(unknown)'}\n"
        f"Scope: {scope}\n"
        f"Manuscript ({char_count} chars):\n\n{manuscript}"
    )

    job = AiJob(
        book_id=book.id,
        user_id=user.id,
        chapter_id=chapter_id if scope == "chapter" else None,
        status="processing",
        prompt=f"{JOB_PREFIX} scope={scope} categories={','.join(cats)}",
        locale=locale,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    try:
        if not settings.llm_live_enabled:
            parsed = _offline_findings(manuscript, cats, chapter_map, language)
            tokens = max(500, char_count // 8)
        else:
            text, tokens = _chat_completion(
                model=model_for_plan(user.plan),
                system=system,
                user_prompt=user_prompt,
                temperature=0.2,
            )
            parsed = _parse_review_json(text, chapter_map)

        findings = _normalize_findings(parsed.get("findings") or [], chapter_map)
        summary = str(parsed.get("summary") or "").strip()
        if not summary:
            summary = _default_summary(findings, language)

        result = {
            "job_id": job.id,
            "scope": scope,
            "categories": cats,
            "summary": summary,
            "findings": findings,
            "chapter_count": len(chapters),
            "char_count": char_count,
        }

        job.status = "ready"
        job.result_text = json.dumps(result, ensure_ascii=False)[:24_000]
        job.tokens_used = tokens
        job.error = None
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        return result
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)[:800]
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        raise HTTPException(502, f"Critical review failed: {exc}") from exc


def list_critical_review_jobs(
    session: Session,
    *,
    user_id: str,
    book_id: str,
    chapter_id: str | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    rows = session.exec(
        select(AiJob)
        .where(AiJob.book_id == book_id)
        .where(AiJob.user_id == user_id)
        .order_by(AiJob.created_at.desc())
    ).all()
    out: list[dict[str, Any]] = []
    for row in rows:
        if not (row.prompt or "").startswith(JOB_PREFIX):
            continue
        if chapter_id and row.chapter_id not in {chapter_id, None}:
            continue
        if row.status != "ready" or not row.result_text:
            continue
        try:
            payload = json.loads(row.result_text)
        except json.JSONDecodeError:
            continue
        out.append(
            {
                "job_id": row.id,
                "created_at": row.created_at,
                "scope": payload.get("scope"),
                "summary": payload.get("summary"),
                "finding_count": len(payload.get("findings") or []),
            }
        )
        if len(out) >= limit:
            break
    return out


def _build_manuscript(
    session: Session,
    book: Book,
    chapter_id: str | None,
    scope: str,
    selection: str,
) -> tuple[list[Chapter], str, dict[str, dict[str, str]]]:
    locale = normalize_locale(book.locale)
    chapter_map: dict[str, dict[str, str]] = {}

    if scope == "selection" and selection.strip():
        label = "Selection"
        cid = chapter_id or "selection"
        chapter_map[cid] = {"id": cid, "label": label}
        text = selection.strip()[:MAX_CHAPTER_CHARS]
        return [], text, chapter_map

    rows = list(
        session.exec(
            select(Chapter)
            .where(Chapter.book_id == book.id)
            .order_by(Chapter.position)
        ).all()
    )
    if scope == "chapter":
        if not chapter_id:
            raise HTTPException(400, "chapter_id is required for chapter scope.")
        rows = [r for r in rows if r.id == chapter_id]
        if not rows:
            raise HTTPException(404, "Chapter not found.")
        max_chars = MAX_CHAPTER_CHARS
    else:
        max_chars = MAX_BOOK_CHARS

    parts: list[str] = []
    total = 0
    for row in rows:
        label = row.full_label or format_chapter_label(
            row.kind, row.number, row.title, locale
        )
        chapter_map[row.id] = {"id": row.id, "label": label}
        body = (row.content_text or "").strip()
        if not body:
            continue
        header = f"=== [CHAPTER_ID:{row.id}] {label} ==="
        block = f"{header}\n{body}"
        if total + len(block) > max_chars:
            remaining = max_chars - total
            if remaining > 400:
                parts.append(block[:remaining])
                total += remaining
            break
        parts.append(block)
        total += len(block) + 2

    return rows, "\n\n".join(parts), chapter_map


def _parse_review_json(text: str, chapter_map: dict[str, dict[str, str]]) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return {"findings": [], "summary": ""}
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {"findings": [], "summary": ""}
    if not isinstance(data, dict):
        return {"findings": [], "summary": ""}
    return data


def _normalize_findings(
    items: list[Any],
    chapter_map: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(items):
        if not isinstance(raw, dict):
            continue
        category = str(raw.get("category") or "style").lower().strip()
        if category not in _VALID_CATEGORIES:
            category = "style"
        severity = str(raw.get("severity") or "moderate").lower().strip()
        if severity not in _VALID_SEVERITIES:
            severity = "moderate"
        quote = str(raw.get("quote") or "").strip()
        message = str(raw.get("message") or "").strip()
        if not quote or not message:
            continue
        key = f"{category}:{quote[:80]}"
        if key in seen:
            continue
        seen.add(key)

        chapter_id = raw.get("chapter_id")
        chapter_id = str(chapter_id).strip() if chapter_id else None
        if chapter_id and chapter_id not in chapter_map:
            chapter_id = None
        chapter_label = str(raw.get("chapter_label") or "").strip()
        if chapter_id and not chapter_label:
            chapter_label = chapter_map[chapter_id]["label"]
        if not chapter_id and len(chapter_map) == 1:
            only = next(iter(chapter_map.values()))
            chapter_id = only["id"]
            chapter_label = only["label"]

        out.append(
            {
                "id": str(raw.get("id") or f"f{index + 1}"),
                "category": category,
                "severity": severity,
                "chapter_id": chapter_id,
                "chapter_label": chapter_label,
                "quote": quote[:500],
                "message": message[:2000],
                "suggested_fix": str(raw.get("suggested_fix") or "").strip()[:2000],
            }
        )
        if len(out) >= 12:
            break
    return out


def _default_summary(findings: list[dict[str, Any]], language: str) -> str:
    if not findings:
        if language.startswith("Portuguese"):
            return "Nenhum problema relevante foi identificado neste trecho."
        if language == "Spanish":
            return "No se identificaron problemas relevantes en este fragmento."
        return "No significant issues were identified in this excerpt."
    major = sum(1 for f in findings if f.get("severity") == "major")
    if language.startswith("Portuguese"):
        return (
            f"A análise encontrou {len(findings)} ponto(s) de atenção"
            + (f", incluindo {major} de alta prioridade." if major else ".")
        )
    if language == "Spanish":
        return (
            f"El análisis encontró {len(findings)} punto(s) de atención"
            + (f", incluidos {major} de alta prioridad." if major else ".")
        )
    return (
        f"The analysis found {len(findings)} issue(s)"
        + (f", including {major} high-priority item(s)." if major else ".")
    )


def _offline_findings(
    manuscript: str,
    categories: list[str],
    chapter_map: dict[str, dict[str, str]],
    language: str,
) -> dict[str, Any]:
    """Deterministic sample findings when the LLM is offline."""
    findings: list[dict[str, Any]] = []
    default_chapter = next(iter(chapter_map.values()), None)

    if "spelling" in categories:
        for match in re.finditer(r"\b(teh|recieve|occured|seperate|definately)\b", manuscript, re.I):
            word = match.group(1)
            findings.append(
                _finding(
                    category="spelling",
                    severity="minor",
                    quote=_quote_window(manuscript, match.start(), match.end()),
                    message=f"Possible misspelling: “{word}”.",
                    suggested_fix="",
                    chapter=default_chapter,
                )
            )
            if len(findings) >= 3:
                break

    if "grammar" in categories and len(findings) < 8:
        for match in re.finditer(r"\b(eu|I)\s+(?:foi|was|were)\b", manuscript, re.I):
            findings.append(
                _finding(
                    category="grammar",
                    severity="moderate",
                    quote=_quote_window(manuscript, match.start(), match.end()),
                    message="Check subject–verb agreement in this sentence.",
                    suggested_fix="",
                    chapter=default_chapter,
                )
            )
            break

    if "cohesion" in categories and len(findings) < 8:
        paragraphs = [p.strip() for p in manuscript.split("\n\n") if p.strip()]
        if len(paragraphs) >= 3:
            quote = paragraphs[1][:100]
            findings.append(
                _finding(
                    category="cohesion",
                    severity="moderate",
                    quote=quote,
                    message="Consider adding a transition linking this paragraph to the previous one.",
                    suggested_fix="",
                    chapter=default_chapter,
                )
            )

    if "organization" in categories and len(findings) < 8 and len(chapter_map) > 1:
        findings.append(
            _finding(
                category="organization",
                severity="moderate",
                quote=manuscript[:80],
                message="Review whether chapter order and pacing serve the narrative arc.",
                suggested_fix="",
                chapter=default_chapter,
            )
        )

    if "style" in categories and len(findings) < 8:
        for match in re.finditer(r"\b(\w{3,})\b.*\b\1\b", manuscript[:3000], re.I):
            word = match.group(1)
            if word.lower() in {"que", "the", "and", "de", "a", "o"}:
                continue
            findings.append(
                _finding(
                    category="style",
                    severity="minor",
                    quote=_quote_window(manuscript, match.start(), min(match.end() + 40, len(manuscript))),
                    message=f"Repeated word “{word}” nearby — consider varying vocabulary.",
                    suggested_fix="",
                    chapter=default_chapter,
                )
            )
            break

    summary = _default_summary(findings, language)
    if not findings:
        summary = (
            "Modo offline: configure a API de IA para uma revisão crítica completa."
            if language.startswith("Portuguese")
            else "Offline mode: configure the AI API for a full critical review."
        )
    return {"summary": summary, "findings": findings[:8]}


def _finding(
    *,
    category: str,
    severity: str,
    quote: str,
    message: str,
    suggested_fix: str,
    chapter: dict[str, str] | None,
) -> dict[str, Any]:
    return {
        "id": f"f-{uuid.uuid4().hex[:8]}",
        "category": category,
        "severity": severity,
        "chapter_id": chapter["id"] if chapter else None,
        "chapter_label": chapter["label"] if chapter else "",
        "quote": quote.strip(),
        "message": message,
        "suggested_fix": suggested_fix,
    }


def _quote_window(text: str, start: int, end: int, radius: int = 40) -> str:
    a = max(0, start - radius)
    b = min(len(text), end + radius)
    snippet = text[a:b].strip()
    return snippet[:120]
