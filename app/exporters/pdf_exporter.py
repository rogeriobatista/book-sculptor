from __future__ import annotations

from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from app.layout import LayoutSettings
from app.models import Book, Chapter


def _register_fonts() -> dict[str, str]:
    """Mapeia fontes lógicas para famílias disponíveis no sistema / reportlab."""
    # Helvetica is always available; try common OS fonts for better look
    mapping = {
        "georgia": "Times-Roman",
        "literata": "Times-Roman",
        "garamond": "Times-Roman",
        "baskerville": "Times-Roman",
    }

    candidates = {
        "georgia": [
            r"C:\Windows\Fonts\georgia.ttf",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/Library/Fonts/Georgia.ttf",
        ],
        "garamond": [
            r"C:\Windows\Fonts\gara.ttf",
            r"C:\Windows\Fonts\GARA.TTF",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
        ],
        "baskerville": [
            r"C:\Windows\Fonts\basel.ttf",
            "/System/Library/Fonts/Supplemental/Baskerville.ttc",
            "/Library/Fonts/Baskerville.ttc",
        ],
        "literata": [
            r"C:\Windows\Fonts\georgia.ttf",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
        ],
    }

    for font_id, paths in candidates.items():
        for path in paths:
            p = Path(path)
            if not p.exists():
                continue
            try:
                name = f"BookSculptor-{font_id}"
                pdfmetrics.registerFont(TTFont(name, str(p)))
                mapping[font_id] = name
                break
            except Exception:  # noqa: BLE001 — fallback silencioso
                continue
    return mapping


_FONT_MAP = _register_fonts()


def _styles(settings: LayoutSettings) -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    font = _FONT_MAP.get(settings.font_id, "Times-Roman")
    size = settings.font_size
    leading = size * settings.line_height()
    indent = settings.first_line_indent_cm() * cm
    gap = settings.paragraph_spacing_pt()
    literary = settings.style_id == "prosa_literaria"

    return {
        "title": ParagraphStyle(
            "BookTitle",
            parent=base["Title"],
            fontName=font,
            fontSize=size + 14,
            leading=(size + 14) * 1.2,
            alignment=TA_CENTER,
            spaceAfter=12,
            textColor="#1a1a1a",
        ),
        "author": ParagraphStyle(
            "BookAuthor",
            parent=base["Normal"],
            fontName=font,
            fontSize=size + 1,
            leading=(size + 1) * 1.3,
            alignment=TA_CENTER,
            textColor="#444444",
        ),
        "rule": ParagraphStyle(
            "TitleRule",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            alignment=TA_CENTER,
            textColor="#888888",
            spaceBefore=10,
            spaceAfter=10,
        ),
        "toc_heading": ParagraphStyle(
            "TocHeading",
            parent=base["Heading1"],
            fontName=font,
            fontSize=size + 5,
            leading=(size + 5) * 1.2,
            alignment=TA_CENTER,
            spaceAfter=20,
        ),
        "toc_item": ParagraphStyle(
            "TocItem",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            leading=size * 1.5,
            spaceAfter=10,
        ),
        "chapter_label": ParagraphStyle(
            "ChapterLabel",
            parent=base["Normal"],
            fontName=font,
            fontSize=max(9, size - 1),
            leading=size * 1.3,
            alignment=TA_CENTER,
            textColor="#666666",
            spaceBefore=56 if literary else 24,
            spaceAfter=8,
        ),
        "chapter_title": ParagraphStyle(
            "ChapterTitle",
            parent=base["Heading1"],
            fontName=font,
            fontSize=size + (6 if literary else 8),
            leading=(size + 6) * 1.2,
            alignment=TA_CENTER,
            spaceAfter=8 if settings.chapter_ornament() else 22,
        ),
        "ornament": ParagraphStyle(
            "Ornament",
            parent=base["Normal"],
            fontName=font,
            fontSize=size + 2,
            alignment=TA_CENTER,
            textColor="#888888",
            spaceBefore=2,
            spaceAfter=26,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            leading=leading,
            alignment=TA_JUSTIFY,
            firstLineIndent=indent,
            spaceAfter=gap,
            spaceBefore=0,
        ),
        "body_first": ParagraphStyle(
            "BodyFirst",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            leading=leading,
            alignment=TA_JUSTIFY,
            firstLineIndent=0,
            spaceAfter=gap,
            spaceBefore=0,
        ),
    }


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def _add_chapter(
    story: list,
    chapter: Chapter,
    styles: dict[str, ParagraphStyle],
    settings: LayoutSettings,
) -> None:
    literary = settings.style_id == "prosa_literaria"
    if chapter.number is not None and chapter.title not in {"Introdução", "Prefácio"}:
        label = f"Capítulo {chapter.number}" if literary else f"CAPÍTULO {chapter.number}"
        story.append(Paragraph(label, styles["chapter_label"]))
    story.append(Paragraph(_esc(chapter.title), styles["chapter_title"]))
    if settings.chapter_ornament():
        story.append(Paragraph("❧", styles["ornament"]))
    for index, paragraph in enumerate(chapter.paragraphs):
        style = (
            styles["body_first"]
            if settings.skip_first_indent() and index == 0
            else styles["body"]
        )
        story.append(Paragraph(_esc(paragraph.text), style))


def _page_number_callback(settings: LayoutSettings):
    mode = settings.page_number

    def _draw(canvas, doc) -> None:  # noqa: ANN001
        if mode == "sem":
            return
        canvas.saveState()
        page = canvas.getPageNumber()
        canvas.setFont("Times-Roman", 9)
        canvas.setFillColorRGB(0.4, 0.4, 0.4)
        width = doc.pagesize[0]
        y = 1.1 * cm
        if mode == "centro":
            canvas.drawCentredString(width / 2, y, str(page))
        else:  # externo — simplificado: direita
            canvas.drawRightString(width - doc.rightMargin, y, str(page))
        canvas.restoreState()

    return _draw


def export_pdf(
    book: Book,
    output_path: str | Path,
    settings: LayoutSettings | None = None,
) -> Path:
    """Exporta livro ou capítulo como PDF tipográfico."""
    settings = settings or LayoutSettings()
    path = Path(output_path)
    if path.suffix.lower() != ".pdf":
        path = path.with_suffix(".pdf")

    fmt = settings.format()
    top, bottom, left, right = settings.margins_cm()
    styles = _styles(settings)

    doc = SimpleDocTemplate(
        str(path),
        pagesize=(fmt.width_cm * cm, fmt.height_cm * cm),
        leftMargin=left * cm,
        rightMargin=right * cm,
        topMargin=top * cm,
        bottomMargin=bottom * cm,
        title=book.title,
        author=book.author or "",
    )

    story: list = []

    if book.is_chapter:
        chapter = book.primary_chapter
        if chapter is None:
            raise ValueError("Nenhum conteúdo de capítulo para exportar.")
        _add_chapter(story, chapter, styles, settings)
    else:
        story.append(Spacer(1, 4.5 * cm))
        story.append(Paragraph(_esc(book.title), styles["title"]))
        if settings.style_id == "prosa_literaria":
            story.append(Paragraph("—", styles["rule"]))
        if book.author:
            story.append(Paragraph(_esc(book.author), styles["author"]))
        story.append(PageBreak())

        if settings.include_toc:
            story.append(Paragraph("Sumário", styles["toc_heading"]))
            for chapter in book.chapters:
                if chapter.number is not None and chapter.title not in {
                    "Introdução",
                    "Prefácio",
                }:
                    label = f"Capítulo {chapter.number} — {chapter.title}"
                else:
                    label = chapter.title
                story.append(Paragraph(_esc(label), styles["toc_item"]))
            story.append(PageBreak())

        for index, chapter in enumerate(book.chapters):
            if index > 0:
                story.append(PageBreak())
            _add_chapter(story, chapter, styles, settings)
    doc.build(story, onFirstPage=_page_number_callback(settings), onLaterPages=_page_number_callback(settings))
    return path
