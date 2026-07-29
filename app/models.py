from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Paragraph:
    text: str
    style: str = "body"  # body | quote | list


@dataclass
class Chapter:
    title: str
    paragraphs: list[Paragraph] = field(default_factory=list)
    number: int | None = None


@dataclass
class Book:
    title: str
    author: str = ""
    chapters: list[Chapter] = field(default_factory=list)
    source_path: str = ""

    @property
    def chapter_count(self) -> int:
        return len(self.chapters)

    @property
    def word_count(self) -> int:
        total = 0
        for chapter in self.chapters:
            for paragraph in chapter.paragraphs:
                total += len(paragraph.text.split())
        return total
