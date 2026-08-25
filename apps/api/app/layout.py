from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

FormatId = Literal[
    "medio",
    "padrao",
    "bolso",
    "tecnico",
    "trade_6x9",
    "trade_55x85",
]
FontId = Literal["georgia", "literata", "garamond", "baskerville"]
DensityId = Literal["compacto", "padrao", "espacoso"]
PageNumberId = Literal["externo", "centro", "sem"]
StyleId = Literal["prosa_literaria", "editorial", "compacto_digital"]
RunningHeaderId = Literal["none", "title", "author"]


@dataclass(frozen=True)
class BookFormat:
    id: FormatId
    label: str
    width_cm: float
    height_cm: float


@dataclass(frozen=True)
class FontOption:
    id: FontId
    label: str
    css_family: str
    docx_name: str


@dataclass(frozen=True)
class StylePreset:
    id: StyleId
    label: str
    description: str
    format_id: FormatId
    font_id: FontId
    font_size: int
    density: DensityId
    page_number: PageNumberId
    include_toc: bool
    paragraph_spacing_pt: float
    first_line_indent_cm: float
    skip_first_indent: bool
    line_height: float
    chapter_ornament: bool
    drop_cap: bool = False
    running_header: RunningHeaderId = "none"


FORMATS: dict[FormatId, BookFormat] = {
    "medio": BookFormat("medio", "Médio\n14 × 21 cm", 14.0, 21.0),
    "padrao": BookFormat("padrao", "Padrão\n15,5 × 23 cm", 15.5, 23.0),
    "bolso": BookFormat("bolso", "Bolso\n11 × 18 cm", 11.0, 18.0),
    "trade_6x9": BookFormat("trade_6x9", "US Trade\n6 × 9 in", 15.24, 22.86),
    "trade_55x85": BookFormat("trade_55x85", "Digest\n5.5 × 8.5 in", 13.97, 21.59),
    "tecnico": BookFormat("tecnico", "Técnico\n21 × 29,7 cm", 21.0, 29.7),
}

FONTS: dict[FontId, FontOption] = {
    "georgia": FontOption(
        "georgia",
        "Georgia\nKindle",
        '"Georgia", "Times New Roman", serif',
        "Georgia",
    ),
    "literata": FontOption(
        "literata",
        "Literata\nestilo Kindle",
        '"Literata", "Georgia", serif',
        "Georgia",
    ),
    "garamond": FontOption(
        "garamond",
        "Garamond\nclássica",
        '"EB Garamond", "Garamond", "Times New Roman", serif',
        "Garamond",
    ),
    "baskerville": FontOption(
        "baskerville",
        "Baskerville\nclássica",
        '"Libre Baskerville", "Baskerville", "Georgia", serif',
        "Baskerville",
    ),
}

DENSITY_MARGINS_CM: dict[DensityId, tuple[float, float, float, float]] = {
    # top, bottom, inner(left), outer(right)
    "compacto": (1.6, 1.6, 1.8, 1.4),
    "padrao": (2.2, 2.2, 2.5, 2.0),
    "espacoso": (2.8, 2.8, 3.2, 2.6),
}

STYLES: dict[StyleId, StylePreset] = {
    "prosa_literaria": StylePreset(
        id="prosa_literaria",
        label="Prosa Literária",
        description="Romance e ficção: Garamond, recuo clássico, capítulos elegantes.",
        format_id="medio",
        font_id="garamond",
        font_size=11,
        density="padrao",
        page_number="centro",
        include_toc=True,
        paragraph_spacing_pt=0,
        first_line_indent_cm=0.7,
        skip_first_indent=True,
        line_height=1.4,
        chapter_ornament=True,
        drop_cap=True,
        running_header="title",
    ),
    "editorial": StylePreset(
        id="editorial",
        label="Editorial",
        description="Não ficção e ensaios: leitura clara, mais respiro entre parágrafos.",
        format_id="padrao",
        font_id="baskerville",
        font_size=11,
        density="padrao",
        page_number="externo",
        include_toc=True,
        paragraph_spacing_pt=8,
        first_line_indent_cm=0.5,
        skip_first_indent=False,
        line_height=1.5,
        chapter_ornament=False,
        drop_cap=False,
        running_header="author",
    ),
    "compacto_digital": StylePreset(
        id="compacto_digital",
        label="Compacto Digital",
        description="Leitura em tela: densidade maior e tipografia Kindle.",
        format_id="bolso",
        font_id="literata",
        font_size=10,
        density="compacto",
        page_number="sem",
        include_toc=False,
        paragraph_spacing_pt=4,
        first_line_indent_cm=0.5,
        skip_first_indent=True,
        line_height=1.35,
        chapter_ornament=False,
        drop_cap=False,
        running_header="none",
    ),
}

DEFAULT_STYLE: StyleId = "prosa_literaria"


@dataclass
class LayoutSettings:
    style_id: StyleId = DEFAULT_STYLE
    format_id: FormatId = "medio"
    font_id: FontId = "garamond"
    font_size: int = 11
    density: DensityId = "padrao"
    page_number: PageNumberId = "centro"
    include_toc: bool = True
    # Typography details (editable; seeded from style presets)
    typography_line_height: float = 1.4
    typography_indent_cm: float = 0.7
    typography_paragraph_spacing_pt: float = 0.0
    typography_skip_first_indent: bool = True
    typography_chapter_ornament: bool = True
    drop_cap: bool = False
    running_header: RunningHeaderId = "none"

    def style(self) -> StylePreset:
        return STYLES.get(self.style_id, STYLES[DEFAULT_STYLE])

    def format(self) -> BookFormat:
        return FORMATS.get(self.format_id, FORMATS["medio"])

    def font(self) -> FontOption:
        return FONTS.get(self.font_id, FONTS["garamond"])

    def margins_cm(self) -> tuple[float, float, float, float]:
        return DENSITY_MARGINS_CM.get(self.density, DENSITY_MARGINS_CM["padrao"])

    def line_height(self) -> float:
        return self.typography_line_height

    def paragraph_spacing_pt(self) -> float:
        return self.typography_paragraph_spacing_pt

    def first_line_indent_cm(self) -> float:
        return self.typography_indent_cm

    def skip_first_indent(self) -> bool:
        return self.typography_skip_first_indent

    def chapter_ornament(self) -> bool:
        return self.typography_chapter_ornament

    def to_dict(self) -> dict:
        return asdict(self)

    def apply_style_preset(self, style_id: StyleId) -> LayoutSettings:
        preset = STYLES[style_id]
        self.style_id = style_id
        self.format_id = preset.format_id
        self.font_id = preset.font_id
        self.font_size = preset.font_size
        self.density = preset.density
        self.page_number = preset.page_number
        self.include_toc = preset.include_toc
        self.typography_line_height = preset.line_height
        self.typography_indent_cm = preset.first_line_indent_cm
        self.typography_paragraph_spacing_pt = preset.paragraph_spacing_pt
        self.typography_skip_first_indent = preset.skip_first_indent
        self.typography_chapter_ornament = preset.chapter_ornament
        self.drop_cap = preset.drop_cap
        self.running_header = preset.running_header
        return self

    @classmethod
    def from_dict(cls, data: dict | None) -> LayoutSettings:
        if not data:
            return cls().apply_style_preset(DEFAULT_STYLE)

        style_id = data.get("style_id", DEFAULT_STYLE)
        if style_id not in STYLES:
            style_id = DEFAULT_STYLE

        settings = cls(style_id=style_id)
        settings.apply_style_preset(style_id)

        if "format_id" in data and data["format_id"] in FORMATS:
            settings.format_id = data["format_id"]
        if "font_id" in data and data["font_id"] in FONTS:
            settings.font_id = data["font_id"]
        if "font_size" in data:
            settings.font_size = min(14, max(10, int(data["font_size"])))
        if "density" in data and data["density"] in DENSITY_MARGINS_CM:
            settings.density = data["density"]
        if "page_number" in data and data["page_number"] in {"externo", "centro", "sem"}:
            settings.page_number = data["page_number"]
        if "include_toc" in data:
            settings.include_toc = bool(data["include_toc"])
        if "typography_line_height" in data:
            settings.typography_line_height = min(
                2.0, max(1.15, float(data["typography_line_height"]))
            )
        if "typography_indent_cm" in data:
            settings.typography_indent_cm = min(
                2.0, max(0.0, float(data["typography_indent_cm"]))
            )
        if "typography_paragraph_spacing_pt" in data:
            settings.typography_paragraph_spacing_pt = min(
                18.0, max(0.0, float(data["typography_paragraph_spacing_pt"]))
            )
        if "typography_skip_first_indent" in data:
            settings.typography_skip_first_indent = bool(data["typography_skip_first_indent"])
        if "typography_chapter_ornament" in data:
            settings.typography_chapter_ornament = bool(data["typography_chapter_ornament"])
        if "drop_cap" in data:
            settings.drop_cap = bool(data["drop_cap"])
        if "running_header" in data and data["running_header"] in {
            "none",
            "title",
            "author",
        }:
            settings.running_header = data["running_header"]
        return settings


def layout_options_payload() -> dict:
    return {
        "styles": [
            {
                "id": s.id,
                "label": s.label,
                "description": s.description,
            }
            for s in STYLES.values()
        ],
        "default_style": DEFAULT_STYLE,
        "formats": [
            {
                "id": f.id,
                "label": f.label,
                "width_cm": f.width_cm,
                "height_cm": f.height_cm,
            }
            for f in FORMATS.values()
        ],
        "fonts": [
            {"id": f.id, "label": f.label, "css_family": f.css_family}
            for f in FONTS.values()
        ],
        "font_sizes": [10, 11, 12, 13, 14],
        "densities": [
            {"id": "compacto", "label": "Compacto", "margins_cm": DENSITY_MARGINS_CM["compacto"]},
            {"id": "padrao", "label": "Padrão", "margins_cm": DENSITY_MARGINS_CM["padrao"]},
            {"id": "espacoso", "label": "Espaçoso", "margins_cm": DENSITY_MARGINS_CM["espacoso"]},
        ],
        "page_numbers": [
            {"id": "externo", "label": "Externo"},
            {"id": "centro", "label": "Centro"},
            {"id": "sem", "label": "Sem"},
        ],
        "running_headers": [
            {"id": "none", "label": "None"},
            {"id": "title", "label": "Book title"},
            {"id": "author", "label": "Author"},
        ],
        "toc": [
            {"id": "com", "label": "Com sumário"},
            {"id": "sem", "label": "Sem"},
        ],
        "presets": {
            sid: {
                "format_id": s.format_id,
                "font_id": s.font_id,
                "font_size": s.font_size,
                "density": s.density,
                "page_number": s.page_number,
                "include_toc": s.include_toc,
                "typography_line_height": s.line_height,
                "typography_indent_cm": s.first_line_indent_cm,
                "typography_paragraph_spacing_pt": s.paragraph_spacing_pt,
                "typography_skip_first_indent": s.skip_first_indent,
                "typography_chapter_ornament": s.chapter_ornament,
                "drop_cap": s.drop_cap,
                "running_header": s.running_header,
            }
            for sid, s in STYLES.items()
        },
    }
