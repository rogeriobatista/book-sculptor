from __future__ import annotations

from pathlib import Path

from app.exporters.docx_exporter import export_docx
from app.exporters.epub_exporter import export_epub
from app.models import Book


def export_document(book: Book, output_path: str | Path, fmt: str = "docx") -> Path:
    """Exporta capítulo ou livro no formato escolhido (docx ou epub)."""
    path = Path(output_path)
    fmt = fmt.lower().lstrip(".")

    if fmt == "docx":
        if path.suffix.lower() != ".docx":
            path = path.with_suffix(".docx")
        return export_docx(book, path)
    if fmt == "epub":
        if path.suffix.lower() != ".epub":
            path = path.with_suffix(".epub")
        return export_epub(book, path)

    raise ValueError(f"Formato de saída não suportado: {fmt}")


# Compatibilidade com imports antigos
export_book = export_document
