/* Pure, DOM-free logic shared by the page (app.js) and the Node tests.
 * Everything here is a plain function of (data, now) so it can be unit-tested
 * without a browser. app.js does the rendering; this file makes the decisions. */
(function (root) {
  "use strict";

  var LEAGUE_CODE = { great: "GL", ultra: "UL", master: "ML" };
  var TIER_POINTS = { core: 3, flex: 2, niche: 0 };
  var DAY = 86400000;
  var SOON_MS = 48 * 3600 * 1000;

  // ISO strings in the data are local wall-clock with no zone (e.g. event windows)
  // or the gamemaster's "YYYY-MM-DD HH:MM:SS". Parse both leniently.
  function parseISO(s) {
    if (!s) return null;
    var d = new Date(String(s).replace(" ", "T").replace("Z", ""));
    return isNaN(d.getTime()) ? null : d;
  }

  // A window is only live if it has no end, or its end is still in the future.
  // A past `end` must never render as active.
  function isLive(row, now) {
    if (!row || !row.now) return false;
    var until = parseISO(row.now.until);
    if (!until) return true;
    return until.getTime() >= now.getTime();
  }

  function matchRow(row, q) {
    if (!q) return true;
    q = q.toLowerCase();
    var hay = [row.target]
      .concat(row.becomes || [])
      .concat(row.lures || [])
      .concat(row.aliases || []);
    for (var i = 0; i < hay.length; i++) {
      if (String(hay[i]).toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }

  function months(m) {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
  }

  function fmtDate(d) {
    return d ? months(d.getMonth()) + " " + d.getDate() : "";
  }

  function fmtDateTime(d) {
    if (!d) return "";
    var h = d.getHours(), m = d.getMinutes();
    var ap = h < 12 ? "am" : "pm";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var t = m ? h12 + ":" + (m < 10 ? "0" + m : m) : "" + h12;
    return fmtDate(d) + ", " + t + ap;
  }

  // Data age is measured from the gamemaster (data) date, never the build date, so a
  // rebuild that fetched nothing cannot look fresh.
  function dataDate(data) { return parseISO(data.gamemaster); }

  function dataAgeDays(data, now) {
    var d = dataDate(data);
    return d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null;
  }

  function stalenessNotice(data, now) {
    var age = dataAgeDays(data, now);
    if (age === null || age <= 3) return null;
    return "Rankings are " + age + " days old — the nightly update may have stalled, "
      + "so a recent event could be missing. The list is still usable.";
  }

  function availabilityNote(data) {
    var a = data.availability;
    if (a && a.ok === false) {
      return "Availability data didn't load today, so “Live now” may be "
        + "incomplete — an empty result doesn’t mean nothing is out there.";
    }
    return null;
  }

  // Build the "Focus today" lists. Eligible = has a live `now` and is not niche.
  // Score, sort, cap at six, then split by whether the window closes within 48h.
  function computeFocus(data, now) {
    var leagues = data.leagues || {};
    var byTarget = {};

    Object.keys(leagues).forEach(function (key) {
      (leagues[key].rows || []).forEach(function (row) {
        if (row.tier === "niche") return;              // niche never appears here
        if (!isLive(row, now)) return;                 // something real, still open
        var t = byTarget[row.target] || (byTarget[row.target] = {
          target: row.target, leagues: [], now: row.now, bestOverall: 9999
        });
        t.leagues.push({ code: LEAGUE_CODE[key] || key, tier: row.tier,
                         bestRole: row.bestRole, overall: row.overall,
                         order: ["great", "ultra", "master"].indexOf(key) });
        if (row.overall && row.overall < t.bestOverall) t.bestOverall = row.overall;
      });
    });

    var entries = Object.keys(byTarget).map(function (k) {
      var t = byTarget[k];
      // Anchor = the league giving the strongest reason: core over flex, then best
      // overall rank, then league order (GL, UL, ML).
      t.leagues.sort(function (a, b) {
        return TIER_POINTS[b.tier] - TIER_POINTS[a.tier]
          || (a.overall || 9999) - (b.overall || 9999)
          || a.order - b.order;
      });
      var anchor = t.leagues[0];
      var extra = t.leagues.length - 1;              // +1 per additional league
      var wild = t.now.kind === "wild" ? 2 : 0;
      var until = parseISO(t.now.until);
      var ending = until && (until.getTime() - now.getTime()) <= SOON_MS
        && until.getTime() >= now.getTime();
      var soon = ending ? 3 : 0;
      t.score = TIER_POINTS[anchor.tier] + extra + wild + soon;
      t.anchor = anchor;
      t.ending = !!ending;
      t.until = until;
      return t;
    });

    entries.sort(function (a, b) {
      return b.score - a.score || a.bestOverall - b.bestOverall;
    });

    var top = entries.slice(0, 6);
    var live = {};
    top.forEach(function (e) { live[e.target] = 1; });
    return {
      endingSoon: top.filter(function (e) { return e.ending; }),
      worth: top.filter(function (e) { return !e.ending; }),
      evergreen: evergreenPicks(leagues, live)
    };
  }

  // The "always worth catching" reminders: top wild cores you can grab any day,
  // not tied to today's events. Excludes anything already in the live groups.
  function evergreenPicks(leagues, live) {
    var by = {};
    Object.keys(leagues).forEach(function (key) {
      (leagues[key].rows || []).forEach(function (row) {
        if (row.tier !== "core" || row.section !== "wild") return;
        if (live && live[row.target]) return;
        var t = by[row.target] || (by[row.target] = {
          target: row.target, leagues: [], bestOverall: 9999,
          anchor: { code: LEAGUE_CODE[key] || key, bestRole: row.bestRole }
        });
        t.leagues.push({ code: LEAGUE_CODE[key] || key, tier: "core" });
        if (row.overall && row.overall < t.bestOverall) {
          t.bestOverall = row.overall;
          t.anchor = { code: LEAGUE_CODE[key] || key, bestRole: row.bestRole };
        }
      });
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
      return b.leagues.length - a.leagues.length || a.bestOverall - b.bestOverall;
    }).slice(0, 5);
  }

  // Evergreen entries have no window, so their line is just the standing.
  function evergreenLine(entry) {
    var codes = entry.leagues.map(function (l) { return l.code; });
    var role = (entry.anchor && entry.anchor.bestRole) || "";
    var m = role.match(/^(\w+)\s+#(\d+)$/);
    if (m) role = "#" + m[2] + " " + m[1];
    return entry.target + " — " + codes.join(" & ") + " core"
      + (role ? ", " + role : "") + ". Always worth a catch.";
  }

  // One line of reasoning, built from the data. e.g.
  //   "Spheal — GL core, #5 Switch. Boosted until Aug 28, 10am."
  function focusLine(entry) {
    var core = entry.leagues.filter(function (l) { return l.tier === "core"; });
    var flex = entry.leagues.filter(function (l) { return l.tier === "flex"; });
    var parts = [];
    if (core.length) {
      parts.push(core.map(function (l) { return l.code; }).join(" & ") + " core");
    }
    if (flex.length) {
      parts.push(flex.map(function (l) { return l.code; }).join(" & ") + " flex");
    }
    var role = entry.anchor.bestRole || "";
    var m = role.match(/^(\w+)\s+#(\d+)$/);      // "Switch #5" -> "#5 Switch"
    if (m) role = "#" + m[2] + " " + m[1];
    if (role) parts.push(role);

    var lead = entry.target + " — " + parts.join(", ") + ".";
    return lead + " " + windowPhrase(entry);
  }

  function windowPhrase(entry) {
    var now = entry.now, when = entry.until ? fmtDateTime(entry.until) : null;
    var via = now.via ? "As " + now.via + ": " : "";
    var body;
    if (now.kind === "wild") {
      body = when ? "boosted until " + when : now.label;
    } else if (now.kind === "raid") {
      body = when ? "in raids until " + when : now.label;
    } else {
      body = now.label;                            // egg pools, undated
    }
    // Capitalise the first letter of the body sentence when there is no "via" prefix.
    if (!via) body = body.charAt(0).toUpperCase() + body.slice(1);
    return via + body + ".";
  }

  // ---- "don't catch" search over the full family index ---------------------
  var CURATED = { core: 1, flex: 1, niche: 1 };   // tiers that are already a list row

  function standingIn(fam, league) {
    var b = fam.best && fam.best[league];
    if (!b) return { tier: "unranked" };
    return { tier: b[1], rank: b[0], role: b[2] };
  }

  // The league where this family is actually worth catching (best curated tier).
  function bestLeagueFor(fam) {
    var best = null;
    Object.keys(fam.best || {}).forEach(function (k) {
      var v = fam.best[k];
      if (!CURATED[v[1]]) return;
      if (!best || v[0] < best.rank) best = { league: k, rank: v[0], tier: v[1], role: v[2] };
    });
    return best;
  }

  // Families that match the query but are NOT a catch in the current league:
  // low-ranked ("skip"), unranked, or only good in another league. Search-only.
  function searchFamilies(data, q, league, shown, limit) {
    if (!q) return [];
    limit = limit || 12;
    var out = [];
    (data.families || []).forEach(function (f) {
      if (!matchRow(f, q)) return;
      if (shown && shown.has(f.target)) return;
      var here = standingIn(f, league);
      if (CURATED[here.tier]) return;               // already shown as a normal row
      out.push({ target: f.target, becomes: f.becomes || [], aliases: f.aliases || [],
                 here: here, better: bestLeagueFor(f) });
    });
    out.sort(function (a, b) {
      var ai = a.better ? 0 : (a.here.tier === "skip" ? 1 : 2);
      var bi = b.better ? 0 : (b.here.tier === "skip" ? 1 : 2);
      if (ai !== bi) return ai - bi;
      var ar = a.better ? a.better.rank : (a.here.rank || 1e9);
      var br = b.better ? b.better.rank : (b.here.rank || 1e9);
      return ar - br;
    });
    return out.slice(0, limit);
  }

  function skipReason(entry, names) {
    var b = entry.better;
    if (b) return "Better in " + (names[b.league] || b.league)
      + " — " + b.tier + " there (#" + b.rank + "). Skip it for this league.";
    if (entry.here.tier === "skip")
      return "Not PvP-relevant — PvPoke ranks it " + entry.here.role + " at best.";
    return "Not in PvPoke’s PvP rankings — don’t bother for battles.";
  }

  // ---- per-card action note: what to actually do with the catch --------------
  function actionNote(row, league) {
    if (row.avail === "Shadow only")
      return "Store candy — you’ll want the Shadow from a Rocket battle, not this wild one.";
    if (league === "master")
      return "Catch — chase a hundo (15/15/15) and bank XL candy; there’s no CP cap here.";
    var xl = row.xl ? " Needs XL candy to reach the cap." : "";
    if (row.tier === "niche")
      return "Catch situationally — only strong in its one role (see ranks)." + xl;
    return "Catch — appraise it: for Great/Ultra you want high Defense & HP, low Attack (not a hundo)." + xl;
  }

  // ---- type matchups (Pokémon GO uses the standard chart) --------------------
  var TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting",
    "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon",
    "Dark", "Steel", "Fairy"];

  // For each attacking type: what it hits for double, half, and no damage.
  var ATTACK = {
    Normal: { x2: [], half: ["Rock", "Steel"], x0: ["Ghost"] },
    Fire: { x2: ["Grass", "Ice", "Bug", "Steel"], half: ["Fire", "Water", "Rock", "Dragon"], x0: [] },
    Water: { x2: ["Fire", "Ground", "Rock"], half: ["Water", "Grass", "Dragon"], x0: [] },
    Electric: { x2: ["Water", "Flying"], half: ["Electric", "Grass", "Dragon"], x0: ["Ground"] },
    Grass: { x2: ["Water", "Ground", "Rock"], half: ["Fire", "Grass", "Poison", "Flying", "Bug", "Dragon", "Steel"], x0: [] },
    Ice: { x2: ["Grass", "Ground", "Flying", "Dragon"], half: ["Fire", "Water", "Ice", "Steel"], x0: [] },
    Fighting: { x2: ["Normal", "Ice", "Rock", "Dark", "Steel"], half: ["Poison", "Flying", "Psychic", "Bug", "Fairy"], x0: ["Ghost"] },
    Poison: { x2: ["Grass", "Fairy"], half: ["Poison", "Ground", "Rock", "Ghost"], x0: ["Steel"] },
    Ground: { x2: ["Fire", "Electric", "Poison", "Rock", "Steel"], half: ["Grass", "Bug"], x0: ["Flying"] },
    Flying: { x2: ["Grass", "Fighting", "Bug"], half: ["Electric", "Rock", "Steel"], x0: [] },
    Psychic: { x2: ["Fighting", "Poison"], half: ["Psychic", "Steel"], x0: ["Dark"] },
    Bug: { x2: ["Grass", "Psychic", "Dark"], half: ["Fire", "Fighting", "Poison", "Flying", "Ghost", "Steel", "Fairy"], x0: [] },
    Rock: { x2: ["Fire", "Ice", "Flying", "Bug"], half: ["Fighting", "Ground", "Steel"], x0: [] },
    Ghost: { x2: ["Psychic", "Ghost"], half: ["Dark"], x0: ["Normal"] },
    Dragon: { x2: ["Dragon"], half: ["Steel"], x0: ["Fairy"] },
    Dark: { x2: ["Psychic", "Ghost"], half: ["Fighting", "Dark", "Fairy"], x0: [] },
    Steel: { x2: ["Ice", "Rock", "Fairy"], half: ["Fire", "Water", "Electric", "Steel"], x0: [] },
    Fairy: { x2: ["Fighting", "Dragon", "Dark"], half: ["Fire", "Poison", "Steel"], x0: [] }
  };

  // Offense: what a mon OF this type hits hard / poorly.
  function typeOffense(type) {
    var a = ATTACK[type] || { x2: [], half: [], x0: [] };
    return { strong: a.x2.slice(), weak: a.half.slice(), none: a.x0.slice() };
  }

  // Defense: which attacking types hit a mon OF this type hard / poorly, by inverting.
  function typeDefense(type) {
    var weakTo = [], resists = [], immune = [];
    TYPES.forEach(function (atk) {
      var a = ATTACK[atk];
      if (a.x0.indexOf(type) >= 0) immune.push(atk);
      else if (a.x2.indexOf(type) >= 0) weakTo.push(atk);
      else if (a.half.indexOf(type) >= 0) resists.push(atk);
    });
    return { weakTo: weakTo, resists: resists, immune: immune };
  }

  var IV_TIPS = {
    "Great & Ultra": "Perfect PvP IVs are usually LOW Attack with high Defense & HP — not 15/15/15. Appraise before you transfer a good-looking catch.",
    "Master": "No CP cap, so raw stats win: look for a hundo (15/15/15) or near-perfect, and save XL Candy to power it to level 50.",
    "Shadow": "Shadows hit harder but are frailer. Great for some picks; the wild Shadow-only catches here are mainly candy until you battle Rocket."
  };

  function errorMessage(reason) {
    return "The data file didn’t load" + (reason ? " (" + reason + ")" : "")
      + ". Check your connection and reload — it may be updating right now.";
  }

  var api = {
    LEAGUE_CODE: LEAGUE_CODE,
    parseISO: parseISO, isLive: isLive, matchRow: matchRow,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    dataDate: dataDate, dataAgeDays: dataAgeDays,
    stalenessNotice: stalenessNotice, availabilityNote: availabilityNote,
    computeFocus: computeFocus, focusLine: focusLine, evergreenLine: evergreenLine,
    errorMessage: errorMessage, actionNote: actionNote,
    standingIn: standingIn, bestLeagueFor: bestLeagueFor,
    searchFamilies: searchFamilies, skipReason: skipReason,
    TYPES: TYPES, typeOffense: typeOffense, typeDefense: typeDefense, IV_TIPS: IV_TIPS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CatchLogic = api;
})(typeof window !== "undefined" ? window : null);
