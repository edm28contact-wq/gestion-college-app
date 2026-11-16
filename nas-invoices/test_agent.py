import hashlib
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from agent import (ReviewRequired, canonical_date, classify, digest, process_one,
                   save_without_overwrite, supplier_name, valid_confidence)


class InvoiceNasTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root / "ENTREE_FACTURES"
        self.dst = self.root / "FACTURES_CLASSEES"
        self.review = self.root / "A_VERIFIER"
        for folder in [self.src, self.dst, self.review]:
            folder.mkdir()
        self.pdf = self.src / "SCAN_000145.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\n" + b"test bytes" * 5)
        os.utime(self.pdf, (time.time() - 300, time.time() - 300))

    def document(self):
        return {"vendor": "LA NORMANDE SA", "date": "2026-09-30",
                "invoice_number": "9027435888",
                "fields": {"vendor": {"score": .97}, "date": {"score": .98},
                           "invoice_number": {"score": .96}}}

    def reader(self, data, name, credentials):
        self.assertTrue(data.startswith(b"%PDF-"))
        return self.document()

    def test_sample_name_exact(self):
        self.assertEqual(classify(self.document()), "2026-09-30 LA NORMANDE.pdf")

    def test_date_is_invoice_date(self):
        self.assertEqual(canonical_date("30/09/2026"), "2026-09-30")
        with self.assertRaises(ReviewRequired):
            canonical_date("2026-02-30")

    def test_suffix_and_invalid_characters(self):
        self.assertEqual(supplier_name("La Normande SA"), "LA NORMANDE")
        self.assertEqual(supplier_name("Société / A: B SAS"), "SOCIÉTÉ A B")

    def test_missing_or_low_confidence_blocked(self):
        record = self.document()
        record["fields"]["vendor"]["score"] = .72
        with self.assertRaises(ReviewRequired):
            classify(record)
        record = self.document()
        del record["fields"]["invoice_number"]
        with self.assertRaises(ReviewRequired):
            classify(record)
        record = self.document()
        record["invoice_number"] = ""
        with self.assertRaises(ReviewRequired):
            classify(record)

    def test_copy_preserves_original_and_exact_bytes(self):
        status, target = process_one(self.pdf, self.dst, self.review, {}, reader=self.reader)
        self.assertEqual(status, "copied")
        self.assertEqual(target.name, "2026-09-30 LA NORMANDE.pdf")
        self.assertEqual(target.read_bytes(), self.pdf.read_bytes())
        self.assertTrue(self.pdf.exists())

    def test_no_duplicate_ocr_or_copy_after_success(self):
        count = [0]
        def counted(*args):
            count[0] += 1
            return self.document()
        self.assertEqual(process_one(self.pdf,self.dst,self.review,{},reader=counted)[0], "copied")
        self.assertEqual(process_one(self.pdf,self.dst,self.review,{},reader=counted)[0], "duplicate")
        self.assertEqual(count[0], 1)

    def test_review_file_copied_with_source_name(self):
        def reader(*args):
            raise ReviewRequired("Sans fournisseur")
        status, target = process_one(self.pdf,self.dst,self.review,{},reader=reader)
        self.assertEqual(status, "review")
        self.assertEqual(target.name, "SCAN_000145.pdf")
        self.assertTrue(self.pdf.is_file())
        self.assertEqual(target.read_bytes(), self.pdf.read_bytes())

    def test_same_name_different_content_gets_suffix(self):
        first = self.pdf.read_bytes()
        other = b"%PDF-1.7\n" + b"different" * 20
        target, created = save_without_overwrite(first,self.dst,"2026-09-30 LA NORMANDE.pdf")
        target2, created2 = save_without_overwrite(other,self.dst,"2026-09-30 LA NORMANDE.pdf")
        self.assertTrue(created and created2)
        self.assertEqual(target2.name,"2026-09-30 LA NORMANDE (2).pdf")
        self.assertEqual(target.read_bytes(),first)

    def test_duplicate_content_with_alternate_name(self):
        original = self.pdf.read_bytes()
        save_without_overwrite(original,self.dst,"2026-09-30 LA NORMANDE.pdf")
        target,created = save_without_overwrite(original,self.dst,"2026-09-30 LA NORMANDE.pdf")
        self.assertFalse(created)
        self.assertEqual(target.read_bytes(),original)

    def test_recent_or_incomplete_file_not_processed(self):
        os.utime(self.pdf, None)
        self.assertEqual(process_one(self.pdf,self.dst,self.review,{},reader=self.reader)[0],"ignored")
        self.pdf.write_bytes(b"not a pdf")
        os.utime(self.pdf, (time.time()-300,time.time()-300))
        def bad(*args):
            raise ReviewRequired("PDF invalide")
        self.assertEqual(process_one(self.pdf,self.dst,self.review,{},reader=bad)[0],"review")

    def test_dry_run_writes_nothing(self):
        status,target=process_one(self.pdf,self.dst,self.review,{},reader=self.reader,dry_run=True)
        self.assertEqual(status,"dry-run-copied")
        self.assertFalse(target.exists())
        self.assertTrue(self.pdf.exists())


if __name__ == "__main__":
    unittest.main()
