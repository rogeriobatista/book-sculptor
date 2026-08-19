"""Authorize access to locally stored files (covers, exports)."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session

from app.access import get_owned_book
from app.db_models import ExportJob, User
from app.storage import resolve_safe_local_path


def assert_local_file_access(session: Session, user: User, file_path: str) -> Path:
    """Return resolved path if the user may read this storage key."""
    path = resolve_safe_local_path(file_path)
    if not path:
        raise HTTPException(404, "File not found.")

    normalized = file_path.replace("\\", "/").strip("/")
    parts = [p for p in normalized.split("/") if p]
    if len(parts) < 2:
        raise HTTPException(403, "Not allowed to access this file.")

    kind, owner_id = parts[0], parts[1]

    if kind == "covers":
        if len(parts) < 3:
            raise HTTPException(403, "Not allowed to access this file.")
        book_id = parts[2]
        get_owned_book(session, user, book_id)
        return path

    if kind == "exports":
        if owner_id != user.id:
            raise HTTPException(403, "Not allowed to access this file.")
        if len(parts) >= 3:
            export_id = parts[2]
            job = session.get(ExportJob, export_id)
            if not job or job.user_id != user.id:
                raise HTTPException(403, "Not allowed to access this file.")
            get_owned_book(session, user, job.book_id)
        return path

    raise HTTPException(403, "Not allowed to access this file.")
