from __future__ import annotations

from pathlib import Path

from docx import Document


def extract_docx(path: Path) -> tuple[str, list[str]]:
    """Extrai texto de um arquivo Word (.docx)."""
    document = Document(str(path))
    blocks: list[str] = []

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            blocks.append(text)

    # Também captura texto de tabelas (como parágrafos)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                blocks.append(" | ".join(cells))

    full_text = "\n\n".join(blocks)
    return full_text, blocks
