from __future__ import annotations

from pathlib import Path

from ebooklib import epub

from app.i18n_labels import SPECIAL_SECTION_KINDS
from app.layout import LayoutSettings
from app.models import Book, Chapter
from app.storage import get_bytes
from app.typography_flow import (
    first_drop_cap_index,
    is_section_paragraph,
    previous_breaks_indent,
)


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _chapter_html(
    chapter: Chapter,
    settings: LayoutSettings,
    locale: str = "pt-BR",
) -> tuple[str, str]:
    from app.typography_i18n import kind_label

    literary = settings.style_id == "prosa_literaria"
    heading = ""

    if chapter.has_heading:
        if chapter.kind in SPECIAL_SECTION_KINDS or (
            chapter.kind == "chapter" and chapter.number is not None
        ):
            label = kind_label(chapter, literary=literary, locale=locale)
        else:
            label = ""

        title = chapter.title
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

        if label:
            heading += f'<p class="chapter-label">{label}</p>'
        if title:
            heading += f"<h1>{_html_escape(title)}</h1>"
        if settings.chapter_ornament() and chapter.kind not in SPECIAL_SECTION_KINDS:
            heading += '<p class="ornament">* * *</p>'
        elif chapter.kind in SPECIAL_SECTION_KINDS:
            heading += '<div class="open-spacer"></div>'

    paragraphs = []
    drop_at = first_drop_cap_index(chapter.paragraphs) if settings.drop_cap else None
    for index, p in enumerate(chapter.paragraphs):
        if is_section_paragraph(p.style, p.text):
            paragraphs.append('<p class="section-rule">. . .</p>')
            paragraphs.append(f'<h2 class="section-title">{_html_escape(p.text)}</h2>')
            continue
        if p.style == "dialogue":
            paragraphs.append(f'<p class="dialogue">{_html_escape(p.text)}</p>')
            continue
        is_opener = previous_breaks_indent(chapter.paragraphs, index)
        classes: list[str] = []
        if settings.skip_first_indent() and is_opener:
            classes.append("first")
        if drop_at is not None and index == drop_at:
            classes.append("dropcap")
            if "first" not in classes:
                classes.append("first")
        cls = f' class="{" ".join(classes)}"' if classes else ""
        paragraphs.append(f"<p{cls}>{_html_escape(p.text)}</p>")
    return chapter.display_label, heading + "".join(paragraphs)

def _book_css(settings: LayoutSettings) -> str:
    font = settings.font().css_family
    size = settings.font_size
    lh = settings.line_height()
    indent = settings.first_line_indent_cm()
    gap = settings.paragraph_spacing_pt()
    drop_cap_css = ""
    if settings.drop_cap:
        drop_cap_css = """
    p.dropcap {
      text-indent: 0 !important;
      display: flow-root;
    }
    p.dropcap::first-letter {
      float: left;
      font-size: 3.05em;
      line-height: 0.78;
      padding: 0.04em 0.1em 0 0;
      font-weight: 650;
    }
"""
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
    {drop_cap_css}
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

    cover_key = getattr(book, "cover_key", None)
    if cover_key:
        cover_bytes = get_bytes(cover_key)
        if cover_bytes:
            lower = cover_key.lower()
            if lower.endswith(".png"):
                ebook.set_cover("cover.png", cover_bytes)
            elif lower.endswith(".webp"):
                # Many EPUB readers reject WebP covers; skip metadata cover.
                pass
            else:
                ebook.set_cover("cover.jpg", cover_bytes)

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
    locale = getattr(book, "locale", "pt-BR")
    if settings.include_toc and has_named:
        from app.typography_i18n import toc_title

        items = []
        for chapter in book.chapters:
            if chapter.has_heading:
                items.append(f"<li>{_html_escape(chapter.label_for(locale))}</li>")
            for para in chapter.paragraphs:
                if para.style == "section":
                    items.append(
                        f'<li style="margin-left:1.2em">{_html_escape(para.text)}</li>'
                    )
        if items:
            title = toc_title(book)
            toc_page = epub.EpubHtml(title=title, file_name="toc.xhtml", lang=locale)
            toc_page.content = f"<h1>{title}</h1><ul>{''.join(items)}</ul>"
            toc_page.add_item(css)
            ebook.add_item(toc_page)
            spine.append(toc_page)

    for index, chapter in enumerate(book.chapters):
        toc_label, content = _chapter_html(chapter, settings, locale=locale)
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
