/* Rendering + interaction. All decisions live in logic.js (window.CatchLogic).
 * Data is fetched at load from a relative path so the page works when served from
 * https://tkoerten.github.io/claude_pokemon_go_catch_list/ . */
(function () {
  "use strict";
  var L = window.CatchLogic;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  };

  var VERDICT = { core: "Catch it", flex: "Worth a ball", niche: "Only if you want it" };
  var CODE_KEY = { GL: "great", UL: "ultra", ML: "master" };
  var state = {
    league: "great", q: "", live: false,
    tiers: new Set(["core", "flex"]), sections: new Set(["wild", "raid"])
  };
  var DATA = null;

  // ---- boot -----------------------------------------------------------------
  fetch("data.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (d) { DATA = d; start(); })
    .catch(function (e) { showError(e && e.message); });

  function showError(reason) {
    var el = $("list");
    if (el) {
      el.innerHTML = '<div class="empty error"><b>Couldn’t load the catch list</b>'
        + esc(L.errorMessage(reason)) + "</div>";
    }
  }

  function start() {
    var now = new Date();
    renderStamp(now);
    renderNotices(now);
    renderLeagues();
    renderFilters();
    renderFocus(now);
    wireEvents();
    sync();
  }

  function renderStamp(now) {
    var d = L.dataDate(DATA);
    $("stamp").textContent = d ? "Updated " + L.fmtDate(d) : "";
  }

  function renderNotices(now) {
    var msgs = [L.stalenessNotice(DATA, now), L.availabilityNote(DATA)]
      .filter(function (m) { return m; });
    var box = $("notice");
    if (!msgs.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = msgs.map(function (m) { return esc(m); }).join("<br>");
  }

  function renderLeagues() {
    $("leagues").innerHTML = Object.keys(DATA.leagues).map(function (k) {
      var v = DATA.leagues[k];
      return '<button data-lg="' + k + '" aria-pressed="' + (k === state.league)
        + '">' + esc(v.label.replace(" League", "")) + "</button>";
    }).join("");
    $("leagues").onclick = function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.league = b.dataset.lg; sync();
    };
  }

  function renderFilters() {
    $("filters").innerHTML =
      [["core", "Core"], ["flex", "Flex"], ["niche", "Deep"]].map(function (p) {
        return '<button class="chip" data-kind="tier" data-tier="' + p[0]
          + '" aria-pressed="' + state.tiers.has(p[0]) + '">' + p[1] + "</button>";
      }).join("") +
      [["wild", "Wild"], ["raid", "Raid &amp; egg"]].map(function (p) {
        return '<button class="chip" data-kind="section" data-section="' + p[0]
          + '" aria-pressed="true">' + p[1] + "</button>";
      }).join("") +
      '<button class="chip" data-kind="live" data-live="1" aria-pressed="false">Live now</button>';
    $("filters").onclick = function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      if (b.dataset.kind === "live") {
        state.live = !state.live; b.setAttribute("aria-pressed", state.live); sync(); return;
      }
      var set = b.dataset.kind === "tier" ? state.tiers : state.sections;
      var key = b.dataset.tier || b.dataset.section;
      set.has(key) ? set.delete(key) : set.add(key);
      b.setAttribute("aria-pressed", set.has(key)); sync();
    };
  }

  // ---- Focus today ----------------------------------------------------------
  function renderFocus(now) {
    var f = L.computeFocus(DATA, now);
    var host = $("focus");
    if (!f.endingSoon.length && !f.worth.length) { host.hidden = true; return; }
    host.hidden = false;
    var html = "";
    if (f.endingSoon.length) html += focusGroup("Ending soon", f.endingSoon, true);
    if (f.worth.length) html += focusGroup("Worth your time", f.worth, false);
    host.innerHTML = html;
    host.onclick = function (e) {
      var li = e.target.closest("li"); if (!li) return;
      jumpTo(li.dataset.key, li.dataset.target);
    };
    host.onkeydown = function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var li = e.target.closest("li"); if (!li) return;
      e.preventDefault(); jumpTo(li.dataset.key, li.dataset.target);
    };
  }

  function focusGroup(heading, entries, soon) {
    return '<h2' + (soon ? ' class="soon"' : "") + ">" + esc(heading) + "</h2><ul>"
      + entries.map(function (en) {
        var line = L.focusLine(en);
        var dash = line.indexOf(" — ");
        var name = dash >= 0 ? line.slice(0, dash) : en.target;
        var why = dash >= 0 ? line.slice(dash + 3) : line;
        var key = CODE_KEY[en.anchor.code] || "great";
        return '<li' + (soon ? ' class="soon"' : "") + ' tabindex="0" role="button"'
          + ' data-key="' + esc(key) + '" data-target="' + esc(en.target) + '">'
          + "<b>" + esc(name) + "</b> — <span class=\"why\">" + esc(why) + "</span></li>";
      }).join("") + "</ul>";
  }

  function jumpTo(key, target) {
    if (key && DATA.leagues[key]) state.league = key;
    state.live = false;
    state.tiers = new Set(["core", "flex", "niche"]);
    state.sections = new Set(["wild", "raid"]);
    document.querySelectorAll('#filters .chip').forEach(function (b) {
      if (b.dataset.kind === "tier") b.setAttribute("aria-pressed", "true");
      if (b.dataset.kind === "section") b.setAttribute("aria-pressed", "true");
      if (b.dataset.kind === "live") b.setAttribute("aria-pressed", "false");
    });
    $("q").value = target; state.q = target.toLowerCase();
    $("clear").classList.add("on");
    sync();
    window.scrollTo({ top: 0 });
  }

  // ---- search + list --------------------------------------------------------
  function hl(s) {
    if (!state.q) return esc(s);
    var i = s.toLowerCase().indexOf(state.q);
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + state.q.length))
      + "</mark>" + esc(s.slice(i + state.q.length));
  }

  function detail(r) {
    var bits = [];
    if (r.avail === "Shadow only") bits.push("Only the Shadow version is ranked. Catching this in the wild builds candy, but the Pokémon you play has to come from a Rocket battle.");
    else if (r.avail === "Both") bits.push("Both the normal and Shadow versions are ranked.");
    (r.lureEvo || []).forEach(function (e) {
      bits.push(e.indexOf(" - ") >= 0 ? e.replace(" - ", ": ") + "." : e + ".");
    });
    if (r.lures && r.lures.length) bits.push(
      r.lures.join(" and ") + " " + (r.lures.length > 1 ? "Lures" : "Lure")
      + " boost its type, out of whatever already spawns in your area.");
    if (r.now) bits.push(r.now.via
      ? "Available now as " + r.now.via + " — " + r.now.label + "."
      : "Available now — " + r.now.label + ".");
    if (r.section === "raid") bits.push("Source: " + r.source + ".");
    if (r.xl) bits.push(state.league === "master"
      ? "Master League is uncapped, so XL candy to level 50 is a real power gap."
      : "Needs XL candy — it can't reach the cap at level 40.");
    return bits.join(" ");
  }

  function sync() {
    var now = new Date();
    document.querySelectorAll("#leagues button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.lg === state.league);
    });
    var lg = DATA.leagues[state.league];
    var rows = lg.rows.filter(function (r) {
      return state.tiers.has(r.tier) && state.sections.has(r.section);
    });
    if (state.live) rows = rows.filter(function (r) { return L.isLive(r, now); });
    if (state.q) rows = rows.filter(function (r) { return L.matchRow(r, state.q); });

    $("count").textContent = rows.length + (rows.length === 1 ? " target" : " targets")
      + " · " + lg.label;

    var curatedHtml = rows.map(function (r) {
      var shown = [r.target].concat(r.becomes).map(function (x) { return x.toLowerCase(); });
      var via = state.q ? (r.aliases || []).find(function (a) {
        return a.toLowerCase().indexOf(state.q) >= 0
          && !shown.some(function (v) { return v.indexOf(state.q) >= 0; });
      }) : null;
      var chain = "<b>" + hl(r.target) + "</b>" +
        (r.becomes.length === 1 && r.becomes[0] === r.target ? "" :
          '<span class="arrow">›</span>' + r.becomes.map(hl).join(", "));
      var tags = ['<span class="tag role">' + esc(r.bestRole) + "</span>"];
      if (r.section === "raid") tags.push('<span class="tag raid">' + esc(r.source) + "</span>");
      if (r.avail === "Shadow only") tags.push('<span class="tag shadowonly">Candy only</span>');
      if (r.xl) tags.push('<span class="tag xl">XL</span>');
      if (r.lures && r.lures.length) tags.push(
        '<span class="tag lure">' + esc(r.lures.join(" · ")) + " lure</span>");
      (r.lureEvo || []).forEach(function (e) {
        tags.push('<span class="tag lureevo">'
          + esc(e.split(" Lure")[0].split(" - ")[0]) + " lure to evolve</span>");
      });
      var cell = function (k, v) {
        return '<div class="rank ' + (v && v <= 75 ? "hit" : "") + '"><div class="k">' + k
          + '</div><div class="v ' + (v ? "" : "none") + '">' + (v ? v : "—") + "</div></div>";
      };
      var live = L.isLive(r, now);
      var now_ = live ? '<div class="now ' + r.now.kind + '"><span class="dot"></span>'
        + esc(r.now.label) + "</div>" : "";
      return '<div class="card" data-tier="' + r.tier + '" tabindex="0" role="button" aria-expanded="false">'
        + now_
        + '<div class="top"><span class="name">' + hl(r.target) + "</span>"
        + '<span class="verdict">' + VERDICT[r.tier] + "</span></div>"
        + '<div class="chain">' + chain + (via ? '<span class="arrow">›</span>' + hl(via) : "") + "</div>"
        + '<div class="tagrow">' + tags.join("") + "</div>"
        + '<div class="ranks">' + cell("Overall", r.overall) + cell("Lead", r.lead)
        + cell("Switch", r.switch) + cell("Closer", r.closer) + "</div>"
        + '<div class="detail" hidden>' + esc(detail(r)) + "</div></div>";
    }).join("");

    // Search-only: families that match but aren't a catch in this league — the
    // "don't catch" answer, and a nudge to the league where it does matter.
    var mutedHtml = "";
    if (state.q) {
      var shown = new Set(rows.map(function (r) { return r.target; }));
      var skips = L.searchFamilies(DATA, state.q, state.league, shown, 12);
      if (skips.length) mutedHtml = '<div class="subhead">Not worth catching here</div>'
        + skips.map(skipCard).join("");
    }

    if (curatedHtml || mutedHtml) {
      $("list").innerHTML = curatedHtml + mutedHtml;
    } else {
      $("list").innerHTML = '<div class="empty"><b>Nothing matches</b>'
        + "Try the wild form or what it evolves into — both work. "
        + 'If <b style="display:inline">Live now</b> is on, turn it off to see everything.</div>';
    }
  }

  var LEAGUE_NAMES = { great: "Great", ultra: "Ultra", master: "Master" };

  function skipCard(e) {
    var shown = [e.target].concat(e.becomes).map(function (x) { return x.toLowerCase(); });
    var via = state.q ? (e.aliases || []).find(function (a) {
      return a.toLowerCase().indexOf(state.q) >= 0
        && !shown.some(function (v) { return v.indexOf(state.q) >= 0; });
    }) : null;
    var chain = "<b>" + hl(e.target) + "</b>"
      + (e.becomes.length ? '<span class="arrow">›</span>' + e.becomes.map(hl).join(", ") : "");
    var jump = e.better ? ' data-jump="' + e.better.league + '"' : "";
    var verdict = e.better ? "Catch elsewhere" : "Don’t catch";
    return '<div class="card" data-tier="skip"' + jump
      + ' tabindex="0" role="button">'
      + '<div class="top"><span class="name">' + hl(e.target) + "</span>"
      + '<span class="verdict">' + verdict + "</span></div>"
      + '<div class="chain">' + chain + (via ? '<span class="arrow">›</span>' + hl(via) : "") + "</div>"
      + '<div class="skipwhy">' + esc(L.skipReason(e, LEAGUE_NAMES)) + "</div></div>";
  }

  function wireEvents() {
    $("q").oninput = function (e) {
      state.q = e.target.value.trim().toLowerCase();
      $("clear").classList.toggle("on", !!state.q); sync();
    };
    $("clear").onclick = function () {
      $("q").value = ""; state.q = "";
      $("clear").classList.remove("on"); $("q").focus(); sync();
    };
    $("list").addEventListener("click", function (e) { activate(e.target.closest(".card")); });
    $("list").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        var c = e.target.closest(".card");
        if (c) { e.preventDefault(); activate(c); }
      }
    });
    $("foot").innerHTML = "<b>Core</b> means top 25 in at least one role. <b>Flex</b> means top 75 in two or"
      + " more. <b>Deep</b> is a single-role specialist. Ranks are the best any form in that family reaches,"
      + " Shadow included, since they share a candy pool.<br><br>"
      + "Search any Pokémon, even a bad one: the good ones show by default, and searching a"
      + " weak line tells you to skip it (or points you to the league where it's worth catching).<br><br>"
      + "<b>Live now</b> shows what is obtainable today: event spawns, raid rotations, and egg pools."
      + " It does not cover the ordinary background spawns in your area — nobody publishes those.<br><br>"
      + "Lure tags come from typing: a lure boosts those types out of your local pool, so it"
      + " concentrates what is already around rather than summoning something new. Searching a"
      + " lure name lists everything it helps with.<br><br>"
      + "Built from PvPoke rankings, data dated " + esc(DATA.gamemaster.slice(0, 10))
      + ". Generated " + esc(DATA.generated) + ".";
  }

  function activate(c) {
    if (!c) return;
    if (c.dataset.jump) { jumpTo(c.dataset.jump, c.querySelector(".name").textContent); return; }
    toggle(c);
  }

  function toggle(c) {
    if (!c) return;
    var open = c.classList.toggle("open");
    c.setAttribute("aria-expanded", open);
    var d = c.querySelector(".detail");
    if (d) d.hidden = !open || !d.textContent.trim();
  }

  // ---- service worker -------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline-first is best-effort */ });
    });
  }
})();
