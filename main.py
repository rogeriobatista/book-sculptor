#!/usr/bin/env python3
"""Book Sculptor — aplicativo desktop local (Windows e macOS)."""

from __future__ import annotations

import argparse
import shutil
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn


HOST = "127.0.0.1"


class DesktopApi:
    """API JS ↔ Python para salvar arquivos na janela desktop."""

    def pick_save_path(self, suggested_name: str, fmt: str) -> str:
        import webview

        if not webview.windows:
            return ""

        fmt = (fmt or "docx").lower()
        filters = {
            "docx": ("Documento Word (*.docx)",),
            "epub": ("Livro EPUB (*.epub)",),
            "pdf": ("Documento PDF (*.pdf)",),
        }
        file_types = filters.get(fmt, ("Todos os arquivos (*.*)",))

        result = webview.windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=suggested_name,
            file_types=file_types,
        )
        if not result:
            return ""
        if isinstance(result, (list, tuple)):
            return str(result[0]) if result else ""
        return str(result)

    def reveal_in_folder(self, path: str) -> bool:
        target = Path(path)
        if not target.exists():
            return False
        try:
            if sys.platform == "win32":
                import os

                os.startfile(target.parent)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                import subprocess

                subprocess.run(["open", "-R", str(target)], check=False)
            else:
                import subprocess

                subprocess.run(["xdg-open", str(target.parent)], check=False)
            return True
        except OSError:
            return False

    def copy_export(self, source: str, destination: str) -> str:
        src = Path(source)
        dest = Path(destination)
        if not src.exists():
            raise FileNotFoundError("Arquivo exportado não encontrado.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        return str(dest)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def _wait_ready(url: str, timeout: float = 15.0) -> bool:
    import urllib.error
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            time.sleep(0.15)
    return False


def _start_server(port: int) -> uvicorn.Server:
    config = uvicorn.Config(
        "app.server:app",
        host=HOST,
        port=port,
        log_level="warning",
        reload=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return server


def run_desktop() -> int:
    try:
        import webview
    except ImportError:
        print(
            "Pacote pywebview não encontrado.\n"
            "Instale com: pip install -r requirements.txt"
        )
        return 1

    port = _free_port()
    url = f"http://{HOST}:{port}"
    server = _start_server(port)

    if not _wait_ready(url):
        print("Não foi possível iniciar o Book Sculptor.")
        return 1

    api = DesktopApi()
    window = webview.create_window(
        title="Book Sculptor",
        url=url,
        width=1280,
        height=860,
        min_size=(960, 680),
        text_select=True,
        js_api=api,
    )

    def _shutdown() -> None:
        server.should_exit = True

    window.events.closed += _shutdown
    webview.start()
    server.should_exit = True
    return 0


def run_browser() -> int:
    port = _free_port()
    url = f"http://{HOST}:{port}"
    _start_server(port)
    if not _wait_ready(url):
        print("Não foi possível iniciar o Book Sculptor.")
        return 1
    webbrowser.open(url)
    print(f"Book Sculptor aberto no navegador: {url}")
    print("Feche esta janela do terminal para encerrar.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Book Sculptor")
    parser.add_argument(
        "--browser",
        action="store_true",
        help="Abrir no navegador em vez da janela desktop",
    )
    args = parser.parse_args(argv)

    if args.browser:
        return run_browser()
    return run_desktop()


if __name__ == "__main__":
    sys.exit(main())
