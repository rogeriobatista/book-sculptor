from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader

from app.models import TextBlock

# Linhas curtas que parecem títulos de divisão
_HEADING_START = (
    "prólogo",
    "prologo",
    "epílogo",
    "epilogo",
    "prefácio",
    "prefacio",
    "capítulo",
    "capitulo",
    "chapter",
    "parte",
    "part",
)

_INCOMPLETE_TAIL = {
    "a", "as", "o", "os", "um", "uma", "de", "da", "do", "das", "dos",
    "e", "em", "no", "na", "ao", "à", "the", "of", "and",
}


def _starts_with_division(line: str) -> bool:
    lower = " ".join(line.split()).strip().lower()
    return any(lower.startswith(h) for h in _HEADING_START)


def _looks_like_heading_line(line: str) -> bool:
    clean = " ".join(line.split()).strip()
    if not clean or len(clean) > 110:
        return False
    if _starts_with_division(clean):
        return True
    words = clean.split()
    if len(words) <= 10 and not clean.endswith((".", ";", ",")):
        letters = [c for c in clean if c.isalpha()]
        if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.55:
            return True
    return False


def _heading_incomplete(text: str) -> bool:
    """Título cortado no fim da linha do PDF (ex.: '... A Fuga O')."""
    words = text.split()
    if not words:
        return True
    if text.rstrip().endswith(("—", "-", ":", "–")):
        return True
    last = words[-1].strip(".,;:!?\"'“”‘’—-")
    if not last:
        return True
    if last.lower() in _INCOMPLETE_TAIL or len(last) <= 2:
        return True
    # Título muito curto após o travessão
    if "—" in text or " - " in text or ":" in text:
        after = text.split("—")[-1] if "—" in text else text.split(":")[-1]
        if len(after.split()) <= 1:
            return True
    return False


def _looks_like_body_line(line: str) -> bool:
    clean = line.strip()
    if not clean:
        return False
    words = clean.split()
    if len(words) >= 14:
        return True
    if clean.endswith((".", "!", "?")) and len(words) >= 6:
        return True
    # Continuação minúscula típica de quebra de linha
    first = words[0].strip("„\"'“”")
    if first and first[0].islower() and not _starts_with_division(clean):
        return True
    return False


def extract_pdf_blocks(path: Path) -> list[TextBlock]:
    """Extrai blocos de PDF separando melhor títulos de capítulos/partes."""
    reader = PdfReader(str(path))
    blocks: list[TextBlock] = []

    for page in reader.pages:
        text = page.extract_text() or ""
        # Remove números de página isolados no topo/rodapé
        lines = []
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                lines.append("")
                continue
            if line.isdigit() and len(line) <= 4:
                continue
            lines.append(line)

        paragraph_lines: list[str] = []
        collecting_heading = False

        def flush() -> None:
            nonlocal paragraph_lines, collecting_heading
            if paragraph_lines:
                joined = " ".join(paragraph_lines)
                if collecting_heading or _starts_with_division(joined):
                    blocks.append(
                        TextBlock(text=joined, bold=True, font_size_pt=14, align="center")
                    )
                else:
                    blocks.append(TextBlock(text=joined))
                paragraph_lines = []
            collecting_heading = False

        for line in lines:
            if not line:
                # Linha em branco: só quebra parágrafo se o bloco atual já parece completo
                if paragraph_lines:
                    joined = " ".join(paragraph_lines)
                    words = joined.split()
                    last = words[-1] if words else ""
                    complete = joined.endswith((".", "!", "?", "…", ":", "»", "\""))
                    # Fragmentos curtos (palavra/linha) continuam no mesmo parágrafo
                    if complete and len(words) >= 8:
                        flush()
                    elif collecting_heading and not _heading_incomplete(joined):
                        flush()
                continue

            if _starts_with_division(line) and not collecting_heading:
                flush()
                paragraph_lines = [line]
                collecting_heading = True
                if not _heading_incomplete(line) and len(line.split()) >= 4:
                    # Título aparentemente completo sozinho
                    flush()
                continue

            if collecting_heading:
                # Junta continuação do título quebrado pelo PDF
                if not _looks_like_body_line(line) or _heading_incomplete(" ".join(paragraph_lines)):
                    paragraph_lines.append(line)
                    joined = " ".join(paragraph_lines)
                    # Se já há corpo colado após título completo, encerra o heading
                    if len(joined.split()) > 22 or (
                        not _heading_incomplete(joined)
                        and _looks_like_body_line(line)
                        and len(paragraph_lines) > 1
                    ):
                        flush()
                    continue
                flush()
                # linha atual é corpo
                paragraph_lines = [line]
                continue

            if _looks_like_heading_line(line) and not _looks_like_body_line(line):
                flush()
                paragraph_lines = [line]
                collecting_heading = True
                continue

            paragraph_lines.append(line)

        flush()

    return [b for b in blocks if b.text.strip()]


def extract_pdf(path: Path) -> tuple[str, list[str]]:
    blocks = extract_pdf_blocks(path)
    texts = [b.text for b in blocks]
    return "\n\n".join(texts), texts
