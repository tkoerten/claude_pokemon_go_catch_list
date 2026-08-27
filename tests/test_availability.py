"""Availability layer: date folding, expired-window handling, failure status.

Offline: the ScrapedDuck fetches are stubbed and wild_spawns.json is pointed at a
crafted temp file, so results are deterministic.
"""
import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import availability  # noqa: E402


class AvailabilityBase(unittest.TestCase):
    def setUp(self):
        self._get = availability.get
        self._here = availability.HERE
        self.tmp = tempfile.mkdtemp()
        availability.HERE = self.tmp
        availability.get = lambda name, failures=None: []   # no network
        with open(os.path.join(self.tmp, "wild_spawns.json"), "w", encoding="utf-8") as f:
            json.dump([{
                "label": "Test Event", "start": "2026-08-25T10:00:00",
                "end": "2026-08-28T10:00:00", "pokemon": ["Ralts", "Spheal"]
            }], f)

    def tearDown(self):
        availability.get = self._get
        availability.HERE = self._here


class Windows(AvailabilityBase):
    def test_active_window_is_present(self):
        out, status = availability.build(datetime.datetime(2026, 8, 26, 12, 0))
        self.assertIn("ralts", out)
        self.assertEqual(out["ralts"]["until"], "2026-08-28T10:00:00")
        self.assertTrue(status["ok"])

    def test_expired_window_is_absent(self):
        # A block whose end has passed must not render as active.
        out, _ = availability.build(datetime.datetime(2027, 1, 1))
        self.assertNotIn("ralts", out)

    def test_before_window_is_absent(self):
        out, _ = availability.build(datetime.datetime(2026, 8, 1))
        self.assertNotIn("ralts", out)


class Status(AvailabilityBase):
    def test_failure_is_recorded(self):
        def flaky(name, failures=None):
            if name == "events" and failures is not None:
                failures.append(name)
            return []
        availability.get = flaky
        _, status = availability.build(datetime.datetime(2026, 8, 26))
        self.assertFalse(status["ok"])
        self.assertIn("events", status["failed"])


class Helpers(unittest.TestCase):
    def test_short_date_is_portable(self):
        # strftime('%-d') is not portable; short_date must still work here.
        self.assertEqual(availability.short_date("2026-08-28T10:00:00"), "Aug 28")

    def test_norm_folds_regional(self):
        self.assertEqual(availability.norm("Galarian Corsola"), "corsola galarian")

    def test_attach_carries_until_and_via(self):
        avail = {"altaria": {"kind": "raid", "label": "Raids until Sep 1",
                             "until": "2026-09-01T10:00:00", "rank": 3}}
        rows = [{"target": "Swablu", "becomes": ["Altaria"]}]
        availability.attach(rows, avail)
        self.assertEqual(rows[0]["now"]["until"], "2026-09-01T10:00:00")
        self.assertEqual(rows[0]["now"]["via"], "Altaria")


if __name__ == "__main__":
    unittest.main()
