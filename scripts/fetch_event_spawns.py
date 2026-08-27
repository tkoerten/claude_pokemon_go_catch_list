"""Refresh wild_spawns.json from the live LeekDuck event pages.

The ScrapedDuck feed flags that an event has wild spawns but never lists the
species, so availability.py can't get them from the feed. This script closes that
gap for the nightly job: it reads the live events, follows each event's `link` to
its LeekDuck page, and parses the Spawns section into the same block shape that
wild_spawns.json has always used by hand:

    {"label": "...", "start": ISO, "end": ISO, "pokemon": [...], "event": slug}

Design rules (see CLAUDE.md):
  * If a page fails to load or yields no species for an event, KEEP whatever
    wild_spawns.json already had for it. Never overwrite good data with nothing.
  * Blocks whose `end` has passed are dropped.
  * Hand-editing wild_spawns.json keeps working: hand blocks (no `event` slug) are
    preserved unless a freshly parsed event's window supersedes them.
  * Only stdlib is used, so the Actions runner needs nothing extra.

Run standalone to refresh the file:   python fetch_event_spawns.py
Preview without writing:              python fetch_event_spawns.py --dry-run
"""
import datetime
import html as _html
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FEED = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json"
UA = "Mozilla/5.0 (compatible; catch-list-bot/1.0; +https://github.com/tkoerten/claude_pokemon_go_catch_list)"

# Event types whose pages never carry a curated multi-species wild list, or whose
# spawns the feed already exposes directly (spotlight / community day).
SKIP_TYPES = {
    "pokemon-spotlight-hour", "go-battle-league", "raid-battles", "raid-hour",
    "raid-day", "season", "go-pass", "research-breakthrough", "pokemon-go-tour",
}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# ---- HTML helpers ----------------------------------------------------------
def clean_text(s):
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def slug_from(link):
    m = re.search(r"/events/([^/]+)/?", link or "")
    return m.group(1) if m else (link or "")


def extract_names(chunk):
    names, seen = [], set()
    for raw in re.findall(r'pkmn-name">(.*?)</div>', chunk, re.S):
        n = clean_text(raw)
        if n and n.lower() not in seen:
            seen.add(n.lower())
            names.append(n)
    return names


def is_rare(title):
    t = (title or "").lower()
    return ("might even encounter" in t or "if you" in t and "lucky" in t
            or "lucky" in t or "rare" in t)


def parse_window(text, fallback_year):
    """Pull a start/end datetime from a prose date paragraph, or None."""
    t = clean_text(text)
    pat = re.compile(
        r"([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?,?\s+at\s+"
        r"(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.|am|pm)", re.I)
    ms = list(pat.finditer(t))
    if len(ms) < 2:
        return None
    y_end = _year(ms[1]) or _year(ms[0]) or fallback_year
    y_start = _year(ms[0]) or y_end
    try:
        return _iso(ms[0], y_start), _iso(ms[1], y_end)
    except (KeyError, ValueError):
        return None


def _year(mo):
    return int(mo.group(3)) if mo.group(3) else None


def _iso(mo, year):
    mon = MONTHS[mo.group(1).lower()[:3]]
    day = int(mo.group(2))
    hh = int(mo.group(4)) % 12
    if mo.group(6).lower().startswith("p"):
        hh += 12
    mm = int(mo.group(5))
    return f"{year:04d}-{mon:02d}-{day:02d}T{hh:02d}:{mm:02d}:00"


def _block(label, start, end, names, slug):
    return {"label": label, "start": start, "end": end, "pokemon": names, "event": slug}


# ---- parser ----------------------------------------------------------------
def parse_spawns(page_html, event):
    """Parse one LeekDuck event page into wild-spawn blocks. Pure; testable."""
    ev_name = clean_text(event.get("name"))
    es, ee = event.get("start"), event.get("end")
    slug = slug_from(event.get("link"))
    fyear = int((es or "0000")[:4]) or datetime.date.today().year

    m = re.search(r'id="spawns"', page_html)
    if not m:
        return []
    close = page_html.find("</h2>", m.start())
    seg_start = close + 5 if close != -1 else m.end()
    tail = page_html[seg_start:]
    nxt = re.search(r'class="event-section-header', tail)
    seg = tail[:nxt.start()] if nxt else tail

    h3s = list(re.finditer(r"<h3[^>]*>(.*?)</h3>", seg, re.S))
    blocks = []
    if not h3s:
        names = extract_names(seg)
        return [_block(ev_name, es, ee, names, slug)] if names else []

    last_named = None
    for i, h in enumerate(h3s):
        title = clean_text(h.group(1))
        end_pos = h3s[i + 1].start() if i + 1 < len(h3s) else len(seg)
        chunk = seg[h.end():end_pos]
        names = extract_names(chunk)
        if not names:
            continue
        if is_rare(title):
            base = last_named or {"label": ev_name, "start": es, "end": ee}
            blocks.append(_block(base["label"] + " (rare)", base["start"],
                                 base["end"], names, slug))
        else:
            win = parse_window(chunk, fyear) or (es, ee)
            b = _block(title or ev_name, win[0], win[1], names, slug)
            last_named = b
            blocks.append(b)
    return blocks


# ---- merge -----------------------------------------------------------------
def _dt(iso):
    try:
        return datetime.datetime.fromisoformat((iso or "").replace("Z", ""))
    except (ValueError, AttributeError):
        return None


def merge(existing, parsed_by_slug, now):
    """Combine hand/previous blocks with freshly parsed ones.

    Drop past blocks; a successfully parsed event replaces its own prior blocks and
    any hand block wholly inside its window; everything else is kept.
    """
    parsed_windows = []
    for slug, blocks in parsed_by_slug.items():
        for b in blocks:
            s, e = _dt(b["start"]), _dt(b["end"])
            if s and e:
                parsed_windows.append((slug, s, e))

    kept = []
    for b in existing:
        e = _dt(b.get("end"))
        if e and e < now:
            continue                                  # expired
        if b.get("event") in parsed_by_slug:
            continue                                  # replaced by fresh parse
        bs, be = _dt(b.get("start")), _dt(b.get("end"))
        superseded = any(
            b.get("event") != slug and bs and be and bs >= ws and be <= we
            for slug, ws, we in parsed_windows)
        if superseded:
            continue
        kept.append(b)

    fresh = [b for blocks in parsed_by_slug.values() for b in blocks
             if not (_dt(b["end"]) and _dt(b["end"]) < now)]
    return kept + fresh


# ---- driver ----------------------------------------------------------------
def _get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def fetch_parsed(now=None, fetch=_get, feed_url=FEED):
    """Return {slug: [blocks]} for every live event we could parse a spawn list from."""
    now = now or datetime.datetime.now()
    iso = now.isoformat()
    try:
        events = json.loads(fetch(feed_url))
    except Exception as e:
        print(f"  warning: could not read events feed ({e}); keeping wild_spawns.json")
        return {}

    parsed = {}
    for e in events:
        if e.get("eventType") in SKIP_TYPES:
            continue
        if not ((e.get("start") or "") <= iso <= (e.get("end") or "")):
            continue
        link = e.get("link")
        if not link:
            continue
        try:
            page = fetch(link)
        except Exception as ex:
            print(f"  warning: could not fetch {link} ({ex}); keeping existing")
            continue
        blocks = parse_spawns(page, e)
        if blocks:
            parsed[slug_from(link)] = blocks
            print(f"  parsed {slug_from(link)}: "
                  f"{sum(len(b['pokemon']) for b in blocks)} species in {len(blocks)} block(s)")
    return parsed


def main(argv):
    dry = "--dry-run" in argv
    path = os.path.join(HERE, "wild_spawns.json")
    existing = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
    now = datetime.datetime.now()
    parsed = fetch_parsed(now)
    if not parsed:
        print("no events parsed; wild_spawns.json left unchanged")
        return 0
    merged = merge(existing, parsed, now)
    if dry:
        print(json.dumps(merged, indent=2, ensure_ascii=False))
        return 0
    with open(path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(merged)} block(s) to wild_spawns.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
