"""Parser tests against a saved LeekDuck fixture.

If LeekDuck changes its spawns markup, these fail here rather than silently
emptying wild_spawns.json in production.
"""
import datetime
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import fetch_event_spawns as F  # noqa: E402

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "leekduck_pokemon_xp_2026_worlds.html")
EVENT = {
    "name": "PokémonXP & 2026 Worlds",
    "start": "2026-08-25T10:00:00.000",
    "end": "2026-08-30T20:00:00.000",
    "link": "https://leekduck.com/events/pokemon-xp-2026-worlds/",
}


def parse():
    with open(FIXTURE, encoding="utf-8") as f:
        return F.parse_spawns(f.read(), EVENT)


class ParseFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blocks = parse()

    def by_label(self, needle):
        return next(b for b in self.blocks if needle in b["label"])

    def test_four_blocks(self):
        self.assertEqual(len(self.blocks), 4)

    def test_pokemonxp_species(self):
        b = self.by_label("PokémonXP")
        self.assertEqual(b["pokemon"],
                         ["Ralts", "Numel", "Spheal", "Drifloon", "Elgyem", "Sobble", "Pawmi"])
        self.assertEqual((b["start"], b["end"]),
                         ("2026-08-25T10:00:00", "2026-08-28T10:00:00"))

    def test_rare_encounters_kept_separate(self):
        # The "might even encounter" group becomes a "(rare)" block with the
        # parent window — this is how Deino / Togetic / Beldum are surfaced.
        rares = [b for b in self.blocks if b["label"].endswith("(rare)")]
        self.assertEqual(len(rares), 2)
        deino = next(b for b in rares if "PokémonXP" in b["label"])
        self.assertEqual(deino["pokemon"], ["Deino"])

    def test_worlds_window_and_species(self):
        b = self.by_label("World Championships")
        self.assertIn("Beldum", [p for r in self.blocks
                                  if "World" in r["label"] for p in r["pokemon"]])
        self.assertEqual((b["start"], b["end"]),
                         ("2026-08-28T10:00:00", "2026-08-30T20:00:00"))

    def test_every_block_tagged_with_event_slug(self):
        for b in self.blocks:
            self.assertEqual(b["event"], "pokemon-xp-2026-worlds")

    def test_missing_section_returns_empty(self):
        self.assertEqual(F.parse_spawns("<html>no spawns here</html>", EVENT), [])


class WindowParsing(unittest.TestCase):
    def test_parse_window_infers_missing_year(self):
        text = ("<p>Tuesday, August 25, at 10:00 a.m. to "
                "Friday, August 28, 2026, at 10:00 a.m. local time.</p>")
        self.assertEqual(F.parse_window(text, 2026),
                         ("2026-08-25T10:00:00", "2026-08-28T10:00:00"))

    def test_parse_window_pm(self):
        text = "<p>August 30, 2026, at 8:00 p.m. to September 1, 2026, at 9:30 p.m.</p>"
        self.assertEqual(F.parse_window(text, 2026),
                         ("2026-08-30T20:00:00", "2026-09-01T21:30:00"))


class Merge(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 8, 27, 12, 0)

    def test_drops_expired_and_keeps_future_hand_blocks(self):
        existing = [
            {"label": "Old", "start": "2026-08-01T00:00:00", "end": "2026-08-10T00:00:00",
             "pokemon": ["Bidoof"]},                                    # expired -> dropped
            {"label": "Later hand block", "start": "2026-09-10T00:00:00",
             "end": "2026-09-15T00:00:00", "pokemon": ["Magikarp"]},    # future -> kept
        ]
        merged = F.merge(existing, {}, self.now)
        labels = [b["label"] for b in merged]
        self.assertNotIn("Old", labels)
        self.assertIn("Later hand block", labels)

    def test_parsed_event_replaces_prior_blocks_for_that_event(self):
        existing = [{"label": "Stale", "start": "2026-08-25T10:00:00",
                     "end": "2026-08-30T20:00:00", "pokemon": ["Wrong"],
                     "event": "pokemon-xp-2026-worlds"}]
        parsed = {"pokemon-xp-2026-worlds": parse()}
        merged = F.merge(existing, parsed, self.now)
        self.assertNotIn("Stale", [b["label"] for b in merged])
        self.assertTrue(all(b.get("event") == "pokemon-xp-2026-worlds"
                            or "event" not in b for b in merged))

    def test_hand_block_inside_parsed_window_is_superseded(self):
        existing = [{"label": "PokemonXP", "start": "2026-08-25T10:00:00",
                     "end": "2026-08-28T10:00:00", "pokemon": ["Ralts"]}]  # no slug
        parsed = {"pokemon-xp-2026-worlds": parse()}
        merged = F.merge(existing, parsed, self.now)
        # The un-slugged hand block sits inside the parsed window, so it is replaced.
        self.assertEqual(sum(1 for b in merged if b["label"] == "PokemonXP"), 0)


if __name__ == "__main__":
    unittest.main()
