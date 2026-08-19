from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.storage import get_local_path

router = APIRouter(tags=["files"])


@router.get("/files/{file_path:path}")
def get_file(file_path: str) -> FileResponse:
    path = get_local_path(file_path)
    if not path:
        raise HTTPException(404, "File not found.")
    return FileResponse(path)
