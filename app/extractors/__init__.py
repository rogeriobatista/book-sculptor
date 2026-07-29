from __future__ import annotations

from pathlib import Path

from app.extractors.docx_reader import extract_docx
from app.extractors.pdf_reader import extract_pdf


def extract_text(file_path: str | Path) -> tuple[str, list[str]]:
    """Extrai texto bruto e blocos de um PDF ou Word.

    Returns:
        (texto_completo, lista_de_blocos/parágrafos)
    """
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
