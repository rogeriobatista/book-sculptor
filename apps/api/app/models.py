from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

DocumentKind = Literal["book", "chapter"]
ChapterKind = Literal[
    "dedication",
    "prologue",
    "chapter",
    "epilogue",
    "afterword",
    "appendix",
    "other",
]
ParagraphStyle = Literal["body", "section", "dialogue", "quote", "list"]


@dataclass
class TextBlock:
    """Bloco de texto com pistas tipográficas do manuscrito."""

    text: str
    style_name: str = "Normal"
    bold: bool = False
    font_size_pt: float | None = None
    align: str = "left"  # left | center | right | justify

    @property
    def is_word_heading(self) -> bool:
        name = (self.style_name or "").lower()
        return "heading" in name or "título" in name or "titulo" in name

    @property
    def heading_level(self) -> int | None:
        name = (self.style_name or "").lower()
        for level in range(1, 5):
            if f"heading {level}" in name or f"título {level}" in name or f"titulo {level}" in name:
                return level
        if self.is_word_heading:
            return 1
        return None


@dataclass
class Paragraph:
    text: str
    style: ParagraphStyle = "body"


@dataclass
class Chapter:
    title: str
    paragraphs: list[Paragraph] = field(default_factory=list)
    number: int | None = None
    kind: ChapterKind = "chapter"
    # Rótulo completo detectado, ex.: "Capítulo 1 — O Menino Sem Nome"
    full_label: str = ""

    @property
    def has_heading(self) -> bool:
        """Se False, o capítulo começa direto no texto (sem título no topo)."""
        if self.full_label.strip():
            return True
        if self.kind in {"dedication", "prologue", "epilogue", "afterword", "appendix"}:
            return True
        if self.kind == "chapter" and (self.number is not None or self.title.strip()):
            # Evita rótulos genéricos inventados
            if self.title.strip().lower() in {"conteúdo", "content", "corpo"}:
                return False
            return True
        return bool(self.title.strip()) and self.title.strip().lower() not in {
            "conteúdo",
            "content",
            "corpo",
        }

    def label_for(self, locale: str = "pt-BR") -> str:
        from app.i18n_labels import format_chapter_label, t

        if self.full_label:
            return self.full_label
        if not self.has_heading:
            return self.title.strip() or t("text", locale)
        return format_chapter_label(self.kind, self.number, self.title, locale)

    @property
    def display_label(self) -> str:
        return self.label_for("pt-BR")


@dataclass
class Book:
    title: str
    author: str = ""
    chapters: list[Chapter] = field(default_factory=list)
    source_path: str = ""
    kind: DocumentKind = "book"
    locale: str = "pt-BR"
    cover_url: str | None = None
    cover_key: str | None = None
    cover_source: str | None = None

    @property
    def is_chapter(self) -> bool:
        return self.kind == "chapter"

    @property
    def chapter_count(self) -> int:
        return len(self.chapters)

    @property
    def word_count(self) -> int:
        total = 0
        for chapter in self.chapters:
            for paragraph in chapter.paragraphs:
                if paragraph.style == "section":
                    continue
                if paragraph.style in {"body", "dialogue", "quote", "list"}:
                    total += len(paragraph.text.split())
        return total

    @property
    def primary_chapter(self) -> Chapter | None:
        return self.chapters[0] if self.chapters else None

    @property
    def section_count(self) -> int:
        return sum(
            1
            for chapter in self.chapters
            for paragraph in chapter.paragraphs
            if paragraph.style == "section"
        )
