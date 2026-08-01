from __future__ import annotations

from app.layout import LayoutSettings
from app.models import Book, Chapter


def chapter_to_dict(chapter: Chapter, index: int) -> dict:
    body_paras = [p for p in chapter.paragraphs if p.style in {"body", "dialogue"}]
    sections = [p for p in chapter.paragraphs if p.style == "section"]
    snippet = ""
    if body_paras:
        snippet = body_paras[0].text[:220]
        if len(body_paras[0].text) > 220:
            snippet += "…"
    elif chapter.paragraphs:
        snippet = chapter.paragraphs[0].text[:220]

    return {
        "id": index,
        "title": chapter.title,
        "number": chapter.number,
        "kind": chapter.kind,
        "label": chapter.display_label if chapter.has_heading else (chapter.title or "Texto principal"),
        "has_heading": chapter.has_heading,
        "paragraph_count": len(body_paras),
        "section_count": len(sections),
        "word_count": sum(len(p.text.split()) for p in body_paras),
        "snippet": snippet,
        "sections": [p.text for p in sections],
    }


def book_to_dict(book: Book) -> dict:
    chapters_n = sum(1 for c in book.chapters if c.kind == "chapter")
    prologues = sum(1 for c in book.chapters if c.kind == "prologue")
    epilogues = sum(1 for c in book.chapters if c.kind == "epilogue")
    parts = book.section_count

    parts_msg = []
    if prologues:
        parts_msg.append("prólogo" if prologues == 1 else f"{prologues} prólogos")
    if chapters_n:
        parts_msg.append(f"{chapters_n} capítulo{'s' if chapters_n != 1 else ''}")
    if parts:
        parts_msg.append(f"{parts} parte{'s' if parts != 1 else ''}")
    if epilogues:
        parts_msg.append("epílogo" if epilogues == 1 else f"{epilogues} epílogos")
    if not parts_msg:
        parts_msg.append(f"{book.chapter_count} divisão(ões)")

    detection = "Detectamos " + " + ".join(parts_msg)

    return {
        "title": book.title,
        "author": book.author,
        "kind": book.kind,
        "chapter_count": book.chapter_count,
        "word_count": book.word_count,
        "detection": detection,
        "has_preface": prologues > 0 or any(c.title == "Introdução" for c in book.chapters),
        "section_count": parts,
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

        has_named_divisions = any(
            c.has_heading or any(p.style == "section" for p in c.paragraphs)
            for c in book.chapters
        )
        if settings.include_toc and has_named_divisions:
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
    rule = '<p class="title-rule">* * *</p>' if settings.style_id == "prosa_literaria" else ""
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
        if chapter.has_heading:
            items.append(f"<li>{_esc(chapter.display_label)}</li>")
        for para in chapter.paragraphs:
            if para.style == "section":
                items.append(f'<li class="toc-section">{_esc(para.text)}</li>')
    if not items:
        return '<div class="toc"><h1>Sumário</h1><p class="muted">Sem divisões nomeadas.</p></div>'
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
        if para.style == "section":
            current.append('<p class="section-rule">. . .</p>')
            current.append(f'<h2 class="section-title">{_esc(para.text)}</h2>')
            used += 60
            continue
        if para.style == "dialogue":
            current.append(f'<p class="dialogue">{_esc(text)}</p>')
            used += cost
            continue
        # first indent: primeiro parágrafo de corpo após título/seção
        is_first_body = settings.skip_first_indent() and (
            index == 0
            or (index > 0 and paragraphs[index - 1].style == "section")
        )
        cls = ' class="first"' if is_first_body else ""
        current.append(f"<p{cls}>{_esc(text)}</p>")
        used += cost

    if current:
        pages.append("".join(current))
    return pages


def _chapter_heading_html(chapter: Chapter, settings: LayoutSettings) -> str:
    if not chapter.has_heading:
        return ""

    literary = settings.style_id == "prosa_literaria"
    ornament = '<p class="ornament">* * *</p>' if settings.chapter_ornament() else ""

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
    if label and title.lower().startswith(label.lower()):
        title = title[len(label) :].strip(" —-.")

    label_html = f'<p class="chapter-label">{_esc(label)}</p>' if label else ""
    title_html = f"<h1 class='chapter-title'>{_esc(title)}</h1>" if title else ""
    return f'<div class="chapter-open">{label_html}{title_html}{ornament}</div>'


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
