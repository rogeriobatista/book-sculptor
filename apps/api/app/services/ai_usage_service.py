"""AI usage analytics dashboard for quota, breakdown, and activity."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.db_models import AiJob, Book, User
from app.services.ai_service import model_for_plan, provider_info
from app.services.book_context import CONTEXT_BUDGET
from app.services.book_style import style_profile_from_book
from app.services.critical_review import JOB_PREFIX
from app.services.token_budget import month_start_utc, quota_info

WRITING_CATEGORIES = frozenset({"chapter", "writing"})
COVER_TOKEN_COST = 8_000


def _resolve_category(job: AiJob) -> str:
    job_type = (job.job_type or "chapter").strip().lower()
    if job_type not in {"", "chapter"}:
        return job_type
    prompt = job.prompt or ""
    if prompt.startswith(JOB_PREFIX):
        return "critique"
    if job.action:
        return "chapter"
    if job.tokens_used == COVER_TOKEN_COST and not job.chapter_id:
        return "cover"
    if "Candidates JSON" in prompt:
        return "structure"
    if any(
        marker in prompt
        for marker in ("synopsis", "back_cover", "keywords", "social_posts")
    ):
        return "publication"
    return "chapter"


def get_usage_dashboard(
    session: Session,
    user: User,
    *,
    book_id: str | None = None,
) -> dict:
    start = month_start_utc()
    now = datetime.now(timezone.utc)
    quota = quota_info(session, user)

    jobs = list(
        session.exec(
            select(AiJob)
            .where(AiJob.user_id == user.id, AiJob.created_at >= start)
            .order_by(AiJob.created_at.desc())
        ).all()
    )

    breakdown_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tokens": 0, "jobs": 0}
    )
    daily_map: dict[str, int] = defaultdict(int)
    input_total = 0
    output_total = 0
    book_tokens = 0
    book_jobs = 0

    for job in jobs:
        tokens = int(job.tokens_used or 0)
        category = _resolve_category(job)
        breakdown_map[category]["tokens"] += tokens
        breakdown_map[category]["jobs"] += 1
        input_total += int(job.input_tokens or 0)
        output_total += int(job.output_tokens or 0)

        created = job.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        day_key = created.date().isoformat()
        daily_map[day_key] += tokens

        if book_id and job.book_id == book_id:
            book_tokens += tokens
            book_jobs += 1

    total_used = quota["used"]
    breakdown = []
    for category, stats in sorted(
        breakdown_map.items(),
        key=lambda item: item[1]["tokens"],
        reverse=True,
    ):
        percent = round((stats["tokens"] / total_used) * 100, 1) if total_used > 0 else 0.0
        breakdown.append(
            {
                "category": category,
                "tokens": stats["tokens"],
                "jobs": stats["jobs"],
                "percent": percent,
            }
        )

    daily: list[dict] = []
    for offset in range(13, -1, -1):
        day = (now - timedelta(days=offset)).date()
        key = day.isoformat()
        daily.append({"date": key, "tokens": daily_map.get(key, 0)})

    days_elapsed = max(1, (now.date() - start.date()).days + 1)
    daily_avg = int(total_used / days_elapsed)
    resets_at = datetime.fromisoformat(quota["resets_at"])
    if resets_at.tzinfo is None:
        resets_at = resets_at.replace(tzinfo=timezone.utc)
    days_until_reset = max(0, (resets_at.date() - now.date()).days)
    projected = int(total_used + daily_avg * days_until_reset)
    limit = int(quota["limit"] or 0)
    if limit <= 0:
        pace = "unavailable"
    elif projected > limit:
        pace = "over"
    elif projected > limit * 0.85:
        pace = "heavy"
    else:
        pace = "on_track"

    recent = []
    for job in jobs[:12]:
        created = job.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        recent.append(
            {
                "id": job.id,
                "category": _resolve_category(job),
                "action": job.action,
                "tokens_used": int(job.tokens_used or 0),
                "input_tokens": int(job.input_tokens or 0),
                "output_tokens": int(job.output_tokens or 0),
                "status": job.status,
                "created_at": created.isoformat(),
                "book_id": job.book_id,
            }
        )

    context_settings = _context_settings(session, book_id)
    provider = provider_info()
    model = model_for_plan(user.plan)

    payload: dict = {
        "quota": quota,
        "provider": provider,
        "tokens": {
            "input": input_total or max(0, total_used - output_total),
            "output": output_total or total_used,
            "total": total_used,
        },
        "breakdown": breakdown,
        "daily": daily,
        "recent": recent,
        "projection": {
            "daily_average": daily_avg,
            "projected_month_end": projected,
            "days_until_reset": days_until_reset,
            "pace": pace,
        },
        "context": context_settings,
        "plan": {
            "id": user.plan,
            "model": model,
            "monthly_tokens": limit,
        },
    }

    if book_id:
        book_percent = round((book_tokens / total_used) * 100, 1) if total_used > 0 else 0.0
        payload["book"] = {
            "book_id": book_id,
            "tokens": book_tokens,
            "jobs": book_jobs,
            "percent_of_month": book_percent,
        }

    return payload


def _context_settings(session: Session, book_id: str | None) -> dict:
    base = {
        "budget_chars": CONTEXT_BUDGET,
        "estimated_tokens_per_request": max(500, CONTEXT_BUDGET // 4),
        "use_prior_chapters": True,
        "prior_chapter_count": 2,
    }
    if not book_id:
        return base
    book = session.get(Book, book_id)
    if not book:
        return base
    profile = style_profile_from_book(book)
    base["use_prior_chapters"] = profile.use_prior_chapters
    base["prior_chapter_count"] = profile.prior_chapter_count
    return base
