from __future__ import annotations

import threading
import traceback
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from app.exporters import export_document
from app.extractors import extract_text
from app.models import Book
from app.structure import (
    build_book_from_folder,
    build_chapter_from_file,
    detect_structure,
    list_chapter_files,
)

COLORS = {
    "bg": "#F7F3EB",
    "card": "#FFFCF7",
    "ink": "#2C2416",
    "muted": "#6B5E4E",
    "accent": "#8B4513",
    "accent_hover": "#6D3410",
    "border": "#E0D5C3",
    "success": "#2F5D3A",
    "error": "#8B2E2E",
}


class BookSculptorApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()

        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("green")

        self.title("Book Sculptor")
        self.geometry("760x700")
        self.minsize(680, 620)
        self.configure(fg_color=COLORS["bg"])

        self.work_mode = ctk.StringVar(value="chapter")  # chapter | book
        self.selected_path: Path | None = None
        self.source_mode: str | None = None  # chapter_file | book_folder | book_file
        self.book: Book | None = None
        self._busy = False

        self._build_ui()
        self._on_work_mode_change()

    def _build_ui(self) -> None:
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=36, pady=(28, 8))

        ctk.CTkLabel(
            header,
            text="Book Sculptor",
            font=ctk.CTkFont(family="Georgia", size=32, weight="bold"),
            text_color=COLORS["ink"],
        ).pack(anchor="w")

        ctk.CTkLabel(
            header,
            text="Formate um capítulo isolado ou monte o livro completo.",
            font=ctk.CTkFont(size=14),
            text_color=COLORS["muted"],
        ).pack(anchor="w", pady=(4, 0))

        # Seletor de modo
        mode_card = ctk.CTkFrame(
            self,
            fg_color=COLORS["card"],
            corner_radius=16,
            border_width=1,
            border_color=COLORS["border"],
        )
        mode_card.pack(fill="x", padx=36, pady=(12, 8))

        mode_inner = ctk.CTkFrame(mode_card, fg_color="transparent")
        mode_inner.pack(fill="x", padx=20, pady=16)

        ctk.CTkLabel(
            mode_inner,
            text="O que você quer formatar?",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["muted"],
        ).pack(anchor="w")

        self.mode_switch = ctk.CTkSegmentedButton(
            mode_inner,
            values=["Capítulo", "Livro inteiro"],
            command=self._on_segment_click,
            font=ctk.CTkFont(size=14, weight="bold"),
            height=40,
            selected_color=COLORS["accent"],
            selected_hover_color=COLORS["accent_hover"],
            unselected_color="#EDE6DA",
            unselected_hover_color="#E0D5C3",
            text_color=COLORS["ink"],
            text_color_disabled=COLORS["muted"],
        )
        self.mode_switch.pack(fill="x", pady=(10, 8))
        self.mode_switch.set("Capítulo")

        self.mode_hint = ctk.CTkLabel(
            mode_inner,
            text="",
            font=ctk.CTkFont(size=12),
            text_color=COLORS["muted"],
            wraplength=640,
            justify="left",
        )
        self.mode_hint.pack(anchor="w")

        # Seleção
        self.drop_card = ctk.CTkFrame(
            self,
            fg_color=COLORS["card"],
            corner_radius=16,
            border_width=2,
            border_color=COLORS["border"],
        )
        self.drop_card.pack(fill="x", padx=36, pady=8)

        inner = ctk.CTkFrame(self.drop_card, fg_color="transparent")
        inner.pack(fill="x", padx=24, pady=20)

        self.file_label = ctk.CTkLabel(
            inner,
            text="Nada selecionado ainda",
            font=ctk.CTkFont(size=14),
            text_color=COLORS["muted"],
            wraplength=640,
            justify="left",
        )
        self.file_label.pack(anchor="w")

        btn_row = ctk.CTkFrame(inner, fg_color="transparent")
        btn_row.pack(fill="x", pady=(14, 0))

        self.pick_chapter_btn = ctk.CTkButton(
            btn_row,
            text="Escolher arquivo do capítulo",
            font=ctk.CTkFont(size=14, weight="bold"),
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
            text_color="#FFFFFF",
            height=42,
            corner_radius=10,
            command=self._pick_chapter_file,
        )
        self.pick_chapter_btn.pack(side="left")

        self.pick_folder_btn = ctk.CTkButton(
            btn_row,
            text="Escolher pasta de capítulos",
            font=ctk.CTkFont(size=14, weight="bold"),
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
            text_color="#FFFFFF",
            height=42,
            corner_radius=10,
            command=self._pick_folder,
        )

        self.pick_book_file_btn = ctk.CTkButton(
            btn_row,
            text="Ou um arquivo do livro",
            font=ctk.CTkFont(size=13),
            fg_color=COLORS["ink"],
            hover_color="#1A150E",
            text_color="#FFFFFF",
            height=42,
            corner_radius=10,
            command=self._pick_book_file,
        )

        # Formato
        options = ctk.CTkFrame(self, fg_color="transparent")
        options.pack(fill="x", padx=36, pady=(4, 4))

        ctk.CTkLabel(
            options,
            text="Formato de saída",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["muted"],
        ).pack(anchor="w")

        self.format_var = ctk.StringVar(value="docx")
        format_row = ctk.CTkFrame(options, fg_color="transparent")
        format_row.pack(anchor="w", pady=(6, 0))

        ctk.CTkRadioButton(
            format_row,
            text="Word (.docx)",
            variable=self.format_var,
            value="docx",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["ink"],
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
        ).pack(side="left", padx=(0, 16))

        ctk.CTkRadioButton(
            format_row,
            text="EPUB (.epub)",
            variable=self.format_var,
            value="epub",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["ink"],
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
        ).pack(side="left")

        # Preview
        preview_frame = ctk.CTkFrame(self, fg_color="transparent")
        preview_frame.pack(fill="both", expand=True, padx=36, pady=(8, 8))

        self.preview_title = ctk.CTkLabel(
            preview_frame,
            text="Pré-visualização",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["muted"],
        )
        self.preview_title.pack(anchor="w")

        self.preview = ctk.CTkTextbox(
            preview_frame,
            font=ctk.CTkFont(family="Consolas", size=13),
            fg_color=COLORS["card"],
            text_color=COLORS["ink"],
            border_width=1,
            border_color=COLORS["border"],
            corner_radius=12,
            wrap="word",
            state="disabled",
        )
        self.preview.pack(fill="both", expand=True, pady=(6, 0))

        # Rodapé
        footer = ctk.CTkFrame(self, fg_color="transparent")
        footer.pack(fill="x", padx=36, pady=(8, 24))

        self.status = ctk.CTkLabel(
            footer,
            text="Escolha o modo e selecione o arquivo ou a pasta",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["muted"],
        )
        self.status.pack(side="left")

        self.export_btn = ctk.CTkButton(
            footer,
            text="Salvar",
            font=ctk.CTkFont(size=14, weight="bold"),
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
            text_color="#FFFFFF",
            height=42,
            width=140,
            corner_radius=10,
            state="disabled",
            command=self._export,
        )
        self.export_btn.pack(side="right")

        self.process_btn = ctk.CTkButton(
            footer,
            text="Formatar",
            font=ctk.CTkFont(size=14, weight="bold"),
            fg_color=COLORS["ink"],
            hover_color="#1A150E",
            text_color="#FFFFFF",
            height=42,
            width=120,
            corner_radius=10,
            state="disabled",
            command=self._process,
        )
        self.process_btn.pack(side="right", padx=(0, 10))

    def _on_segment_click(self, value: str) -> None:
        self.work_mode.set("chapter" if value == "Capítulo" else "book")
        self._on_work_mode_change()

    def _on_work_mode_change(self) -> None:
        mode = self.work_mode.get()
        self.selected_path = None
        self.source_mode = None
        self.book = None
        self.process_btn.configure(state="disabled")
        self.export_btn.configure(state="disabled")
        self._set_preview("")
        self.file_label.configure(text="Nada selecionado ainda", text_color=COLORS["muted"])

        # Esconde todos e mostra os do modo atual
        self.pick_chapter_btn.pack_forget()
        self.pick_folder_btn.pack_forget()
        self.pick_book_file_btn.pack_forget()

        if mode == "chapter":
            self.mode_hint.configure(
                text="O arquivo será tratado só como conteúdo de um capítulo — "
                "sem página de título, sem sumário, sem estrutura de livro."
            )
            self.pick_chapter_btn.pack(side="left")
            self.export_btn.configure(text="Salvar capítulo")
            self.preview_title.configure(text="Pré-visualização do capítulo")
            self._set_status("Selecione o arquivo do capítulo para formatar")
        else:
            self.mode_hint.configure(
                text="Monte o livro completo: pasta com um arquivo por capítulo, "
                "ou um único arquivo que já contenha vários capítulos."
            )
            self.pick_folder_btn.pack(side="left")
            self.pick_book_file_btn.pack(side="left", padx=(10, 0))
            self.export_btn.configure(text="Salvar livro")
            self.preview_title.configure(text="Pré-visualização do livro")
            self._set_status("Selecione a pasta ou o arquivo do livro")

    def _set_status(self, text: str, color: str | None = None) -> None:
        self.status.configure(text=text, text_color=color or COLORS["muted"])

    def _set_preview(self, text: str) -> None:
        self.preview.configure(state="normal")
        self.preview.delete("1.0", "end")
        self.preview.insert("1.0", text)
        self.preview.configure(state="disabled")

    def _ready_selection(self, path: Path, mode: str, label: str, status: str) -> None:
        self.selected_path = path
        self.source_mode = mode
        self.book = None
        self.file_label.configure(text=label, text_color=COLORS["ink"])
        self.process_btn.configure(state="normal")
        self.export_btn.configure(state="disabled")
        self._set_status(status)

    def _pick_chapter_file(self) -> None:
        if self._busy:
            return
        path = filedialog.askopenfilename(
            title="Escolher arquivo do capítulo",
            filetypes=[
                ("PDF e Word", "*.pdf *.docx"),
                ("PDF", "*.pdf"),
                ("Word", "*.docx"),
                ("Todos", "*.*"),
            ],
        )
        if not path:
            return
        selected = Path(path)
        self._ready_selection(
            selected,
            "chapter_file",
            f"Capítulo: {selected.name}",
            "Arquivo do capítulo pronto. Clique em Formatar.",
        )
        self._set_preview(
            "Este arquivo será formatado apenas como um capítulo.\n"
            "Não será criada página de título nem sumário de livro."
        )

    def _pick_folder(self) -> None:
        if self._busy:
            return
        path = filedialog.askdirectory(title="Escolher pasta com capítulos")
        if not path:
            return

        selected = Path(path)
        try:
            files = list_chapter_files(selected)
        except ValueError as exc:
            messagebox.showerror("Pasta inválida", str(exc))
            return

        if not files:
            messagebox.showwarning(
                "Pasta vazia",
                "Nenhum arquivo PDF ou Word (.docx) foi encontrado nesta pasta.",
            )
            return

        names = "\n".join(f"  {i}. {f.name}" for i, f in enumerate(files, start=1))
        self._ready_selection(
            selected,
            "book_folder",
            f"Livro (pasta): {selected.name}  —  {len(files)} capítulos",
            f"{len(files)} capítulos encontrados. Clique em Formatar.",
        )
        self._set_preview(
            f"Livro completo — ordem dos capítulos:\n\n{names}\n\n"
            "Serão gerados: página de título, sumário e capítulos."
        )

    def _pick_book_file(self) -> None:
        if self._busy:
            return
        path = filedialog.askopenfilename(
            title="Escolher arquivo do livro",
            filetypes=[
                ("PDF e Word", "*.pdf *.docx"),
                ("PDF", "*.pdf"),
                ("Word", "*.docx"),
                ("Todos", "*.*"),
            ],
        )
        if not path:
            return
        selected = Path(path)
        self._ready_selection(
            selected,
            "book_file",
            f"Livro (arquivo): {selected.name}",
            "Arquivo do livro pronto. Clique em Formatar.",
        )
        self._set_preview(
            "O app vai procurar capítulos dentro deste arquivo e montar o livro completo\n"
            "(página de título, sumário e capítulos)."
        )

    def _process(self) -> None:
        if not self.selected_path or not self.source_mode or self._busy:
            return

        self._busy = True
        self.process_btn.configure(state="disabled")
        self.export_btn.configure(state="disabled")
        self._set_status("Lendo e formatando… isso pode levar alguns segundos.")

        thread = threading.Thread(target=self._process_worker, daemon=True)
        thread.start()

    def _process_worker(self) -> None:
        try:
            assert self.selected_path is not None
            assert self.source_mode is not None

            if self.source_mode == "chapter_file":
                book = build_chapter_from_file(self.selected_path)
            elif self.source_mode == "book_folder":
                book = build_book_from_folder(self.selected_path)
            else:
                _, blocks = extract_text(self.selected_path)
                book = detect_structure(blocks, self.selected_path)

            self.after(0, lambda: self._on_process_ok(book))
        except Exception as exc:  # noqa: BLE001
            err = str(exc) or traceback.format_exc()
            self.after(0, lambda: self._on_process_error(err))

    def _on_process_ok(self, book: Book) -> None:
        self.book = book
        self._busy = False
        self.process_btn.configure(state="normal")
        self.export_btn.configure(state="normal")

        if book.is_chapter:
            chapter = book.primary_chapter
            assert chapter is not None
            number_line = (
                f"Número: {chapter.number}"
                if chapter.number is not None
                else "Número: (sem número)"
            )
            lines = [
                "Tipo: CAPÍTULO (conteúdo isolado)",
                f"Título do capítulo: {chapter.title}",
                number_line,
                f"Parágrafos: {len(chapter.paragraphs)}",
                f"Palavras (aprox.): {book.word_count:,}".replace(",", "."),
                "",
                "Saída: só o capítulo formatado — sem página de título nem sumário.",
            ]
            self._set_status(
                "Capítulo pronto. Clique em Salvar capítulo.",
                COLORS["success"],
            )
        else:
            lines = [
                "Tipo: LIVRO INTEIRO",
                f"Título: {book.title}",
                f"Autor: {book.author or '(não detectado)'}",
                f"Capítulos: {book.chapter_count}",
                f"Palavras (aprox.): {book.word_count:,}".replace(",", "."),
                "",
                "Capítulos:",
            ]
            for chapter in book.chapters:
                if chapter.number is not None and chapter.title != "Introdução":
                    lines.append(f"  • Capítulo {chapter.number} — {chapter.title}")
                else:
                    lines.append(f"  • {chapter.title}")
                lines.append(f"      ({len(chapter.paragraphs)} parágrafos)")
            lines.append("")
            lines.append("Saída: página de título + sumário + capítulos.")
            self._set_status(
                "Livro pronto. Clique em Salvar livro.",
                COLORS["success"],
            )

        self._set_preview("\n".join(lines))

    def _on_process_error(self, message: str) -> None:
        self._busy = False
        self.process_btn.configure(state="normal")
        self._set_status("Não foi possível processar.", COLORS["error"])
        messagebox.showerror("Erro", f"Algo deu errado:\n\n{message}")

    def _export(self) -> None:
        if not self.book or self._busy:
            return

        fmt = self.format_var.get()
        ext = "docx" if fmt == "docx" else "epub"

        if self.book.is_chapter:
            chapter = self.book.primary_chapter
            assert chapter is not None
            if chapter.number is not None:
                default_name = f"Capitulo {chapter.number} - {chapter.title}.{ext}"
            else:
                default_name = f"{chapter.title}.{ext}"
            dialog_title = "Salvar capítulo"
            success_label = "Capítulo"
        else:
            default_name = f"{self.book.title}.{ext}"
            dialog_title = "Salvar livro"
            success_label = "Livro"

        safe = "".join(c for c in default_name if c not in '<>:"/\\|?*')
        filetypes = [("Word", "*.docx")] if fmt == "docx" else [("EPUB", "*.epub")]

        path = filedialog.asksaveasfilename(
            title=dialog_title,
            defaultextension=f".{ext}",
            initialfile=safe,
            filetypes=filetypes,
        )
        if not path:
            return

        try:
            saved = export_document(self.book, path, fmt=fmt)
            self._set_status(f"{success_label} salvo: {saved.name}", COLORS["success"])
            messagebox.showinfo(
                "Sucesso",
                f"{success_label} salvo com sucesso!\n\n{saved}",
            )
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Erro ao salvar", str(exc))
            self._set_status("Falha ao salvar o arquivo.", COLORS["error"])


def run() -> None:
    app = BookSculptorApp()
    app.mainloop()
