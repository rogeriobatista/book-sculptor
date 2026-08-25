from __future__ import annotations

import io
from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    CondPageBreak,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from app.i18n_labels import SPECIAL_SECTION_KINDS
from app.layout import LayoutSettings
from app.models import Book, Chapter
from app.storage import get_bytes


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
    # Colapsa quebras residuais — <br/> por palavra gerava coluna estreita no PDF
    cleaned = " ".join(text.replace("\u00ad", "").split())
    return (
        cleaned.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _chapter_label_and_title(
    chapter: Chapter,
    literary: bool,
    locale: str = "pt-BR",
) -> tuple[str, str]:
    from app.typography_i18n import kind_label

    if chapter.kind in {*SPECIAL_SECTION_KINDS, "chapter"} and (
        chapter.kind != "chapter" or chapter.number is not None
    ):
        label = kind_label(chapter, literary=literary, locale=locale)
    else:
        label = ""

    title = chapter.title.strip()
    if chapter.kind in SPECIAL_SECTION_KINDS and title.lower() in {
        "prólogo",
        "prologo",
        "epílogo",
        "epilogo",
        "dedicatória",
        "dedicatoria",
        "posfácio",
        "posfacio",
        "apêndice",
        "apendice",
        "dedication",
        "prologue",
        "epilogue",
        "afterword",
        "appendix",
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
    locale: str = "pt-BR",
) -> None:
    literary = settings.style_id == "prosa_literaria"
    opening: list = []

    is_front = chapter.kind in SPECIAL_SECTION_KINDS
    if chapter.has_heading:
        # Abertura tipográfica: prólogo um pouco mais alto que capítulo numerado
        top = (2.4 if is_front else 3.2) * cm if literary else 1.6 * cm
        opening.append(Spacer(1, top))
        label, title = _chapter_label_and_title(chapter, literary, locale=locale)
        if label:
            opening.append(Paragraph(label, styles["chapter_label"]))
        if title:
            opening.append(Paragraph(_esc(title), styles["chapter_title"]))
        # Ornamento só em capítulos numerados; prólogo segue direto ao texto
        if settings.chapter_ornament() and not is_front:
            opening.append(Paragraph("* * *", styles["ornament"]))
        else:
            opening.append(Spacer(1, 16 if is_front else 10))

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
        is_opener = index == 0 or prev_section
        style = (
            styles["body_first"]
            if settings.skip_first_indent() and is_opener
            else styles["body"]
        )
        text = _esc(paragraph.text)
        if settings.drop_cap and index == 0 and text:
            first, rest = text[:1], text[1:]
            drop_size = max(settings.font_size + 14, int(settings.font_size * 2.6))
            text = f'<font size="{drop_size}"><b>{first}</b></font>{rest}'
        body_flow.append(Paragraph(text, style))

    if opening:
        # Abertura + primeiros blocos de corpo (evita página só com título)
        lead = body_flow[:3]
        rest = body_flow[3:]
        story.append(KeepTogether(opening + lead))
        story.extend(rest)
    else:
        story.extend(body_flow)


def _page_chrome_callback(
    settings: LayoutSettings,
    *,
    skip_pages: int = 0,
    header_text: str = "",
):
    mode = settings.page_number
    running = settings.running_header
    header = " ".join(header_text.split())[:72]

    def _draw(canvas, doc) -> None:  # noqa: ANN001
        page = canvas.getPageNumber()
        # Página de rosto (e às vezes sumário) sem chrome tipográfico
        if page <= skip_pages:
            return
        canvas.saveState()
        canvas.setFont("Times-Roman", 9)
        canvas.setFillColorRGB(0.35, 0.35, 0.35)
        width = doc.pagesize[0]
        if running != "none" and header:
            canvas.drawCentredString(
                width / 2,
                doc.pagesize[1] - (0.85 * cm),
                header,
            )
        if mode != "sem":
            y = 1.15 * cm
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
    locale = getattr(book, "locale", "pt-BR")

    if book.is_chapter:
        chapter = book.primary_chapter
        if chapter is None:
            raise ValueError("Nenhum conteúdo de capítulo para exportar.")
        _add_chapter(story, chapter, styles, settings, locale=locale)
    else:
        from app.typography_i18n import toc_title

        cover_bytes = None
        cover_key = getattr(book, "cover_key", None)
        if cover_key:
            cover_bytes = get_bytes(cover_key)

        if cover_bytes:
            fmt_size = settings.format()
            # Full-bleed-ish cover within margins
            max_w = (fmt_size.width_cm - left - right) * cm
            max_h = (fmt_size.height_cm - top - bottom) * cm
            img = Image(io.BytesIO(cover_bytes))
            iw, ih = float(img.imageWidth), float(img.imageHeight)
            scale = min(max_w / iw, max_h / ih) if iw and ih else 1.0
            img.drawWidth = iw * scale
            img.drawHeight = ih * scale
            story.append(Spacer(1, max(0, (max_h - img.drawHeight) / 2)))
            story.append(img)
            story.append(PageBreak())
            skip_pages = 1

        # ——— Página de rosto ———
        story.append(Spacer(1, 5.2 * cm))
        story.append(Paragraph(_esc(book.title), styles["title"]))
        if settings.style_id == "prosa_literaria":
            story.append(Paragraph("* * *", styles["rule"]))
        if book.author:
            story.append(Paragraph(_esc(book.author), styles["author"]))
        story.append(PageBreak())
        skip_pages += 1

        has_named = any(
            c.has_heading or any(p.style == "section" for p in c.paragraphs)
            for c in book.chapters
        )
        if settings.include_toc and has_named:
            story.append(Paragraph(toc_title(book), styles["toc_heading"]))
            for chapter in book.chapters:
                if chapter.has_heading:
                    story.append(
                        Paragraph(_esc(chapter.label_for(locale)), styles["toc_item"])
                    )
                for para in chapter.paragraphs:
                    if para.style == "section":
                        story.append(Paragraph(_esc(para.text), styles["toc_section"]))
            story.append(PageBreak())
            skip_pages += 1

        for index, chapter in enumerate(book.chapters):
            if index > 0:
                story.append(PageBreak())
            # Garante espaço mínimo para abertura de capítulo
            story.append(CondPageBreak(6 * cm))
            _add_chapter(story, chapter, styles, settings, locale=locale)

    header_text = ""
    if settings.running_header == "author":
        header_text = book.author or ""
    elif settings.running_header == "title":
        header_text = book.title or ""
    chrome = _page_chrome_callback(
        settings, skip_pages=skip_pages, header_text=header_text
    )
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    return path
