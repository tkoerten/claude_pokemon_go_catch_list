"""Lure Module effects.

Lures boost spawns by TYPE, so attraction is derived from the gamemaster rather than
scraped. It boosts those types out of your local spawn pool -- it does not summon a
Pokemon that never appears in your area.

Lure evolutions are a fixed, hand-maintained list: they are game rules, not data.
"""

LURE_TYPES = {
    "Glacial":  {"water", "ice"},
    "Mossy":    {"bug", "grass", "poison"},
    "Magnetic": {"electric", "steel", "rock"},
    "Rainy":    {"water", "bug", "electric"},
}

# speciesId of the pre-evolution -> (lure needed, resulting Pokemon)
LURE_EVOLUTIONS = {
    "eevee":      [("Mossy", "Leafeon"), ("Glacial", "Glaceon")],
    "magneton":   [("Magnetic", "Magnezone")],
    "nosepass":   [("Magnetic", "Probopass")],
    "charjabug":  [("Magnetic", "Vikavolt")],
    "grubbin":    [("Magnetic", "Vikavolt")],
    "sliggoo":    [("Rainy", "Goodra")],
    "goomy":      [("Rainy", "Goodra")],
    "crabrawler": [("Glacial", "Crabominable")],
}

# Golden Lures are their own thing: they make a Golden PokeStop, which is how you
# farm the 999 Gimmighoul Coins that Gholdengo needs.
GOLDEN = {"gimmighoul": "Golden Lure - coins for Gholdengo"}


def attracts(types):
    """Which lures boost a Pokemon with these types."""
    t = {x.lower() for x in types or []}
    return [name for name, want in LURE_TYPES.items() if t & want]


def for_species(species_id, types, family_ids=()):
    """Return (attracting lures, lure-evolution notes) for one catch target."""
    lures = attracts(types)
    evo = []
    for sid in (species_id,) + tuple(family_ids):
        for lure, result in LURE_EVOLUTIONS.get(sid, []):
            note = f"{lure} Lure to evolve {result}"
            if note not in evo:
                evo.append(note)
    if species_id in GOLDEN:
        evo.append(GOLDEN[species_id])
    return lures, evo
