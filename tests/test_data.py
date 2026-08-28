"""Structural tests over the generated data.json.

These assert shape and invariants, not specific rankings, so they keep passing as
the nightly data changes. Run:  python -m unittest discover -s tests
"""
import datetime
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data.json")


def load():
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)


def search(data, q):
    """Mirror the page's matcher: substring over target, becomes, aliases, lures."""
    q = q.lower()
    hits = set()
    for lg in data["leagues"].values():
        for r in lg["rows"]:
            pool = [r["target"]] + r.get("becomes", []) + r.get("aliases", []) + r.get("lures", [])
            if any(q in str(x).lower() for x in pool):
                hits.add(r["target"])
    return hits


class DataShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = load()

    def test_leagues_present(self):
        self.assertEqual(set(self.d["leagues"]), {"great", "ultra", "master"})

    def test_meta_present(self):
        self.assertIn("gamemaster", self.d)
        self.assertIn("builtAt", self.d)
        # builtAt must be a parseable timestamp.
        datetime.datetime.fromisoformat(self.d["builtAt"])

    def test_targets_unique_per_league(self):
        for key, lg in self.d["leagues"].items():
            targets = [r["target"] for r in lg["rows"]]
            self.assertEqual(len(targets), len(set(targets)),
                             f"duplicate catch target in {key}")

    def test_ranks_numeric(self):
        for lg in self.d["leagues"].values():
            for r in lg["rows"]:
                for k in ("lead", "switch", "closer"):
                    self.assertIsInstance(r[k], int)
                self.assertTrue(r["overall"] is None or isinstance(r["overall"], int))

    def test_now_dates_parse(self):
        for lg in self.d["leagues"].values():
            for r in lg["rows"]:
                now = r.get("now")
                if now and now.get("until"):
                    datetime.datetime.fromisoformat(now["until"].replace("Z", ""))


class SearchResolves(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = load()

    def test_middle_and_final_stages_resolve(self):
        cases = {
            "prinplup": "Piplup", "croconaw": "Totodile", "corvisquire": "Rookidee",
            "gabite": "Gible", "frogadier": "Froakie", "seadra": "Horsea",
            "doublade": "Honedge", "shelgon": "Bagon", "annihilape": "Mankey",
            "clodsire": "Wooper (Paldean)",
        }
        for q, target in cases.items():
            self.assertIn(target, search(self.d, q), f"{q} should resolve to {target}")

    def test_ninetales_resolves_both_vulpix(self):
        hits = search(self.d, "ninetales")
        self.assertIn("Vulpix", hits)
        self.assertIn("Vulpix (Alolan)", hits)

    def test_aliases_span_whole_tree(self):
        # Find Piplup's row and confirm every evolution stage is searchable.
        row = next(r for lg in self.d["leagues"].values() for r in lg["rows"]
                   if r["target"] == "Piplup")
        low = [a.lower() for a in row["aliases"]]
        for stage in ("piplup", "prinplup", "empoleon"):
            self.assertIn(stage, low)


class FamilyIndex(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = load()
        cls.by = {f["target"]: f for f in cls.d["families"]}

    def test_index_present_and_covers_curated(self):
        self.assertGreater(len(self.d["families"]), 300)
        # Every curated row must also appear in the family index.
        targets = {f["target"] for f in self.d["families"]}
        for lg in self.d["leagues"].values():
            for r in lg["rows"]:
                self.assertIn(r["target"], targets)

    def test_weak_family_is_ranked_but_low(self):
        # Weedle's line is ranked (via Beedrill) but nowhere near the top 75.
        f = self.by["Weedle"]
        self.assertIn("weedle", [a.lower() for a in f["aliases"]])
        self.assertTrue(f["best"], "Weedle should carry at least one league rank")
        self.assertTrue(all(v[1] == "skip" for v in f["best"].values()))

    def test_unranked_family_has_empty_best(self):
        # Base Rattata isn't in PvPoke's rankings at all.
        self.assertEqual(self.by["Rattata"]["best"], {})

    def test_cross_league_family(self):
        # Dialga is skip in Great/Ultra but core in Master.
        best = self.by["Dialga"]["best"]
        self.assertEqual(best["master"][1], "core")
        self.assertEqual(best["great"][1], "skip")

    def test_curated_family_tier_matches_row(self):
        # Piplup is core in Great in both the index and the curated rows.
        self.assertEqual(self.by["Piplup"]["best"]["great"][1], "core")
        row = next(r for r in self.d["leagues"]["great"]["rows"] if r["target"] == "Piplup")
        self.assertEqual(row["tier"], "core")


if __name__ == "__main__":
    unittest.main()
