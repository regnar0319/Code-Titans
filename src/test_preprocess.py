"""Regression tests for the telemetry preprocessing pipeline.

Run with:
    python src/test_preprocess.py
"""

import io
import json
import unittest

from preprocess import normalize_record, preprocess


class PreprocessTests(unittest.TestCase):
    def test_normalizes_common_aliases(self) -> None:
        payload = normalize_record(
            {
                "node_id": "42",
                "lat": "27.9860654",
                "lng": "86.9092494",
                "triage": "medical",
                "conscious": "yes",
                "is_group": "0",
                "battery": "75",
                "hop_limit": "3",
            }
        )

        self.assertEqual(
            payload,
            {
                "nodeId": 42,
                "latitude": 27.986065,
                "longitude": 86.909249,
                "triageType": 1,
                "isConscious": True,
                "groupCount": False,
                "batteryPercent": 75.0,
                "ttl": 3,
            },
        )

    def test_rejects_malformed_json_and_continues(self) -> None:
        source = io.StringIO(
            '{"nodeId":1,"latitude":0,"longitude":0,"batteryPercent":50,"ttl":1}\n'
            '{not-json}\n'
            '{"nodeId":2,"latitude":91,"longitude":0,"batteryPercent":50,"ttl":1}\n'
        )
        destination = io.StringIO()
        rejects = io.StringIO()

        summary = preprocess(source, destination, input_format="jsonl", rejects=rejects)

        self.assertEqual((summary.accepted, summary.rejected), (1, 2))
        self.assertEqual(json.loads(destination.getvalue()), {
            "nodeId": 1,
            "latitude": 0.0,
            "longitude": 0.0,
            "triageType": 0,
            "isConscious": False,
            "groupCount": False,
            "batteryPercent": 50.0,
            "ttl": 1,
        })
        rejection_errors = [json.loads(line)["error"] for line in rejects.getvalue().splitlines()]
        self.assertIn("invalid JSON", rejection_errors[0])
        self.assertEqual(rejection_errors[1], "latitude must be in -90..90")


if __name__ == "__main__":
    unittest.main()
