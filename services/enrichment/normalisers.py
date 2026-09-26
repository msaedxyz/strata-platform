"""Deterministic normalisers for names, dates, numbers, percentages, quantities and currency amounts.

docs/05 guardrail 3: each extracted value must appear in its quote. The check normalises the value and
the quote with these functions and compares the results. For example "$1.2bn" gives 1200000000 USD,
"K2.5 million" gives 2500000 ZMW and "US$498m" gives 498000000 USD.

Each normal form is a string, so that two values compare with ==:

| Type | Normal form | Example |
|---|---|---|
| money | "<amount> <ISO currency>" | "1200000000 USD" |
| percent | "<number>%" | "80%" |
| number | "<number>" | "60" |
| quantity | "<amount> t" or "<amount> t/y" | "2500000 t/y" |
| date | "YYYY-MM-DD", "YYYY-MM", "YYYY-Qn", "YYYY-Hn" or "YYYY" | "2026-10-06" |
| enum | the code | "suspended" |
| text | lower case, single spaces | "fuel shortage" |
| entity | the normalised name | "barrick mining" |
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from services.projections.folds import normalise_name

__all__ = [
    "normalise_name", "normalise_value", "values_in", "format_amount", "parse_money", "parse_dates",
    "parse_numbers", "parse_percents", "parse_quantities", "normalise_enum",
]

_NUM = r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
# The unit words ignore case, so that a headline ("$1.1 Billion", "$1B", "US$2 BN") gives the full amount (M4).
_MULT = r"(?:\s?(?P<mult>(?i:billion|bn|million|mn|thousand|m|b|k))\b)?"
_PRE = r"(?P<pre>US\$|U\.S\.\s?\$|USD|US dollars|ZMW|ZMK|ZK|(?<![A-Za-z])K(?=\d)|\$|€|EUR|£|GBP|ZAR|CNY)"
_POST = r"(?P<post>USD|(?i:US dollars|dollars|kwacha|euros)|ZMW|EUR|GBP|ZAR)"

_MONEY_A = re.compile(_PRE + r"\s?" + _NUM + _MULT + r"(?:\s?" + _POST + r"\b)?")
_MONEY_B = re.compile(r"(?<![\w$€£.])" + _NUM + _MULT + r"\s" + _POST + r"\b")

_CURRENCY = {
    "us$": "USD", "u.s.$": "USD", "u.s. $": "USD", "usd": "USD", "us dollars": "USD", "dollars": "USD", "$": "USD",
    "k": "ZMW", "zk": "ZMW", "zmw": "ZMW", "zmk": "ZMW", "kwacha": "ZMW",
    "€": "EUR", "eur": "EUR", "euros": "EUR", "£": "GBP", "gbp": "GBP", "zar": "ZAR", "cny": "CNY",
}
_MULTIPLIER = {"billion": 10**9, "bn": 10**9, "b": 10**9, "million": 10**6, "mn": 10**6, "m": 10**6,
               "thousand": 10**3, "k": 10**3}

_PERCENT = re.compile(r"(?P<num>\d+(?:\.\d+)?)\s?(?:%|per ?cent\b|percent\b)", re.IGNORECASE)
_PERCENT_NORMAL = re.compile(r"^(?P<num>\d+(?:\.\d+)?)%$")

_WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
}
_NUMBER = re.compile(
    r"(?<![\w.,])(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s(?P<mult>million|thousand)\b)?(?![\w])"
    r"|\b(?P<word>" + "|".join(_WORD_NUMBERS) + r")\b",
    re.IGNORECASE,
)

_QUANTITY = re.compile(
    r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s(?P<mult>million|thousand)\b)?\s?"
    r"(?:tonnes|tons|t)\b(?: of [a-z]+(?: (?!a\b|per\b|each\b)[a-z]+)?)?"
    r"(?P<year>\s(?:a|per|each) year\b|\sper annum\b|/y\b|\s?tpa\b)?",
    re.IGNORECASE,
)
_QUANTITY_NORMAL = re.compile(r"^(?P<num>\d+(?:\.\d+)?) (?P<unit>t|t/y)$")

_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4, "apr": 4, "may": 5,
    "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}
_MONTH = r"(?P<month>" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\.?"
_ORD = {"first": 1, "second": 2, "third": 3, "fourth": 4}
_DATE_PATTERNS = [
    ("day", re.compile(r"\b(?P<year>\d{4})-(?P<mnum>\d{2})-(?P<day>\d{2})\b")),
    ("day", re.compile(r"\b(?P<day>\d{1,2})(?:st|nd|rd|th)?\s" + _MONTH + r",?\s(?P<year>\d{4})\b", re.IGNORECASE)),
    ("day", re.compile(r"\b" + _MONTH + r"\s(?P<day>\d{1,2})(?:st|nd|rd|th)?,?\s(?P<year>\d{4})\b", re.IGNORECASE)),
    ("quarter", re.compile(r"\b(?P<year>\d{4})-Q(?P<q>[1-4])\b")),
    ("quarter", re.compile(r"\bQ(?P<q>[1-4])\s(?P<year>\d{4})\b")),
    ("quarter", re.compile(r"\b(?P<qword>first|second|third|fourth) quarter(?: of)?\s(?P<year>\d{4})\b", re.IGNORECASE)),
    ("half", re.compile(r"\b(?P<year>\d{4})-H(?P<h>[12])\b")),
    ("half", re.compile(r"\bH(?P<h>[12])\s(?P<year>\d{4})\b")),
    ("half", re.compile(r"\b(?P<hword>first|second) half(?: of)?\s(?P<year>\d{4})\b", re.IGNORECASE)),
    ("month", re.compile(r"\b(?P<year>\d{4})-(?P<mnum>\d{2})\b(?!-)")),
    ("month", re.compile(r"\b" + _MONTH + r"\s(?P<year>\d{4})\b", re.IGNORECASE)),
    ("year", re.compile(r"(?<![\d$.,])\b(?P<year>(?:19|20)\d{2})\b(?![\d%]|[.,]\d)")),
]


def format_amount(value: Decimal) -> str:
    if value == value.to_integral_value():
        return str(int(value))
    return format(value.normalize(), "f")


def _decimal(num: str) -> Decimal | None:
    try:
        return Decimal(num.replace(",", ""))
    except InvalidOperation:
        return None


def _non_overlapping(found: list[tuple[int, int, str]]) -> list[tuple[int, int, str]]:
    """Keep the longest match at each place. found holds (start, end, normal)."""
    found.sort(key=lambda f: (f[0], -(f[1] - f[0])))
    out: list[tuple[int, int, str]] = []
    for item in found:
        if out and item[0] < out[-1][1]:
            continue
        out.append(item)
    return out


def parse_money(text: str) -> list[tuple[int, int, str]]:
    found = []
    for pattern in (_MONEY_A, _MONEY_B):
        for m in pattern.finditer(text):
            amount = _decimal(m.group("num"))
            if amount is None:
                continue
            mult = (m.group("mult") or "").lower()
            if mult:
                amount *= _MULTIPLIER[mult]
            symbol = (m.groupdict().get("pre") or m.groupdict().get("post") or "").lower().replace(" $", "$")
            currency = _CURRENCY.get(symbol) or _CURRENCY.get((m.groupdict().get("post") or "").lower())
            if currency is None:
                continue
            found.append((m.start(), m.end(), f"{format_amount(amount)} {currency}"))
    return _non_overlapping(found)


def parse_percents(text: str) -> list[tuple[int, int, str]]:
    return _non_overlapping([(m.start(), m.end(), f"{format_amount(Decimal(m.group('num')))}%")
                             for m in _PERCENT.finditer(text)])


def parse_numbers(text: str) -> list[tuple[int, int, str]]:
    found = []
    for m in _NUMBER.finditer(text):
        if m.group("word"):
            found.append((m.start(), m.end(), str(_WORD_NUMBERS[m.group("word").lower()])))
            continue
        value = _decimal(m.group("num"))
        if value is None:
            continue
        mult = (m.group("mult") or "").lower()
        if mult:
            value *= _MULTIPLIER[mult]
        found.append((m.start(), m.end(), format_amount(value)))
    return _non_overlapping(found)


def parse_quantities(text: str) -> list[tuple[int, int, str]]:
    found = []
    for m in _QUANTITY.finditer(text):
        value = _decimal(m.group("num"))
        if value is None:
            continue
        mult = (m.group("mult") or "").lower()
        if mult:
            value *= _MULTIPLIER[mult]
        unit = "t/y" if m.group("year") else "t"
        found.append((m.start(), m.end(), f"{format_amount(value)} {unit}"))
    for m in _QUANTITY_NORMAL.finditer(text.strip()):
        found.append((0, len(text), f"{format_amount(Decimal(m.group('num')))} {m.group('unit')}"))
    return _non_overlapping(found)


def _date_normal(kind: str, m: re.Match) -> str | None:
    g = m.groupdict()
    year = int(g["year"])
    if not 1900 <= year <= 2100:
        return None
    if kind == "year":
        return f"{year:04d}"
    if kind == "quarter":
        q = int(g["q"]) if g.get("q") else _ORD[g["qword"].lower()]
        return f"{year:04d}-Q{q}"
    if kind == "half":
        h = int(g["h"]) if g.get("h") else _ORD[g["hword"].lower()]
        return f"{year:04d}-H{h}"
    month = int(g["mnum"]) if g.get("mnum") else _MONTHS[g["month"].lower().rstrip(".")]
    if not 1 <= month <= 12:
        return None
    if kind == "month":
        return f"{year:04d}-{month:02d}"
    day = int(g["day"])
    if not 1 <= day <= 31:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_dates(text: str) -> list[tuple[int, int, str]]:
    found = []
    for kind, pattern in _DATE_PATTERNS:
        for m in pattern.finditer(text):
            normal = _date_normal(kind, m)
            if normal:
                found.append((m.start(), m.end(), normal))
    return _non_overlapping(found)


def normalise_enum(text: str) -> str:
    return "_".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def normalise_text(text: str) -> str:
    return " ".join(text.lower().split())


_PARSERS = {
    "money": parse_money,
    "percent": parse_percents,
    "number": parse_numbers,
    "quantity": parse_quantities,
    "date": parse_dates,
}


def values_in(value_type: str, text: str) -> list[str]:
    """Each value of the type in the text, in normal form."""
    parser = _PARSERS.get(value_type)
    if parser is not None:
        return [normal for _s, _e, normal in parser(text)]
    if value_type == "enum":
        return [normalise_enum(text)]
    if value_type == "entity":
        return [normalise_name(text)]
    return [normalise_text(text)]


def normalise_value(value_type: str, text: str | None) -> str | None:
    """The normal form of one value, or None when the text does not give a value of the type."""
    if text is None or not str(text).strip():
        return None
    text = str(text).strip()
    found = values_in(value_type, text)
    if not found:
        return None
    if value_type in _PARSERS and len(found) != 1:
        return None
    return found[0]
