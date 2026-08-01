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
    heading = ""

    if chapter.has_heading:
        if chapter.kind == "prologue":
            label = "Prólogo"
        elif chapter.kind == "epilogue":
            label = "Epílogo"
        elif chapter.number is not None and chapter.kind == "chapter":
            label = f"Capítulo {chapter.number}" if literary else f"CAPÍTULO {chapter.number}"
        else:
            label = ""

        title = chapter.title
        if chapter.kind in {"prologue", "epilogue"} and title.lower() in {
            "prólogo",
            "prologo",
            "epílogo",
            "epilogo",
        }:
            title = ""

        if label:
            heading += f'<p class="chapter-label">{label}</p>'
        if title:
            heading += f"<h1>{_html_escape(title)}</h1>"
        if settings.chapter_ornament() and chapter.kind not in {"prologue", "epilogue"}:
            heading += '<p class="ornament">* * *</p>'
        elif chapter.kind in {"prologue", "epilogue"}:
            heading += '<div class="open-spacer"></div>'

    paragraphs = []
    for index, p in enumerate(chapter.paragraphs):
        if p.style == "section":
            paragraphs.append('<p class="section-rule">. . .</p>')
            paragraphs.append(f'<h2 class="section-title">{_html_escape(p.text)}</h2>')
            continue
        if p.style == "dialogue":
            paragraphs.append(f'<p class="dialogue">{_html_escape(p.text)}</p>')
            continue
        prev_section = index > 0 and chapter.paragraphs[index - 1].style == "section"
        cls = (
            ' class="first"'
            if settings.skip_first_indent() and (index == 0 or prev_section)
            else ""
        )
        paragraphs.append(f"<p{cls}>{_html_escape(p.text)}</p>")
    return chapter.display_label, heading + "".join(paragraphs)

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
    .open-spacer {{ height: 1.35em; }}
    .section-rule {{
      text-align: center;
      color: #aaa;
      letter-spacing: 0.35em;
      text-indent: 0 !important;
      margin: 1.4em 0 0.3em;
    }}
    h2.section-title {{
      text-align: center;
      font-size: 1.08em;
      font-weight: 600;
      font-style: italic;
      margin: 0.3em 0 1em;
      text-indent: 0;
    }}
    p {{
      text-align: justify;
      text-indent: {indent}cm;
      margin: 0 0 {gap}pt;
      hyphens: auto;
    }}
    p.first {{ text-indent: 0; }}
    p.dialogue {{
      text-indent: {indent}cm;
      margin: 0 0 {gap}pt;
    }}
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

    has_named = any(
        c.has_heading or any(p.style == "section" for p in c.paragraphs)
        for c in book.chapters
    )
    if settings.include_toc and has_named:
        items = []
        for chapter in book.chapters:
            if chapter.has_heading:
                items.append(f"<li>{_html_escape(chapter.display_label)}</li>")
            for para in chapter.paragraphs:
                if para.style == "section":
                    items.append(
                        f'<li style="margin-left:1.2em">{_html_escape(para.text)}</li>'
                    )
        if items:
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
