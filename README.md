# Pokémon GO PvP Catch List

A field tool for Pokémon GO PvP. You see a Pokémon in the wild — should you catch it,
and for which league? Search any evolution stage and get an answer without tapping.

**Live site:** https://tkoerten.github.io/claude_pokemon_go_catch_list/

- Works offline (installable to a phone home screen; the shell is cached).
- No account, no tracking, no third-party requests when you open it — every ranking and
  availability fact is baked into `data.json` at build time.
- Rebuilt automatically every night from live PvPoke rankings plus current raids, eggs,
  and event spawns.

## What it shows

For **Great**, **Ultra**, and **Master** league:

- **Core / Flex / Deep** tiers from PvPoke's top-75 across Overall / Lead / Switch /
  Closer. One row per catch family, keeping the best rank any form (Shadow included)
  reaches, since a family shares a candy pool.
- **Focus today** at the top: at most six things worth your time right now, derived from
  the data — split into *Ending soon* (a window closing within 48 hours) and
  *Worth your time*.
- **Live now**: what's obtainable today from raids, eggs, and event spawns, with end
  dates where they're published.
- **Lure** hints (by type) and lure-evolution notes, XL and Shadow-only flags.

If the data is more than three days old the header says so — the nightly job may have
stalled, but the list is still usable.

## How the data is built

`scripts/` is a small Python pipeline (standard library only, except `openpyxl` for the
optional workbook):

| File | Job |
| --- | --- |
| `pvpoke_data.py` | Fetch PvPoke rankings, collapse forms into catch families, tier them, emit aliases for every evolution stage. |
| `availability.py` | The `now` layer: raids/eggs/Spotlight/Community Day from the ScrapedDuck feed, plus event wild spawns from `wild_spawns.json`. Fails soft and reports it. |
| `lures.py` | Lure effects derived from typing, plus hand-kept lure-evolution rules. |
| `fetch_event_spawns.py` | Refreshes `wild_spawns.json` by parsing live LeekDuck event pages. |
| `build.py` | Writes `data.json` (and, with a path argument, `catch-list.xlsx`). |

The site itself is static: `index.html` (shell), `styles.css`, `logic.js` (all the
decisions, unit-tested), `app.js` (rendering), `sw.js` (service worker), `manifest.json`.
`data.json` is fetched at load with a relative path.

## Refresh it manually

```bash
pip install openpyxl
python scripts/fetch_event_spawns.py    # refresh event wild spawns (optional)
python scripts/build.py                 # regenerate data.json at the repo root
```

`python scripts/build.py some/dir` also writes `catch-list.xlsx` into `some/dir`.

Preview locally (a plain static server is enough):

```bash
python -m http.server 8099
```

then open http://localhost:8099 .

## Editing event spawns by hand

`scripts/fetch_event_spawns.py` tries to keep `scripts/wild_spawns.json` current
automatically, but **hand-editing it is always the fallback** — if a LeekDuck layout
change breaks the parser, edit the file directly. Each block:

```json
{
  "label": "Event name",
  "start": "2026-08-25T10:00:00",
  "end":   "2026-08-28T10:00:00",
  "pokemon": ["Ralts", "Spheal"]
}
```

- Local-time ISO strings, no timezone suffix.
- Blocks whose `end` has passed are ignored (and pruned on the next automated run).
- Add an `"event": "<leekduck-slug>"` field if you want an automated refresh of that
  event to replace your block; without it, a hand block is kept until it expires (or is
  superseded by a parsed event covering the same window).
- If you have nothing reliable, leave `[]` rather than guessing.

## Nightly refresh & deploy

`.github/workflows/deploy.yml` runs at **09:00 UTC** daily (and on demand via
**Actions → Build and deploy → Run workflow**). It runs the tests, refreshes the event
spawns, rebuilds `data.json`, commits only if the content changed, and deploys to Pages.

It **fails loudly**: if PvPoke 404s or a league returns fewer than ~50 rows, the build
aborts and the previous `data.json` stays live — a stale correct list beats a fresh
broken one.

A push to `main` also deploys, using the committed `data.json`.

> GitHub disables scheduled workflows after ~60 days of repository inactivity. If the
> nightly job goes quiet, the page's "rankings are N days old" notice will show it; run
> the workflow manually (or push any commit) to wake it back up.

## Tests

```bash
python -m unittest discover -s tests -p "test_*.py"   # data shape, availability, spawn parser
node --test tests/logic.test.js                       # focus / search / staleness logic
```

The spawn parser is tested against a saved LeekDuck fixture, so a markup change on their
end fails a test rather than silently emptying the spawn list.

## Credit

Rankings from [PvPoke](https://pvpoke.com/). Event, raid, and egg data from the
[ScrapedDuck](https://github.com/bigfoott/ScrapedDuck) scrape of
[LeekDuck](https://leekduck.com/). This project is not affiliated with any of them,
Niantic, or The Pokémon Company.
