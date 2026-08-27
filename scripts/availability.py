"""Work out what is actually obtainable right now, and until when.

Raids and eggs come from the ScrapedDuck feed (a community scrape of LeekDuck).
Wild event spawns are NOT in that feed as a species list -- it only flags that an
event has spawns -- so those live in wild_spawns.json, which is refreshed by
scripts/fetch_event_spawns.py (or by hand). See SKILL.md / CLAUDE.md.

The reduction logic here is unchanged from the seed. Two things were added so the
page can stay honest:
  * every `now` carries a machine-readable ISO `until` (not just a display string),
    so the page can hide a window whose end has passed and score "ending soon".
  * build() reports which feeds failed, so the page can say "availability unknown
    today" instead of letting an empty Live-now filter read as "nothing is live".
"""
import json, os, re, datetime, urllib.request

DUCK = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data"
HERE = os.path.dirname(os.path.abspath(__file__))
REGIONS = ["Alolan", "Galarian", "Hisuian", "Paldean"]


def get(name, failures=None):
    try:
        with urllib.request.urlopen(f"{DUCK}/{name}.json", timeout=45) as r:
            return json.load(r)
    except Exception as e:
        print(f"  warning: could not fetch {name}.json ({e})")
        if failures is not None:
            failures.append(name)
        return []


def norm(n):
    """Fold LeekDuck and PvPoke naming into one key. 'Galarian Corsola' -> 'corsola galarian'."""
    n = re.sub(r"\s*\((Shadow|Busted|Disguised)\)", "", n, flags=re.I)
    for r in REGIONS:
        if n.startswith(r + " "):
            n = f"{n[len(r) + 1:]} ({r})"
    n = re.sub(r"[^a-z0-9 ]", " ", n.lower())
    return re.sub(r"\s+", " ", n).strip()


def _dt(iso):
    try:
        return datetime.datetime.fromisoformat((iso or "").replace("Z", ""))
    except Exception:
        return None


def short_date(iso):
    """'Aug 28'. strftime('%-d') is not portable (fails on Windows), so format by hand."""
    d = _dt(iso)
    return f"{d.strftime('%b')} {d.day}" if d else None


def build(now=None):
    """Return (avail_map, status). status.ok is False if any feed failed to load."""
    now = now or datetime.datetime.now()
    iso = now.isoformat()
    failures = []
    out = {}

    def add(name, kind, label, until_iso=None, rank=0):
        k = norm(name)
        if not k:
            return
        cur = out.get(k)
        if cur is None or rank > cur["rank"]:
            out[k] = {"kind": kind, "label": label, "until": until_iso, "rank": rank}

    events = get("events", failures)

    # Raid bosses, with the end date of the rotation they belong to.
    for e in events:
        rb = (e.get("extraData") or {}).get("raidbattles")
        if not rb or not ((e.get("start") or "") <= iso <= (e.get("end") or "")):
            continue
        end_iso = e.get("end") or None
        end = short_date(end_iso)
        for b in rb.get("bosses", []):
            add(b["name"], "raid", f"Raids{' until ' + end if end else ''}", end_iso, rank=3)

    # Whatever is in the raid rotation right now, if no dated event covered it.
    for b in get("raids", failures):
        add(b["name"], "raid", f"{b.get('tier', 'Raid')}", None, rank=2)

    # Egg pools.
    for x in get("eggs", failures):
        t = x["eggType"] + (" (Adventure Sync)" if x.get("isAdventureSync") else "")
        add(x["name"], "egg", f"{t} eggs", None, rank=1)

    # Spotlight hours and community days name their featured spawn directly.
    for e in events:
        ed = e.get("extraData") or {}
        if not ((e.get("start") or "") <= iso <= (e.get("end") or "")):
            continue
        for key, word in (("spotlight", "Spotlight Hour"), ("communityday", "Community Day")):
            blk = ed.get(key) or {}
            for p in blk.get("list", []) or ([blk] if blk.get("name") else []):
                add(p["name"], "wild", word, e.get("end") or None, rank=5)

    # Event wild spawns, hand-maintained because no feed publishes them.
    path = os.path.join(HERE, "wild_spawns.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            blocks = json.load(f)
        for blk in blocks:
            if not (blk.get("start", "") <= iso <= blk.get("end", "9999")):
                continue
            end_iso = blk["end"]
            end = short_date(end_iso)
            for name in blk["pokemon"]:
                add(name, "wild", f"{blk['label']} until {end}", end_iso, rank=4)

    status = {"ok": not failures, "failed": failures}
    return out, status


def attach(rows, avail):
    """Tag each catch-list row with what is obtainable now, base form or evolution."""
    for r in rows:
        hit = avail.get(norm(r["target"]))
        via = None
        if not hit:
            for b in r["becomes"]:
                hit = avail.get(norm(b))
                if hit:
                    via = b
                    break
        if hit:
            r["now"] = {"kind": hit["kind"], "label": hit["label"],
                        "until": hit.get("until"), "via": via}
        else:
            r["now"] = None
    return rows
