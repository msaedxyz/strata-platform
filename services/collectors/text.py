"""Text normalisation, hashes, simhash and language detection.

All evidence offsets refer to the text that normalise() gives.
"""

from __future__ import annotations

import hashlib
import html
import re
import unicodedata
from functools import lru_cache

from services.common.config import load_yaml

_WORD = re.compile(r"\w+", re.UNICODE)
_TAG = re.compile(r"<[^>]+>")
_BLOCK_TAG = re.compile(r"</?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|blockquote)\b[^>]*>", re.IGNORECASE)
_BLANK_LINES = re.compile(r"\n{3,}")


@lru_cache
def collectors_config() -> dict:
    return load_yaml("collectors.yaml")


def normalise(text: str) -> str:
    """Unicode NFC, \\n line endings, no trailing spaces, at most one blank line in a row.

    Indentation stays, so that structured text (for example the brief YAML) keeps its meaning.
    """
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", "\n").replace(" ", "\n")
    text = text.replace("\x00", "").replace(" ", " ")
    lines = [line.rstrip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip("\n").rstrip()


def html_to_text(fragment: str) -> str:
    """Plain text from a small HTML fragment, such as an RSS description."""
    if not fragment:
        return ""
    text = _BLOCK_TAG.sub("\n", fragment)
    text = _TAG.sub("", text)
    return html.unescape(text)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def excerpt(text: str, length: int | None = None) -> str:
    length = length or collectors_config()["pipeline"]["excerpt_chars"]
    return " ".join(text.split())[:length]


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _WORD.findall(text)]


def simhash(text: str, shingle_words: int | None = None) -> int:
    """64 bit simhash over word shingles. Returns a signed value that fits a PostgreSQL bigint."""
    n = shingle_words or collectors_config()["pipeline"]["simhash_shingle_words"]
    tokens = _tokens(text)
    if not tokens:
        return 0
    if len(tokens) < n:
        shingles = [" ".join(tokens)]
    else:
        shingles = [" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]
    weights = [0] * 64
    for shingle in shingles:
        h = int.from_bytes(hashlib.blake2b(shingle.encode("utf-8"), digest_size=8).digest(), "big")
        for bit in range(64):
            weights[bit] += 1 if (h >> bit) & 1 else -1
    value = 0
    for bit in range(64):
        if weights[bit] > 0:
            value |= 1 << bit
    return value - (1 << 64) if value >= (1 << 63) else value


def hamming(a: int, b: int) -> int:
    return ((a ^ b) & ((1 << 64) - 1)).bit_count()


def detect_language(text: str) -> str | None:
    """ISO 639-1 code, or None when the text is too short or unclear."""
    sample = text[: collectors_config()["pipeline"]["language_sample_chars"]]
    if len(_tokens(sample)) < 3:
        return None
    try:
        from langdetect import DetectorFactory, detect

        DetectorFactory.seed = 0
        return detect(sample).split("-")[0]
    except Exception:  # langdetect raises when it finds no features
        return None
