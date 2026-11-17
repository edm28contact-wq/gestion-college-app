import unittest
from copy import deepcopy

from ocr_review_policy import triage_readings

HASH = "a" * 64


def reading(colors, checks=True):
    return {
        "file_hash": HASH,
        "document_checks_ok": checks,
        "lines": [{"line_id": key, "status": color, "description": "produit " + key}
                  for key, color in colors.items()],
    }


class OCRReviewPolicyTests(unittest.TestCase):
    def test_all_green_finish_first_read(self):
        output = triage_readings([reading({"a": "green"})])
        self.assertEqual(output["action"], "finished")
        self.assertEqual(len(output["retained_green"]), 1)
        self.assertEqual(output["stock_entries_written"], 0)

    def test_red_on_first_read_causes_second_read(self):
        output = triage_readings([reading({"a": "red", "b": "green"})])
        self.assertEqual(output["action"], "retry")
        self.assertEqual(output["next_reading"], 2)
        self.assertTrue(output["excluded_red"][0]["restorable_manually"])

    def test_orange_on_first_read_causes_second_read(self):
        output = triage_readings([reading({"a": "orange"})])
        self.assertEqual(output["next_reading"], 2)

    def test_second_read_only_red_finishes(self):
        output = triage_readings([
            reading({"a": "orange", "b": "red"}),
            reading({"a": "green", "b": "red"}),
        ])
        self.assertEqual(output["action"], "finished")
        self.assertEqual(output["excluded_red"][0]["line_id"], "b")
        self.assertEqual(output["retained_green"][0]["line_id"], "a")

    def test_orange_remains_after_second_triggers_third(self):
        output = triage_readings([
            reading({"a": "orange"}),
            reading({"a": "orange"}),
        ])
        self.assertEqual(output["action"], "retry")
        self.assertEqual(output["next_reading"], 3)

    def test_orange_after_third_is_manual(self):
        output = triage_readings([
            reading({"a": "orange"}),
            reading({"a": "orange"}),
            reading({"a": "orange"}),
        ])
        self.assertEqual(output["action"], "manual_review")
        self.assertEqual(len(output["manual_review_orange"]), 1)

    def test_red_after_third_does_not_require_manual_review(self):
        output = triage_readings([
            reading({"a": "orange"}),
            reading({"a": "orange"}),
            reading({"a": "red"}),
        ])
        self.assertEqual(output["action"], "finished")
        self.assertTrue(output["excluded_red"][0]["excluded_from_receipt"])

    def test_disappearing_line_is_never_discarded(self):
        output = triage_readings([
            reading({"a": "red", "b": "green"}),
            reading({"b": "green"}),
        ])
        self.assertEqual(output["action"], "retry")
        self.assertEqual(output["pending_orange"][0]["line_id"], "a")

    def test_newly_discovered_line_not_green_without_second_source(self):
        output = triage_readings([
            reading({"a": "red"}),
            reading({"a": "red", "b": "green"}),
        ])
        self.assertEqual(output["action"], "retry")
        self.assertIn("b", [x["line_id"] for x in output["pending_orange"]])

    def test_newly_discovered_line_can_be_confirmed_on_third(self):
        output = triage_readings([
            reading({"a": "red"}),
            reading({"a": "red", "b": "green"}),
            reading({"a": "red", "b": "green"}),
        ])
        self.assertEqual(output["action"], "finished")
        self.assertIn("b", [x["line_id"] for x in output["retained_green"]])

    def test_document_incomplete_triggers_retry_even_if_lines_green(self):
        output = triage_readings([reading({"a": "green"}, checks=False)])
        self.assertEqual(output["action"], "retry")

    def test_document_incomplete_after_third_requires_review(self):
        output = triage_readings([reading({"a": "green"}, checks=False)] * 3)
        self.assertEqual(output["action"], "manual_review")

    def test_different_file_hash_rejected(self):
        a, b = reading({"a": "orange"}), reading({"a": "red"})
        b["file_hash"] = "b" * 64
        with self.assertRaises(ValueError):
            triage_readings([a, b])

    def test_duplicate_line_id_rejected(self):
        a = reading({"a": "orange"})
        a["lines"].append(deepcopy(a["lines"][0]))
        with self.assertRaises(ValueError):
            triage_readings([a])

    def test_input_remains_unchanged(self):
        original = [reading({"a": "red"})]
        backup = deepcopy(original)
        triage_readings(original)
        self.assertEqual(original, backup)

    def test_max_three_readings(self):
        with self.assertRaises(ValueError):
            triage_readings([reading({"a": "orange"})] * 4)


if __name__ == "__main__":
    unittest.main()
