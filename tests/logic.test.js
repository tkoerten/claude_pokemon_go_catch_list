/* Tests for the page's decision logic. Run:  node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const L = require("../logic.js");

const NOW = new Date("2026-08-27T12:00:00");

function row(over) {
  return Object.assign({
    target: "X", becomes: [], aliases: [], lures: [],
    tier: "core", section: "wild", bestRole: "Switch #5",
    overall: 10, lead: 10, switch: 5, closer: 20, now: null
  }, over);
}

// ---- isLive ---------------------------------------------------------------
test("isLive: no now is not live", () => {
  assert.equal(L.isLive(row({ now: null }), NOW), false);
});
test("isLive: undated window is live", () => {
  assert.equal(L.isLive(row({ now: { kind: "egg", label: "10 km eggs", until: null } }), NOW), true);
});
test("isLive: future window is live", () => {
  assert.equal(L.isLive(row({ now: { kind: "wild", until: "2026-08-28T10:00:00" } }), NOW), true);
});
test("isLive: past window is NOT live", () => {
  assert.equal(L.isLive(row({ now: { kind: "wild", until: "2026-08-25T10:00:00" } }), NOW), false);
});

// ---- matchRow -------------------------------------------------------------
test("matchRow: empty query matches", () => {
  assert.equal(L.matchRow(row({}), ""), true);
});
test("matchRow: resolves from a middle-stage alias", () => {
  const r = row({ target: "Piplup", becomes: ["Empoleon"], aliases: ["Piplup", "Prinplup", "Empoleon"] });
  assert.equal(L.matchRow(r, "prinplup"), true);
});
test("matchRow: matches a lure name", () => {
  assert.equal(L.matchRow(row({ lures: ["Glacial", "Rainy"] }), "glacial"), true);
});
test("matchRow: unrelated query does not match", () => {
  assert.equal(L.matchRow(row({ target: "Piplup", aliases: ["Piplup"] }), "zzz"), false);
});

// ---- computeFocus ---------------------------------------------------------
function data(leagues) { return { leagues }; }

test("computeFocus: empty when nothing is live", () => {
  const d = data({ great: { rows: [row({ tier: "core", now: null })] } });
  const f = L.computeFocus(d, NOW);
  assert.equal(f.endingSoon.length, 0);
  assert.equal(f.worth.length, 0);
});

test("computeFocus: never includes a niche row", () => {
  const d = data({
    great: {
      rows: [
        row({ target: "Nichey", tier: "niche",
              now: { kind: "wild", label: "Event", until: "2026-08-28T10:00:00" } }),
        row({ target: "Corey", tier: "core",
              now: { kind: "egg", label: "10 km eggs", until: null } })
      ]
    }
  });
  const f = L.computeFocus(d, NOW);
  const names = f.endingSoon.concat(f.worth).map(e => e.target);
  assert.ok(!names.includes("Nichey"));
  assert.ok(names.includes("Corey"));
});

test("computeFocus: a window inside 48h lands under Ending soon", () => {
  const d = data({
    great: {
      rows: [row({ target: "Spheal", tier: "core",
                   now: { kind: "wild", label: "Boosted", until: "2026-08-28T10:00:00" } })]
    }
  });
  const f = L.computeFocus(d, NOW);
  assert.equal(f.endingSoon.length, 1);
  assert.equal(f.endingSoon[0].target, "Spheal");
  assert.equal(f.worth.length, 0);
});

test("computeFocus: an undated pool lands under Worth your time", () => {
  const d = data({
    great: { rows: [row({ target: "Piplup", tier: "core",
                          now: { kind: "egg", label: "1 km eggs", until: null } })] }
  });
  const f = L.computeFocus(d, NOW);
  assert.equal(f.worth.length, 1);
  assert.equal(f.endingSoon.length, 0);
});

test("computeFocus: caps at six total", () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push(row({ target: "P" + i, tier: "core", overall: i + 1,
                    now: { kind: "egg", label: "eggs", until: null } }));
  }
  const f = L.computeFocus(data({ great: { rows } }), NOW);
  assert.equal(f.endingSoon.length + f.worth.length, 6);
});

test("computeFocus: cross-league core is scored and phrased", () => {
  const mk = t => row({ target: "Deino", tier: t, bestRole: "Switch #13",
                        now: { kind: "wild", label: "Boosted", until: "2026-08-28T10:00:00" } });
  const d = data({ great: { rows: [mk("core")] }, master: { rows: [mk("core")] } });
  const f = L.computeFocus(d, NOW);
  const e = f.endingSoon[0];
  assert.equal(e.target, "Deino");
  // core in two leagues -> +1 bonus over a single-league core.
  const line = L.focusLine(e);
  assert.match(line, /core/);
  assert.match(line, /#13 Switch/);
});

// ---- misc -----------------------------------------------------------------
test("errorMessage: mentions the reason", () => {
  const m = L.errorMessage("HTTP 404");
  assert.ok(m.length > 0);
  assert.match(m, /404/);
});

test("stalenessNotice: quiet when fresh, speaks when old", () => {
  const fresh = { gamemaster: "2026-08-26 10:00:00" };
  const old = { gamemaster: "2026-08-01 10:00:00" };
  assert.equal(L.stalenessNotice(fresh, NOW), null);
  assert.match(L.stalenessNotice(old, NOW), /days old/);
});

test("availabilityNote: speaks only when a feed failed", () => {
  assert.equal(L.availabilityNote({ availability: { ok: true } }), null);
  assert.match(L.availabilityNote({ availability: { ok: false, failed: ["events"] } }), /Live now/);
});

// ---- search over the full family index (the "don't catch" answer) ---------
const FAMILIES = {
  families: [
    { target: "Weedle", becomes: ["Beedrill"], aliases: ["Weedle", "Kakuna", "Beedrill"],
      best: { great: [230, "skip", "Switch #230"] } },
    { target: "Rattata", becomes: ["Raticate"], aliases: ["Rattata", "Raticate"], best: {} },
    { target: "Dialga", becomes: [], aliases: ["Dialga"],
      best: { great: [655, "skip", "Switch #655"], master: [25, "core", "Closer #25"] } },
    { target: "Piplup", becomes: ["Empoleon"], aliases: ["Piplup", "Prinplup", "Empoleon"],
      best: { great: [4, "core", "Closer #9"] } }
  ]
};
const NAMES = { great: "Great", ultra: "Ultra", master: "Master" };

test("searchFamilies: empty query returns nothing", () => {
  assert.equal(L.searchFamilies(FAMILIES, "", "great", new Set()).length, 0);
});

test("searchFamilies: a weak line resolves from any stage and is skip", () => {
  const r = L.searchFamilies(FAMILIES, "kakuna", "great", new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].target, "Weedle");
  assert.equal(r[0].here.tier, "skip");
  assert.match(L.skipReason(r[0], NAMES), /Switch #230/);
});

test("searchFamilies: unranked family says so", () => {
  const r = L.searchFamilies(FAMILIES, "rattata", "great", new Set());
  assert.equal(r[0].here.tier, "unranked");
  assert.match(L.skipReason(r[0], NAMES), /Not in PvPoke/);
});

test("searchFamilies: cross-league nudge points to the right league", () => {
  const r = L.searchFamilies(FAMILIES, "dialga", "great", new Set());
  assert.ok(r[0].better);
  assert.equal(r[0].better.league, "master");
  assert.match(L.skipReason(r[0], NAMES), /Better in Master/);
});

test("searchFamilies: a family curated in this league is NOT a skip card", () => {
  const r = L.searchFamilies(FAMILIES, "piplup", "great", new Set(["Piplup"]));
  assert.equal(r.length, 0);
});

test("searchFamilies: better-in-another-league sorts ahead of dead skips", () => {
  const r = L.searchFamilies(FAMILIES, "a", "great", new Set());  // matches several
  // Dialga (has a better league) should come before pure skips/unranked.
  assert.equal(r[0].target, "Dialga");
});

// ---- action notes ---------------------------------------------------------
test("actionNote: Master says hunt a hundo", () => {
  assert.match(L.actionNote(row({}), "master"), /hundo/);
});
test("actionNote: Great/Ultra says appraise for IVs", () => {
  assert.match(L.actionNote(row({ tier: "core" }), "great"), /Defense & HP/);
});
test("actionNote: Shadow-only says store candy", () => {
  assert.match(L.actionNote(row({ avail: "Shadow only" }), "great"), /Store candy/);
});
test("actionNote: XL flag is mentioned for GL/UL", () => {
  assert.match(L.actionNote(row({ xl: true }), "ultra"), /XL candy/);
});

// ---- evergreen picks ------------------------------------------------------
test("computeFocus: evergreen surfaces top wild cores not already live", () => {
  const d = data({
    great: {
      rows: [
        row({ target: "Mimikyu", tier: "core", section: "wild", overall: 1, bestRole: "Closer #1", now: null }),
        row({ target: "Regidrago", tier: "core", section: "raid", overall: 2, now: null }),  // raid -> excluded
        row({ target: "Spheal", tier: "core", section: "wild", overall: 5,
              now: { kind: "wild", label: "Boosted", until: "2026-08-28T10:00:00" } })       // live -> excluded
      ]
    }
  });
  const f = L.computeFocus(d, NOW);
  const names = f.evergreen.map(e => e.target);
  assert.ok(names.includes("Mimikyu"));
  assert.ok(!names.includes("Regidrago"));   // raids aren't "catch any day"
  assert.ok(!names.includes("Spheal"));      // already in a live group
  assert.match(L.evergreenLine(f.evergreen[0]), /Mimikyu — GL core, #1 Closer\. Always worth a catch\./);
});

// ---- type chart -----------------------------------------------------------
test("typeChart: Water offense and defense are correct", () => {
  const off = L.typeOffense("Water");
  assert.deepEqual(off.strong.sort(), ["Fire", "Ground", "Rock"].sort());
  const def = L.typeDefense("Water");
  assert.deepEqual(def.weakTo.sort(), ["Electric", "Grass"].sort());
});
test("typeChart: Ghost has no effect on Normal, and vice versa", () => {
  assert.ok(L.typeOffense("Ghost").none.includes("Normal"));
  assert.ok(L.typeDefense("Ghost").immune.includes("Normal"));   // Normal can't hit Ghost
});
test("typeChart: every referenced type is one of the 18", () => {
  const set = new Set(L.TYPES);
  assert.equal(L.TYPES.length, 18);
  L.TYPES.forEach(function (t) {
    const o = L.typeOffense(t);
    o.strong.concat(o.weak, o.none).forEach(function (x) { assert.ok(set.has(x), t + " -> " + x); });
  });
});
