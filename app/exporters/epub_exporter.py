from __future__ import annotations

from pathlib import Path

from ebooklib import epub

from app.layout import LayoutSettings
from app.models import Book, Chapter


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _chapter_html(chapter: Chapter, settings: LayoutSettings) -> tuple[str, str]:
    literary = settings.style_id == "prosa_literaria"
    if chapter.number is not None and chapter.title not in {"Introdução", "Prefácio"}:
        label = f"Capítulo {chapter.number}" if literary else f"CAPÍTULO {chapter.number}"
        heading = (
            f'<p class="chapter-label">{label}</p>'
            f"<h1>{_html_escape(chapter.title)}</h1>"
        )
        if settings.chapter_ornament():
            heading += '<p class="ornament">❧</p>'
        toc_label = f"Capítulo {chapter.number} — {chapter.title}"
    else:
        heading = f"<h1>{_html_escape(chapter.title)}</h1>"
        if settings.chapter_ornament():
            heading += '<p class="ornament">❧</p>'
        toc_label = chapter.title

    paragraphs = []
    for index, p in enumerate(chapter.paragraphs):
        cls = ' class="first"' if settings.skip_first_indent() and index == 0 else ""
        paragraphs.append(f"<p{cls}>{_html_escape(p.text)}</p>")
    return toc_label, heading + "".join(paragraphs)


def _book_css(settings: LayoutSettings) -> str:
    font = settings.font().css_family
    size = settings.font_size
    lh = settings.line_height()
    indent = settings.first_line_indent_cm()
    gap = settings.paragraph_spacing_pt()
    return f"""
    body {{
      font-family: {font};
      line-height: {lh};
      margin: 1.2em;
      font-size: {size}pt;
      color: #1a1a1a;
    }}
    h1 {{
      text-align: center;
      margin: 0.4em 0 0.2em;
      font-size: 1.45em;
      font-weight: 600;
    }}
    .chapter-label {{
      text-align: center;
      color: #666;
      font-size: 0.95em;
      font-style: italic;
      letter-spacing: 0.06em;
      text-indent: 0 !important;
      margin: 2.5em 0 0.3em;
    }}
    .ornament {{
      text-align: center;
      color: #888;
      text-indent: 0 !important;
      margin: 0.2em 0 1.6em;
    }}
    p {{
      text-align: justify;
      text-indent: {indent}cm;
      margin: 0 0 {gap}pt;
      hyphens: auto;
    }}
    p.first {{ text-indent: 0; }}
    .title-page {{ text-align: center; margin-top: 30%; }}
    .title-page h1 {{ font-size: 2em; font-weight: 700; }}
    .title-rule {{ color: #888; margin: 1em 0; text-indent: 0; }}
    .author {{ color: #444; margin-top: 0.5em; text-indent: 0; font-style: italic; }}
    """


def export_chapter_epub(
    book: Book,
    output_path: str | Path,
    settings: LayoutSettings | None = None,
) -> Path:
    settings = settings or LayoutSettings()
    path = Path(output_path)
    chapter = book.primary_chapter
    if chapter is None:
        raise ValueError("Nenhum conteúdo de capítulo para exportar.")

    ebook = epub.EpubBook()
    toc_label, content = _chapter_html(chapter, settings)
    ebook.set_identifier(f"book-sculptor-chapter-{path.stem}")
    ebook.set_title(toc_label)
    ebook.set_language("pt")

    css = epub.EpubItem(
        uid="style",
        file_name="style/book.css",
        media_type="text/css",
        content=_book_css(settings).encode("utf-8"),
    )
    ebook.add_item(css)

    item = epub.EpubHtml(title=toc_label, file_name="chapter.xhtml", lang="pt")
    item.content = content
    item.add_item(css)
    ebook.add_item(item)

    ebook.toc = (item,)
    ebook.spine = ["nav", item]
    ebook.add_item(epub.EpubNcx())
    ebook.add_item(epub.EpubNav())
    epub.write_epub(str(path), ebook)
    return path


def export_epub(
    book: Book,
    output_path: str | Path,
    settings: LayoutSettings | None = None,
) -> Path:
    settings = settings or LayoutSettings()
    if book.is_chapter:
        return export_chapter_epub(book, output_path, settings)

    path = Path(output_path)
    ebook = epub.EpubBook()

    ebook.set_identifier(f"book-sculptor-{path.stem}")
    ebook.set_title(book.title)
    ebook.set_language("pt")
    if book.author:
        ebook.add_author(book.author)

    css = epub.EpubItem(
        uid="style",
        file_name="style/book.css",
        media_type="text/css",
        content=_book_css(settings).encode("utf-8"),
    )
    ebook.add_item(css)

    title_html = (
        f'<div class="title-page"><h1>{_html_escape(book.title)}</h1>'
        f'<p class="title-rule">—</p>'
        + (f'<p class="author">{_html_escape(book.author)}</p>' if book.author else "")
        + "</div>"
    )
    title_page = epub.EpubHtml(title="Título", file_name="title.xhtml", lang="pt")
    title_page.content = title_html
    title_page.add_item(css)
    ebook.add_item(title_page)

    spine: list = ["nav", title_page]
    toc = []

    if settings.include_toc:
        items = []
        for chapter in book.chapters:
            if chapter.number is not None and chapter.title not in {"Introdução", "Prefácio"}:
                label = f"Capítulo {chapter.number} — {chapter.title}"
            else:
                label = chapter.title
            items.append(f"<li>{_html_escape(label)}</li>")
        toc_page = epub.EpubHtml(title="Sumário", file_name="toc.xhtml", lang="pt")
        toc_page.content = f"<h1>Sumário</h1><ul>{''.join(items)}</ul>"
        toc_page.add_item(css)
        ebook.add_item(toc_page)
        spine.append(toc_page)

    for index, chapter in enumerate(book.chapters):
        toc_label, content = _chapter_html(chapter, settings)
        item = epub.EpubHtml(
            title=toc_label,
            file_name=f"chapter_{index + 1}.xhtml",
            lang="pt",
        )
        item.content = content
        item.add_item(css)
        ebook.add_item(item)
        spine.append(item)
        toc.append(item)

    ebook.toc = tuple(toc)
    ebook.spine = spine
    ebook.add_item(epub.EpubNcx())
    ebook.add_item(epub.EpubNav())
    epub.write_epub(str(path), ebook)
    return path
