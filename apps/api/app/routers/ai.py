from __future__ import annotations

import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from app.access import assert_can_edit, get_owned_book
from app.auth import CurrentUser
from app.db import get_session
from app.services.ai_service import (
    assert_ai_allowed,
    iter_chapter_ai_stream,
    provider_info,
    run_chapter_ai,
)
from app.services.critical_review import (
    get_latest_critical_review,
    list_critical_review_jobs,
    run_critical_review,
)

router = APIRouter(prefix="/ai", tags=["ai"])


class CriticalReviewRequest(BaseModel):
    book_id: str
    chapter_id: Optional[str] = None
    scope: Literal["chapter", "book", "selection"] = "chapter"
    categories: list[str] = []
    selection: str = ""


class AiRequest(BaseModel):
    book_id: str
    chapter_id: Optional[str] = None
    action: Literal[
        "generate",
        "continue",
        "rewrite",
        "tone",
        "start",
        "outline",
        "dialogue",
        "simplify",
        "finalize",
        "consistent",
    ] = "generate"
    prompt: str = ""
    selection: str = ""


@router.get("/quota")
def ai_quota(
    user: CurrentUser,
    session: Session = Depends(get_session),
    book_id: Optional[str] = None,
    dashboard: bool = False,
) -> dict:
    from app.services.ai_service import get_quota, provider_info

    if dashboard:
        from app.services.ai_usage_service import get_usage_dashboard

        if book_id:
            get_owned_book(session, user, book_id)
        payload = get_usage_dashboard(session, user, book_id=book_id)
        payload["provider"] = provider_info()
        return payload

    payload = get_quota(session, user)
    payload["provider"] = provider_info()
    return payload


@router.get("/usage")
def ai_usage(
    user: CurrentUser,
    session: Session = Depends(get_session),
    book_id: Optional[str] = None,
) -> dict:
    from app.services.ai_usage_service import get_usage_dashboard

    if book_id:
        get_owned_book(session, user, book_id)
    return get_usage_dashboard(session, user, book_id=book_id)


@router.post("/chapter")
def ai_chapter(
    body: AiRequest,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    assert_ai_allowed(user)
    book = get_owned_book(session, user, body.book_id)
    assert_can_edit(session, user, book)
    job = run_chapter_ai(
        session,
        user=user,
        book=book,
        chapter_id=body.chapter_id,
        action=body.action,
        prompt=body.prompt,
        selection=body.selection,
    )
    return {
        "id": job.id,
        "status": job.status,
        "result_text": job.result_text,
        "tokens_used": job.tokens_used,
        "error": job.error,
        "locale": job.locale,
    }


@router.post("/chapter/stream")
def ai_chapter_stream(
    body: AiRequest,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Stream chapter AI output as Server-Sent Events (text/event-stream)."""
    assert_ai_allowed(user)
    book = get_owned_book(session, user, body.book_id)
    assert_can_edit(session, user, book)

    def event_gen():
        for event in iter_chapter_ai_stream(
            session,
            user=user,
            book=book,
            chapter_id=body.chapter_id,
            action=body.action,
            prompt=body.prompt,
            selection=body.selection,
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/critical-review")
def ai_critical_review(
    body: CriticalReviewRequest,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    assert_ai_allowed(user)
    book = get_owned_book(session, user, body.book_id)
    assert_can_edit(session, user, book)
    return run_critical_review(
        session,
        user=user,
        book=book,
        chapter_id=body.chapter_id,
        scope=body.scope,
        categories=body.categories,
        selection=body.selection,
    )


@router.get("/critical-review/jobs")
def ai_critical_review_jobs(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
    chapter_id: Optional[str] = None,
) -> list[dict]:
    assert_ai_allowed(user)
    get_owned_book(session, user, book_id)
    return list_critical_review_jobs(
        session,
        user_id=user.id,
        book_id=book_id,
        chapter_id=chapter_id,
    )


@router.get("/critical-review/latest")
def ai_critical_review_latest(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
    chapter_id: Optional[str] = None,
) -> dict | None:
    assert_ai_allowed(user)
    get_owned_book(session, user, book_id)
    return get_latest_critical_review(
        session,
        user_id=user.id,
        book_id=book_id,
        chapter_id=chapter_id,
    )
