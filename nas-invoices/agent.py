#!/usr/bin/env python3
"""Classement en copie seule des factures PDF sur un NAS. Aucune ecriture en stock."""
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

LOG = logging.getLogger("nas-invoices")
API = "https://api.veryfi.com/api/v8/partner/documents"
MAX_BYTES = 6 * 1024 * 1024
SAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
DATE_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
DATE_FR = re.compile(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$")
COMPANY_SUFFIX = re.compile(r"\s+(?:SA|SAS|SARL|SASU|EURL|S\.A\.|S\.A\.S\.)$", re.I)


class ReviewRequired(Exception):
    """Aucune copie avec un nom deduit d'informations incertaines."""


def unwrap(field):
    if isinstance(field, dict):
        return field.get("value")
    return field


def confidence(field):
    if not isinstance(field, dict):
        return None
    scores = [field.get(k) for k in ("score", "ocr_score")]
    values = [float(v) for v in scores if isinstance(v, (int, float)) and 0 <= v <= 1]
    return min(values) if values else None


def valid_confidence(field, minimum):
    score = confidence(field)
    return score is not None and score >= minimum


def canonical_date(value):
    value = str(unwrap(value) or "").strip()
    iso = DATE_ISO.fullmatch(value)
    fr = DATE_FR.fullmatch(value)
    if iso:
        year, month, day = map(int, iso.groups())
    elif fr:
        day, month, year = map(int, fr.groups())
    else:
        raise ReviewRequired("Date de facture absente ou ambigue")
    try:
        return date(year, month, day).isoformat()
    except ValueError as exc:
        raise ReviewRequired("Date de facture invalide") from exc


def supplier_name(value):
    text = str(unwrap(value) or "").strip()
    if not text:
        raise ReviewRequired("Fournisseur absent")
    text = COMPANY_SUFFIX.sub("", text).strip()
    text = SAFE_NAME.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    text = text.upper()
    if len(text) < 3 or len(text) > 90 or text in ("INCONNU", "FOURNISSEUR", "UNKNOWN"):
        raise ReviewRequired("Fournisseur non exploitable")
    return text


def classify(document, min_confidence=0.90):
    """Le nom automatique necessite date, fournisseur ET numero de facture fiables."""
    vendor = document.get("vendor")
    if isinstance(vendor, dict):
        vendor = vendor.get("name") or vendor.get("raw_name")
    if not vendor:
        vendor = (document.get("supplier") or {}).get("name") if isinstance(document.get("supplier"), dict) else None
    number = str(unwrap(document.get("invoice_number")) or "").strip()
    invoice_date = unwrap(document.get("date") or document.get("invoice_date"))
    if not number or len(number) > 140:
        raise ReviewRequired("Numero de facture absent ou ambigu")
    top = document.get("fields") if isinstance(document.get("fields"), dict) else {}
    raw_vendor = document.get("vendor")
    vendor_field = top.get("vendor")
    if vendor_field is None and isinstance(raw_vendor, dict):
        vendor_field = raw_vendor.get("name")
    raw_date = top.get("date") if top.get("date") is not None else document.get("date")
    raw_number = top.get("invoice_number") if top.get("invoice_number") is not None else document.get("invoice_number")
    for label, field in (("fournisseur", vendor_field), ("date", raw_date), ("numero", raw_number)):
        if not valid_confidence(field, min_confidence):
            raise ReviewRequired("Confiance absente ou insuffisante pour " + label)
    # Le numero est exige meme s'il n'apparait pas dans le nom du PDF.
    return canonical_date(invoice_date) + " " + supplier_name(vendor) + ".pdf"


def read_veryfi(pdf_bytes, filename, credentials, opener=None):
    import base64
    if not pdf_bytes.startswith(b"%PDF-"):
        raise ReviewRequired("Document non PDF")
    if len(pdf_bytes) > MAX_BYTES:
        raise ReviewRequired("PDF superieur a 6 Mo")
    if not all(credentials.get(k) for k in ("client_id", "api_key")):
        raise RuntimeError("Identifiants Veryfi manquants")
    mode = credentials.get("auth_mode", "bearer").lower()
    if mode == "standard":
        if not credentials.get("username"):
            raise RuntimeError("VERYFI_USERNAME requis en mode standard")
        auth = "apikey " + credentials["username"] + ":" + credentials["api_key"]
    elif mode == "bearer":
        auth = "Bearer " + credentials["api_key"]
    else:
        raise RuntimeError("Mode Veryfi non pris en charge")
    payload = json.dumps({"file_name": filename, "file_data": base64.b64encode(pdf_bytes).decode("ascii"),
                          "categories": [], "bounding_boxes": True, "confidence_details": True,
                          "auto_delete": True}).encode("utf-8")
    request = urllib.request.Request(API, data=payload, method="POST",
        headers={"CLIENT-ID": credentials["client_id"], "AUTHORIZATION": auth,
                 "Content-Type": "application/json", "Accept": "application/json"})
    client = opener or urllib.request.urlopen
    with client(request, timeout=90) as response:
        return json.load(response)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_copy(data, destination):
    """Une copie partielle ne doit jamais etre visible sous son nom definitif."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, tmp = tempfile.mkstemp(prefix=".facture-", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        # Lien exclusif : ne remplace jamais une facture existante.
        os.link(tmp, destination)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def save_without_overwrite(data, base_dir, name):
    stem = Path(name).stem
    h = digest(data)
    for idx in range(1, 10000):
        target = base_dir / (name if idx == 1 else f"{stem} ({idx}).pdf")
        if target.exists():
            if digest(target.read_bytes()) == h:
                return target, False
            continue
        try:
            atomic_copy(data, target)
            return target, True
        except FileExistsError:
            continue
    raise RuntimeError("Trop de fichiers portant le meme nom")


def is_stable(path, min_age=30):
    try:
        stat = path.stat()
        return stat.st_size > 5 and time.time() - stat.st_mtime >= min_age
    except FileNotFoundError:
        return False


def process_one(path, destination, review, credentials, reader=read_veryfi,
                min_confidence=0.90, dry_run=False):
    if path.suffix.lower() != ".pdf" or not is_stable(path):
        return "ignored", None
    before = path.stat()
    # Ne pas charger un PDF demesure en memoire et ne jamais traiter un fichier incomplet.
    if before.st_size > MAX_BYTES:
        raise RuntimeError("PDF > 6 Mo : traitement manuel requis, aucune copie")
    data = path.read_bytes()
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or len(data) != after.st_size:
        return "ignored", None
    h = digest(data)
    # Aucun cout OCR si ce contenu a deja ete archive, meme sous un autre nom.
    for old in destination.glob("*.pdf"):
        if old.is_file() and digest(old.read_bytes()) == h:
            return "duplicate", old
    for old in review.glob("*.pdf") if review.exists() else ():
        if old.is_file() and digest(old.read_bytes()) == h:
            return "review-existing", old
    try:
        result = reader(data, path.name, credentials)
        renamed = classify(result, min_confidence)
        dest = destination
        status = "copied"
    except ReviewRequired as exc:
        renamed = path.name
        dest = review
        status = "review"
        LOG.warning("Revue necessaire pour %s: %s", path.name, exc)
    if dry_run:
        return "dry-run-" + status, dest / renamed
    new_path, created = save_without_overwrite(data, dest, renamed)
    return status if created else "duplicate", new_path


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(message)s")
    root = Path(os.environ.get("NAS_ROOT", "/data")).resolve()
    source = Path(os.environ.get("SOURCE_DIR", str(root / "ENTREE_FACTURES"))).resolve()
    destination = Path(os.environ.get("DEST_DIR", str(root / "FACTURES_CLASSEES"))).resolve()
    review = Path(os.environ.get("REVIEW_DIR", str(root / "A_VERIFIER"))).resolve()
    if source == destination or source == review or destination == review:
        raise RuntimeError("Les dossiers source, destination et revue doivent etre differents")
    if source in destination.parents or destination in source.parents or source in review.parents:
        raise RuntimeError("Les dossiers surveilles ne doivent pas s'imbriquer")
    credentials = {"client_id": os.environ.get("VERYFI_CLIENT_ID", ""),
                   "api_key": os.environ.get("VERYFI_API_KEY", ""),
                   "username": os.environ.get("VERYFI_USERNAME", ""),
                   "auth_mode": os.environ.get("VERYFI_AUTH_MODE", "bearer")}
    if not credentials["client_id"] or not credentials["api_key"]:
        raise RuntimeError("VERYFI_CLIENT_ID et VERYFI_API_KEY doivent etre configures sur le NAS")
    if not source.is_dir():
        raise RuntimeError(f"Dossier source inexistant : {source}")
    destination.mkdir(parents=True, exist_ok=True)
    review.mkdir(parents=True, exist_ok=True)
    min_score = float(os.environ.get("MIN_CONFIDENCE", "0.90"))
    interval = max(30, int(os.environ.get("SCAN_INTERVAL_SEC", "60")))
    dry_run = os.environ.get("DRY_RUN", "true").lower() != "false"
    LOG.info("Surveillance NAS : %s -> %s (simulation=%s)", source, destination, dry_run)
    seen_dry_run = set()
    while True:
        for path in sorted(source.iterdir()):
            if not path.is_file() or path.suffix.lower() != ".pdf":
                continue
            try:
                if dry_run and is_stable(path):
                    hash_value = digest(path.read_bytes())
                    if hash_value in seen_dry_run:
                        continue
                    seen_dry_run.add(hash_value)
                status, target = process_one(path, destination, review, credentials,
                                            min_confidence=min_score, dry_run=dry_run)
                if status != "ignored":
                    LOG.info("%s : %s -> %s", status, path.name, target)
            except (OSError, ValueError, RuntimeError, urllib.error.URLError) as exc:
                LOG.error("Traitement impossible pour %s : %s", path.name, exc)
        time.sleep(interval)


if __name__ == "__main__":
    main()
