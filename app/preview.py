from __future__ import annotations

from app.layout import LayoutSettings
from app.models import Book, Chapter


def chapter_to_dict(chapter: Chapter, index: int) -> dict:
    snippet = ""
    if chapter.paragraphs:
        snippet = chapter.paragraphs[0].text[:220]
        if len(chapter.paragraphs[0].text) > 220:
            snippet += "…"
    label = chapter.title
    if chapter.number is not None and chapter.title != "Introdução":
        label = f"{chapter.number} {chapter.title}"
    return {
        "id": index,
        "title": chapter.title,
        "number": chapter.number,
        "label": label,
        "paragraph_count": len(chapter.paragraphs),
        "word_count": sum(len(p.text.split()) for p in chapter.paragraphs),
        "snippet": snippet,
    }


def book_to_dict(book: Book) -> dict:
    numbered = sum(
        1
        for c in book.chapters
        if c.title != "Introdução" and c.title != "Prefácio"
    )
    has_preface = any(c.title in {"Introdução", "Prefácio"} for c in book.chapters)
    detection = f"Detectamos {numbered} capítulo{'s' if numbered != 1 else ''}"
    if has_preface:
        detection += " + prefácio"

    return {
        "title": book.title,
        "author": book.author,
        "kind": book.kind,
        "chapter_count": book.chapter_count,
        "word_count": book.word_count,
        "detection": detection,
        "has_preface": has_preface,
        "chapters": [chapter_to_dict(c, i) for i, c in enumerate(book.chapters)],
    }


def estimate_chars_per_page(settings: LayoutSettings) -> int:
    fmt = settings.format()
    top, bottom, left, right = settings.margins_cm()
    usable_w = max(4.0, fmt.width_cm - left - right)
    usable_h = max(6.0, fmt.height_cm - top - bottom)
    chars_per_line = int(usable_w * (52 / settings.font_size) * 2.2)
    line_height = settings.font_size * settings.line_height()
    lines = int((usable_h * 28.3) / line_height)
    density_factor = {"compacto": 1.15, "padrao": 1.0, "espacoso": 0.85}[settings.density]
    return max(400, int(chars_per_line * lines * density_factor * 0.55))


def build_preview_pages(book: Book, settings: LayoutSettings) -> list[dict]:
    """Gera páginas aproximadas para a prévia tipográfica."""
    pages: list[dict] = []
    chars_per_page = estimate_chars_per_page(settings)

    if book.is_chapter:
        for chapter in book.chapters:
            chunks = _paginate_chapter(chapter, chars_per_page, settings)
            for i, chunk_html in enumerate(chunks):
                pages.append(
                    {
                        "type": "chapter",
                        "title": chapter.title,
                        "chapter_number": chapter.number,
                        "part": i + 1,
                        "parts": len(chunks),
                        "html": chunk_html,
                    }
                )
    else:
        pages.append(
            {
                "type": "title",
                "title": book.title,
                "author": book.author,
                "html": _title_page_html(book, settings),
            }
        )

        if settings.include_toc:
            pages.append(
                {
                    "type": "toc",
                    "title": "Sumário",
                    "html": _toc_html(book),
                }
            )

        for chapter in book.chapters:
            chunks = _paginate_chapter(chapter, chars_per_page, settings)
            for i, chunk_html in enumerate(chunks):
                pages.append(
                    {
                        "type": "chapter",
                        "title": chapter.title,
                        "chapter_number": chapter.number,
                        "part": i + 1,
                        "parts": len(chunks),
                        "html": chunk_html,
                    }
                )

    if not pages:
        pages.append({"type": "empty", "html": "<p class='muted'>Nenhum conteúdo.</p>"})

    return pages


def _title_page_html(book: Book, settings: LayoutSettings) -> str:
    author = f'<p class="author">{_esc(book.author)}</p>' if book.author else ""
    rule = '<p class="title-rule">—</p>' if settings.style_id == "prosa_literaria" else ""
    return (
        f'<div class="title-page literary">'
        f"<h1>{_esc(book.title)}</h1>"
        f"{rule}"
        f"{author}"
        f"</div>"
    )


def _toc_html(book: Book) -> str:
    items = []
    for chapter in book.chapters:
        if chapter.number is not None and chapter.title not in {"Introdução", "Prefácio"}:
            label = f"Capítulo {chapter.number} — {chapter.title}"
        else:
            label = chapter.title
        items.append(f"<li>{_esc(label)}</li>")
    return f'<div class="toc"><h1>Sumário</h1><ul>{"".join(items)}</ul></div>'


def _paginate_chapter(
    chapter: Chapter,
    chars_per_page: int,
    settings: LayoutSettings,
) -> list[str]:
    heading = _chapter_heading_html(chapter, settings)
    paragraphs = list(chapter.paragraphs)
    if not paragraphs:
        return [heading]

    pages: list[str] = []
    current: list[str] = [heading]
    used = 120

    for index, para in enumerate(paragraphs):
        text = para.text
        cost = len(text) + 20
        if current and used + cost > chars_per_page and len(current) > 1:
            pages.append("".join(current))
            current = []
            used = 0
        cls = ' class="first"' if settings.skip_first_indent() and index == 0 else ""
        current.append(f"<p{cls}>{_esc(text)}</p>")
        used += cost

    if current:
        pages.append("".join(current))
    return pages


def _chapter_heading_html(chapter: Chapter, settings: LayoutSettings) -> str:
    literary = settings.style_id == "prosa_literaria"
    ornament = '<p class="ornament">❧</p>' if settings.chapter_ornament() else ""
    if chapter.number is not None and chapter.title not in {"Introdução", "Prefácio"}:
        label = f"Capítulo {chapter.number}" if literary else f"CAPÍTULO {chapter.number}"
        return (
            f'<div class="chapter-open">'
            f'<p class="chapter-label">{label}</p>'
            f"<h1 class='chapter-title'>{_esc(chapter.title)}</h1>"
            f"{ornament}"
            f"</div>"
        )
    return (
        f'<div class="chapter-open">'
        f"<h1 class='chapter-title'>{_esc(chapter.title)}</h1>"
        f"{ornament}"
        f"</div>"
    )


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def settings_css(settings: LayoutSettings) -> dict:
    fmt = settings.format()
    font = settings.font()
    top, bottom, left, right = settings.margins_cm()
    scale = 18
    return {
        "width_px": round(fmt.width_cm * scale),
        "height_px": round(fmt.height_cm * scale),
        "padding": f"{top * scale:.0f}px {right * scale:.0f}px {bottom * scale:.0f}px {left * scale:.0f}px",
        "font_family": font.css_family,
        "font_size": f"{settings.font_size}pt",
        "line_height": settings.line_height(),
        "page_number": settings.page_number,
        "format_label": fmt.label,
        "font_label": font.label,
        "style_id": settings.style_id,
        "indent_em": round(settings.first_line_indent_cm() * 2.2, 2),
        "paragraph_gap_pt": settings.paragraph_spacing_pt(),
        "skip_first_indent": settings.skip_first_indent(),
    }


def preview_payload(book: Book, settings: LayoutSettings) -> dict:
    pages = build_preview_pages(book, settings)
    return {
        "book": book_to_dict(book),
        "settings": settings.to_dict(),
        "css": settings_css(settings),
        "pages": pages,
        "page_count": len(pages),
    }


def diagnostic_payload(book: Book) -> dict:
    issues = []
    if book.chapter_count <= 1 and book.kind == "book":
        issues.append("Seu texto tem pouca divisão clara em capítulos — vamos estruturar isso.")
    short = [c for c in book.chapters if sum(len(p.text.split()) for p in c.paragraphs) < 80]
    if short:
        issues.append(f"{len(short)} capítulo(s) muito curto(s) — confira se o conteúdo veio completo.")
    empty = [c for c in book.chapters if not c.paragraphs]
    if empty:
        issues.append(f"{len(empty)} capítulo(s) sem parágrafos detectados.")

    return {
        "chapters": book.chapter_count,
        "words": book.word_count,
        "issues": issues,
        "issue_count": len(issues),
        "message": issues[0] if issues else "Estrutura do manuscrito pronta para diagramação.",
    }
