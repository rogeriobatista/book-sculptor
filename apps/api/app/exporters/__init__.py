from __future__ import annotations

from pathlib import Path

from app.exporters.docx_exporter import export_docx
from app.exporters.epub_exporter import export_epub
from app.exporters.pdf_exporter import export_pdf
from app.layout import LayoutSettings
from app.models import Book


def export_document(
    book: Book,
    output_path: str | Path,
    fmt: str = "docx",
    settings: LayoutSettings | None = None,
) -> Path:
    """Exporta capítulo ou livro no formato escolhido (docx, epub ou pdf)."""
    path = Path(output_path)
    fmt = fmt.lower().lstrip(".")
    settings = settings or LayoutSettings()

    if fmt == "docx":
        if path.suffix.lower() != ".docx":
            path = path.with_suffix(".docx")
        return export_docx(book, path, settings)
    if fmt == "epub":
        if path.suffix.lower() != ".epub":
            path = path.with_suffix(".epub")
        return export_epub(book, path, settings)
    if fmt == "pdf":
        if path.suffix.lower() != ".pdf":
            path = path.with_suffix(".pdf")
        return export_pdf(book, path, settings)

    raise ValueError(f"Formato de saída não suportado: {fmt}")


export_book = export_document
