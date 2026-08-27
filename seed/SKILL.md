---
name: pogo-pvp-catch-list
description: Rebuilds Toby's Pokemon GO PvP catch list from live PvPoke rankings plus current event, raid, and egg availability for Great, Ultra, and Master League, producing an offline phone-ready web page and an Excel workbook. Use this whenever he says "re-run rankings", "update the catch list", "refresh the PvPoke list", "what's worth catching right now", "the meta changed", or asks which Pokemon to target, which base forms to hunt, what is currently in raids or eggs, or how the GBL rankings have shifted since last time. Also use it when he asks what changed after a game update, a move rebalance, a new event, or a new season.
---

# Pokemon GO PvP catch list

Turns PvPoke's ranking data into a field tool: given a Pokemon he sees in the wild,
should he catch it, and for which league.

## Run it

**Step 1 — refresh the event spawn list.** Do this first, every run. See
"Current availability" below for why it can't be automated. Web search for the
currently live Pokemon GO events, read the event pages, and rewrite
`scripts/wild_spawns.json` with the featured wild spawns and their windows:

```json
[{"label": "Event name", "start": "2026-08-25T10:00:00",
  "end": "2026-08-28T10:00:00", "pokemon": ["Ralts", "Spheal"]}]
```

Use local-time ISO strings with no timezone suffix. Drop blocks whose `end` has
passed. If a search turns up nothing usable, leave the file as an empty list `[]`
rather than guessing, and say so in the reply.

**Step 2 — build.**

```bash
cd scripts && python3 build.py /mnt/user-data/outputs
```

Takes about 30 seconds. Writes `catch-list.html` and `catch-list.xlsx`. Present both
with `present_files`, HTML first.

**Step 3 — say what's live.** The build prints per-league counts and the gamemaster
date. Report that date, then call out the Core and Flex targets that are obtainable
right now and when each window closes. That is the part he acts on today; the rest of
the list keeps.

## What it does

For each league it pulls the top 75 from Overall, Lead, Switch, and Closer, then
collapses everything to **one row per catchable base form**, because candy is shared
across a family and across Shadow status. Shadow and non-Shadow forms are ranked
separately by PvPoke but are the same catch target, so each row shows the best rank
any form in the family reaches.

Rows are tiered:

- **Core** — top 25 in at least one category. The list worth actively hunting.
- **Flex** — top 75 in two or more categories, no top-25 finish.
- **Deep** — top 75 in exactly one category. Hidden by default in the web page.

Rows are also split by **source**: `wild` (catchable while walking) versus `raid`
(legendaries, egg-only babies, fossils, Mystery Box, Special Research). Master League
is mostly raid; that is expected, not a bug.

`Availability` is the field he cares about most after the tier:

- `Normal only` — the wild catch is the meta piece.
- `Both` — the wild catch is playable and the Shadow is also ranked.
- `Shadow only` — the wild catch is **candy farming only**. The usable Pokemon has to
  come from a Rocket battle.

## Current availability

Every row carries a `now` field: what makes it obtainable today, with an end date where
one is published. The web page shows it as a pill at the top of the card and a **Live
now** filter chip.

Three sources, in descending reliability:

- **Raids and eggs** — automatic, from the ScrapedDuck feed
  (`raw.githubusercontent.com/bigfoott/ScrapedDuck/data/`), a community scrape of
  LeekDuck. Raid rotations carry real end dates; egg pools do not.
- **Spotlight Hours and Community Days** — automatic, same feed, which names the
  featured species directly.
- **Event wild spawns** — hand-maintained in `scripts/wild_spawns.json`, refreshed by
  Claude each run. The feed flags that an event has spawns but never lists the species,
  and the sandbox can't reach leekduck.com, so this step needs web search.

**Lures are a hint, not a guarantee.** A lure boosts its types out of whatever already
spawns in your area; it does not summon something that never appears there. Say it that
way — "Glacial Lure boosts it" — never "use a Glacial Lure to get one".

**What no source covers:** the ordinary background spawn pool. Niantic does not publish
seasonal or biome spawn tables, and this season's page explicitly declines to list them.
So a blank `now` means "not currently featured", never "won't appear". Don't let the
page or the reply imply otherwise.

## Files

- `scripts/pvpoke_data.py` — fetches and reduces the rankings. All thresholds live at
  the top: `TOP_N` (75), `CORE_N` (25), plus the egg-only, fossil, and special-source sets.
- `scripts/lures.py` — Lure Module effects. Attraction is derived from typing
  (Glacial = Water/Ice, Mossy = Bug/Grass/Poison, Magnetic = Electric/Steel/Rock,
  Rainy = Water/Bug/Electric), so it needs no fetching. `LURE_EVOLUTIONS` is a
  hand-maintained list of the evolutions that require a lure — game rules, not data,
  so add to it when a new one ships.
- `scripts/availability.py` — the `now` layer. `norm()` folds LeekDuck's "Galarian
  Corsola" and PvPoke's "Corsola (Galarian)" into one key; extend `REGIONS` if a new
  regional prefix appears.
- `scripts/wild_spawns.json` — the hand-maintained event spawn windows.
- `scripts/build.py` — writes the two output files.
- `scripts/template.html` — the page. `__DATA__` is replaced with the JSON blob.

## Design constraints that matter

The web page is used **outdoors, on a phone, with kids, often with no signal**. Keep it:

- **A single self-contained file.** No CDN, no fonts, no network calls. System font
  stack only. If a change would add an external request, don't make it.
- **Answer-first.** The verdict word and the name must be readable without tapping.
  Ranks are secondary and stay collapsed until the card is tapped.
- **Searchable from any stage.** Every row carries `aliases`: the whole evolution tree
  from the gamemaster, including middle stages that no league ranks. A kid typing
  "Prinplup" or "Corvisquire" has to land on Piplup and Rookidee. Never trim aliases
  down to the ranked forms.

## When a feed changes

The rankings come from `raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/`.
If a fetch 404s or a league comes back with far fewer rows than the counts below,
**say so plainly and stop** rather than shipping a stale or partial list. Check whether
PvPoke reorganised `src/data/rankings/` and adjust the paths in `pvpoke_data.py`.

The availability feeds fail soft on purpose: `availability.py` prints a warning and
carries on, so a ScrapedDuck outage costs the `now` column but still produces a correct
ranking list. If you see that warning, tell him the availability data is missing this
run instead of letting an empty **Live now** filter read as "nothing is available".

Rough expected sizes, as of the August 2026 build: Great ~122 targets, Ultra ~104,
Master ~72. A league dropping below about 50 means something broke upstream.

## Conventions he has already settled

Do not re-litigate these unless he asks:

- Shadow-only families stay in the list. He farms candy ahead of Rocket battles.
- XL requirement is flagged, never used to filter rows out.
- Ultra and Master each show wild and raid targets, split into sections.
- Both the web page and the workbook get rebuilt every run.
- Lure attraction is derived from typing rather than curated per-Pokemon lists.
