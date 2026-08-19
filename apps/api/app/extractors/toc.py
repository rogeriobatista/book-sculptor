"""Extract table-of-contents / sumário outlines from DOCX and PDF."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from app.models import TextBlock


@dataclass
class TocEntry:
    """One sumário / outline entry."""

    title: str
    level: int = 1  # 1 = top-level (chapter/prologue), 2+ = part/section
    kind: str | None = None  # prologue|chapter|epilogue|part|other
    number: int | None = None
    source: str = "unknown"  # docx-toc|pdf-outline|inline|heading


_TOC_STYLE = re.compile(
    r"^(?:toc\s*\d+|sumário\s*\d+|sumario\s*\d+|tm\s*\d+|table of contents)",
    re.I,
)
_TOC_HEADING = re.compile(
    r"^(?:sumário|sumario|índice|indice|contents|table of contents|"
    r"índice remissivo|indice remissivo)\s*$",
    re.I,
)
_PAGE_TRAIL = re.compile(r"[\s\.…·•]+(\d{1,4})\s*$")
_DOT_LEADER = re.compile(r"\.{2,}|…+|·{2,}")


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("–", "—").replace("−", "—")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _roman_to_int(value: str) -> int | None:
    roman = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
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


def _classify_toc_title(title: str) -> tuple[str | None, int | None]:
    clean = _normalize(title)
    low = clean.lower()
    if re.match(r"^(?:prólogo|prologo|prologue|prefácio|prefacio)\b", low):
        return "prologue", None
    if re.match(
        r"^(?:epílogo|epilogo|epilogue|posfácio|posfacio|conclusão|conclusao)\b",
        low,
    ):
        return "epilogue", None
    m = re.match(
        r"^(?:capítulo|capitulo|chapter)\s+([0-9]+|[ivxlcdm]+)\b|"
        r"^cap\.\s*([0-9]+|[ivxlcdm]+)\b|"
        r"^cap\s+([0-9]+|[ivxlcdm]+)\b",
        low,
    )
    if m:
        raw = next((g for g in m.groups() if g), None)
        return "chapter", _parse_number(raw) if raw else None
    m = re.match(
        r"^(?:parte|part|seção|secao|section|livro|volume)\s+"
        r"([0-9]{1,2}|[ivxlcdm]{1,6})\b",
        low,
    )
    if m:
        return "part", _parse_number(m.group(1))
    return None, None


def _clean_toc_line(text: str) -> str:
    clean = _normalize(text)
    clean = _PAGE_TRAIL.sub("", clean)
    clean = _DOT_LEADER.sub(" ", clean)
    clean = re.sub(r"\s+", " ", clean).strip(" -—\t")
    return clean


def _entry_from_title(title: str, *, level: int, source: str) -> TocEntry | None:
    title = _clean_toc_line(title)
    if not title or len(title) > 140:
        return None
    if _TOC_HEADING.match(title):
        return None
    # Sumário entries are short; long glued prose is not a TOC line
    if len(title.split()) > 16:
        # Keep only the structural prefix when present
        m = re.match(
            r"^((?:prólogo|prologo|prologue|prefácio|prefacio|"
            r"epílogo|epilogo|epilogue|posfácio|posfacio|"
            r"capítulo|capitulo|chapter|cap\.\s*[0-9]+|cap\s+[0-9]+|"
            r"parte|part|seção|secao|section|livro|volume)"
            r"[^\n]{0,80}?)(?=\s+[A-ZÁÉÍÓÚÀÃÕ][a-záéíóúàãõ]|\s*$)",
            title,
            re.I,
        )
        if m and len(m.group(1).split()) <= 14:
            title = m.group(1).strip(" —-")
        else:
            return None
    kind, number = _classify_toc_title(title)
    # Nested levels default to part when unlabeled
    if kind is None and level >= 2:
        kind = "part"
    if kind is None and level == 1:
        kind = "chapter"
    return TocEntry(
        title=title,
        level=level,
        kind=kind,
        number=number,
        source=source,
    )


def extract_docx_toc(path: Path) -> list[TocEntry]:
    """TOC paragraph styles (TOC 1 / TOC 2) and heading outline as fallback."""
    from docx import Document

    document = Document(str(path))
    entries: list[TocEntry] = []
    heading_outline: list[TocEntry] = []

    for paragraph in document.paragraphs:
        text = (paragraph.text or "").strip()
        if not text:
            continue
        style_name = paragraph.style.name if paragraph.style is not None else ""
        style_low = style_name.lower()

        if _TOC_STYLE.match(style_low) or style_low.startswith("toc"):
            level = 1
            m = re.search(r"(\d+)", style_low)
            if m:
                level = max(1, int(m.group(1)))
            entry = _entry_from_title(text, level=level, source="docx-toc")
            if entry:
                entries.append(entry)
            continue

        # Heading styles act as a structural sumário when no formal TOC exists.
        if "heading" in style_low or "título" in style_low or "titulo" in style_low:
            level = 1
            for n in range(1, 5):
                if f"heading {n}" in style_low or f"título {n}" in style_low or f"titulo {n}" in style_low:
                    level = n
                    break
            entry = _entry_from_title(text, level=level, source="heading")
            if entry:
                # Heading 2+ → prefer part
                if level >= 2 and entry.kind in {None, "chapter", "other"}:
                    if re.match(
                        r"^(?:parte|part|seção|secao|section|livro|volume)\b",
                        entry.title,
                        re.I,
                    ):
                        entry.kind = "part"
                    elif entry.kind == "chapter" and level >= 2:
                        entry.kind = "part"
                heading_outline.append(entry)

    return entries or heading_outline


def extract_pdf_toc(path: Path) -> list[TocEntry]:
    """PDF bookmarks / outline tree."""
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    outline = getattr(reader, "outline", None) or []
    entries: list[TocEntry] = []

    def walk(items, level: int = 1) -> None:
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
                continue
            title = getattr(item, "title", None) or str(item)
            entry = _entry_from_title(str(title), level=level, source="pdf-outline")
            if entry:
                if level >= 2 and entry.kind in {None, "chapter", "other"}:
                    entry.kind = "part"
                entries.append(entry)

    try:
        walk(outline)
    except Exception:  # noqa: BLE001
        return []
    return entries


def extract_inline_toc(blocks: list[TextBlock], *, max_entries: int = 120) -> list[TocEntry]:
    """Detect a textual Sumário / Índice section inside extracted blocks."""
    start = None
    for i, block in enumerate(blocks):
        text = _normalize(block.text)
        if _TOC_HEADING.match(text):
            start = i + 1
            break
        # "Sumário" glued with following text
        if re.match(r"^(?:sumário|sumario|índice|indice|contents)\b", text, re.I):
            # Only treat as TOC header when the rest looks like entries, not body prose
            rest = re.sub(
                r"^(?:sumário|sumario|índice|indice|contents)\s*[—:\-]?\s*",
                "",
                text,
                flags=re.I,
            ).strip()
            if not rest or len(rest.split()) <= 14:
                start = i if rest else i + 1
                break
    if start is None:
        return []

    entries: list[TocEntry] = []
    for block in blocks[start : start + 80]:
        text = _normalize(block.text)
        if not text:
            continue
        if _TOC_HEADING.match(text):
            continue
        # Stop when long body prose begins
        words = text.split()
        if len(words) >= 28 and not _DOT_LEADER.search(text) and not _PAGE_TRAIL.search(text):
            if not re.match(
                r"^(?:prólogo|prologo|capítulo|capitulo|chapter|parte|part|epílogo)\b",
                text,
                re.I,
            ):
                break
        # Split glued "Capítulo 1 — Título Parte I — …"
        chunks = re.split(
            r"(?=\b(?:prólogo|prologo|capítulo|capitulo|chapter|cap\.\s*\d|cap\s+\d|"
            r"parte|part|epílogo|epilogo)\b)",
            text,
            flags=re.I,
        )
        for chunk in chunks:
            chunk = chunk.strip()
            if not chunk:
                continue
            kind, _number = _classify_toc_title(chunk)
            if kind is None and not (_DOT_LEADER.search(chunk) or _PAGE_TRAIL.search(chunk)):
                if len(chunk.split()) > 12:
                    continue
            level = 2 if kind == "part" else 1
            entry = _entry_from_title(chunk, level=level, source="inline")
            if entry:
                # Drop prologue/chapter lines that still look like body prose
                if _looks_like_prose_title(entry.title):
                    continue
                entries.append(entry)
                if len(entries) >= max_entries:
                    return entries if len(entries) >= 2 else []
    # A single glued line after a fake "Sumário" is not a real TOC
    return entries if len(entries) >= 2 else []


def _looks_like_prose_title(title: str) -> bool:
    """True when a supposed TOC title still contains sentence body."""
    words = title.split()
    if len(words) <= 6:
        return False
    # "Traição O Reino" / article mid-title starting a sentence
    for i in range(2, len(words) - 1):
        w = words[i].strip(".,;:—-")
        nxt = words[i + 1].strip(".,;:—-") if i + 1 < len(words) else ""
        if w.lower() in {"o", "a", "os", "as", "um", "uma", "the"} and w[:1].isupper():
            if nxt and (nxt[0].islower() or (nxt[0].isupper() and len(words) - i > 3)):
                return True
    return False


def extract_toc(path: str | Path, blocks: list[TextBlock] | None = None) -> list[TocEntry]:
    """Best-effort sumário for a manuscript file."""
    path = Path(path)
    suffix = path.suffix.lower()
    entries: list[TocEntry] = []

    if suffix == ".docx":
        try:
            entries = extract_docx_toc(path)
        except Exception:  # noqa: BLE001
            entries = []
    elif suffix == ".pdf":
        try:
            entries = extract_pdf_toc(path)
        except Exception:  # noqa: BLE001
            entries = []

    if not entries and blocks:
        entries = extract_inline_toc(blocks)

    # Prefer formal TOC; if only headings, still useful for parts.
    return _dedupe_toc(entries)


def _dedupe_toc(entries: list[TocEntry]) -> list[TocEntry]:
    seen: set[str] = set()
    out: list[TocEntry] = []
    for entry in entries:
        key = entry.title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(entry)
    return out


def toc_match_key(text: str) -> str:
    """Normalize a heading for matching against TOC titles."""
    clean = _clean_toc_line(text).lower()
    clean = re.sub(
        r"^(?:capítulo|capitulo|chapter|cap\.|parte|part|seção|secao|section|"
        r"prólogo|prologo|epílogo|epilogo)\s*"
        r"(?:[0-9]+|[ivxlcdm]+)?\s*[.:\-—]?\s*",
        "",
        clean,
    )
    return re.sub(r"[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüçñ\s]", "", clean).strip()


def apply_toc_to_candidates(
    candidates: list[dict],
    toc: list[TocEntry],
) -> list[dict]:
    """Upgrade/downgrade heading candidates using sumário hints (esp. parts)."""
    if not toc or not candidates:
        return candidates

    by_key: dict[str, TocEntry] = {}
    for entry in toc:
        key = toc_match_key(entry.title)
        if key:
            by_key[key] = entry
        # Also index full title
        by_key[entry.title.lower()] = entry

    # If TOC lists parts nested (level>=2) or under chapters, force section level.
    part_as_section = any(
        (e.kind == "part" and e.level >= 2) or e.source == "heading" and e.level >= 2
        for e in toc
    )
    # Top-level parts in TOC remain major book units
    top_level_parts = {
        toc_match_key(e.title)
        for e in toc
        if e.kind == "part" and e.level == 1 and e.source in {"docx-toc", "pdf-outline", "inline"}
    }

    out: list[dict] = []
    for cand in candidates:
        item = dict(cand)
        text = str(item.get("text") or item.get("title") or "")
        key = toc_match_key(text)
        full = text.lower()
        entry = by_key.get(key) or by_key.get(full)

        if entry:
            if entry.kind:
                item["kind"] = entry.kind
                item["heuristic_kind"] = entry.kind
            if entry.number is not None:
                item["number"] = entry.number
            if entry.kind == "part":
                if entry.level >= 2 or (part_as_section and key not in top_level_parts):
                    item["level"] = "section"
                else:
                    item["level"] = "major"
                item["confidence"] = "high"
            elif entry.kind in {"prologue", "chapter", "epilogue"}:
                item["level"] = "major"
                item["confidence"] = "high"
            item["toc_source"] = entry.source
            item["title"] = entry.title if len(entry.title) >= len(str(item.get("title") or "")) else item.get("title")
        else:
            # Unmatched "Parte …" while TOC says parts are nested → keep section
            if item.get("kind") == "part" and part_as_section and key not in top_level_parts:
                item["level"] = "section"
                item["confidence"] = item.get("confidence") or "medium"

        out.append(item)
    return out
