"""Make the two fixture PDF files. The output is committed. Run: uv run python -m tests.fixtures.make_pdfs

1. docs/zppa-haulage-tender.pdf: two pages with a text layer (a ZPPA invitation for bids for haulage).
2. docs/erb-fuel-prices-scanned.pdf: one page with no text layer. The page is an image of the text,
   like a scanned notice. The collector must read it with OCR (docs/04 criterion 8).

The documents are invented test data.
"""

from __future__ import annotations

import io
from pathlib import Path

SITE = Path(__file__).resolve().parent / "site" / "docs"

TENDER_PAGES = [
    [
        "ZAMBIA PUBLIC PROCUREMENT AUTHORITY",
        "INVITATION FOR BIDS",
        "Tender No. ZPPA/FX/2026/041",
        "Haulage of copper concentrate from Kansanshi Mine, Solwezi,",
        "to the Kasumbalesa border post",
        "",
        "1. The procuring entity invites sealed bids from eligible transport",
        "companies for the haulage of about 30,000 tonnes of copper",
        "concentrate each month for a period of three years.",
        "2. Bidders must have a fleet of at least 50 trucks with trailers",
        "and a valid road transport licence.",
        "3. The procuring entity will hold a pre-bid meeting in Solwezi",
        "on 12 October 2026.",
    ],
    [
        "INSTRUCTIONS TO BIDDERS",
        "",
        "4. Bids must reach the procuring entity before 10:00 hours on",
        "30 October 2026. Late bids will be rejected.",
        "5. The bid security is ZMW 500,000 in the form of a bank guarantee.",
        "6. Bidders must state the fuel consumption of their fleet and the",
        "name of their fuel supplier.",
        "7. The contract will start in January 2027.",
    ],
]

SCANNED_LINES = [
    "ENERGY REGULATION BOARD",
    "PRESS STATEMENT",
    "FUEL PUMP PRICE REVIEW FOR OCTOBER 2026",
    "",
    "The Energy Regulation Board has reviewed the pump",
    "prices of petroleum products for October 2026.",
    "Diesel prices in Lusaka stay unchanged.",
    "The next review is in November 2026.",
]


def _text_pdf(pages: list[list[str]], title: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, invariant=1)
    c.setTitle(title)
    c.setAuthor("Strata fixture")
    width, height = A4
    for lines in pages:
        y = height - 72
        c.setFont("Helvetica-Bold", 14)
        for i, line in enumerate(lines):
            if i == 1:
                c.setFont("Helvetica", 12)
            c.drawString(72, y, line)
            y -= 22
        c.showPage()
    c.save()
    return buf.getvalue()


def _scanned_pdf(lines: list[str]) -> bytes:
    """Render a text page to an image, then put only the image in a new PDF."""
    import pypdfium2 as pdfium
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    source = _text_pdf([lines], "scan source")
    doc = pdfium.PdfDocument(source)
    image = doc[0].render(scale=150 / 72).to_pil().convert("L")
    doc.close()
    img_buf = io.BytesIO()
    image.save(img_buf, format="JPEG", quality=60)
    img_buf.seek(0)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, invariant=1)
    c.setTitle("ERB press statement (scanned)")
    width, height = A4
    c.drawImage(ImageReader(img_buf), 0, 0, width=width, height=height)
    c.showPage()
    c.save()
    return buf.getvalue()


def main() -> None:
    SITE.mkdir(parents=True, exist_ok=True)
    (SITE / "zppa-haulage-tender.pdf").write_bytes(
        _text_pdf(TENDER_PAGES, "ZPPA invitation for bids: haulage of copper concentrate"))
    (SITE / "erb-fuel-prices-scanned.pdf").write_bytes(_scanned_pdf(SCANNED_LINES))
    for p in sorted(SITE.glob("*.pdf")):
        print(f"{p.relative_to(SITE.parent.parent)}: {p.stat().st_size} bytes")


if __name__ == "__main__":
    main()
