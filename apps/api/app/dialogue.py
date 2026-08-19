from __future__ import annotations

import re

from app.models import Paragraph

# Verbos de atribuição após travessão: "— disse ele" (não é fala nova)
_ATTRIBUTION_VERBS = {
    "disse",
    "falou",
    "perguntou",
    "respondeu",
    "exclamou",
    "murmurou",
    "continuou",
    "acrescentou",
    "retrucou",
    "insistiu",
    "anunciou",
    "comentou",
    "suspirou",
    "gritou",
    "sussurrou",
    "indagou",
    "replicou",
    "observou",
    "declarou",
    "afirmou",
    "negou",
    "confessou",
    "sugeriu",
    "ordenou",
    "pediu",
    "explicou",
    "interrompeu",
    "concluiu",
    "repetiu",
    "admitiu",
    "avisou",
    "protestou",
    "argumentou",
    "balbuciou",
    "gaguejou",
    "retrucou",
    "ponderou",
    "argumentou",
    "redarguiu",
    "tornou",
    "completou",
    "corrigiu",
    "confirmou",
    "negou",
    "ironizou",
    "brincou",
    "completou",
}

# Travessão de fala: início ou após pontuação/espaço, seguido de maiúscula ou aspas
_SPEECH_OPEN_RE = re.compile(
    r"(?:^|(?<=[.!?…»:;\"”»])\s+|(?<=:)\s+|(?<=\s))"
    r"[—–]\s*"
    r"(?=[A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÄËÏÖÜÜ«\"“„])"
)

# Aspas tipográficas de fala isolada
_QUOTE_SPEECH_RE = re.compile(
    r'(?P<q>[«"“„])(?P<body>.+?)(?P<close>[»"”])'
)


def _normalize_dashes(text: str) -> str:
    text = text.replace("–", "—").replace("−", "—")
    # " - " usado como travessão de diálogo no início de fala
    text = re.sub(r"(^|[\s])-\s+(?=[A-ZÁÉÍÓÚÀÃÕ«\"“])", r"\1— ", text)
    return re.sub(r"\s+", " ", text).strip()


def _is_attribution_dash(text: str, dash_pos: int) -> bool:
    """True se o travessão introduz verbo de atribuição, não uma fala nova."""
    after = text[dash_pos:]
    after = re.sub(r"^[—–\s]+", "", after)
    if not after:
        return False
    first = re.split(r"[\s,.—–]+", after, maxsplit=1)[0].lower()
    return first in _ATTRIBUTION_VERBS


def _speech_open_positions(text: str) -> list[int]:
    positions: list[int] = []
    for match in _SPEECH_OPEN_RE.finditer(text):
        # Localiza o travessão dentro do match
        chunk = match.group(0)
        rel = chunk.find("—")
        if rel < 0:
            rel = chunk.find("–")
        abs_pos = match.start() + max(0, rel)
        if _is_attribution_dash(text, abs_pos):
            continue
        positions.append(abs_pos)
    return positions


def _normalize_speech(text: str) -> str:
    text = text.strip()
    if not text:
        return text
    # Garante travessão tipográfico no início
    text = re.sub(r"^[—–\-\s]+", "", text)
    return f"— {text}" if text else text


# Palavras que começam sentença em fala, não nomes próprios do narrador
_SPEECH_STARTERS = {
    "você", "vocês", "eu", "tu", "nós", "vos", "me", "te", "lhe",
    "isso", "isto", "aquilo", "esse", "essa", "este", "esta", "aquele", "aquela",
    "meu", "minha", "teu", "tua", "nosso", "nossa", "seu", "sua",
    "quem", "como", "porque", "porquê", "quando", "onde", "qual", "quais",
    "ainda", "também", "sempre", "nunca", "agora", "aqui", "ali", "talvez",
    "parece", "depois", "antes", "então", "porém", "contudo", "mas",
    "para", "por", "sem", "com", "não", "sim", "claro", "certo",
    "vamos", "deixe", "deixa", "olhe", "veja", "escute", "espere",
    "obrigado", "obrigada", "desculpe", "perdão", "por favor",
    "ele", "ela", "eles", "elas",  # em fala: "Ele não virá."
}


def _looks_like_narrative(sentence: str) -> bool:
    """Detecta batida narrativa após uma fala (ex.: 'Kaelan assentiu.')."""
    s = sentence.strip()
    if not s or s.startswith("—"):
        return False
    if re.match(r"^(Quando|Então|Depois|Enquanto|Assim|Porém|Contudo)\b", s):
        return True
    # "Os dois apertaram...", "As crianças corriam..."
    if re.match(r"^(Os|As)\s+\w+", s) and len(s.split()) >= 3:
        return True
    # Nome próprio (3+ letras) + verbo: "Kaelan assentiu", "Lyra estava parada"
    match = re.match(
        r"^([A-ZÁÉÍÓÚÀÃÕ][a-záéíóúàãõâêôç'’]{2,})"
        r"(?:\s+[A-ZÁÉÍÓÚÀÃÕ][a-záéíóúàãõâêôç'’]+)?\s+"
        r"([a-záéíóúàãõç]+)",
        s,
    )
    if not match or len(s.split()) > 14:
        return False
    if match.group(1).lower() in _SPEECH_STARTERS:
        return False
    return True


def _peel_trailing_narrative(speech: str) -> tuple[str, str]:
    """Separa narrativa colada após o fim da fala.

    Ex.: "— Não perderia este dia por nada. Os dois apertaram os braços"
         → ("— Não perderia este dia por nada.", "Os dois apertaram os braços")
    """
    attrib = re.search(
        r"—\s*(?:" + "|".join(sorted(_ATTRIBUTION_VERBS, key=len, reverse=True)) + r")\b",
        speech,
        flags=re.IGNORECASE,
    )
    if attrib:
        # Fala com atribuição ("— … — disse X —, …"): mantém o bloco inteiro.
        # A próxima réplica já é cortada pelo splitter principal.
        return speech.strip(), ""

    parts = re.split(r"(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÀÃÕ])", speech)
    if len(parts) <= 1:
        return speech.strip(), ""

    kept: list[str] = [parts[0]]
    for idx in range(1, len(parts)):
        part = parts[idx]
        if part.startswith("—"):
            kept.append(part)
            continue
        if _looks_like_narrative(part):
            return " ".join(kept).strip(), " ".join(parts[idx:]).strip()
        kept.append(part)
    return " ".join(kept).strip(), ""


def split_dialogue(text: str) -> list[Paragraph]:
    """Divide um bloco em narrativa e falas (uma fala por parágrafo)."""
    text = _normalize_dashes(text)
    if not text:
        return []

    opens = _speech_open_positions(text)
    if not opens:
        # Aspas de diálogo como parágrafo único, se o bloco for só fala
        quote = _QUOTE_SPEECH_RE.fullmatch(text)
        if quote and len(text.split()) <= 40:
            return [Paragraph(text=text, style="dialogue")]
        return [Paragraph(text=text, style="body")]

    paragraphs: list[Paragraph] = []
    cursor = 0

    for index, pos in enumerate(opens):
        if pos > cursor:
            narrative = text[cursor:pos].strip(" \t")
            narrative = narrative.strip()
            if narrative:
                paragraphs.append(Paragraph(text=narrative, style="body"))

        end = opens[index + 1] if index + 1 < len(opens) else len(text)
        raw_speech = text[pos:end].strip()
        speech, trailing = _peel_trailing_narrative(raw_speech)
        speech = _normalize_speech(speech)
        if speech:
            paragraphs.append(Paragraph(text=speech, style="dialogue"))
        if trailing:
            paragraphs.append(Paragraph(text=trailing, style="body"))
        cursor = end

    if cursor < len(text):
        tail = text[cursor:].strip()
        if tail:
            paragraphs.append(Paragraph(text=tail, style="body"))

    return paragraphs or [Paragraph(text=text, style="body")]


def expand_paragraphs_with_dialogue(paragraphs: list[Paragraph]) -> list[Paragraph]:
    """Aplica split de diálogo em parágrafos de corpo."""
    out: list[Paragraph] = []
    for para in paragraphs:
        if para.style != "body":
            out.append(para)
            continue
        out.extend(split_dialogue(para.text))
    return out
