from __future__ import annotations

from typing import Literal

LocaleCode = Literal["en", "pt-BR", "es"]
SUPPORTED_LOCALES: tuple[LocaleCode, ...] = ("en", "pt-BR", "es")

_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "toc": "Table of Contents",
        "dedication": "Dedication",
        "prologue": "Prologue",
        "epilogue": "Epilogue",
        "afterword": "Afterword",
        "appendix": "Appendix",
        "chapter": "Chapter",
        "part": "Part",
        "content": "Content",
        "text": "Text",
        "manuscript": "Manuscript",
        "body": "Body",
    },
    "pt-BR": {
        "toc": "Sumário",
        "dedication": "Dedicatória",
        "prologue": "Prólogo",
        "epilogue": "Epílogo",
        "afterword": "Posfácio",
        "appendix": "Apêndice",
        "chapter": "Capítulo",
        "part": "Parte",
        "content": "Conteúdo",
        "text": "Texto",
        "manuscript": "Manuscrito",
        "body": "Corpo",
    },
    "es": {
        "toc": "Índice",
        "dedication": "Dedicatoria",
        "prologue": "Prólogo",
        "epilogue": "Epílogo",
        "afterword": "Posfacio",
        "appendix": "Apéndice",
        "chapter": "Capítulo",
        "part": "Parte",
        "content": "Contenido",
        "text": "Texto",
        "manuscript": "Manuscrito",
        "body": "Cuerpo",
    },
}

CHAPTER_KINDS = (
    "dedication",
    "prologue",
    "chapter",
    "epilogue",
    "afterword",
    "appendix",
    "part",
    "other",
)

# Front/back matter: labeled sections without chapter numbers.
SPECIAL_SECTION_KINDS = frozenset(
    {"dedication", "prologue", "epilogue", "afterword", "appendix"}
)


def normalize_locale(locale: str | None) -> LocaleCode:
    if not locale:
        return "en"
    raw = locale.strip()
    if raw in SUPPORTED_LOCALES:
        return raw  # type: ignore[return-value]
    lower = raw.lower().replace("_", "-")
    if lower in {"pt-br", "pt"}:
        return "pt-BR"
    if lower.startswith("es"):
        return "es"
    if lower.startswith("en"):
        return "en"
    return "en"


def t(key: str, locale: str | None = None) -> str:
    loc = normalize_locale(locale)
    return _LABELS[loc].get(key, _LABELS["en"].get(key, key))


def _named_kind_label(kind: str, title: str, locale: LocaleCode) -> str:
    base = t(kind, locale)
    aliases = {
        base.lower(),
        kind,
        # Common language variants so we don't duplicate the kind in the label.
        "dedication",
        "dedicatória",
        "dedicatoria",
        "prologue",
        "prólogo",
        "prologo",
        "epilogue",
        "epílogo",
        "epilogo",
        "afterword",
        "posfácio",
        "posfacio",
        "appendix",
        "apêndice",
        "apendice",
    }
    if title and title.lower() not in aliases:
        return f"{base} — {title}"
    return base


def format_chapter_label(
    kind: str,
    number: int | None,
    title: str,
    locale: str | None = None,
) -> str:
    loc = normalize_locale(locale)
    title = (title or "").strip()
    if kind in {"dedication", "prologue", "epilogue", "afterword", "appendix"}:
        return _named_kind_label(kind, title, loc)
    if kind == "part":
        base = t("part", loc)
        if number is not None and title:
            return f"{base} {number} — {title}"
        if number is not None:
            return f"{base} {number}"
        return title or base
    if kind == "other":
        return title or t("content", loc)
    base = t("chapter", loc)
    if number is not None and title:
        return f"{base} {number} — {title}"
    if number is not None:
        return f"{base} {number}"
    return title or base


def stripe_checkout_locale(ui_locale: str | None) -> str:
    loc = normalize_locale(ui_locale)
    return {"en": "en", "pt-BR": "pt-BR", "es": "es"}[loc]
