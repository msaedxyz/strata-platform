"""Evidence spans: sentences with offsets, and the exact substring check of docs/05 guardrail 2.

All offsets refer to the normalised text of the source (services/collectors/text.normalise).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import config

_SENTENCE_END = re.compile(r"(?<=[.!?])[\"'”’)]?\s+(?=[\"'“‘(]?[A-Z0-9])")


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    quote: str

    def as_dict(self) -> dict:
        return {"quote": self.quote, "start": self.start, "end": self.end}


class SpanError(ValueError):
    def __init__(self, reason_code: str, detail: dict):
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.detail = detail


def max_quote() -> int:
    return int(config.get("pipeline.max_quote_chars", 500))


def sentences(text: str) -> list[Span]:
    """Sentences with their offsets. A line break always ends a sentence."""
    out: list[Span] = []
    pos = 0
    for line in text.split("\n"):
        start_of_line = pos
        pos += len(line) + 1
        if not line.strip():
            continue
        cursor = 0
        for m in _SENTENCE_END.finditer(line):
            piece = line[cursor:m.start() + 1 if line[m.start()] in ".!?" else m.start()]
            _add(out, start_of_line + cursor, piece)
            cursor = m.end()
        _add(out, start_of_line + cursor, line[cursor:])
    return out


def _add(out: list[Span], start: int, piece: str) -> None:
    stripped = piece.strip()
    if not stripped:
        return
    lead = len(piece) - len(piece.lstrip())
    s = start + lead
    out.append(Span(s, s + len(stripped), stripped))


def sentence_at(sents: list[Span], offset: int) -> Span | None:
    for s in sents:
        if s.start <= offset < s.end:
            return s
    return None


def clip(text: str, span: Span, focus_start: int, focus_end: int) -> Span:
    """The span, cut to the quote limit around the focus when it is too long."""
    limit = max_quote()
    if span.end - span.start <= limit:
        return span
    half = max(0, (limit - (focus_end - focus_start)) // 2)
    start = max(span.start, focus_start - half)
    end = min(span.end, start + limit)
    start = max(span.start, end - limit)
    return Span(start, end, text[start:end])


def make_span(text: str, start: int, end: int) -> Span:
    return Span(start, end, text[start:end])


def verify(text: str, item: dict) -> Span:
    """Check one evidence item {quote, start, end} against the text. Raise SpanError on failure."""
    try:
        quote, start, end = item["quote"], int(item["start"]), int(item["end"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SpanError("schema_invalid", {"item": item, "error": str(exc)}) from exc
    if not quote:
        raise SpanError("span_mismatch", {"item": item, "error": "empty quote"})
    if len(quote) > max_quote():
        raise SpanError("quote_too_long", {"item": item, "length": len(quote)})
    if start < 0 or end > len(text) or end <= start or text[start:end] != quote:
        raise SpanError("span_mismatch", {"item": item, "text_at_offsets": text[max(0, start):max(0, end)][:500]})
    return Span(start, end, quote)
