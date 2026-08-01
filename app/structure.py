from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from app.models import Book, Chapter, Paragraph

# Padrões comuns de título de capítulo (PT/EN/ES + numeração)
CHAPTER_PATTERNS = [
    re.compile(
        r"^(?:capítulo|capitulo|chapter|cap\.?|capítulo)\s*"
        r"([0-9]+|[ivxlcdm]+|[a-z])\s*[:.\-–—]?\s*(.*)$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:parte|part|seção|secao|section)\s*"
        r"([0-9]+|[ivxlcdm]+)\s*[:.\-–—]?\s*(.*)$",
        re.IGNORECASE,
    ),
    re.compile(r"^([0-9]{1,3})\s*[\.\)\-–—]\s+(.+)$"),
    re.compile(r"^([IVXLCDM]+)\s*[\.\)\-–—]\s+(.+)$"),
]

TITLE_CANDIDATE_MAX_WORDS = 12
TITLE_CANDIDATE_MAX_CHARS = 80


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip()


def _looks_like_heading(text: str) -> bool:
    """Heurística: texto curto, poucas palavras, sem pontuação final típica."""
    clean = _normalize(text)
    if not clean or len(clean) > TITLE_CANDIDATE_MAX_CHARS:
        return False
    words = clean.split()
    if len(words) > TITLE_CANDIDATE_MAX_WORDS:
        return False
    if clean.endswith((".", ",", ";", ":")) and len(words) > 6:
        return False
    # Muito texto em caixa alta → provável título
    letters = [c for c in clean if c.isalpha()]
    if letters:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio > 0.7 and len(words) <= TITLE_CANDIDATE_MAX_WORDS:
            return True
    # Casa com padrão de capítulo
    for pattern in CHAPTER_PATTERNS:
        if pattern.match(clean):
            return True
    return False


def _parse_chapter_title(text: str) -> tuple[int | None, str]:
    clean = _normalize(text)
    for pattern in CHAPTER_PATTERNS:
        match = pattern.match(clean)
        if match:
            groups = match.groups()
            number: int | None = None
            raw_num = groups[0]
            rest = groups[1].strip() if len(groups) > 1 else ""
            if raw_num.isdigit():
                number = int(raw_num)
            title = rest if rest else clean
            return number, title
    return None, clean


def _guess_title(blocks: list[str], source_path: Path) -> str:
    fallback = source_path.stem.replace("_", " ").replace("-", " ").strip()
    fallback = re.sub(r"^\d+\s*", "", fallback).strip() or fallback
    fallback = fallback.title() if fallback.islower() else fallback

    for block in blocks[:8]:
        clean = _normalize(block)
        if any(p.match(clean) for p in CHAPTER_PATTERNS):
            continue
        words = clean.split()
        if not (1 <= len(words) <= TITLE_CANDIDATE_MAX_WORDS and len(clean) <= TITLE_CANDIDATE_MAX_CHARS):
            continue
        if clean.lower().startswith(("por ", "by ", "autor", "author")):
            continue
        # Frases com pontuação final são corpo, não título
        if clean.endswith((".", "!", "?", ";", ",")):
            continue
        return clean.title() if clean.isupper() else clean
    return fallback


def _guess_author(blocks: list[str]) -> str:
    author_re = re.compile(
        r"^(?:por|by|autor(?:a)?|author)\s*[:\-–—]?\s*(.+)$",
        re.IGNORECASE,
    )
    for block in blocks[:12]:
        clean = _normalize(block)
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


def detect_structure(blocks: list[str], source_path: str | Path) -> Book:
    """Analisa blocos de texto e monta uma estrutura de livro."""
    path = Path(source_path)
    cleaned = [_normalize(b) for b in blocks if _normalize(b)]

    title = _guess_title(cleaned, path)
    author = _guess_author(cleaned)

    chapters: list[Chapter] = []
    heading_indices: list[int] = []

    for i, block in enumerate(cleaned):
        if _looks_like_heading(block) and any(p.match(block) for p in CHAPTER_PATTERNS):
            heading_indices.append(i)
        elif (
            _looks_like_heading(block)
            and i > 0
            and len(block.split()) <= 8
            and not block.lower().startswith(("por ", "by ", "autor"))
        ):
            # Título curto entre blocos longos também pode ser capítulo
            prev_long = i > 0 and len(cleaned[i - 1].split()) > 20
            next_long = i + 1 < len(cleaned) and len(cleaned[i + 1].split()) > 15
            if prev_long or next_long:
                heading_indices.append(i)

    def _keep_body(block: str) -> bool:
        return block.lower() != title.lower() and not _is_author_line(block, author)

    # Se não achou capítulos, cria um único com todo o conteúdo
    if not heading_indices:
        body = [Paragraph(text=b) for b in cleaned if _keep_body(b)]
        chapters.append(Chapter(title="Conteúdo", paragraphs=body, number=1))
        return Book(title=title, author=author, chapters=chapters, source_path=str(path), kind="book")

    # Conteúdo antes do primeiro capítulo → prefácio / introdução
    first_heading = heading_indices[0]
    preface_blocks = [b for b in cleaned[:first_heading] if _keep_body(b)]
    if preface_blocks:
        chapters.append(
            Chapter(
                title="Introdução",
                paragraphs=[Paragraph(text=b) for b in preface_blocks],
                number=None,
            )
        )

    for idx, start in enumerate(heading_indices):
        end = heading_indices[idx + 1] if idx + 1 < len(heading_indices) else len(cleaned)
        number, chapter_title = _parse_chapter_title(cleaned[start])
        body = [Paragraph(text=b) for b in cleaned[start + 1 : end]]
        chapters.append(
            Chapter(title=chapter_title, paragraphs=body, number=number or (idx + 1))
        )

    # Numera capítulos sem número
    counter = 1
    for chapter in chapters:
        if chapter.title == "Introdução":
            continue
        if chapter.number is None:
            chapter.number = counter
        counter = max(counter, (chapter.number or 0) + 1)

    return Book(title=title, author=author, chapters=chapters, source_path=str(path), kind="book")


SUPPORTED_SUFFIXES = {".pdf", ".docx"}


def _natural_sort_key(path: Path) -> tuple:
    """Ordena arquivos de forma natural: 2 antes de 10, Cap 1 antes de Cap 2."""
    parts = re.split(r"(\d+)", path.stem.lower())
    key: list = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return tuple(key)


def _title_from_filename(path: Path) -> tuple[int | None, str]:
    """Extrai número e título do nome do arquivo."""
    raw = path.stem.replace("_", " ").replace("-", " ").strip()
    raw = re.sub(r"\s+", " ", raw)
    number, title = _parse_chapter_title(raw)
    if number is not None:
        return number, title if title else raw

    # Prefixo numérico: "01 O Despertar", "1_cartas"
    prefix = re.match(r"^(\d+)\s*(.*)$", raw)
    if prefix:
        num = int(prefix.group(1))
        rest = prefix.group(2).strip(" .-–—:")
        return num, rest if rest else f"Capítulo {num}"

    return None, raw.title() if raw.islower() else raw


def list_chapter_files(folder: str | Path) -> list[Path]:
    """Lista PDFs e Word de uma pasta, ordenados naturalmente."""
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


def _chapter_from_blocks(
    cleaned: list[str],
    number: int | None,
    chapter_title: str,
) -> Chapter:
    """Monta um capítulo a partir de blocos — sem tratar o arquivo como livro."""
    body = list(cleaned)

    if body and any(p.match(body[0]) for p in CHAPTER_PATTERNS):
        parsed_num, parsed_title = _parse_chapter_title(body[0])
        if parsed_num is not None:
            number = parsed_num
        if parsed_title:
            chapter_title = parsed_title
        body = body[1:]
    elif body and body[0].lower() == chapter_title.lower():
        body = body[1:]

    return Chapter(
        title=chapter_title,
        paragraphs=[Paragraph(text=b) for b in body],
        number=number,
    )


def build_chapter_from_file(file_path: str | Path) -> Book:
    """Trata um arquivo isolado como conteúdo de um único capítulo (não como livro)."""
    from app.extractors import extract_text

    path = Path(file_path)
    _, blocks = extract_text(path)
    cleaned = [_normalize(b) for b in blocks if _normalize(b)]
    number, chapter_title = _title_from_filename(path)
    chapter = _chapter_from_blocks(cleaned, number, chapter_title)

    return Book(
        title=chapter.title,
        author="",
        chapters=[chapter],
        source_path=str(path),
        kind="chapter",
    )


def build_book_from_folder(folder: str | Path) -> Book:
    """Monta um livro onde cada arquivo da pasta é um capítulo."""
    from app.extractors import extract_text

    path = Path(folder)
    files = list_chapter_files(path)
    if not files:
        raise ValueError(
            "Nenhum arquivo PDF ou Word (.docx) encontrado nesta pasta."
        )

    book_title = path.name.replace("_", " ").replace("-", " ").strip().title()
    chapters: list[Chapter] = []

    for index, file_path in enumerate(files, start=1):
        _, blocks = extract_text(file_path)
        cleaned = [_normalize(b) for b in blocks if _normalize(b)]
        number, chapter_title = _title_from_filename(file_path)
        chapter = _chapter_from_blocks(
            cleaned,
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