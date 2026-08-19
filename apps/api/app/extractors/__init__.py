from __future__ import annotations

from pathlib import Path

from app.extractors.docx_reader import extract_docx, extract_docx_blocks
from app.extractors.pdf_reader import extract_pdf, extract_pdf_blocks
from app.extractors.toc import TocEntry, extract_toc
from app.models import TextBlock

__all__ = [
    "TocEntry",
    "extract_blocks",
    "extract_text",
    "extract_toc",
]


def extract_text(file_path: str | Path) -> tuple[str, list[str]]:
    """Extrai texto bruto e blocos de um PDF ou Word."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix in {".docx", ".doc"}:
        if suffix == ".doc":
            raise ValueError(
                "Arquivos .doc antigos não são suportados. "
                "Abra no Word e salve como .docx."
            )
        return extract_docx(path)

    raise ValueError(
        f"Formato não suportado: {suffix}. Use PDF (.pdf) ou Word (.docx)."
    )


def extract_blocks(file_path: str | Path) -> list[TextBlock]:
    """Extrai blocos com metadados tipográficos quando disponíveis."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return extract_pdf_blocks(path)
    if suffix == ".docx":
        return extract_docx_blocks(path)
    if suffix == ".doc":
        raise ValueError(
            "Arquivos .doc antigos não são suportados. "
            "Abra no Word e salve como .docx."
        )
    raise ValueError(
        f"Formato não suportado: {suffix}. Use PDF (.pdf) ou Word (.docx)."
    )
