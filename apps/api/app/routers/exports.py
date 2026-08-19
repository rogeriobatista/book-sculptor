from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel import Session, select

from app.access import export_needs_watermark, get_owned_book
from app.auth import CurrentUser
from app.db import get_session, engine
from app.db_models import ExportJob
from app.schemas import ExportCreate, ExportOut
from app.services.export_runner import process_export_job
from sqlmodel import Session as SQLSession

router = APIRouter(tags=["exports"])


def _out(job: ExportJob) -> ExportOut:
    return ExportOut(
        id=job.id,
        book_id=job.book_id,
        format=job.format,
        status=job.status,
        download_url=job.download_url,
        watermark=job.watermark,
        error=job.error,
    )


def _run_job(job_id: str) -> None:
    with SQLSession(engine) as session:
        process_export_job(session, job_id)


@router.post("/books/{book_id}/exports", response_model=ExportOut)
def create_export(
    book_id: str,
    body: ExportCreate,
    background: BackgroundTasks,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> ExportOut:
    get_owned_book(session, user, book_id)
    job = ExportJob(
        book_id=book_id,
        user_id=user.id,
        format=body.format,
        status="queued",
        watermark=export_needs_watermark(user),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    background.add_task(_run_job, job.id)
    return _out(job)


@router.get("/books/{book_id}/exports", response_model=list[ExportOut])
def list_exports(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[ExportOut]:
    get_owned_book(session, user, book_id)
    jobs = session.exec(
        select(ExportJob)
        .where(ExportJob.book_id == book_id, ExportJob.user_id == user.id)
        .order_by(ExportJob.created_at.desc())
    ).all()
    return [_out(j) for j in jobs]


@router.get("/exports/{export_id}", response_model=ExportOut)
def get_export(
    export_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> ExportOut:
    job = session.get(ExportJob, export_id)
    if not job or job.user_id != user.id:
        raise HTTPException(404, "Export not found.")
    return _out(job)
