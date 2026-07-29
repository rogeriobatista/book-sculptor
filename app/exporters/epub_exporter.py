from __future__ import annotations

from pathlib import Path

from ebooklib import epub

from app.models import Book, Chapter


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _chapter_html(chapter: Chapter) -> tuple[str, str]:
    if chapter.number is not None and chapter.title != "Introdução":
        heading = (
            f"<h2>Capítulo {chapter.number}</h2>"
            f"<h1>{_html_escape(chapter.title)}</h1>"
        )
        toc_label = f"Capítulo {chapter.number} — {chapter.title}"
    else:
        heading = f"<h1>{_html_escape(chapter.title)}</h1>"
        toc_label = chapter.title

    paragraphs = "".join(f"<p>{_html_escape(p.text)}</p>" for p in chapter.paragraphs)
    return toc_label, heading + paragraphs


def _book_css() -> str:
    return """
    body { font-family: Georgia, serif; line-height: 1.6; margin: 1.2em; }
    h1 { text-align: center; margin-top: 1.2em; font-size: 1.6em; }
    h2 { text-align: center; color: #666; font-size: 0.95em; font-weight: normal; margin-bottom: 0; }
    p { text-align: justify; text-indent: 1.5em; margin: 0.6em 0; }
    .title-page { text-align: center; margin-top: 30%; }
    .title-page h1 { font-size: 2em; }
    .author { color: #444; margin-top: 1.5em; }
    """


def export_chapter_epub(book: Book, output_path: str | Path) -> Path:
    """Exporta apenas um capítulo em EPUB (sem página de título de livro)."""
    path = Path(output_path)
    chapter = book.primary_chapter
    if chapter is None:
        raise ValueError("Nenhum conteúdo de capítulo para exportar.")

    ebook = epub.EpubBook()
    toc_label, content = _chapter_html(chapter)
    ebook.set_identifier(f"book-sculptor-chapter-{path.stem}")
    ebook.set_title(toc_label)
    ebook.set_language("pt")

    css = epub.EpubItem(
        uid="style",
        file_name="style/book.css",
        media_type="text/css",
        content=_book_css().encode("utf-8"),
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


def export_epub(book: Book, output_path: str | Path) -> Path:
    """Exporta o livro completo como EPUB."""
    if book.is_chapter:
        return export_chapter_epub(book, output_path)

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
        content=_book_css().encode("utf-8"),
    )
    ebook.add_item(css)

    title_html = (
        f'<div class="title-page"><h1>{_html_escape(book.title)}</h1>'
        + (f'<p class="author">{_html_escape(book.author)}</p>' if book.author else "")
        + "</div>"
    )
    title_page = epub.EpubHtml(title="Título", file_name="title.xhtml", lang="pt")
    title_page.content = title_html
    title_page.add_item(css)
    ebook.add_item(title_page)

    spine = ["nav", title_page]
    toc = []

    for index, chapter in enumerate(book.chapters):
        toc_label, content = _chapter_html(chapter)
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
