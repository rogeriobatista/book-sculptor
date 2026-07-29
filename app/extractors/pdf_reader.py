from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader


def extract_pdf(path: Path) -> tuple[str, list[str]]:
    """Extrai texto de um PDF, página a página."""
    reader = PdfReader(str(path))
    blocks: list[str] = []

    for page in reader.pages:
        text = page.extract_text() or ""
        # Quebra por linhas e agrupa em parágrafos
        lines = [line.strip() for line in text.splitlines()]
        paragraph_lines: list[str] = []

        for line in lines:
            if not line:
                if paragraph_lines:
                    blocks.append(" ".join(paragraph_lines))
                    paragraph_lines = []
                continue
            paragraph_lines.append(line)

        if paragraph_lines:
            blocks.append(" ".join(paragraph_lines))

    # Remove blocos vazios / só espaços
    blocks = [b.strip() for b in blocks if b and b.strip()]
    full_text = "\n\n".join(blocks)
    return full_text, blocks
