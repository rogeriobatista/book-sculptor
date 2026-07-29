from __future__ import annotations

import threading
import traceback
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from app.exporters import export_book
from app.extractors import extract_text
from app.models import Book
from app.structure import build_book_from_folder, detect_structure, list_chapter_files

# Visual: papel / tinta — legível e acolhedor para usuários não técnicos
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
        self.geometry("740x660")
        self.minsize(660, 580)
        self.configure(fg_color=COLORS["bg"])

        self.selected_path: Path | None = None
        self.source_mode: str | None = None  # "file" | "folder"
        self.book: Book | None = None
        self._busy = False

        self._build_ui()

    def _build_ui(self) -> None:
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=36, pady=(32, 8))

        ctk.CTkLabel(
            header,
            text="Book Sculptor",
            font=ctk.CTkFont(family="Georgia", size=32, weight="bold"),
            text_color=COLORS["ink"],
        ).pack(anchor="w")

        ctk.CTkLabel(
            header,
            text="Transforme PDFs e documentos Word em livros bem formatados.",
            font=ctk.CTkFont(size=14),
            text_color=COLORS["muted"],
        ).pack(anchor="w", pady=(4, 0))

        self.drop_card = ctk.CTkFrame(
            self,
            fg_color=COLORS["card"],
            corner_radius=16,
            border_width=2,
            border_color=COLORS["border"],
        )
        self.drop_card.pack(fill="x", padx=36, pady=16)

        inner = ctk.CTkFrame(self.drop_card, fg_color="transparent")
        inner.pack(fill="x", padx=24, pady=24)

        self.file_label = ctk.CTkLabel(
            inner,
            text="Nenhum arquivo ou pasta selecionado",
            font=ctk.CTkFont(size=14),
            text_color=COLORS["muted"],
            wraplength=620,
            justify="left",
        )
        self.file_label.pack(anchor="w")

        hint = ctk.CTkLabel(
            inner,
            text="Arquivo único = um documento com vários capítulos  ·  Pasta = cada arquivo vira um capítulo",
            font=ctk.CTkFont(size=12),
            text_color=COLORS["muted"],
            wraplength=620,
            justify="left",
        )
        hint.pack(anchor="w", pady=(8, 0))

        btn_row = ctk.CTkFrame(inner, fg_color="transparent")
        btn_row.pack(fill="x", pady=(16, 0))

        self.pick_btn = ctk.CTkButton(
            btn_row,
            text="Escolher arquivo",
            font=ctk.CTkFont(size=14, weight="bold"),
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
            text_color="#FFFFFF",
            height=42,
            corner_radius=10,
            command=self._pick_file,
        )
        self.pick_btn.pack(side="left")

        self.pick_folder_btn = ctk.CTkButton(
            btn_row,
            text="Escolher pasta de capítulos",
            font=ctk.CTkFont(size=14, weight="bold"),
            fg_color=COLORS["ink"],
            hover_color="#1A150E",
            text_color="#FFFFFF",
            height=42,
            corner_radius=10,
            command=self._pick_folder,
        )
        self.pick_folder_btn.pack(side="left", padx=(10, 0))

        options = ctk.CTkFrame(self, fg_color="transparent")
        options.pack(fill="x", padx=36, pady=(4, 8))

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
            text="Word (.docx) — abre no Word / LibreOffice",
            variable=self.format_var,
            value="docx",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["ink"],
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
        ).pack(anchor="w", pady=2)

        ctk.CTkRadioButton(
            format_row,
            text="EPUB (.epub) — para leitores digitais",
            variable=self.format_var,
            value="epub",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["ink"],
            fg_color=COLORS["accent"],
            hover_color=COLORS["accent_hover"],
        ).pack(anchor="w", pady=2)

        preview_frame = ctk.CTkFrame(self, fg_color="transparent")
        preview_frame.pack(fill="both", expand=True, padx=36, pady=(8, 8))

        ctk.CTkLabel(
            preview_frame,
            text="Estrutura detectada",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["muted"],
        ).pack(anchor="w")

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

        footer = ctk.CTkFrame(self, fg_color="transparent")
        footer.pack(fill="x", padx=36, pady=(8, 28))

        self.status = ctk.CTkLabel(
            footer,
            text="Selecione um arquivo ou uma pasta para começar",
            font=ctk.CTkFont(size=13),
            text_color=COLORS["muted"],
        )
        self.status.pack(side="left")

        self.export_btn = ctk.CTkButton(
            footer,
            text="Salvar livro",
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
        self._set_preview("")
        self._set_status(status)

    def _pick_file(self) -> None:
        if self._busy:
            return
        path = filedialog.askopenfilename(
            title="Escolher arquivo",
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
            "file",
            selected.name,
            "Arquivo pronto. Clique em Formatar.",
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
        label = f"Pasta: {selected.name}  ({len(files)} capítulos)"
        self._ready_selection(
            selected,
            "folder",
            label,
            f"{len(files)} arquivos encontrados. Clique em Formatar.",
        )
        self._set_preview(
            f"Ordem dos capítulos (pelo nome do arquivo):\n\n{names}\n\n"
            "Dica: nomeie como 01_titulo.docx, 02_titulo.docx para controlar a ordem."
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

            if self.source_mode == "folder":
                book = build_book_from_folder(self.selected_path)
            else:
                _, blocks = extract_text(self.selected_path)
                book = detect_structure(blocks, self.selected_path)

            self.after(0, lambda: self._on_process_ok(book))
        except Exception as exc:  # noqa: BLE001 — mostra erro amigável na UI
            err = str(exc) or traceback.format_exc()
            self.after(0, lambda: self._on_process_error(err))

    def _on_process_ok(self, book: Book) -> None:
        self.book = book
        self._busy = False
        self.process_btn.configure(state="normal")
        self.export_btn.configure(state="normal")

        source_note = (
            "Modo: pasta (1 arquivo = 1 capítulo)"
            if self.source_mode == "folder"
            else "Modo: arquivo único"
        )
        lines = [
            f"Título: {book.title}",
            f"Autor: {book.author or '(não detectado)'}",
            f"Capítulos: {book.chapter_count}",
            f"Palavras (aprox.): {book.word_count:,}".replace(",", "."),
            source_note,
            "",
            "Capítulos encontrados:",
        ]
        for chapter in book.chapters:
            if chapter.number is not None and chapter.title != "Introdução":
                lines.append(f"  • Capítulo {chapter.number} — {chapter.title}")
            else:
                lines.append(f"  • {chapter.title}")
            lines.append(f"      ({len(chapter.paragraphs)} parágrafos)")

        self._set_preview("\n".join(lines))
        self._set_status(
            "Pronto! Revise a estrutura e clique em Salvar livro.",
            COLORS["success"],
        )

    def _on_process_error(self, message: str) -> None:
        self._busy = False
        self.process_btn.configure(state="normal")
        self._set_status("Não foi possível processar.", COLORS["error"])
        messagebox.showerror("Erro", f"Algo deu errado:\n\n{message}")

    def _export(self) -> None:
        if not self.book or self._busy:
            return

        fmt = self.format_var.get()
        default_name = f"{self.book.title}.{'docx' if fmt == 'docx' else 'epub'}"
        safe = "".join(c for c in default_name if c not in '<>:"/\\|?*')

        if fmt == "docx":
            filetypes = [("Word", "*.docx")]
            defaultextension = ".docx"
        else:
            filetypes = [("EPUB", "*.epub")]
            defaultextension = ".epub"

        path = filedialog.asksaveasfilename(
            title="Salvar livro",
            defaultextension=defaultextension,
            initialfile=safe,
            filetypes=filetypes,
        )
        if not path:
            return

        try:
            saved = export_book(self.book, path, fmt=fmt)
            self._set_status(f"Livro salvo: {saved.name}", COLORS["success"])
            messagebox.showinfo(
                "Sucesso",
                f"Livro salvo com sucesso!\n\n{saved}",
            )
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Erro ao salvar", str(exc))
            self._set_status("Falha ao salvar o arquivo.", COLORS["error"])


def run() -> None:
    app = BookSculptorApp()
    app.mainloop()
