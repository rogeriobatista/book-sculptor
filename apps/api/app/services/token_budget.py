"""Per-user AI token budget: estimation, quota checks, and usage aggregation."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.db_models import AiJob, User

PLAN_MONTHLY_TOKENS: dict[str, int] = {
    "free": 0,
    "pro": 200_000,
    "studio": 1_000_000,
}

# Rough chars-per-token ratio for pre-flight estimates (no tiktoken dependency).
_CHARS_PER_TOKEN = 4


def estimate_tokens(*texts: str) -> int:
    """Estimate token count from text length (conservative for quota pre-checks)."""
    total_chars = sum(len(t) for t in texts if t)
    if total_chars == 0:
        return 500
    return max(200, int(total_chars / _CHARS_PER_TOKEN) + 150)


def month_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def tokens_used_this_month(session: Session, user_id: str) -> int:
    start = month_start_utc()
    result = session.exec(
        select(func.coalesce(func.sum(AiJob.tokens_used), 0)).where(
            AiJob.user_id == user_id,
            AiJob.created_at >= start,
        )
    ).one()
    return int(result or 0)


def quota_limit(plan: str) -> int:
    return PLAN_MONTHLY_TOKENS.get(plan, 0)


def quota_info(session: Session, user: User) -> dict:
    used = tokens_used_this_month(session, user.id)
    limit = quota_limit(user.plan)
    remaining = max(0, limit - used)
    percent = round((used / limit) * 100, 1) if limit > 0 else 0.0
    now = datetime.now(timezone.utc)
    if now.month == 12:
        resets_at = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        resets_at = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
    return {
        "plan": user.plan,
        "used": used,
        "limit": limit,
        "remaining": remaining,
        "percent_used": percent,
        "allowed": user.plan != "free",
        "resets_at": resets_at.isoformat(),
        "warning": percent >= 80,
        "exceeded": limit > 0 and used >= limit,
    }


def assert_ai_allowed(user: User) -> None:
    if user.plan == "free":
        raise HTTPException(402, "AI is available on Pro and Studio plans.")


def assert_quota(
    session: Session,
    user: User,
    *,
    estimate: int | None = None,
    prompt_texts: tuple[str, ...] = (),
) -> None:
    assert_ai_allowed(user)
    limit = quota_limit(user.plan)
    used = tokens_used_this_month(session, user.id)
    needed = estimate if estimate is not None else estimate_tokens(*prompt_texts)
    if used + needed > limit:
        remaining = max(0, limit - used)
        raise HTTPException(
            402,
            f"Monthly AI quota exceeded. {remaining:,} tokens remaining of {limit:,}.",
        )
