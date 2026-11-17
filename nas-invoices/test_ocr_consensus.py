import unittest
from ocr_consensus import reconcile, number


class DualOcrConsensusTests(unittest.TestCase):
    def setUp(self):
        self.catalog = [{
            "supplier": "FOURNISSEUR TEST", "supplier_reference": "REF100",
            "product_id": "test-product-100", "active": True,
            "purchase_unit": "COL", "stock_unit": "POT",
            "purchase_to_stock_factor": "48"
        }]
        self.base = {
            "supplier": "FOURNISSEUR TEST", "date": "2026-09-30", "invoice_number": "INV-100",
            "lines": [{
                "position": "p1:r1", "supplier_reference": "REF100",
                "description": "Yaourt nature 125 g", "purchase_quantity": "2",
                "purchase_unit": "COL", "priced_quantity": "96", "priced_unit": "POT",
                "unit_price_ht": "0,43", "total_ht": "41,28"
            }]
        }

    def engine(self, name, patch=None):
        from copy import deepcopy
        result = deepcopy(self.base)
        result["engine"] = name
        if patch:
            result["lines"][0].update(patch)
        return result

    def test_two_matching_engines_are_still_only_candidates(self):
        result = reconcile(self.engine("paddleocr"), self.engine("doctr"), self.catalog)
        self.assertEqual(result["invoice_status"], "candidates_only")
        self.assertEqual(result["lines"][0]["quantity_in_stock_unit"], "96")
        self.assertEqual(result["lines"][0]["status"], "candidate_for_review")
        self.assertEqual(result["stock_entries_written"], 0)

    def test_different_qty_requires_review(self):
        result = reconcile(self.engine("paddleocr"), self.engine("doctr", {"priced_quantity": "98"}), self.catalog)
        self.assertEqual(result["invoice_status"], "review")
        self.assertIn("priced_quantity_disagreement", result["lines"][0]["issues"])

    def test_different_description_requires_review(self):
        result = reconcile(self.engine("paddleocr"), self.engine("doctr", {"description": "Autre produit"}), self.catalog)
        self.assertIn("description_disagreement", result["lines"][0]["issues"])

    def test_repeated_reference_allowed_different_position(self):
        a, b = self.engine("paddleocr"), self.engine("doctr")
        for doc in [a, b]:
            from copy import deepcopy
            row = deepcopy(doc["lines"][0])
            row["position"] = "p2:r3"
            doc["lines"].append(row)
        result = reconcile(a, b, self.catalog)
        self.assertEqual(len(result["lines"]), 2)
        self.assertTrue(all(x["status"] == "candidate_for_review" for x in result["lines"]))

    def test_both_engines_can_agree_on_bad_total(self):
        a = self.engine("paddleocr", {"total_ht": "40,50"})
        b = self.engine("doctr", {"total_ht": "40,50"})
        result = reconcile(a, b, self.catalog)
        self.assertIn("line_amount_inconsistent", result["lines"][0]["issues"])

    def test_ambiguous_catalog_requires_review(self):
        catalog = self.catalog + [dict(self.catalog[0], product_id="duplicate-product")]
        result = reconcile(self.engine("paddleocr"), self.engine("doctr"), catalog)
        self.assertIn("catalog_product_absent_or_ambiguous", result["lines"][0]["issues"])

    def test_missing_line_requires_review(self):
        b = self.engine("doctr")
        b["lines"] = []
        result = reconcile(self.engine("paddleocr"), b, self.catalog)
        self.assertIn("line_missing_from_one_engine", result["lines"][0]["issues"])

    def test_inconsistent_catalog_conversion_requires_review(self):
        catalog = [dict(self.catalog[0], purchase_to_stock_factor="24")]
        result = reconcile(self.engine("paddleocr"), self.engine("doctr"), catalog)
        self.assertIn("priced_quantity_differs_from_stock_conversion", result["lines"][0]["issues"])

    def test_incorrect_units_requires_review(self):
        result = reconcile(self.engine("paddleocr"), self.engine("doctr"), [dict(self.catalog[0], purchase_unit="SAC")])
        self.assertIn("catalog_purchase_unit_mismatch", result["lines"][0]["issues"])

    def test_agreement_header_is_necessary(self):
        b = self.engine("doctr")
        b["invoice_number"] = "INV-999"
        result = reconcile(self.engine("paddleocr"), b, self.catalog)
        self.assertEqual(result["invoice_status"], "review")

    def test_same_engine_rejected(self):
        with self.assertRaises(ValueError):
            reconcile(self.engine("paddleocr"), self.engine("paddleocr"), self.catalog)

    def test_ambiguous_numeric_input_rejected(self):
        with self.assertRaises(ValueError):
            number("10,50,25")

    def test_priced_quantity_can_be_purchase_unit(self):
        a = self.engine("paddleocr", {"priced_quantity": "2", "priced_unit": "COL", "unit_price_ht": "20,64"})
        b = self.engine("doctr", {"priced_quantity": "2", "priced_unit": "COL", "unit_price_ht": "20,64"})
        result = reconcile(a, b, self.catalog)
        self.assertEqual(result["lines"][0]["status"], "candidate_for_review")
        self.assertEqual(result["lines"][0]["quantity_in_stock_unit"], "96")


if __name__ == "__main__":
    unittest.main()
