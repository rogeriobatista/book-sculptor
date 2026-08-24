"""Book voice / style profile stored in settings_json.ai_style."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

POV_VALUES = ("first", "third_limited", "third_omniscient", "second")
PovId = Literal["first", "third_limited", "third_omniscient", "second"]

POV_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "first": "First person (I/we)",
        "third_limited": "Third person limited",
        "third_omniscient": "Third person omniscient",
        "second": "Second person (you)",
    },
    "pt-BR": {
        "first": "Primeira pessoa (eu/nós)",
        "third_limited": "Terceira pessoa limitada",
        "third_omniscient": "Terceira pessoa onisciente",
        "second": "Segunda pessoa (você)",
    },
    "es": {
        "first": "Primera persona (yo/nosotros)",
        "third_limited": "Tercera persona limitada",
        "third_omniscient": "Tercera persona omnisciente",
        "second": "Segunda persona (tú/usted)",
    },
}


class BookStyleProfile(BaseModel):
    genre: str = ""
    tone: str = ""
    pov: PovId | str = "third_limited"
    audience: str = ""
    style_notes: str = ""
    avoid_words: str = ""
    reference_authors: str = ""
    use_prior_chapters: bool = True
    prior_chapter_count: int = Field(default=2, ge=0, le=4)

    def to_prompt_block(self, language: str) -> str:
        lines: list[str] = []
        if self.genre.strip():
            lines.append(f"Genre: {self.genre.strip()}")
        if self.tone.strip():
            lines.append(f"Tone: {self.tone.strip()}")
        pov_label = POV_LABELS.get(language, POV_LABELS["en"]).get(
            str(self.pov), str(self.pov)
        )
        if self.pov:
            lines.append(f"Narrative POV: {pov_label}")
        if self.audience.strip():
            lines.append(f"Target audience: {self.audience.strip()}")
        if self.reference_authors.strip():
            lines.append(f"Voice reference (do not copy): {self.reference_authors.strip()}")
        if self.style_notes.strip():
            lines.append(f"Style notes: {self.style_notes.strip()}")
        if self.avoid_words.strip():
            lines.append(f"Avoid these words/phrases: {self.avoid_words.strip()}")
        if not lines:
            return ""
        return "Book voice profile:\n" + "\n".join(f"- {line}" for line in lines)

    def is_configured(self) -> bool:
        return bool(
            self.genre.strip()
            or self.tone.strip()
            or self.style_notes.strip()
            or self.audience.strip()
            or self.reference_authors.strip()
            or self.avoid_words.strip()
            or self.pov != "third_limited"
        )


def parse_style_profile(raw: Any) -> BookStyleProfile:
    if not isinstance(raw, dict):
        return BookStyleProfile()
    pov = str(raw.get("pov") or "third_limited").strip()
    if pov not in POV_VALUES:
        pov = "third_limited"
    try:
        prior = int(raw.get("prior_chapter_count", 2))
    except (TypeError, ValueError):
        prior = 2
    prior = max(0, min(4, prior))
    return BookStyleProfile(
        genre=str(raw.get("genre") or "").strip()[:200],
        tone=str(raw.get("tone") or "").strip()[:200],
        pov=pov,  # type: ignore[arg-type]
        audience=str(raw.get("audience") or "").strip()[:200],
        style_notes=str(raw.get("style_notes") or "").strip()[:2000],
        avoid_words=str(raw.get("avoid_words") or "").strip()[:500],
        reference_authors=str(raw.get("reference_authors") or "").strip()[:300],
        use_prior_chapters=bool(raw.get("use_prior_chapters", True)),
        prior_chapter_count=prior,
    )


def style_profile_from_book(book) -> BookStyleProfile:
    settings = book.settings_json if hasattr(book, "settings_json") else {}
    if not isinstance(settings, dict):
        return BookStyleProfile()
    return parse_style_profile(settings.get("ai_style"))


def merge_book_settings_json(
    existing: dict[str, Any] | None,
    incoming: dict[str, Any] | None,
) -> dict[str, Any]:
    """Merge layout settings with optional ai_style without dropping either."""
    from app.layout import LayoutSettings

    existing = existing or {}
    incoming = incoming or {}
    layout_keys = {
        k: v
        for k, v in {**existing, **incoming}.items()
        if k != "ai_style"
    }
    merged = LayoutSettings.from_dict(layout_keys).to_dict()
    if "ai_style" in incoming:
        merged["ai_style"] = parse_style_profile(incoming["ai_style"]).model_dump()
    elif existing.get("ai_style"):
        merged["ai_style"] = parse_style_profile(existing["ai_style"]).model_dump()
    if "publication" in incoming:
        from app.services.publication_profile import parse_publication_profile

        merged["publication"] = parse_publication_profile(incoming["publication"]).model_dump()
    elif existing.get("publication"):
        from app.services.publication_profile import parse_publication_profile

        merged["publication"] = parse_publication_profile(existing["publication"]).model_dump()
    return merged
