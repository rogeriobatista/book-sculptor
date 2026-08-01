from __future__ import annotations

import re
import shutil
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.extractors import extract_blocks
from app.layout import LayoutSettings
from app.models import Book
from app.structure import (
    _chapter_from_blocks,
    _format_label,
    _title_from_filename,
    build_chapter_from_file,
    detect_structure,
)


@dataclass
class ManuscriptFile:
    id: str
    name: str
    path: Path


@dataclass
class ProjectState:
    id: str
    work_dir: Path
    files: list[ManuscriptFile] = field(default_factory=list)
    book: Book | None = None
    settings: LayoutSettings = field(default_factory=LayoutSettings)
    mode: str = "book"  # book | chapter
    # Título definido pelo usuário (sobrescreve o detectado)
    custom_title: str | None = None


class ProjectStore:
    def __init__(self) -> None:
        self._projects: dict[str, ProjectState] = {}

    def create(self) -> ProjectState:
        project_id = uuid.uuid4().hex[:12]
        work_dir = Path(tempfile.mkdtemp(prefix=f"booksculptor-{project_id}-"))
        project = ProjectState(id=project_id, work_dir=work_dir)
        self._projects[project_id] = project
        return project

    def get(self, project_id: str) -> ProjectState:
        project = self._projects.get(project_id)
        if not project:
            raise KeyError("Projeto não encontrado. Envie o manuscrito novamente.")
        return project

    def delete(self, project_id: str) -> None:
        project = self._projects.pop(project_id, None)
        if project and project.work_dir.exists():
            shutil.rmtree(project.work_dir, ignore_errors=True)


store = ProjectStore()


def add_upload(project: ProjectState, filename: str, content: bytes) -> ManuscriptFile:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise ValueError("Use apenas arquivos PDF (.pdf) ou Word (.docx).")

    file_id = uuid.uuid4().hex[:10]
    safe_name = Path(filename).name
    dest = project.work_dir / f"{file_id}_{safe_name}"
    dest.write_bytes(content)
    item = ManuscriptFile(id=file_id, name=safe_name, path=dest)
    project.files.append(item)
    return item


def remove_file(project: ProjectState, file_id: str) -> None:
    remaining = []
    for item in project.files:
        if item.id == file_id:
            if item.path.exists():
                item.path.unlink()
        else:
            remaining.append(item)
    project.files = remaining


def rebuild_book(project: ProjectState) -> Book:
    if not project.files:
        raise ValueError("Envie ao menos um arquivo do manuscrito.")

    if project.mode == "chapter":
        book = build_chapter_from_file(project.files[0].path)
    elif len(project.files) == 1:
        file = project.files[0]
        blocks = extract_blocks(file.path)
        logical = Path(file.name)
        book = detect_structure(blocks, logical)
        stem = logical.stem.replace("_", " ").replace("-", " ").strip()
        stem = re.sub(r"^\d+\s*", "", stem).strip() or stem
        if not book.title or book.title.lower() in {"conteúdo", "content"}:
            book.title = stem
        if book.title.endswith((".", "!", "?")) and stem:
            book.title = stem
    else:
        chapters = []
        for index, file in enumerate(project.files, start=1):
            blocks = extract_blocks(file.path)
            number, title = _title_from_filename(Path(file.name))
            chapter = _chapter_from_blocks(
                blocks,
                number if number is not None else index,
                title,
            )
            chapters.append(chapter)

        raw = Path(project.files[0].name).stem.replace("_", " ").replace("-", " ").strip()
        book_title = re.sub(r"^\d+\s*", "", raw).strip() or "Manuscrito"
        book = Book(
            title=book_title,
            author="",
            chapters=chapters,
            source_path=str(project.work_dir),
            kind="book",
        )

    project.book = book
    apply_custom_title(project)
    return project.book


def apply_custom_title(project: ProjectState) -> Book | None:
    """Aplica o título manual ao livro ou ao capítulo, conforme o modo."""
    book = project.book
    if not book:
        return None

    title = (project.custom_title or "").strip()
    if not title:
        return book

    book.title = title

    if project.mode == "chapter" or book.is_chapter:
        chapter = book.primary_chapter
        if chapter is not None:
            chapter.title = title
            if chapter.kind == "prologue":
                chapter.full_label = _format_label("prologue", None, title)
            elif chapter.kind == "epilogue":
                chapter.full_label = _format_label("epilogue", None, title)
            elif chapter.kind == "chapter":
                chapter.full_label = _format_label("chapter", chapter.number, title)
            else:
                chapter.full_label = title

    return book


def set_custom_title(project: ProjectState, title: str | None) -> Book | None:
    """Define ou limpa o título manual e reaplica no livro atual."""
    clean = (title or "").strip()
    project.custom_title = clean or None

    if project.book is None:
        return None

    if project.custom_title:
        return apply_custom_title(project)

    # Sem título manual: reconstrói para recuperar o detectado
    if project.files:
        return rebuild_book(project)
    return project.book


def reorder_chapters(project: ProjectState, order: list[int]) -> Book:
    if not project.book:
        raise ValueError("Nenhum livro carregado.")
    chapters = project.book.chapters
    if sorted(order) != list(range(len(chapters))):
        raise ValueError("Ordem de capítulos inválida.")
    project.book.chapters = [chapters[i] for i in order]
    n = 1
    for chapter in project.book.chapters:
        if chapter.kind != "chapter":
            continue
        if chapter.number is not None:
            chapter.number = n
            n += 1
    return project.book


def move_chapter(project: ProjectState, index: int, direction: int) -> Book:
    if not project.book:
        raise ValueError("Nenhum livro carregado.")
    chapters = project.book.chapters
    target = index + direction
    if index < 0 or index >= len(chapters) or target < 0 or target >= len(chapters):
        return project.book
    chapters[index], chapters[target] = chapters[target], chapters[index]
    return reorder_chapters(project, list(range(len(chapters))))
