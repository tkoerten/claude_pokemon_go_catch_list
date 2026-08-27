"""Work out what is actually obtainable right now, and until when.

Raids and eggs come from the ScrapedDuck feed (a community scrape of LeekDuck).
Wild event spawns are NOT in that feed as a species list -- it only flags that an
event has spawns -- so those live in wild_spawns.json, which Claude refreshes by
reading the live event pages. See SKILL.md.
"""
import json, os, re, datetime, urllib.request

DUCK = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data"
HERE = os.path.dirname(os.path.abspath(__file__))
REGIONS = ["Alolan", "Galarian", "Hisuian", "Paldean"]


def get(name):
    try:
        with urllib.request.urlopen(f"{DUCK}/{name}.json", timeout=45) as r:
            return json.load(r)
    except Exception as e:
        print(f"  warning: could not fetch {name}.json ({e})")
        return []


def norm(n):
    """Fold LeekDuck and PvPoke naming into one key. 'Galarian Corsola' -> 'corsola galarian'."""
    n = re.sub(r"\s*\((Shadow|Busted|Disguised)\)", "", n, flags=re.I)
    for r in REGIONS:
        if n.startswith(r + " "):
            n = f"{n[len(r) + 1:]} ({r})"
    n = re.sub(r"[^a-z0-9 ]", " ", n.lower())
    return re.sub(r"\s+", " ", n).strip()


def short_date(iso):
    try:
        return datetime.datetime.fromisoformat(iso.replace("Z", "")).strftime("%b %-d")
    except Exception:
        return None


def build(now=None):
    now = now or datetime.datetime.now()
    iso = now.isoformat()
    out = {}

    def add(name, kind, label, until=None, rank=0):
        k = norm(name)
        if not k:
            return
        cur = out.get(k)
        if cur is None or rank > cur["rank"]:
            out[k] = {"kind": kind, "label": label, "until": until, "rank": rank}

    events = get("events")

    # Raid bosses, with the end date of the rotation they belong to.
    for e in events:
        rb = (e.get("extraData") or {}).get("raidbattles")
        if not rb or not ((e.get("start") or "") <= iso <= (e.get("end") or "")):
            continue
        end = short_date(e.get("end") or "")
        for b in rb.get("bosses", []):
            add(b["name"], "raid", f"Raids{' until ' + end if end else ''}", end, rank=3)

    # Whatever is in the raid rotation right now, if no dated event covered it.
    for b in get("raids"):
        add(b["name"], "raid", f"{b.get('tier', 'Raid')}", None, rank=2)

    # Egg pools.
    for x in get("eggs"):
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
                add(p["name"], "wild", word, short_date(e.get("end") or ""), rank=5)

    # Event wild spawns, hand-maintained because no feed publishes them.
    path = os.path.join(HERE, "wild_spawns.json")
    if os.path.exists(path):
        for blk in json.load(open(path)):
            if not (blk.get("start", "") <= iso <= blk.get("end", "9999")):
                continue
            end = short_date(blk["end"])
            for name in blk["pokemon"]:
                add(name, "wild", f"{blk['label']} until {end}", end, rank=4)

    return out


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
            r["now"] = {"kind": hit["kind"], "label": hit["label"], "via": via}
        else:
            r["now"] = None
    return rows
