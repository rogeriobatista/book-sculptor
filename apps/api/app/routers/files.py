from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.auth import CurrentUser
from app.db import get_session
from app.services.file_access import assert_local_file_access

router = APIRouter(tags=["files"])


@router.get("/files/{file_path:path}")
def get_file(
    file_path: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> FileResponse:
    try:
        path = assert_local_file_access(session, user, file_path)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, "File not found.") from exc
    return FileResponse(path)
