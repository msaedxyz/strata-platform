"""PDF text extraction. Source: docs/04-ingestion.md, collectors table.

pdfplumber reads the text layer. A page with no text layer goes to OCR: Tesseract when the
tesseract binary exists, else RapidOCR (offline, from PyPI). The source gets the OCR flag, and
source.metadata records the OCR engine and the pages.
page_map gives the start offset of each page in the normalised text.
"""

from __future__ import annotations

import io
import logging
import shutil
import threading
from dataclasses import dataclass, field

from services.common.logging import log

from .text import collectors_config, normalise

logger = logging.getLogger("strata.collectors.pdf")
PAGE_SEPARATOR = "\n\n"

_rapid = None
_rapid_lock = threading.Lock()


@dataclass
class PdfText:
    text: str
    page_map: list[dict]
    ocr: bool
    ocr_pages: list[int] = field(default_factory=list)
    ocr_engine: str | None = None
    page_count: int = 0
    title: str | None = None


def ocr_engine_name() -> str:
    return "tesseract" if shutil.which("tesseract") else "rapidocr"


def _render(pdf_bytes: bytes, page_index: int, dpi: int):
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        page = doc[page_index]
        image = page.render(scale=dpi / 72).to_pil()
        page.close()
        return image
    finally:
        doc.close()


def _ocr_tesseract(image, language: str) -> str:
    import pytesseract

    return pytesseract.image_to_string(image, lang=language)


def _ocr_rapid(image) -> str:
    global _rapid
    import numpy as np

    with _rapid_lock:
        if _rapid is None:
            from rapidocr_onnxruntime import RapidOCR

            _rapid = RapidOCR()
        engine = _rapid
    result, _ = engine(np.array(image.convert("RGB")))
    if not result:
        return ""
    # Each item is [box, text, score]. Group the boxes into lines by their vertical position.
    items = sorted(result, key=lambda r: (min(p[1] for p in r[0]), min(p[0] for p in r[0])))
    lines: list[list[tuple[float, str]]] = []
    last_y: float | None = None
    for box, text, _score in items:
        top = min(p[1] for p in box)
        height = max(p[1] for p in box) - top
        if last_y is None or top - last_y > max(height * 0.5, 5):
            lines.append([])
            last_y = top
        lines[-1].append((min(p[0] for p in box), text))
    return "\n".join(" ".join(t for _x, t in sorted(line)) for line in lines)


def ocr_page(pdf_bytes: bytes, page_index: int) -> tuple[str, str]:
    cfg = collectors_config()["pdf"]
    image = _render(pdf_bytes, page_index, cfg["ocr_dpi"])
    engine = ocr_engine_name()
    if engine == "tesseract":
        return _ocr_tesseract(image, cfg["ocr_language"]), engine
    return _ocr_rapid(image), engine


def extract_pdf(pdf_bytes: bytes) -> PdfText:
    import pdfplumber

    cfg = collectors_config()["pdf"]
    pages: list[str] = []
    ocr_pages: list[int] = []
    engine: str | None = None
    title: str | None = None
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        title = (pdf.metadata or {}).get("Title") or None
        for index, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            if len(text.strip()) < cfg["ocr_min_chars"]:
                try:
                    text, engine = ocr_page(pdf_bytes, index)
                    ocr_pages.append(index + 1)
                except Exception as exc:  # OCR failure leaves the page empty
                    log(logger, logging.ERROR, "OCR failed", page=index + 1, error=str(exc))
            pages.append(normalise(text))
    # Each page text is normalised, so the joined text is normalised too and the offsets stay exact.
    page_map: list[dict] = []
    full = ""
    for number, page_text in enumerate(pages, start=1):
        if page_text and full:
            full += PAGE_SEPARATOR
        page_map.append({"page": number, "start": len(full)})
        full += page_text
    if not title:
        first = next((line for line in full.split("\n") if line.strip()), None)
        title = first[:200] if first else None
    return PdfText(text=full, page_map=page_map, ocr=bool(ocr_pages), ocr_pages=ocr_pages, ocr_engine=engine,
                   page_count=len(pages), title=title)
