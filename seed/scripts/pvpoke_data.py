"""Fetch PvPoke ranking data and reduce it to family-level catch targets."""
import json, math, os, sys, urllib.request, datetime
import lures

RAW = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data"
LEAGUES = [("great", "Great League", 1500), ("ultra", "Ultra League", 2500), ("master", "Master League", 10000)]
CATS = ["overall", "leads", "switches", "closers"]
CAT_LABEL = {"overall": "Overall", "leads": "Lead", "switches": "Switch", "closers": "Closer"}
CPM40 = 0.7903
TOP_N = 75
CORE_N = 25

EGG_ONLY = {"azurill","cleffa","igglybuff","elekid","magby","smoochum","pichu","tyrogue","mantyke",
            "budew","chingling","bonsly","mime_jr","happiny","munchlax","riolu","wynaut","toxel"}
FOSSIL = {"omanyte","kabuto","aerodactyl","lileep","anorith","cranidos","shieldon","tirtouga",
          "archen","tyrunt","amaura","dracozolt","arctozolt","dracovish","arctovish"}
SPECIAL = {"meltan": "Mystery Box", "cosmog": "Special Research"}

# Legendaries and mythicals do NOT all come from raids. Anything listed here overrides
# the default "Raid" label; mythicals fall back to research/ticketed below.
SOURCE_OVERRIDE = {
    "articuno_galarian": "Daily Adventure Incense", "zapdos_galarian": "Daily Adventure Incense",
    "moltres_galarian": "Daily Adventure Incense",
    "zygarde": "Routes (Zygarde Cells)", "zygarde_complete": "Routes (Zygarde Cells)",
    "zygarde_10": "Routes (Zygarde Cells)", "zygarde_50": "Routes (Zygarde Cells)",
    "kubfu": "Special Research", "cosmog": "Special Research",
}
# Baby forms hatch from eggs; note the lowest form you can actually meet in the wild.
WILD_FORM = {"azurill": "Marill", "cleffa": "Clefairy", "igglybuff": "Jigglypuff",
             "elekid": "Electabuzz", "magby": "Magmar", "smoochum": "Jynx",
             "mantyke": "Mantine", "budew": "Roselia", "chingling": "Chimecho",
             "bonsly": "Sudowoodo", "mime_jr": "Mr. Mime", "happiny": "Chansey",
             "munchlax": "Snorlax", "riolu": "Lucario", "toxel": "Toxtricity"}


def strip_shadow(s):
    return s[:-7] if s.endswith("_shadow") else s


def fetch(path):
    with urllib.request.urlopen(RAW + path, timeout=60) as r:
        return json.load(r)


def load():
    gm = fetch("/gamemaster.json")
    data = {}
    for key, _, cp in LEAGUES:
        data[key] = {c: fetch(f"/rankings/all/{c}/rankings-{cp}.json") for c in CATS}
    return gm, data


def family_index(gm):
    byid = {p["speciesId"]: p for p in gm["pokemon"]}
    rev = {}
    for p in gm["pokemon"]:
        for e in (p.get("family") or {}).get("evolutions") or []:
            rev.setdefault(e, p["speciesId"])

    def parent(s):
        return ((byid.get(s) or {}).get("family") or {}).get("parent") or rev.get(s)

    def base(s):
        cur, seen = s, set()
        while True:
            p = parent(cur)
            if not p or p in seen or p not in byid:
                return cur
            seen.add(p)
            cur = p
    return byid, base


def family_names(byid, base_id):
    """Every stage in the evolution tree, so search matches an unranked middle form."""
    names, seen, stack = [], set(), [base_id]
    while stack:
        cur = stack.pop()
        if cur in seen or cur not in byid:
            continue
        seen.add(cur)
        nm = byid[cur].get("speciesName")
        if nm and nm not in names:
            names.append(nm)
        stack += (byid[cur].get("family") or {}).get("evolutions") or []
    return names


def max_cp_l40(byid, species_id):
    bs = (byid.get(strip_shadow(species_id)) or {}).get("baseStats")
    if not bs:
        return None
    a, d, h = bs["atk"] + 15, bs["def"] + 15, bs["hp"] + 15
    return int(a * CPM40 * math.sqrt(d * CPM40) * math.sqrt(h * CPM40) / 10)


def build_league(gm, rankings, cp_cap):
    byid, base = family_index(gm)
    ranks, names = {}, {}
    for c in CATS:
        ranks[c] = {e["speciesId"]: i + 1 for i, e in enumerate(rankings[c])}
        for e in rankings[c]:
            names.setdefault(e["speciesId"], e["speciesName"])

    union = set()
    for c in CATS:
        union |= {s for s, r in ranks[c].items() if r <= TOP_N}

    groups = {}
    for s in union:
        b = strip_shadow(base(s))
        g = groups.setdefault(b, {"shadow": [], "normal": []})
        g["shadow" if s.endswith("_shadow") else "normal"].append(s)

    rows = []
    for b, g in groups.items():
        bp = byid.get(b) or {}
        tags = set(bp.get("tags", []))
        forms = g["normal"] + g["shadow"]
        R = {c: min(ranks[c].get(s, 9999) for s in forms) for c in CATS}
        if min(R.values()) > TOP_N:
            continue

        if b in SOURCE_OVERRIDE:
            section, source = "raid", SOURCE_OVERRIDE[b]
        elif b in SPECIAL:
            section, source = "raid", SPECIAL[b]
        elif "mythical" in tags:
            section, source = "raid", "Special Research"
        elif tags & {"legendary", "ultrabeast"}:
            section, source = "raid", "Raid"
        elif b in EGG_ONLY:
            wf = WILD_FORM.get(b)
            section = "raid"
            source = f"Eggs only ({wf} in wild)" if wf else "Eggs only"
        elif b in FOSSIL:
            section, source = "raid", "Eggs / raids"
        else:
            section, source = "wild", "Wild"

        if not g["normal"]:
            avail = "Shadow only"
        elif not g["shadow"]:
            avail = "Normal only"
        else:
            avail = "Both"

        best_form = min(forms, key=lambda s: ranks["overall"].get(s, 9999))
        if cp_cap >= 10000:
            xl = True
        else:
            mc = max_cp_l40(byid, best_form)
            xl = bool(mc and mc < cp_cap)

        top25 = [CAT_LABEL[c] for c in CATS if R[c] <= CORE_N]
        n75 = sum(1 for c in CATS if R[c] <= TOP_N)
        tier = "core" if top25 else ("flex" if n75 >= 2 else "niche")
        best_role = min([(R["leads"], "Lead"), (R["switches"], "Switch"), (R["closers"], "Closer")])

        # Lure info only helps for something you meet in the wild.
        fam_ids = tuple(sorted({strip_shadow(x) for x in forms}))
        lure_hits, lure_evo = lures.for_species(b, bp.get("types", []), fam_ids)
        if section != "wild":
            lure_hits = []

        rows.append({
            "target": bp.get("speciesName", b),
            "becomes": sorted({names[s] for s in forms}),
            "section": section, "source": source, "avail": avail, "tier": tier,
            "overall": R["overall"] if R["overall"] < 9999 else None,
            "lead": R["leads"], "switch": R["switches"], "closer": R["closers"],
            "bestRole": f"{best_role[1]} #{best_role[0]}",
            "top25": top25, "roles75": n75, "xl": xl,
            "lures": lure_hits, "lureEvo": lure_evo,
            "aliases": family_names(byid, b),
        })

    order = {"core": 0, "flex": 1, "niche": 2}
    rows.sort(key=lambda r: (order[r["tier"]], r["overall"] if r["overall"] else 9999))
    return rows


def build_all():
    gm, data = load()
    out = {"generated": datetime.date.today().isoformat(),
           "gamemaster": gm.get("timestamp", "unknown"), "leagues": {}}
    for key, label, cp in LEAGUES:
        out["leagues"][key] = {"label": label, "cpCap": cp, "rows": build_league(gm, data[key], cp)}
    return out


if __name__ == "__main__":
    d = build_all()
    print(json.dumps({k: {"total": len(v["rows"]),
                          "core": sum(1 for r in v["rows"] if r["tier"] == "core"),
                          "flex": sum(1 for r in v["rows"] if r["tier"] == "flex"),
                          "wild": sum(1 for r in v["rows"] if r["section"] == "wild"),
                          "raid": sum(1 for r in v["rows"] if r["section"] == "raid")}
                      for k, v in d["leagues"].items()}, indent=1))
    json.dump(d, open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pvp.json", "w"))
