# CLAUDE.md — durable rules for this repo

A Pokémon GO PvP catch list: given a Pokémon seen in the wild, should you catch it,
and for which league. Static site + a Python pipeline that bakes all data at build
time. These rules are settled — follow them, don't re-litigate them.

## Ranking data
- **PvPoke is the only ranking source.** Fetched from
  `raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/`. Do not substitute
  another ranking source or hand-adjust ranks.
- Each league pulls the **top 75** from **Overall, Lead, Switch, and Closer**.
- Forms collapse into **one row per catch family** (candy is shared across a family
  and across Shadow status), and the row keeps the **best rank any form reaches**.
- Tiers: **core** = top 25 in ≥1 category; **flex** = top 75 in ≥2 categories;
  **niche/Deep** = top 75 in exactly one.
- `aliases` include **every evolution stage** from the gamemaster, so an unranked
  middle form (Prinplup, Corvisquire) is searchable. **Never trim aliases to ranked
  forms only.**
- The default list shows only the good targets (core/flex/niche). `data.json` also
  carries a **`families` index** of every catch family — ranked or not — so a search
  resolves anything and the weak ones get a **"don't catch"** answer. It is
  **search-only** (never shown by default) and **cross-league aware**: a family that's
  weak here but strong elsewhere reads "Catch elsewhere — core in Master". The verdict
  is honest — a real PvPoke rank where one exists ("Switch #230 at best"), or "not in
  PvPoke's rankings" where the line is unranked. **Never invent a rank to fill the gap.**

## Availability (`now`)
- Availability always needs a **source and, where published, dates**. Three feeds,
  descending reliability: raids/eggs and Spotlight/Community Day from ScrapedDuck
  (`raw.githubusercontent.com/bigfoott/ScrapedDuck/data/`), and event wild spawns
  from `scripts/wild_spawns.json`.
- **No invented spawn percentages.** Say "boosted spawn", never "common" or a made-up
  rate. A blank `now` means "not currently featured", never "won't appear".
- A window whose `end` has passed must **not render as active** (the page checks this
  at view time, not just at build).

## Lures
- Lure attraction is **derived from typing**, not curated per-Pokémon:
  Glacial = Water/Ice, Mossy = Bug/Grass/Poison, Magnetic = Electric/Steel/Rock,
  Rainy = Water/Bug/Electric.
- A lure **boosts types out of the local pool; it never guarantees a spawn.** Phrase
  it "Glacial Lure boosts it", never "use a Glacial Lure to get one".
- `LURE_EVOLUTIONS` in `scripts/lures.py` is game rules, not data — extend by hand.

## Leagues / Shadow / XL
- **Master League wants high IVs and XL candy**, not low-attack PvP IVs. XL is flagged,
  never used to filter a row out.
- Shadow-only families stay in the list (candy farming ahead of Rocket battles).
- Ultra and Master each split into wild and raid sections. Master being mostly raid is
  expected, not a bug.

## The page
- **Bake everything at build time.** A kid opening the page must trigger **no
  third-party fetch** — only the relative `data.json` load. No frameworks, CSS
  libraries, webfonts, database, login, or runtime API.
- System font stack only, high contrast for outdoor use, answer-first: name, verdict,
  a one-line **action note** (catch / check IVs / hunt a hundo + XL / store candy), and
  **all four role ranks** (Overall · Lead · Switch · Closer) are readable without
  tapping. Overall alone can mislead, so it never drives the order or the verdict; a tap
  only reveals extra prose.
- An **IV & type guide** (one tap from the header) carries the IV reminder and an
  interactive type-matchup lookup. Type data is the standard chart, baked in — no fetch.
- **Focus today** also carries an "Always worth catching" group of top wild cores
  (Mimikyu, Rookidee…) so the morning view answers "what today?" even with no events.
- Keep the list **alphabetical within tier** and the UI simple enough for kids.
- "Last updated" shows the **data date** (gamemaster), never the build date.

## Fail loud, not silent
- If PvPoke 404s or a league returns far fewer rows than expected
  (Great ~122, Ultra ~104, Master ~72; **< 50 means something broke**), the build
  raises and leaves the previous `data.json` in place. A stale correct list beats a
  fresh broken one.
- Availability feeds fail **soft** and record the failure in the data so the page can
  say availability is missing today rather than showing an empty "Live now".

## When something changes
- Stop and flag it (don't guess) if live PvPoke or ScrapedDuck data contradicts what
  the pipeline expects — then the right answer isn't obvious.
- If PvPoke reorganises `src/data/rankings/`, fix the paths in `scripts/pvpoke_data.py`.
