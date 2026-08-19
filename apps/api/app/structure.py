from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from app.dialogue import expand_paragraphs_with_dialogue, split_dialogue
from app.extractors.toc import TocEntry, apply_toc_to_candidates, extract_toc
from app.models import Book, Chapter, ChapterKind, Paragraph, TextBlock
from app.prose import coalesce_prose_fragments

# ——— Padrões de divisão (baseados na formatação tipográfica do manuscrito) ———

# Prefixo: captura o início mesmo quando o corpo veio colado na mesma linha
PROLOGUE_PREFIX = re.compile(
    r"^(?P<head>(?:prólogo|prologo|prologue|prefácio|prefacio|preface)"
    r"(?:\s*[.:\-–—]\s*)?)"
    r"(?P<rest>.*)$",
    re.IGNORECASE,
)

EPILOGUE_PREFIX = re.compile(
    r"^(?P<head>(?:epílogo|epilogo|epilogue|posfácio|posfacio|conclusão|conclusao)"
    r"(?:\s*[.:\-–—]\s*)?)"
    r"(?P<rest>.*)$",
    re.IGNORECASE,
)

CHAPTER_PREFIX = re.compile(
    # Full word forms, OR abbreviation "Cap." / "Cap " with separator before the number.
    # Never bare "cap" glued to letters — that matches "Capitão" as Cap + roman "i".
    r"^(?P<head>"
    r"(?:capítulo|capitulo|chapter)\s+"
    r"(?P<num>[0-9]+|[ivxlcdm]+)\s*"
    r"(?:[.:\-–—]\s*)?"
    r"|"
    r"cap\.\s*"
    r"(?P<num_dot>[0-9]+|[ivxlcdm]+)\s*"
    r"(?:[.:\-–—]\s*)?"
    r"|"
    r"cap\s+"
    r"(?P<num_sp>[0-9]+|[ivxlcdm]+)\s*"
    r"(?:[.:\-–—]\s*)?"
    r")"
    r"(?P<rest>.*)$",
    re.IGNORECASE,
)

# Words that start with "cap…" but are not chapter markers
_NOT_CHAPTER_START = re.compile(
    r"^(?:capitão|capitao|captain|capital|capítulo\s+de|capitulo\s+de)\b",
    re.IGNORECASE,
)

# Subdivisão ou divisão maior (Parte / Livro / Volume) — nível decidido depois
PART_PREFIX = re.compile(
    r"^(?P<head>(?:parte|part|seção|secao|section|livro|volume)\s+"
    r"(?P<num>[0-9]{1,2}|[ivxlcdm]{1,6})\s*"
    r"(?:[.:\-–—]\s*)?)"
    r"(?P<rest>.*)$",
    re.IGNORECASE,
)

INTRO_PREFIX = re.compile(
    r"^(?P<head>(?:introdução|introducao|introduction|dedicatória|dedicatoria|"
    r"agradecimentos|acknowledgements|acknowledgment)\s*"
    r"(?:[.:\-–—]\s*)?)"
    r"(?P<rest>.*)$",
    re.IGNORECASE,
)

# "1. Título" / "1 — Título" sem a palavra Capítulo
NUMBERED_TITLE_RE = re.compile(
    r"^([0-9]{1,3})\s*[.:\)\-–—]\s+(.+)$"
)

# Próxima divisão embutida — exige número após parte/seção para evitar "faz parte de"
NEXT_DIVISION_RE = re.compile(
    r"(?=\b(?:prólogo|prologo|prologue|prefácio|prefacio|"
    r"epílogo|epilogo|epilogue|posfácio|posfacio|"
    r"capítulo|capitulo|chapter|cap\.\s*\d|cap\s+\d|"
    r"(?:parte|part|seção|secao|section|livro|volume)\s+"
    r"(?:\d{1,2}|[ivxlcdm]{1,6})\b))",
    re.IGNORECASE,
)

_TITLE_PREP = {
    "a", "as", "o", "os", "um", "uma", "uns", "umas",
    "da", "das", "de", "do", "dos", "e", "em", "no", "na",
    "nos", "nas", "ao", "aos", "à", "às", "pelo", "pela",
    "the", "of", "and", "an",
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "del", "al", "y", "en", "por", "para", "con",
}

TITLE_CANDIDATE_MAX_WORDS = 14
TITLE_CANDIDATE_MAX_CHARS = 100

SUPPORTED_SUFFIXES = {".pdf", ".docx"}


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    # Normaliza travessões tipográficos
    text = text.replace("–", "—").replace("−", "—")
    # Remove hifens suaves / caracteres de largura zero que forçam quebras falsas
    text = text.replace("\u00ad", "").replace("\u200b", "").replace("\u200c", "")
    text = text.replace("\u200d", "").replace("\ufeff", "").replace("\u2060", "")
    text = re.sub(r"\s+", " ", text).strip()
    # "fim.Início" → "fim. Início" (comum em PDF colado)
    text = re.sub(
        r"([.!?…])([A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÄËÏÖÜ])",
        r"\1 \2",
        text,
    )
    return text


def _roman_to_int(value: str) -> int | None:
    roman = {
        "i": 1,
        "v": 5,
        "x": 10,
        "l": 50,
        "c": 100,
        "d": 500,
        "m": 1000,
    }
    s = value.lower()
    if not s or any(ch not in roman for ch in s):
        return None
    total = 0
    prev = 0
    for ch in reversed(s):
        n = roman[ch]
        if n < prev:
            total -= n
        else:
            total += n
            prev = n
    return total or None


def _parse_number(raw: str) -> int | None:
    if raw.isdigit():
        return int(raw)
    return _roman_to_int(raw)


def _split_title_and_body(rest: str) -> tuple[str, str]:
    """Separa título curto do corpo quando o PDF colou os dois na mesma linha.

    Ex.: "A Noite da Traição O Reino de Asterion conhecia a paz..."
         → ("A Noite da Traição", "O Reino de Asterion conhecia a paz...")
    """
    rest = rest.strip(" —-.")
    if not rest:
        return "", ""

    words = rest.split()
    if len(words) <= 1:
        return rest, ""

    sentence_starters = {"o", "a", "os", "as", "um", "uma", "ele", "ela", "eles", "elas"}

    def _strip_word(w: str) -> str:
        return w.strip(".,;:!?\"'“”‘’")

    # 1) Artigo maiúsculo + minúscula (ex.: "A Fuga O túnel tremia")
    #    Ignora "a/o" minúsculos no meio da frase ("conhecia a paz").
    for i in range(1, len(words) - 1):
        raw_article = _strip_word(words[i])
        token = raw_article.lower()
        nxt = _strip_word(words[i + 1])
        if (
            raw_article[:1].isupper()
            and token in sentence_starters
            and nxt
            and nxt[0].islower()
        ):
            title = " ".join(words[:i]).strip(" —-.")
            body = " ".join(words[i:]).strip()
            if title and len(title.split()) <= TITLE_CANDIDATE_MAX_WORDS:
                return title, body

    # 2) Artigo maiúsculo + Nome próprio + verbo minúsculo
    #    (ex.: "...Traição O Reino ... conhecia")
    for i in range(1, len(words) - 1):
        raw_article = _strip_word(words[i])
        token = raw_article.lower()
        nxt = _strip_word(words[i + 1])
        if (
            raw_article[:1].isupper()
            and token in sentence_starters
            and nxt
            and nxt[0].isupper()
        ):
            window = words[i : i + 12]
            has_verbish = any(
                _strip_word(w)[:1].islower()
                and _strip_word(w).lower() not in _TITLE_PREP
                and len(_strip_word(w)) > 2
                for w in window[2:]
            )
            if has_verbish:
                title = " ".join(words[:i]).strip(" —-.")
                body = " ".join(words[i:]).strip()
                if title and len(title.split()) <= TITLE_CANDIDATE_MAX_WORDS:
                    return title, body

    # 3) Pontuação forte cedo → título antes do ponto
    punct = re.search(r"[.!?]", rest)
    if punct and punct.start() <= 60:
        title = rest[: punct.start()].strip()
        body = rest[punct.end() :].strip()
        if 1 <= len(title.split()) <= TITLE_CANDIDATE_MAX_WORDS and body:
            return title, body

    # 4) Fallback só para blocos muito longos sem padrão claro
    if len(words) > 16:
        cut = 6
        return " ".join(words[:cut]).strip(" —-."), " ".join(words[cut:]).strip()

    return rest, ""


def _take_title_before_next_division(rest: str) -> tuple[str, str]:
    """Corta o resto antes da próxima palavra-chave de divisão."""
    rest = rest.strip()
    if not rest:
        return "", ""
    parts = NEXT_DIVISION_RE.split(rest, maxsplit=1)
    if len(parts) >= 2 and parts[0].strip():
        return parts[0].strip(), parts[1].strip()
    # split com lookahead pode devolver ['', 'Parte I...'] se rest começa com Parte
    if len(parts) == 2 and not parts[0].strip():
        return "", rest
    return rest, ""


def _format_label(kind: str, number: int | None, title: str, locale: str = "pt-BR") -> str:
    from app.i18n_labels import format_chapter_label, t

    if kind == "part":
        num = number
        base = t("part", locale)
        if num is not None and title:
            roman = _to_roman(num) if num <= 20 else str(num)
            return f"{base} {roman} — {title}"
        if num is not None:
            roman = _to_roman(num) if num <= 20 else str(num)
            return f"{base} {roman}"
        return title
    return format_chapter_label(kind, number, title, locale)


def _to_roman(n: int) -> str:
    values = [
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
        (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
        (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    ]
    out = []
    for value, numeral in values:
        while n >= value:
            out.append(numeral)
            n -= value
    return "".join(out) or "I"


def extract_leading_division(text: str) -> tuple[dict | None, str]:
    """Extrai uma divisão no início do texto e devolve o resto (corpo ou próxima divisão)."""
    clean = _normalize(text)
    if not clean:
        return None, ""

    if re.match(
        r"^(?:prólogo|prologo|prologue|prefácio|prefacio|preface)"
        r"(?:\s*[.:\-–—]|\s+(?=[A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÄËÏÖÜ])|$)",
        clean,
        re.I,
    ):
        match = PROLOGUE_PREFIX.match(clean)
        assert match is not None
        title_chunk, after = _take_title_before_next_division(match.group("rest"))
        title, body = _split_title_and_body(title_chunk)
        if not title:
            title = "Prólogo"
        remainder = " ".join(x for x in (body, after) if x).strip()
        info = {
            "kind": "prologue",
            "level": "major",
            "number": None,
            "title": title if title.lower() not in {"prólogo", "prologo"} else "Prólogo",
            "full_label": _format_label("prologue", None, title),
            "confidence": "high",
        }
        return info, remainder

    if re.match(
        r"^(?:epílogo|epilogo|epilogue|posfácio|posfacio|conclusão|conclusao)"
        r"(?:\s*[.:\-–—]|\s+(?=[A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÄËÏÖÜ])|$)",
        clean,
        re.I,
    ):
        match = EPILOGUE_PREFIX.match(clean)
        assert match is not None
        title_chunk, after = _take_title_before_next_division(match.group("rest"))
        title, body = _split_title_and_body(title_chunk)
        if not title:
            title = "Epílogo"
        remainder = " ".join(x for x in (body, after) if x).strip()
        info = {
            "kind": "epilogue",
            "level": "major",
            "number": None,
            "title": title if title.lower() not in {"epílogo", "epilogo"} else "Epílogo",
            "full_label": _format_label("epilogue", None, title),
            "confidence": "high",
        }
        return info, remainder

    match = CHAPTER_PREFIX.match(clean)
    if match and not _NOT_CHAPTER_START.match(clean):
        raw_num = match.group("num") or match.group("num_dot") or match.group("num_sp")
        number = _parse_number(raw_num) if raw_num else None
        title_chunk, after = _take_title_before_next_division(match.group("rest"))
        title, body = _split_title_and_body(title_chunk)
        # Mid-sentence leftovers (e.g. false "Cap"+"i"+"tão…") start lowercase
        if title and title[:1].islower():
            return None, clean
        if not title:
            title = f"Capítulo {number}" if number is not None else "Capítulo"
        # A whole long paragraph is not a chapter heading
        remainder = " ".join(x for x in (body, after) if x).strip()
        if not remainder and len(title.split()) > TITLE_CANDIDATE_MAX_WORDS:
            return None, clean
        info = {
            "kind": "chapter",
            "level": "major",
            "number": number,
            "title": title,
            "full_label": _format_label("chapter", number, title),
            "confidence": "high",
        }
        return info, remainder

    match = INTRO_PREFIX.match(clean)
    if match and len(clean.split()) <= TITLE_CANDIDATE_MAX_WORDS:
        title_chunk, after = _take_title_before_next_division(match.group("rest"))
        title, body = _split_title_and_body(title_chunk)
        head = match.group("head").strip(" .:–—-")
        head_low = head.lower()
        if not title:
            title = head[:1].upper() + head[1:] if head else "Introdução"
        remainder = " ".join(x for x in (body, after) if x).strip()
        if re.search(r"dedicat", head_low):
            kind = "dedication"
        else:
            kind = "other"
        info = {
            "kind": kind,
            "level": "major",
            "number": None,
            "title": title,
            "full_label": _format_label(kind, None, title) if kind == "dedication" else title,
            "confidence": "high",
        }
        return info, remainder

    match = PART_PREFIX.match(clean)
    if match:
        number = _parse_number(match.group("num"))
        # Ignora falsos positivos absurdo (ex.: ruído de PDF)
        if number is not None and (number < 1 or number > 40):
            return None, clean
        title_chunk, after = _take_title_before_next_division(match.group("rest"))
        title, body = _split_title_and_body(title_chunk)
        head_low = match.group("head").lower()
        # Livro/Volume quase sempre dividem o livro; Parte pode ser seção ou major
        is_book_unit = bool(re.search(r"\b(?:livro|volume)\b", head_low))
        if not title:
            if is_book_unit:
                title = f"Livro {_to_roman(number) if number else ''}".strip()
            else:
                title = f"Parte {number}" if number is not None else "Parte"
        remainder = " ".join(x for x in (body, after) if x).strip()
        info = {
            "kind": "part",
            "level": "major" if is_book_unit else "section",
            "number": number,
            "title": title,
            "full_label": _format_label("part", number, title),
            "confidence": "medium" if is_book_unit else "low",
        }
        return info, remainder

    match = NUMBERED_TITLE_RE.match(clean)
    if match and len(clean.split()) <= TITLE_CANDIDATE_MAX_WORDS:
        return {
            "kind": "chapter",
            "level": "major",
            "number": int(match.group(1)),
            "title": match.group(2).strip(),
            "full_label": clean,
            "confidence": "medium",
        }, ""

    return None, clean


def classify_division(text: str) -> dict | None:
    """Classifica um bloco como prólogo, capítulo, parte, epílogo ou None."""
    info, remainder = extract_leading_division(text)
    if not info:
        return None
    # Só classifica o bloco inteiro se for (quase) só o título —
    # senão expand_blocks deve separar corpo/partes.
    if remainder and len(remainder.split()) > 3:
        # Ainda assim devolve info para quem só precisa do tipo; full_label já limpo
        return info
    return info


def expand_blocks(blocks: list[TextBlock]) -> list[TextBlock]:
    """Expande blocos onde título + parte + corpo vieram colados numa linha."""
    expanded: list[TextBlock] = []
    last_chapter_key: tuple[int | None, str] | None = None

    for block in blocks:
        remaining = _normalize(block.text)
        if not remaining:
            continue
        peeled_any = False
        while remaining:
            info, remaining = extract_leading_division(remaining)
            if info is None:
                expanded.append(
                    TextBlock(
                        text=remaining,
                        style_name="Normal",
                        bold=False,
                        font_size_pt=None,
                        align=block.align if not peeled_any else "left",
                    )
                )
                break

            peeled_any = True

            # Capítulos repetidos (comum em PDF já diagramado) → só aproveita a Parte
            if info["kind"] == "chapter":
                key = (info.get("number"), (info.get("title") or "").lower())
                if last_chapter_key == key:
                    continue
                last_chapter_key = key

            expanded.append(
                TextBlock(
                    text=info["full_label"],
                    style_name="Heading 1" if info["level"] == "major" else "Heading 2",
                    bold=True,
                    font_size_pt=16 if info["level"] == "major" else 13,
                    align="center" if info["level"] == "major" else "left",
                )
            )
    return expanded


def _formatting_suggests_heading(block: TextBlock) -> bool:
    """Usa tipografia do Word (estilo, negrito, tamanho) como sinal de divisão."""
    text = _normalize(block.text)
    if not text or len(text) > TITLE_CANDIDATE_MAX_CHARS:
        return False
    words = text.split()
    if len(words) > TITLE_CANDIDATE_MAX_WORDS:
        return False

    # Estilos Heading do Word são o sinal mais confiável
    if block.heading_level is not None:
        return True

    if text.endswith((".", "!", "?", ";", ",")):
        return False

    # Centro + destaque tipográfico
    if block.align == "center" and (block.bold or (block.font_size_pt or 0) >= 13):
        if len(words) <= 12:
            return True

    # Negrito grande (títulos de capítulo em DOCX sem estilo Heading)
    if block.bold and (block.font_size_pt or 0) >= 13 and len(words) <= 10:
        return True

    if (block.font_size_pt or 0) >= 16 and len(words) <= 10:
        return True

    return False


def _looks_like_heading(block: TextBlock | str) -> bool:
    if isinstance(block, str):
        block = TextBlock(text=block)
    text = _normalize(block.text)
    if not text:
        return False

    classified = classify_division(text)
    if classified:
        return True

    if _formatting_suggests_heading(block):
        # Evita frases longas em negrito
        if text.endswith((".", "!", "?")) and len(text.split()) > 4:
            return False
        return True

    return False


def _guess_title(blocks: list[TextBlock], source_path: Path) -> str:
    fallback = source_path.stem.replace("_", " ").replace("-", " ").strip()
    fallback = re.sub(r"^\d+\s*", "", fallback).strip() or fallback
    fallback = fallback.title() if fallback.islower() else fallback

    for block in blocks[:10]:
        clean = _normalize(block.text)
        # Remove número de página residual do PDF
        clean = re.sub(r"^\d{1,4}\s+", "", clean).strip()
        if not clean or clean.lower() in {"sumário", "sumario", "contents", "índice", "indice"}:
            continue
        if classify_division(clean):
            continue
        words = clean.split()
        if not (1 <= len(words) <= TITLE_CANDIDATE_MAX_WORDS and len(clean) <= TITLE_CANDIDATE_MAX_CHARS):
            continue
        if clean.lower().startswith(("por ", "by ", "autor", "author")):
            continue
        if clean.endswith((".", "!", "?", ";", ",")):
            continue
        # Prefere títulos tipograficamente destacados
        if block.bold or block.is_word_heading or (block.font_size_pt or 0) >= 14:
            return clean.title() if clean.isupper() else clean
        return clean.title() if clean.isupper() else clean
    return fallback


def _guess_author(blocks: list[TextBlock]) -> str:
    author_re = re.compile(
        r"^(?:por|by|autor(?:a)?|author)\s*[:\-–—]?\s*(.+)$",
        re.IGNORECASE,
    )
    for block in blocks[:12]:
        clean = _normalize(block.text)
        match = author_re.match(clean)
        if match:
            return match.group(1).strip()
    return ""


def _is_author_line(text: str, author: str) -> bool:
    clean = text.lower().strip()
    if author and clean == author.lower():
        return True
    return bool(
        re.match(
            r"^(?:por|by|autor(?:a)?|author)\s*[:\-–—]?\s*.+$",
            clean,
            re.IGNORECASE,
        )
    )


def _to_blocks(raw: list[str] | list[TextBlock]) -> list[TextBlock]:
    if not raw:
        return []
    if isinstance(raw[0], TextBlock):
        return [b for b in raw if _normalize(b.text)]  # type: ignore[union-attr]
    return [TextBlock(text=_normalize(t)) for t in raw if _normalize(str(t))]  # type: ignore[arg-type]


def _context_snippet(items: list[TextBlock], index: int, *, before: bool) -> str:
    if before:
        span = items[max(0, index - 2) : index]
    else:
        span = items[index + 1 : index + 3]
    return " ".join(_normalize(b.text) for b in span if _normalize(b.text))[:180]


def _looks_like_title_only_heading(block: TextBlock, clean: str) -> bool:
    """Short Title Case / centered lines that often mark PT chapter titles without 'Capítulo'."""
    if not clean or len(clean) > TITLE_CANDIDATE_MAX_CHARS:
        return False
    words = clean.split()
    if not (2 <= len(words) <= 10):
        return False
    if clean.endswith((".", "!", "?", ";", ",", ":")):
        return False
    # Dialogue / interruptions: — Nome — / - Nome
    if clean.startswith(("—", "–", "-")) or clean.endswith(("—", "–", "-")):
        return False
    if clean.count("—") + clean.count("–") >= 1 and len(words) <= 4:
        return False
    if clean.lower() in {
        "sumário",
        "sumario",
        "contents",
        "índice",
        "indice",
        "índice remissivo",
        "fim",
        "fim.",
        "the end",
        "fin",
    }:
        return False
    if classify_division(clean):
        return False

    # Prefer typographic evidence for title-only chapters
    typographic = (
        _formatting_suggests_heading(block)
        or block.align == "center"
        or (block.bold and (block.font_size_pt or 0) >= 12)
        or (block.font_size_pt or 0) >= 14
    )
    if not typographic:
        return False

    caps = sum(1 for w in words if w[:1].isupper())
    titleish = caps >= max(1, len(words) - 1) or clean.isupper()
    return bool(titleish)


def _collect_heading_candidates(
    items: list[TextBlock],
    *,
    book_title: str,
) -> list[dict]:
    candidates: list[dict] = []
    for i, block in enumerate(items):
        clean = _normalize(block.text)
        if not clean:
            continue
        if book_title and clean.lower() == book_title.lower():
            continue

        classified = classify_division(clean)
        if classified:
            candidates.append(
                {
                    "index": i,
                    "text": clean,
                    "heuristic_kind": classified["kind"],
                    "kind": classified["kind"],
                    "level": classified["level"],
                    "number": classified.get("number"),
                    "title": classified.get("title") or clean,
                    "full_label": classified.get("full_label") or clean,
                    "confidence": classified.get("confidence") or "medium",
                    "context_before": _context_snippet(items, i, before=True),
                    "context_after": _context_snippet(items, i, before=False),
                }
            )
            continue

        if _formatting_suggests_heading(block) and not clean.endswith((".", "!", "?")):
            # Early title page: leave for book title unless later majors exist
            level = block.heading_level or (1 if (block.font_size_pt or 0) >= 16 else 2)
            as_section = level >= 2 or (block.font_size_pt or 0) < 15
            candidates.append(
                {
                    "index": i,
                    "text": clean,
                    "heuristic_kind": "part" if as_section else "other",
                    "kind": "part" if as_section else "other",
                    "level": "section" if as_section else "major",
                    "number": None,
                    "title": clean,
                    "full_label": clean,
                    "confidence": "low",
                    "early_title_page": i < 8,
                    "context_before": _context_snippet(items, i, before=True),
                    "context_after": _context_snippet(items, i, before=False),
                }
            )
            continue

        if _looks_like_title_only_heading(block, clean):
            candidates.append(
                {
                    "index": i,
                    "text": clean,
                    "heuristic_kind": "other",
                    "kind": "chapter",
                    "level": "major",
                    "number": None,
                    "title": clean,
                    "full_label": clean,
                    "confidence": "low",
                    "early_title_page": i < 8,
                    "context_before": _context_snippet(items, i, before=True),
                    "context_after": _context_snippet(items, i, before=False),
                }
            )
    return candidates


def _apply_heading_candidates(
    candidates: list[dict],
) -> tuple[list[int], set[int], dict[int, dict]]:
    major_indices: list[int] = []
    section_indices: set[int] = set()
    classifications: dict[int, dict] = {}

    # Drop early title-page low-confidence hits until a confident major appears
    first_confident_major = next(
        (
            c["index"]
            for c in candidates
            if c.get("level") == "major"
            and c.get("kind") != "skip"
            and c.get("confidence") == "high"
            and not c.get("early_title_page")
        ),
        None,
    )

    for c in candidates:
        kind = c.get("kind") or "other"
        if kind == "skip":
            continue
        if c.get("early_title_page") and c.get("confidence") != "high":
            if first_confident_major is None or c["index"] < first_confident_major:
                # Keep only if AI promoted it to a real structural kind with refine
                if not c.get("ai_refined"):
                    continue
                if kind not in {"prologue", "chapter", "epilogue", "part", "other"}:
                    continue

        level = c.get("level") or "major"
        title = (c.get("title") or c.get("text") or "").strip()
        number = c.get("number")
        label_kind = (
            kind
            if kind
            in {
                "dedication",
                "prologue",
                "epilogue",
                "afterword",
                "appendix",
                "chapter",
                "part",
            }
            else "chapter"
        )
        info = {
            "kind": kind,
            "level": level,
            "number": number,
            "title": title,
            "full_label": c.get("full_label")
            or _format_label(label_kind, number, title),
        }

        # Part as internal section (default) vs book-level unit (major → other chapter)
        if kind == "part" and level != "major":
            info["level"] = "section"
            section_indices.add(c["index"])
            classifications[c["index"]] = info
            continue

        if kind == "part":
            info["kind"] = "other"
            info["level"] = "major"
            info["full_label"] = title

        if level == "section":
            info["kind"] = "part"
            info["level"] = "section"
            section_indices.add(c["index"])
            classifications[c["index"]] = info
            continue

        major_indices.append(c["index"])
        classifications[c["index"]] = info

    major_indices = sorted(set(major_indices))
    return major_indices, section_indices, classifications


def detect_structure(
    blocks: list[str] | list[TextBlock],
    source_path: str | Path,
    *,
    refine_headings=None,
    source_file: str | Path | None = None,
    toc_entries: list[TocEntry] | None = None,
) -> Book:
    """Analisa blocos (com ou sem formatação) e monta a estrutura do livro.

    Reconhece:
    - Prólogo / Prefácio
    - Capítulos (`Capítulo N — Título`) e títulos literários isolados
    - Partes (seção interna ou divisão maior do livro)
    - Epílogo / Posfácio
    Também usa negrito, tamanho de fonte e estilos Heading do Word.

    Quando disponível, o **sumário** do DOCX/PDF (estilos TOC, bookmarks,
    outline de Heading, ou bloco textual “Sumário/Índice”) orienta o nível
    das partes (seção interna vs divisão maior do livro).

    ``refine_headings`` (opcional): callable(candidates) -> candidates refined by AI.
    ``source_file``: caminho real do arquivo (para TOC); ``source_path`` pode ser só o nome lógico.
    """
    path = Path(source_path)
    items = expand_blocks(_to_blocks(blocks))
    title = _guess_title(items, path)
    author = _guess_author(items)

    toc = toc_entries
    if toc is None:
        file_for_toc = Path(source_file) if source_file else path
        if file_for_toc.exists() and file_for_toc.suffix.lower() in SUPPORTED_SUFFIXES:
            try:
                toc = extract_toc(file_for_toc, items)
            except Exception:  # noqa: BLE001
                toc = []
        else:
            from app.extractors.toc import extract_inline_toc

            try:
                toc = extract_inline_toc(items)
            except Exception:  # noqa: BLE001
                toc = []

    candidates = _collect_heading_candidates(items, book_title=title)
    if toc:
        candidates = apply_toc_to_candidates(candidates, toc)

    if refine_headings and candidates:
        try:
            # Prefer callables that accept optional toc context
            try:
                candidates = refine_headings(candidates, toc=toc) or candidates
            except TypeError:
                candidates = refine_headings(candidates) or candidates
        except Exception:  # noqa: BLE001 — never fail import because AI refine failed
            pass

    major_indices, section_indices, classifications = _apply_heading_candidates(
        candidates
    )

    def _keep_body(text: str) -> bool:
        return text.lower() != title.lower() and not _is_author_line(text, author)

    chapters: list[Chapter] = []

    if not major_indices:
        # Sem capítulos explícitos: tenta só prólogo/partes ou um bloco único
        body: list[Paragraph] = []
        for i, block in enumerate(items):
            text = _normalize(block.text)
            if not _keep_body(text):
                continue
            if i in section_indices:
                body.append(Paragraph(text=classifications[i]["full_label"], style="section"))
            else:
                body.extend(split_dialogue(text))
        body = coalesce_prose_fragments(expand_paragraphs_with_dialogue(body))
        # Sem divisões detectadas: corpo do livro sem título artificial no topo
        chapters.append(
            Chapter(title="", paragraphs=body, number=None, kind="other", full_label="")
        )
        return Book(title=title, author=author, chapters=chapters, source_path=str(path), kind="book")

    # Texto antes da primeira divisão maior
    first = major_indices[0]
    preface: list[Paragraph] = []
    for i, block in enumerate(items[:first]):
        text = _normalize(block.text)
        if not _keep_body(text):
            continue
        if i in section_indices:
            preface.append(Paragraph(text=classifications[i]["full_label"], style="section"))
        else:
            preface.extend(split_dialogue(text))
    if preface and classifications[first]["kind"] != "prologue":
        chapters.append(
            Chapter(
                title="Introdução",
                paragraphs=coalesce_prose_fragments(expand_paragraphs_with_dialogue(preface)),
                number=None,
                kind="other",
            )
        )

    for idx, start in enumerate(major_indices):
        end = major_indices[idx + 1] if idx + 1 < len(major_indices) else len(items)
        info = classifications[start]
        body: list[Paragraph] = []

        for i in range(start + 1, end):
            text = _normalize(items[i].text)
            if not text:
                continue
            if i in section_indices:
                body.append(Paragraph(text=classifications[i]["full_label"], style="section"))
            else:
                body.extend(split_dialogue(text))

        kind: ChapterKind
        if info["kind"] in {
            "dedication",
            "prologue",
            "epilogue",
            "afterword",
            "appendix",
            "chapter",
        }:
            kind = info["kind"]  # type: ignore[assignment]
        else:
            kind = "other"

        chapters.append(
            Chapter(
                title=info["title"],
                paragraphs=coalesce_prose_fragments(expand_paragraphs_with_dialogue(body)),
                number=info["number"],
                kind=kind,
                full_label=info["full_label"],
            )
        )

    # Numera capítulos "chapter" sem número
    counter = 1
    for chapter in chapters:
        if chapter.kind != "chapter":
            continue
        if chapter.number is None:
            chapter.number = counter
        counter = max(counter, (chapter.number or 0) + 1)

    return Book(title=title, author=author, chapters=chapters, source_path=str(path), kind="book")



def _natural_sort_key(path: Path) -> tuple:
    parts = re.split(r"(\d+)", path.stem.lower())
    key: list = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return tuple(key)


def _title_from_filename(path: Path) -> tuple[int | None, str]:
    raw = path.stem.replace("_", " ").replace("-", " ").strip()
    raw = re.sub(r"\s+", " ", raw)
    info = classify_division(raw)
    if info and info["level"] == "major":
        return info["number"], info["title"]

    prefix = re.match(r"^(\d+)\s*(.*)$", raw)
    if prefix:
        num = int(prefix.group(1))
        rest = prefix.group(2).strip(" .-–—:")
        return num, rest if rest else f"Capítulo {num}"

    return None, raw.title() if raw.islower() else raw


def list_chapter_files(folder: str | Path) -> list[Path]:
    path = Path(folder)
    if not path.is_dir():
        raise ValueError(f"Pasta não encontrada: {path}")

    files = [
        f
        for f in path.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_SUFFIXES
    ]
    files.sort(key=_natural_sort_key)
    return files


def _parse_body_with_sections(blocks: list[TextBlock]) -> list[Paragraph]:
    """Converte blocos em parágrafos, marcando Partes como seções."""
    paragraphs: list[Paragraph] = []
    for block in expand_blocks(blocks):
        text = _normalize(block.text)
        if not text:
            continue
        info = classify_division(text)
        if info and info["level"] == "section":
            paragraphs.append(Paragraph(text=info["full_label"], style="section"))
        elif _formatting_suggests_heading(block) and (block.heading_level or 2) >= 2:
            if info is None and not text.endswith((".", "!", "?")):
                paragraphs.append(Paragraph(text=text, style="section"))
            else:
                paragraphs.extend(split_dialogue(text))
        else:
            paragraphs.extend(split_dialogue(text))
    return coalesce_prose_fragments(expand_paragraphs_with_dialogue(paragraphs))


def _chapter_from_blocks(
    blocks: list[str] | list[TextBlock],
    number: int | None,
    chapter_title: str,
) -> Chapter:
    """Monta um capítulo a partir de blocos — detecta Partes internas."""
    items = expand_blocks(_to_blocks(blocks))
    kind: ChapterKind = "chapter"
    full_label = ""

    if items:
        first_info = classify_division(_normalize(items[0].text))
        if first_info and first_info["level"] == "major":
            if first_info["number"] is not None:
                number = first_info["number"]
            chapter_title = first_info["title"] or chapter_title
            full_label = first_info["full_label"]
            if first_info["kind"] in {
                "dedication",
                "prologue",
                "epilogue",
                "afterword",
                "appendix",
                "chapter",
            }:
                kind = first_info["kind"]  # type: ignore[assignment]
            items = items[1:]
        elif _normalize(items[0].text).lower() == chapter_title.lower():
            items = items[1:]

    return Chapter(
        title=chapter_title,
        paragraphs=_parse_body_with_sections(items),
        number=number,
        kind=kind,
        full_label=full_label,
    )


def build_chapter_from_file(file_path: str | Path) -> Book:
    """Trata um arquivo isolado como conteúdo de um único capítulo."""
    from app.extractors import extract_blocks

    path = Path(file_path)
    blocks = extract_blocks(path)
    # Se o arquivo contém várias divisões maiores, usa detecção completa
    majors = [
        b
        for b in blocks
        if (info := classify_division(_normalize(b.text))) and info["level"] == "major"
    ]
    if len(majors) > 1:
        book = detect_structure(blocks, path)
        book.kind = "chapter"
        return book

    number, chapter_title = _title_from_filename(path)
    chapter = _chapter_from_blocks(blocks, number, chapter_title)
    return Book(
        title=chapter.title,
        author="",
        chapters=[chapter],
        source_path=str(path),
        kind="chapter",
    )


def build_book_from_folder(folder: str | Path) -> Book:
    """Monta um livro onde cada arquivo da pasta é um capítulo."""
    from app.extractors import extract_blocks

    path = Path(folder)
    files = list_chapter_files(path)
    if not files:
        raise ValueError(
            "Nenhum arquivo PDF ou Word (.docx) encontrado nesta pasta."
        )

    book_title = path.name.replace("_", " ").replace("-", " ").strip().title()
    chapters: list[Chapter] = []

    for index, file_path in enumerate(files, start=1):
        blocks = extract_blocks(file_path)
        number, chapter_title = _title_from_filename(file_path)
        chapter = _chapter_from_blocks(
            blocks,
            number if number is not None else index,
            chapter_title,
        )
        chapters.append(chapter)

    return Book(
        title=book_title,
        author="",
        chapters=chapters,
        source_path=str(path),
        kind="book",
    )


# Compatibilidade com imports antigos
def _parse_chapter_title(text: str) -> tuple[int | None, str]:
    info = classify_division(text)
    if info and info["level"] == "major":
        return info["number"], info["title"]
    return None, _normalize(text)
