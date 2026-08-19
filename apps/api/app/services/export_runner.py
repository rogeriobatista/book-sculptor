from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session

from app.access import export_needs_watermark
from app.db_models import ExportJob, User
from app.exporters import export_document
from app.services.book_builder import load_domain_book, settings_from_book
from app.storage import put_bytes
from app.db_models import Book as BookRow


MEDIA = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "epub": "application/epub+zip",
    "pdf": "application/pdf",
}


def process_export_job(session: Session, job_id: str) -> ExportJob:
    job = session.get(ExportJob, job_id)
    if not job:
        raise KeyError("Export job not found.")

    job.status = "processing"
    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()

    try:
        book = session.get(BookRow, job.book_id)
        user = session.get(User, job.user_id)
        if not book or not user:
            raise ValueError("Book or user missing.")

        domain = load_domain_book(session, book)
        settings = settings_from_book(book)
        fmt = job.format if job.format in {"docx", "epub", "pdf"} else "pdf"
        watermark = export_needs_watermark(user)
        job.watermark = watermark

        if watermark and domain.title and "Book Sculptor" not in domain.title:
            domain.title = f"{domain.title} (Book Sculptor Free)"

        safe = "".join(c for c in domain.title if c not in '<>:"/\\|?*').strip() or "book"
        key = f"exports/{job.user_id}/{job.id}/{safe}.{fmt}"

        with tempfile.TemporaryDirectory(prefix="bs-export-") as tmp:
            out = Path(tmp) / f"{safe}.{fmt}"
            export_document(domain, out, fmt=fmt, settings=settings)
            data = out.read_bytes()

        url = put_bytes(key, data, MEDIA.get(fmt, "application/octet-stream"))
        job.storage_key = key
        job.download_url = url
        job.status = "ready"
        job.error = None
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)

    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job
