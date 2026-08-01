from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.exporters import export_document
from app.layout import LayoutSettings, layout_options_payload
from app.preview import book_to_dict, diagnostic_payload, preview_payload
from app.project import (
    add_upload,
    move_chapter,
    rebuild_book,
    remove_file,
    reorder_chapters,
    store,
)

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
EXPORTS = ROOT / ".exports"
EXPORTS.mkdir(exist_ok=True)

app = FastAPI(title="Book Sculptor")
app.mount("/static", StaticFiles(directory=WEB), name="static")


class SettingsBody(BaseModel):
    style_id: str = "prosa_literaria"
    format_id: str = "medio"
    font_id: str = "garamond"
    font_size: int = 11
    density: str = "padrao"
    page_number: str = "centro"
    include_toc: bool = True


class ReorderBody(BaseModel):
    order: list[int]


class MoveBody(BaseModel):
    index: int
    direction: int


class ModeBody(BaseModel):
    mode: str  # book | chapter


class ExportBody(BaseModel):
    format: str = "docx"  # docx | epub | pdf


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/api/options")
def options() -> dict:
    return layout_options_payload()


@app.post("/api/projects")
def create_project() -> dict:
    project = store.create()
    return {"project_id": project.id}


@app.post("/api/projects/{project_id}/files")
async def upload_files(
    project_id: str,
    files: list[UploadFile] = File(...),
) -> dict:
    try:
        project = store.get(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc

    try:
        for upload in files:
            content = await upload.read()
            add_upload(project, upload.filename or "arquivo.docx", content)
        book = rebuild_book(project)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    return _project_payload(project, book)


@app.delete("/api/projects/{project_id}/files/{file_id}")
def delete_file(project_id: str, file_id: str) -> dict:
    try:
        project = store.get(project_id)
        remove_file(project, file_id)
        book = rebuild_book(project) if project.files else None
        project.book = book
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _project_payload(project, book)


@app.post("/api/projects/{project_id}/mode")
def set_mode(project_id: str, body: ModeBody) -> dict:
    try:
        project = store.get(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    if body.mode not in {"book", "chapter"}:
        raise HTTPException(400, "Modo inválido.")
    project.mode = body.mode
    book = rebuild_book(project) if project.files else None
    project.book = book
    return _project_payload(project, book)


@app.post("/api/projects/{project_id}/settings")
def update_settings(project_id: str, body: SettingsBody) -> dict:
    try:
        project = store.get(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    project.settings = LayoutSettings.from_dict(body.model_dump())
    return {"settings": project.settings.to_dict()}


@app.get("/api/projects/{project_id}/preview")
def get_preview(project_id: str) -> dict:
    try:
        project = store.get(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    if not project.book:
        raise HTTPException(400, "Envie um manuscrito para gerar a prévia.")
    payload = preview_payload(project.book, project.settings)
    payload["files"] = [{"id": f.id, "name": f.name} for f in project.files]
    payload["diagnostic"] = diagnostic_payload(project.book)
    payload["mode"] = project.mode
    return payload


@app.post("/api/projects/{project_id}/chapters/reorder")
def reorder(project_id: str, body: ReorderBody) -> dict:
    try:
        project = store.get(project_id)
        book = reorder_chapters(project, body.order)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _project_payload(project, book)


@app.post("/api/projects/{project_id}/chapters/move")
def move(project_id: str, body: MoveBody) -> dict:
    try:
        project = store.get(project_id)
        book = move_chapter(project, body.index, body.direction)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _project_payload(project, book)


@app.post("/api/projects/{project_id}/export")
def export_project(project_id: str, body: ExportBody) -> dict:
    try:
        project = store.get(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    if not project.book:
        raise HTTPException(400, "Nada para exportar. Envie um manuscrito primeiro.")

    fmt = body.format if body.format in {"docx", "epub", "pdf"} else "docx"
    safe = "".join(c for c in project.book.title if c not in '<>:"/\\|?*').strip() or "livro"
    display_name = f"{safe}.{fmt}"
    out = EXPORTS / f"{project.id}_{safe}.{fmt}"
    try:
        export_document(project.book, out, fmt=fmt, settings=project.settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Falha ao gerar o arquivo: {exc}") from exc

    return {
        "download_url": f"/api/projects/{project_id}/download/{out.name}",
        "filename": display_name,
        "temp_path": str(out),
        "format": fmt,
    }


@app.get("/api/projects/{project_id}/download/{filename}")
def download(project_id: str, filename: str) -> FileResponse:
    path = EXPORTS / filename
    if not path.exists() or not filename.startswith(project_id):
        raise HTTPException(404, "Arquivo não encontrado.")

    suffix = path.suffix.lower()
    media = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".epub": "application/epub+zip",
        ".pdf": "application/pdf",
    }.get(suffix, "application/octet-stream")

    download_name = path.name.split("_", 1)[-1]
    return FileResponse(
        path,
        filename=download_name,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )

def _project_payload(project, book) -> dict:
    return {
        "project_id": project.id,
        "mode": project.mode,
        "files": [{"id": f.id, "name": f.name} for f in project.files],
        "settings": project.settings.to_dict(),
        "book": book_to_dict(book) if book else None,
        "diagnostic": diagnostic_payload(book) if book else None,
    }
