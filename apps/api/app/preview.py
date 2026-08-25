from __future__ import annotations

from app.i18n_labels import SPECIAL_SECTION_KINDS
from app.layout import LayoutSettings
from app.models import Book, Chapter
from app.typography_flow import (
    first_drop_cap_index,
    is_section_paragraph,
    previous_breaks_indent,
)


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

    locale = getattr(book, "locale", "pt-BR")
    if book.is_chapter:
        for chapter in book.chapters:
            chunks = _paginate_chapter(chapter, chars_per_page, settings, locale=locale)
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
        cover_url = getattr(book, "cover_url", None)
        if cover_url:
            pages.append(
                {
                    "type": "cover",
                    "title": book.title,
                    "html": _cover_page_html(book),
                }
            )
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
            from app.i18n_labels import t

            toc_title = t("toc", getattr(book, "locale", "pt-BR"))
            pages.append(
                {
                    "type": "toc",
                    "title": toc_title,
                    "html": _toc_html(book),
                }
            )

        for chapter in book.chapters:
            chunks = _paginate_chapter(chapter, chars_per_page, settings, locale=locale)
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


def _cover_page_html(book: Book) -> str:
    url = getattr(book, "cover_url", None) or ""
    alt = _esc(book.title or "Cover")
    return (
        f'<div class="cover-page">'
        f'<img src="{_esc(url)}" alt="{alt}" class="cover-image" />'
        f"</div>"
    )


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
    from app.i18n_labels import t

    locale = getattr(book, "locale", "pt-BR")
    toc_title = t("toc", locale)
    items = []
    for chapter in book.chapters:
        if chapter.has_heading:
            items.append(f"<li>{_esc(chapter.label_for(locale))}</li>")
        for para in chapter.paragraphs:
            if para.style == "section":
                items.append(f'<li class="toc-section">{_esc(para.text)}</li>')
    if not items:
        return f'<div class="toc"><h1>{toc_title}</h1><p class="muted">—</p></div>'
    return f'<div class="toc"><h1>{toc_title}</h1><ul>{"".join(items)}</ul></div>'

def _paginate_chapter(
    chapter: Chapter,
    chars_per_page: int,
    settings: LayoutSettings,
    locale: str = "pt-BR",
) -> list[str]:
    heading = _chapter_heading_html(chapter, settings, locale=locale)
    paragraphs = list(chapter.paragraphs)
    if not paragraphs:
        return [heading] if heading else []

    pages: list[str] = []
    has_open = bool(heading)
    # Abertura tipográfica reserva espaço; o corpo ainda precisa preencher a página
    open_ratio = 0.52 if chapter.kind in SPECIAL_SECTION_KINDS else 0.45
    first_budget = int(chars_per_page * (open_ratio if has_open else 1.0))
    budget = first_budget
    current: list[str] = [heading] if heading else []
    used = 200 if has_open else 0
    min_blocks = 1 if has_open else 0

    drop_at = first_drop_cap_index(paragraphs) if settings.drop_cap else None

    for index, para in enumerate(paragraphs):
        text = para.text
        cost = len(text) + 20
        if current and used + cost > budget and len(current) > min_blocks:
            pages.append("".join(current))
            current = []
            used = 0
            budget = chars_per_page
            min_blocks = 0
        if is_section_paragraph(para.style, text):
            current.append('<p class="section-rule">. . .</p>')
            current.append(f'<h2 class="section-title">{_esc(text)}</h2>')
            used += 60
            continue
        if para.style == "dialogue":
            current.append(f'<p class="dialogue">{_esc(text)}</p>')
            used += cost
            continue
        # first indent: primeiro parágrafo de corpo após título/seção
        is_first_body = previous_breaks_indent(paragraphs, index)
        classes: list[str] = []
        if settings.skip_first_indent() and is_first_body:
            classes.append("first")
        if drop_at is not None and index == drop_at:
            classes.append("dropcap")
            if "first" not in classes:
                classes.append("first")
        cls = f' class="{" ".join(classes)}"' if classes else ""
        current.append(f"<p{cls}>{_esc(text)}</p>")
        used += cost

    if current:
        pages.append("".join(current))
    return pages


def _chapter_heading_html(
    chapter: Chapter,
    settings: LayoutSettings,
    locale: str = "pt-BR",
) -> str:
    if not chapter.has_heading:
        return ""

    from app.typography_i18n import kind_label

    literary = settings.style_id == "prosa_literaria"
    # Matéria especial: só espaço tipográfico (sem ornamento entre título e texto)
    show_ornament = settings.chapter_ornament() and chapter.kind not in SPECIAL_SECTION_KINDS
    ornament = '<p class="ornament">* * *</p>' if show_ornament else ""

    if chapter.kind in SPECIAL_SECTION_KINDS:
        label = kind_label(chapter, literary=literary, locale=locale)
        open_class = f"chapter-open {chapter.kind}-open"
    elif chapter.number is not None and chapter.kind == "chapter":
        label = kind_label(chapter, literary=literary, locale=locale)
        open_class = "chapter-open"
    else:
        label = ""
        open_class = "chapter-open"

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
    if label and title.lower().startswith(label.lower()):
        title = title[len(label) :].strip(" —-.")

    label_html = f'<p class="chapter-label">{_esc(label)}</p>' if label else ""
    title_html = f"<h1 class='chapter-title'>{_esc(title)}</h1>" if title else ""
    spacer = (
        '<div class="open-spacer" aria-hidden="true"></div>'
        if chapter.kind in SPECIAL_SECTION_KINDS and not show_ornament
        else ""
    )
    return f'<div class="{open_class}">{label_html}{title_html}{ornament}{spacer}</div>'


def _esc(text: str) -> str:
    cleaned = " ".join(text.replace("\u00ad", "").split())
    return (
        cleaned.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def settings_css(settings: LayoutSettings) -> dict:
    """Métricas da página para a prévia (tamanho realista ~96 dpi)."""
    fmt = settings.format()
    font = settings.font()
    top, bottom, left, right = settings.margins_cm()
    # ~96 CSS dpi: 1 cm ≈ 37.8 px — tipografia e margens ficam fiéis ao impresso
    px_per_cm = 37.795
    return {
        "width_cm": fmt.width_cm,
        "height_cm": fmt.height_cm,
        "margins_cm": [top, bottom, left, right],
        "px_per_cm": px_per_cm,
        "width_px": round(fmt.width_cm * px_per_cm),
        "height_px": round(fmt.height_cm * px_per_cm),
        "padding": (
            f"{top * px_per_cm:.1f}px {right * px_per_cm:.1f}px "
            f"{bottom * px_per_cm:.1f}px {left * px_per_cm:.1f}px"
        ),
        "font_family": font.css_family,
        "font_size": f"{settings.font_size}pt",
        "line_height": settings.line_height(),
        "page_number": settings.page_number,
        "format_label": fmt.label,
        "font_label": font.label,
        "style_id": settings.style_id,
        "indent_em": round(settings.first_line_indent_cm() / 0.423, 2),  # cm → em approx at 11pt
        "paragraph_gap_pt": settings.paragraph_spacing_pt(),
        "skip_first_indent": settings.skip_first_indent(),
        "drop_cap": settings.drop_cap,
        "running_header": settings.running_header,
    }


def preview_payload(book: Book, settings: LayoutSettings) -> dict:
    pages = build_preview_pages(book, settings)
    css = settings_css(settings)
    if settings.running_header == "author":
        css["running_header_text"] = (book.author or "").strip()
    elif settings.running_header == "title":
        css["running_header_text"] = (book.title or "").strip()
    else:
        css["running_header_text"] = ""
    return {
        "book": book_to_dict(book),
        "settings": settings.to_dict(),
        "css": css,
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
