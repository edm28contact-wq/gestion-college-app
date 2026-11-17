"""Fail-closed validation of independent OCR readings of invoice stock lines.

No network requests, filesystem access, or stock/database writes.
Model adapters must supply independently extracted structured values and stable
page + row identifiers; this module does not operate OCR models itself.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
import unicodedata

MONEY_TOLERANCE = Decimal("0.02")
FIELDS = (
    "supplier_reference", "description", "purchase_quantity", "purchase_unit",
    "priced_quantity", "priced_unit", "unit_price_ht", "total_ht",
)
AMOUNTS = ("purchase_quantity", "priced_quantity", "unit_price_ht", "total_ht")


def normalized(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^A-Z0-9]+", " ", text.upper()).strip()


def number(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("numeric value missing")
    raw = str(value).strip().replace("\u00a0", "").replace(" ", "")
    if not raw:
        raise ValueError("numeric value missing")
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".") if raw.rfind(",") > raw.rfind(".") else raw.replace(",", "")
    else:
        raw = raw.replace(",", ".")
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", raw):
        raise ValueError("ambiguous numeric representation")
    try:
        result = Decimal(raw)
        if not result.is_finite():
            raise ValueError("non finite numeric value")
        return result
    except InvalidOperation as exc:
        raise ValueError("invalid numeric value") from exc


def _field_equal(field, left, right):
    if field in AMOUNTS:
        try:
            return number(left) == number(right)
        except ValueError:
            return False
    return bool(normalized(left)) and normalized(left) == normalized(right)


def _index_rows(rows):
    result = {}
    for row in rows:
        position = str(row.get("position") or "").strip()
        if not re.fullmatch(r"p[1-9]\d*:r[1-9]\d*", position):
            raise ValueError("position must be a verified page and row identifier")
        if position in result:
            raise ValueError("duplicate position in single OCR output")
        result[position] = row
    return result


def reconcile(first, second, catalog):
    """Return candidates for review; never execute a stock entry.

    Both engines must be independent and supply matching line positions.
    Catalog: [{supplier, supplier_reference, product_id, active,
               purchase_unit, stock_unit, purchase_to_stock_factor}].
    """
    engines = (str(first.get("engine", "")), str(second.get("engine", "")))
    if any(not name for name in engines) or engines[0] == engines[1]:
        raise ValueError("two independent OCR engine identifiers required")
    invoice_issues = []
    for field in ("supplier", "date", "invoice_number"):
        if not _field_equal(field, first.get(field), second.get(field)):
            invoice_issues.append("invoice_" + field + "_disagreement")
    left, right = _index_rows(first.get("lines", [])), _index_rows(second.get("lines", []))
    catalog_by_key = {}
    for item in catalog:
        if item.get("active") is False:
            continue
        key = (normalized(item.get("supplier")), normalized(item.get("supplier_reference")))
        if all(key):
            catalog_by_key.setdefault(key, []).append(item)
    reviewed = []
    for position in sorted(set(left) | set(right), key=lambda v: tuple(int(x) for x in re.findall(r"\d+", v))):
        a, b = left.get(position), right.get(position)
        issues = list(invoice_issues)
        if a is None or b is None:
            issues.append("line_missing_from_one_engine")
            reviewed.append({"position": position, "status": "review", "issues": issues})
            continue
        for field in FIELDS:
            if not _field_equal(field, a.get(field), b.get(field)):
                issues.append(field + "_disagreement")
        if issues:
            reviewed.append({"position": position, "status": "review", "issues": issues})
            continue
        supplier = normalized(first["supplier"])
        supplier_ref = normalized(a["supplier_reference"])
        matches = catalog_by_key.get((supplier, supplier_ref), [])
        if len(matches) != 1:
            issues.append("catalog_product_absent_or_ambiguous")
            reviewed.append({"position": position, "status": "review", "issues": issues})
            continue
        product = matches[0]
        if normalized(product.get("purchase_unit")) != normalized(a["purchase_unit"]):
            issues.append("catalog_purchase_unit_mismatch")
        try:
            qty = number(a["purchase_quantity"])
            priced_qty = number(a["priced_quantity"])
            unit_price = number(a["unit_price_ht"])
            line_total = number(a["total_ht"])
            factor = number(product.get("purchase_to_stock_factor"))
        except ValueError:
            issues.append("invalid_numeric_fields")
            reviewed.append({"position": position, "status": "review", "issues": issues})
            continue
        stock_unit = normalized(product.get("stock_unit"))
        priced_unit = normalized(a.get("priced_unit"))
        purchase_unit = normalized(a.get("purchase_unit"))
        if not stock_unit:
            issues.append("catalog_stock_unit_missing")
        if qty <= 0 or priced_qty <= 0 or unit_price < 0 or line_total < 0 or factor <= 0:
            issues.append("non_positive_quantity_or_factor")
        if abs(priced_qty * unit_price - line_total) > MONEY_TOLERANCE:
            issues.append("line_amount_inconsistent")
        stock_qty = qty * factor
        if priced_unit == stock_unit:
            if priced_qty != stock_qty:
                issues.append("priced_quantity_differs_from_stock_conversion")
        elif priced_unit == purchase_unit:
            if priced_qty != qty:
                issues.append("priced_quantity_differs_from_purchase_quantity")
        else:
            issues.append("priced_unit_not_supported_by_catalog")
        if issues:
            reviewed.append({"position": position, "status": "review", "issues": issues})
            continue
        reviewed.append({
            "position": position,
            "status": "candidate_for_review",
            "issues": [],
            "product_id": product["product_id"],
            "quantity_in_stock_unit": str(stock_qty.normalize()),
            "stock_unit": str(product["stock_unit"]),
            "line_total_ht": str(line_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
            "source_engines": list(engines),
        })
    return {
        "invoice_status": "review" if invoice_issues or any(x["status"] != "candidate_for_review" for x in reviewed) or not reviewed else "candidates_only",
        "issues": invoice_issues,
        "lines": reviewed,
        "stock_entries_written": 0,
    }
