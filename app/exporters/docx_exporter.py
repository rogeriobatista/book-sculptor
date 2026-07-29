from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from app.models import Book, Chapter


def _set_run_font(run, name: str = "Georgia", size: int = 12, bold: bool = False) -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold


def _apply_book_page(document: Document) -> None:
    for section in document.sections:
        section.top_margin = Cm(2.5)
        section.bottom_margin = Cm(2.5)
        section.left_margin = Cm(3.0)
        section.right_margin = Cm(2.5)
        section.page_width = Cm(15.24)
        section.page_height = Cm(22.86)


def _write_chapter_body(document: Document, chapter: Chapter) -> None:
    if chapter.number is not None and chapter.title != "Introdução":
        cap_label = document.add_paragraph()
        cap_label.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap_label.paragraph_format.space_before = Pt(24)
        cap_label.paragraph_format.space_after = Pt(6)
        run = cap_label.add_run(f"Capítulo {chapter.number}")
        _set_run_font(run, name="Georgia", size=11)
        run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

        heading = document.add_paragraph()
        heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
        heading.paragraph_format.space_after = Pt(28)
    else:
        heading = document.add_paragraph()
        heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
        heading.paragraph_format.space_before = Pt(24)
        heading.paragraph_format.space_after = Pt(28)

    run = heading.add_run(chapter.title)
    _set_run_font(run, name="Georgia", size=20, bold=True)

    for paragraph in chapter.paragraphs:
        body = document.add_paragraph()
        body.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        body.paragraph_format.first_line_indent = Cm(0.75)
        body.paragraph_format.space_after = Pt(8)
        body.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
        run = body.add_run(paragraph.text)
        _set_run_font(run, name="Georgia", size=12)


def export_chapter_docx(book: Book, output_path: str | Path) -> Path:
    """Exporta apenas o conteúdo de um capítulo (sem página de título nem sumário)."""
    path = Path(output_path)
    chapter = book.primary_chapter
    if chapter is None:
        raise ValueError("Nenhum conteúdo de capítulo para exportar.")

    document = Document()
    _apply_book_page(document)
    _write_chapter_body(document, chapter)
    document.save(str(path))
    return path


def export_docx(book: Book, output_path: str | Path) -> Path:
    """Exporta o livro completo (título, sumário e capítulos)."""
    if book.is_chapter:
        return export_chapter_docx(book, output_path)

    path = Path(output_path)
    document = Document()
    _apply_book_page(document)

    # Página de título
    for _ in range(4):
        document.add_paragraph()

    title_para = document.add_paragraph()
    title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_para.add_run(book.title)
    _set_run_font(run, name="Georgia", size=28, bold=True)
    run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)

    if book.author:
        document.add_paragraph()
        author_para = document.add_paragraph()
        author_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = author_para.add_run(book.author)
        _set_run_font(run, name="Georgia", size=14)
        run.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    document.add_page_break()

    # Sumário
    toc_heading = document.add_paragraph()
    toc_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = toc_heading.add_run("Sumário")
    _set_run_font(run, name="Georgia", size=18, bold=True)
    document.add_paragraph()

    for chapter in book.chapters:
        line = document.add_paragraph()
        line.paragraph_format.space_after = Pt(8)
        if chapter.number is not None and chapter.title != "Introdução":
            label = f"Capítulo {chapter.number} — {chapter.title}"
        else:
            label = chapter.title
        run = line.add_run(label)
        _set_run_font(run, name="Georgia", size=12)

    document.add_page_break()

    for index, chapter in enumerate(book.chapters):
        if index > 0:
            document.add_page_break()
        _write_chapter_body(document, chapter)

    document.save(str(path))
    return path
