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
    PLAN_MONTHLY_TOKENS,
    assert_ai_allowed,
    iter_chapter_ai_stream,
    provider_info,
    run_chapter_ai,
    tokens_used_this_month,
)

router = APIRouter(prefix="/ai", tags=["ai"])


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
    ] = "generate"
    prompt: str = ""
    selection: str = ""


@router.get("/quota")
def ai_quota(
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    used = tokens_used_this_month(session, user.id)
    limit = PLAN_MONTHLY_TOKENS.get(user.plan, 0)
    return {
        "plan": user.plan,
        "used": used,
        "limit": limit,
        "allowed": user.plan != "free",
        "provider": provider_info(),
    }


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
