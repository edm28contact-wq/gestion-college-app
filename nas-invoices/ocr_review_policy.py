"""Politique de tri automatique apres 1, 2 ou 3 lectures OCR de la meme facture.

Ce module ne realise aucun OCR et n'ecrit ni en base ni dans le stock.
Une ligne rouge est EXCLUE, jamais supprimee de la piste d'audit.
"""
from copy import deepcopy

COLORS = {"green", "orange", "red"}
MAX_READS = 3


def _indexed_lines(reading):
    result = {}
    lines = reading.get("lines")
    if not isinstance(lines, list):
        raise ValueError("lines must be a list")
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError("invalid line")
        identity = line.get("line_id")
        status = line.get("status")
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError("line_id required")
        if identity in result:
            raise ValueError("duplicate line_id in a reading")
        if status not in COLORS:
            raise ValueError("unknown line status")
        result[identity] = deepcopy(line)
    return result


def triage_readings(readings):
    """Calculer l'etape suivante et les listes de reception sans effet de bord.

    Chaque lecture doit fournir:
    - file_hash: empreinte SHA256 de la facture identique pour les trois lectures
    - document_checks_ok: verification amont de couverture de toutes les pages,
      lignes attendues, coherence des sommes, date, fournisseur et numero facture
    - lines: lignes rapprochees des lectures successives par un ID stable;
      chaque ligne a line_id et status = green/orange/red.

    Seuls les controles amont peuvent qualifier une ligne de verte. Le retour
    n'autorise pas a lui seul une entree en stock.
    """
    if not isinstance(readings, list) or not 1 <= len(readings) <= MAX_READS:
        raise ValueError("expected between one and three OCR readings")
    source_hash = readings[0].get("file_hash")
    if not isinstance(source_hash, str) or len(source_hash) != 64 or any(ch not in "0123456789abcdef" for ch in source_hash.lower()):
        raise ValueError("invalid SHA256 invoice hash")
    indexed = []
    for reading in readings:
        if reading.get("file_hash") != source_hash:
            raise ValueError("readings do not belong to the same original PDF")
        if not isinstance(reading.get("document_checks_ok"), bool):
            raise ValueError("document_checks_ok must be a verified boolean")
        indexed.append(_indexed_lines(reading))

    current = indexed[-1]
    last_run = len(readings)
    earlier = {}
    for previous in indexed[:-1]:
        earlier.update(previous)
    retained, excluded, unresolved = [], [], []
    all_ids = sorted(set(earlier) | set(current))

    for line_id in all_ids:
        latest = current.get(line_id)
        if latest is None:
            item = deepcopy(earlier[line_id])
            item["status"] = "orange"
            item["reason"] = "line_missing_in_latest_reading"
            unresolved.append(item)
        elif latest["status"] == "red":
            item = deepcopy(latest)
            item["excluded_from_receipt"] = True
            item["restorable_manually"] = True
            excluded.append(item)
        elif latest["status"] == "orange":
            unresolved.append(deepcopy(latest))
        elif last_run > 1 and line_id not in earlier:
            item = deepcopy(latest)
            item["status"] = "orange"
            item["reason"] = "new_line_not_confirmed_by_previous_reading"
            unresolved.append(item)
        else:
            retained.append(deepcopy(latest))

    checks_ok = readings[-1]["document_checks_ok"]
    if last_run == 1 and (unresolved or excluded or not checks_ok):
        action = "retry"
    elif last_run == 2 and (unresolved or not checks_ok):
        action = "retry"
    elif unresolved or not checks_ok:
        action = "manual_review"
    else:
        action = "finished"

    return {
        "action": action,
        "readings_completed": last_run,
        "next_reading": last_run + 1 if action == "retry" else None,
        "retained_green": retained,
        "excluded_red": excluded,
        "manual_review_orange": unresolved if action == "manual_review" else [],
        "pending_orange": unresolved,
        "document_checks_ok": checks_ok,
        "stock_entries_written": 0,
    }
