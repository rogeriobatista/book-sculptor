from __future__ import annotations

from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    CondPageBreak,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from app.layout import LayoutSettings
from app.models import Book, Chapter


def _register_fonts() -> dict[str, str]:
    """Mapeia fontes lógicas para famílias disponíveis no sistema / reportlab."""
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
            r"C:\Windows\Fonts\EBGaramond-Regular.ttf",
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
            fontSize=size + 16,
            leading=(size + 16) * 1.15,
            alignment=TA_CENTER,
            spaceAfter=8,
            textColor="#1a1a1a",
        ),
        "author": ParagraphStyle(
            "BookAuthor",
            parent=base["Normal"],
            fontName=font,
            fontSize=size + 2,
            leading=(size + 2) * 1.35,
            alignment=TA_CENTER,
            textColor="#444444",
            spaceBefore=8,
        ),
        "rule": ParagraphStyle(
            "TitleRule",
            parent=base["Normal"],
            fontName=font,
            fontSize=size + 2,
            alignment=TA_CENTER,
            textColor="#888888",
            spaceBefore=18,
            spaceAfter=10,
        ),
        "toc_heading": ParagraphStyle(
            "TocHeading",
            parent=base["Heading1"],
            fontName=font,
            fontSize=size + 6,
            leading=(size + 6) * 1.2,
            alignment=TA_CENTER,
            spaceBefore=40,
            spaceAfter=28,
        ),
        "toc_item": ParagraphStyle(
            "TocItem",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            leading=size * 1.65,
            spaceBefore=2,
            spaceAfter=6,
            alignment=TA_LEFT,
        ),
        "toc_section": ParagraphStyle(
            "TocSection",
            parent=base["Normal"],
            fontName=font,
            fontSize=max(9, size - 1),
            leading=size * 1.5,
            leftIndent=18,
            spaceBefore=0,
            spaceAfter=4,
            textColor="#444444",
        ),
        "chapter_label": ParagraphStyle(
            "ChapterLabel",
            parent=base["Normal"],
            fontName=font,
            fontSize=max(9, size - 1),
            leading=size * 1.35,
            alignment=TA_CENTER,
            textColor="#555555",
            spaceBefore=0,
            spaceAfter=10,
        ),
        "chapter_title": ParagraphStyle(
            "ChapterTitle",
            parent=base["Heading1"],
            fontName=font,
            fontSize=size + (7 if literary else 9),
            leading=(size + 7) * 1.2,
            alignment=TA_CENTER,
            spaceBefore=0,
            spaceAfter=6 if settings.chapter_ornament() else 28,
            textColor="#1a1a1a",
        ),
        "ornament": ParagraphStyle(
            "Ornament",
            parent=base["Normal"],
            fontName=font,
            fontSize=size + 4,
            alignment=TA_CENTER,
            textColor="#888888",
            spaceBefore=6,
            spaceAfter=32,
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
        "dialogue": ParagraphStyle(
            "Dialogue",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            leading=leading,
            alignment=TA_JUSTIFY,
            firstLineIndent=indent,
            spaceAfter=gap,
            spaceBefore=0,
        ),
        "section": ParagraphStyle(
            "SectionTitle",
            parent=base["Heading2"],
            fontName=font,
            fontSize=size + (1 if literary else 2),
            leading=(size + 2) * 1.3,
            alignment=TA_CENTER if literary else TA_LEFT,
            spaceBefore=28,
            spaceAfter=16,
            textColor="#2a2a2a",
        ),
        "section_rule": ParagraphStyle(
            "SectionRule",
            parent=base["Normal"],
            fontName=font,
            fontSize=size,
            alignment=TA_CENTER,
            textColor="#aaaaaa",
            spaceBefore=4,
            spaceAfter=10,
        ),
    }


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def _chapter_label_and_title(chapter: Chapter, literary: bool) -> tuple[str, str]:
    if chapter.kind == "prologue":
        label = "Prólogo"
    elif chapter.kind == "epilogue":
        label = "Epílogo"
    elif chapter.number is not None and chapter.kind == "chapter":
        label = f"Capítulo {chapter.number}" if literary else f"CAPÍTULO {chapter.number}"
    else:
        label = ""

    title = chapter.title.strip()
    if chapter.kind in {"prologue", "epilogue"} and title.lower() in {
        "prólogo",
        "prologo",
        "epílogo",
        "epilogo",
    }:
        title = ""
    # Evita repetir "Capítulo N" no título
    if label and title.lower().startswith(label.lower()):
        title = title[len(label) :].strip(" —-.")
    return label, title


def _add_chapter(
    story: list,
    chapter: Chapter,
    styles: dict[str, ParagraphStyle],
    settings: LayoutSettings,
) -> None:
    literary = settings.style_id == "prosa_literaria"
    opening: list = []

    if chapter.has_heading:
        # Espaço superior tipográfico de abertura de capítulo
        opening.append(Spacer(1, 3.2 * cm if literary else 1.6 * cm))
        label, title = _chapter_label_and_title(chapter, literary)
        if label:
            opening.append(Paragraph(label, styles["chapter_label"]))
        if title:
            opening.append(Paragraph(_esc(title), styles["chapter_title"]))
        if settings.chapter_ornament():
            opening.append(Paragraph("* * *", styles["ornament"]))
        elif not title:
            opening.append(Spacer(1, 18))

    body_flow: list = []
    for index, paragraph in enumerate(chapter.paragraphs):
        if paragraph.style == "section":
            section_bits: list = [Spacer(1, 0.35 * cm)]
            if literary:
                section_bits.append(Paragraph(". . .", styles["section_rule"]))
            section_bits.append(Paragraph(_esc(paragraph.text), styles["section"]))
            body_flow.append(KeepTogether(section_bits))
            continue
        if paragraph.style == "dialogue":
            body_flow.append(Paragraph(_esc(paragraph.text), styles["dialogue"]))
            continue
        prev_section = index > 0 and chapter.paragraphs[index - 1].style == "section"
        style = (
            styles["body_first"]
            if settings.skip_first_indent() and (index == 0 or prev_section)
            else styles["body"]
        )
        body_flow.append(Paragraph(_esc(paragraph.text), style))

    if opening:
        # Mantém abertura + primeiro parágrafo juntos (evita título órfão)
        first_body = body_flow[:1]
        rest = body_flow[1:]
        story.append(KeepTogether(opening + first_body))
        story.extend(rest)
    else:
        story.extend(body_flow)


def _page_number_callback(settings: LayoutSettings, skip_pages: int = 0):
    mode = settings.page_number

    def _draw(canvas, doc) -> None:  # noqa: ANN001
        page = canvas.getPageNumber()
        # Página de rosto (e às vezes sumário) sem número tipográfico visível
        if mode == "sem" or page <= skip_pages:
            return
        canvas.saveState()
        canvas.setFont("Times-Roman", 9)
        canvas.setFillColorRGB(0.35, 0.35, 0.35)
        width = doc.pagesize[0]
        y = 1.15 * cm
        # Numeração "de livro": a partir do miolo, ou absoluta
        shown = page - skip_pages if skip_pages else page
        if mode == "centro":
            canvas.drawCentredString(width / 2, y, str(shown))
        else:
            canvas.drawRightString(width - doc.rightMargin, y, str(shown))
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
    skip_pages = 0

    if book.is_chapter:
        chapter = book.primary_chapter
        if chapter is None:
            raise ValueError("Nenhum conteúdo de capítulo para exportar.")
        _add_chapter(story, chapter, styles, settings)
    else:
        # ——— Página de rosto ———
        story.append(Spacer(1, 5.2 * cm))
        story.append(Paragraph(_esc(book.title), styles["title"]))
        if settings.style_id == "prosa_literaria":
            story.append(Paragraph("* * *", styles["rule"]))
        if book.author:
            story.append(Paragraph(_esc(book.author), styles["author"]))
        story.append(PageBreak())
        skip_pages = 1

        has_named = any(
            c.has_heading or any(p.style == "section" for p in c.paragraphs)
            for c in book.chapters
        )
        if settings.include_toc and has_named:
            story.append(Paragraph("Sumário", styles["toc_heading"]))
            for chapter in book.chapters:
                if chapter.has_heading:
                    story.append(Paragraph(_esc(chapter.display_label), styles["toc_item"]))
                for para in chapter.paragraphs:
                    if para.style == "section":
                        story.append(Paragraph(_esc(para.text), styles["toc_section"]))
            story.append(PageBreak())
            skip_pages = 2

        for index, chapter in enumerate(book.chapters):
            if index > 0:
                story.append(PageBreak())
            # Garante espaço mínimo para abertura de capítulo
            story.append(CondPageBreak(6 * cm))
            _add_chapter(story, chapter, styles, settings)

    doc.build(
        story,
        onFirstPage=_page_number_callback(settings, skip_pages=skip_pages),
        onLaterPages=_page_number_callback(settings, skip_pages=skip_pages),
    )
    return path
