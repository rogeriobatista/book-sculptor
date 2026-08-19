from __future__ import annotations

from app.models import Paragraph


def _word_count(text: str) -> int:
    return len(text.split())


def _is_fragment(text: str) -> bool:
    """Parágrafo curto demais para ser prosa autônoma (lixo de PDF/Word quebrado)."""
    words = text.split()
    if not words:
        return True
    if len(words) <= 4:
        return True
    # Continuação típica de linha partida
    if len(words) <= 8 and text[:1].islower():
        return True
    return False


def _ends_sentence(text: str) -> bool:
    stripped = text.rstrip()
    if not stripped:
        return False
    return stripped.endswith((".", "!", "?", "…", "»", "\"", "”"))


def coalesce_prose_fragments(paragraphs: list[Paragraph]) -> list[Paragraph]:
    """Fundir parágrafos fragmentados palavra-a-palavra em prosa contínua.

    Manuscritos vindos de PDF/Word mal quebrados chegam com um parágrafo por
    palavra/linha curta. Sem esta etapa, a exportação gera coluna estreita.
    """
    if not paragraphs:
        return []

    out: list[Paragraph] = []
    for para in paragraphs:
        if para.style != "body" or not out:
            out.append(Paragraph(text=para.text, style=para.style))
            continue

        prev = out[-1]
        if prev.style != "body":
            out.append(Paragraph(text=para.text, style=para.style))
            continue

        cur_frag = _is_fragment(para.text)
        prev_frag = _is_fragment(prev.text)
        starts_lower = bool(para.text) and para.text[0].islower()

        # Nova sentença completa após ponto → manter separado
        if (
            _ends_sentence(prev.text)
            and not starts_lower
            and not cur_frag
            and _word_count(para.text) >= 6
        ):
            out.append(Paragraph(text=para.text, style="body"))
            continue

        should_merge = (
            cur_frag
            or prev_frag
            or starts_lower
            or (not _ends_sentence(prev.text) and _word_count(para.text) <= 14)
        )

        if should_merge:
            merged = f"{prev.text.rstrip()} {para.text.lstrip()}".strip()
            out[-1] = Paragraph(text=merged, style="body")
        else:
            out.append(Paragraph(text=para.text, style="body"))

    return out
