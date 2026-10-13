# Stats Leaderboard (`stats.html`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `public.contest_results` as a self-refreshing public leaderboard page named `stats.html`, showing the ten highest-scoring distinct nicknames with their repeat runs greyed beneath them.

**Architecture:** One windowed `GET` is fetched through a new `fetchResults` in the existing `js/results-api.js`, ranked and de-duplicated by a pure `rankRows` in a new `js/leaderboard.js`, then rendered and polled by that same module. `stats.html` is a static page with no build step; tests run the real page inside an `srcdoc` iframe whose `fetch` is stubbed before any page script executes.

**Tech Stack:** ES5 JavaScript, plain HTML, plain CSS, `fetch` against Supabase PostgREST. No framework, no bundler, no runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-13-stats-leaderboard-design.md`

## Global Constraints

- **ES5 only** in shipped `js/*.js`: no `let`, `const`, arrow functions, template literals, `class`, `Array.prototype.find`, `Object.assign`. The existing modules (`js/results-api.js`, `js/game-logic.js`) are ES5 and `node tests/run-tests.js` must keep passing.
- **No build step, no bundler, no runtime third-party dependency** — no CDN script, no `@supabase/supabase-js`.
- **Every nickname and every cell is written with `textContent`, never `innerHTML`.** A nickname is attacker-shaped content; `innerHTML` anywhere in the leaderboard is a security defect, not a style choice.
- **No test may contact production Supabase.** Every `fetch` a test causes must be answered by a stub. Never execute `sql/001-create-contest-results.sql` again.
- Exact values from the spec: `REFRESH_MS = 10000`, `FETCH_LIMIT = 500`, `TOP_NAMES = 10`, status strings `Loading…`, `Updated HH:MM:SS`, `Not configured`, `Couldn't load — retrying`, empty copy `No results yet — finish a contest and your score appears here.`, link text `Play now`, page title `Halloween Contest Leaderboard`, footnote `Ranked from the top 500 results.`
- **`.gitignore` stays uncommitted.** Never stage it.
- The published page is `https://alcebal2002.github.io/halloween-contest/stats.html` and goes live on push to `main`. Do not push as part of any task; commits are local until the partner says push.

## Review Focus

Five things the spec implies but that a reasonable person would only notice in use, each pinned to the task that owns the code:

1. **A nickname containing markup.** `<img src=x onerror=alert(1)>` must arrive as literal text and create no element. A single `innerHTML` in `render` turns every nickname into executable HTML. → Task 3, Step 3 (assertion 6).
2. **One nickname holding several top scores.** Its repeats must not push another player out of the top ten, must not claim a second rank number, and must sit directly beneath its own best row. → Task 2 (unit tests `repeat row directly beneath its own best row`, `keeps the first ten names`, `four rows for a top name that repeats three times`) and Task 3 (assertions 4–5).
3. **Seven columns at 360px.** The reflow must hide no field and produce no horizontal scroll; a page that fits only because a column was dropped is a failure. → Task 3, Step 3 (assertions 8 and 13).
4. **A failed refresh blanking a good leaderboard.** One dropped request must leave the previously rendered rows exactly as they were and say so on the status line. → Task 3 (assertion 12) and Task 4 (assertion 15).
5. **An unconfigured deploy polling forever.** When `js/supabase-config.js` still carries a placeholder, the page must issue zero requests and stop, rather than firing a doomed request every ten seconds. → Task 4 (assertions 20–21).

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `js/results-api.js` | HTTP only, no DOM. Gains `fetchResults` alongside `saveResult`. |
| `js/leaderboard.js` | New. `rankRows` (pure ordering), `render` (pure-ish DOM write), `startPolling`/`stopPolling`/`shouldPoll`, `reload`, `boot` (orchestration). |
| `stats.html` | New. Markup, script tags, one-line boot call. |
| `css/style.css` | Gains `.lb-*` rules and the `max-width: 559px` reflow. |
| `tests/test-suite.js` | Shared unit suite; gains `fetchResults`, `rankRows`, `shouldPoll` coverage. |
| `tests/test.html` | Needs one more `<script src>` for `js/leaderboard.js`. |
| `tests/stats-check.html` | New. Drives the real `stats.html` with a stubbed `fetch`. |
| `tests/README.md` | Seven runners → eight. |

---

### Task 1: `fetchResults` in `js/results-api.js`

**Files:**
- Modify: `js/results-api.js`
- Test: `tests/test-suite.js`

**Interfaces:**
- Consumes: `isConfigured(config)`, `REST_PATH`, `DEFAULT_TIMEOUT_MS`, `jsonResponse`/`saveConfig` helpers already defined in `tests/test-suite.js`.
- Produces: `ResultsApi.fetchResults(config, fetchImpl, timeoutMs) → Promise<outcome>` where `outcome` is exactly one of `{ok:true, kind:"loaded", rows:[...]}`, `{ok:false, kind:"unconfigured"}`, `{ok:false, kind:"failed", detail:string}`. Always resolves; never rejects; never throws. Task 4 calls it as `api.fetchResults(config)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-suite.js` immediately before the final `return { tests: tests };` line (currently line 995). These reuse the `saveConfig()`, `saveRow()` and `jsonResponse(status, body)` helpers defined at lines 927–939.

```js
  /* ---- Supabase results: the leaderboard fetch ---- */

  test("fetchResults issues a windowed GET ordered by score", function () {
    var seen = {};
    var fetchImpl = function (url, opts) {
      seen.url = url; seen.opts = opts;
      return Promise.resolve(jsonResponse(200, []));
    };
    return RA.fetchResults(saveConfig(), fetchImpl).then(function (res) {
      assertEqual(res.ok, true, "a 200 with an array is a load");
      assertEqual(res.kind, "loaded", "kind");
      assertEqual(res.rows.length, 0, "an empty board is still a load");
      assertEqual(seen.url,
        "https://lyzuxvcsjavxhlovgeeu.supabase.co/rest/v1/contest_results" +
        "?select=session_id,nickname,total_score,correct_count,bonuses_matched,elapsed_ms,finished_at" +
        "&order=total_score.desc,created_at.asc&limit=500", "windowed, score-descending endpoint");
      assertEqual(seen.opts.method, "GET", "method");
      assertEqual(seen.opts.headers["apikey"], saveConfig().anonKey, "apikey header");
      assertEqual(seen.opts.headers["Authorization"], "Bearer " + saveConfig().anonKey, "bearer header");
      assertEqual(seen.opts.body, undefined, "a GET carries no body");
    });
  });

  test("fetchResults returns the rows the server sent", function () {
    var rows = [{ nickname: "Bat", total_score: 12 }];
    var fetchImpl = function () { return Promise.resolve(jsonResponse(200, rows)); };
    return RA.fetchResults(saveConfig(), fetchImpl).then(function (res) {
      assertEqual(res.rows.length, 1, "row count");
      assertEqual(res.rows[0].nickname, "Bat", "row identity");
    });
  });

  test("fetchResults resolves unconfigured without issuing a request", function () {
    var calls = 0;
    var fetchImpl = function () { calls++; return Promise.resolve(jsonResponse(200, [])); };
    var bad = { url: "https://example.supabase.co", anonKey: "PASTE_YOUR_KEY_HERE" };
    return RA.fetchResults(bad, fetchImpl).then(function (res) {
      assertEqual(res.ok, false, "not a load");
      assertEqual(res.kind, "unconfigured", "kind");
      assertEqual(calls, 0, "an unconfigured config must never reach the network");
    });
  });

  test("fetchResults resolves failed on a non-2xx status", function () {
    var fetchImpl = function () { return Promise.resolve(jsonResponse(500, { message: "boom" })); };
    return RA.fetchResults(saveConfig(), fetchImpl).then(function (res) {
      assertEqual(res.ok, false, "a 500 is not a load");
      assertEqual(res.kind, "failed", "kind");
    });
  });

  test("fetchResults resolves failed when the body is not an array", function () {
    var fetchImpl = function () { return Promise.resolve(jsonResponse(200, { hint: "not rows" })); };
    return RA.fetchResults(saveConfig(), fetchImpl).then(function (res) {
      assertEqual(res.ok, false, "an object body is not a leaderboard");
      assertEqual(res.kind, "failed", "kind");
    });
  });

  test("fetchResults resolves failed when fetch rejects", function () {
    var fetchImpl = function () { return Promise.reject(new TypeError("Failed to fetch")); };
    return RA.fetchResults(saveConfig(), fetchImpl).then(function (res) {
      assertEqual(res.ok, false, "a rejected request is not a load");
      assertEqual(res.kind, "failed", "kind");
      assert(res.detail.length > 0, "the detail should say what happened");
    });
  });

  test("fetchResults times out a request that never settles", function () {
    var hanging = function () { return new Promise(function () { /* never settles */ }); };
    return RA.fetchResults(saveConfig(), hanging, 30).then(function (res) {
      assertEqual(res.ok, false, "a hung request is not a load");
      assertEqual(res.kind, "failed", "kind");
      assert(res.detail.indexOf("timed out") !== -1, "detail names the timeout: " + res.detail);
    });
  });

  test("fetchResults never throws on a config it cannot read", function () {
    var fetchImpl = function () { return Promise.resolve(jsonResponse(200, [])); };
    var threw = null;
    var result = null;
    try {
      result = RA.fetchResults(null, fetchImpl);
    } catch (e) {
      threw = e;
    }
    assertEqual(threw, null, "a bad config must resolve, not throw");
    return result.then(function (res) {
      assertEqual(res.ok, false, "nothing was sent");
      assertEqual(res.kind, "unconfigured", "kind");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/run-tests.js`
Expected: FAIL — `RA.fetchResults is not a function` (8 new tests fail, the existing 73 still pass).

- [ ] **Step 3: Write the implementation**

In `js/results-api.js`, add the three query constants directly beneath `var REST_PATH = "/rest/v1/contest_results";` (line 10):

```js
  var SELECT_COLUMNS = "session_id,nickname,total_score,correct_count,bonuses_matched,elapsed_ms,finished_at";
  var ORDER_CLAUSE = "total_score.desc,created_at.asc";
  var FETCH_LIMIT = 500;
```

Add `fetchResults` between `saveResult` and `classifySaveError` (between lines 124 and 126), then add it to the returned object at the bottom of the file.

```js
  // Reads the leaderboard window. Same contract as saveResult: it always
  // resolves — never rejects, never throws — so the board can be updated
  // without a catch. The ambient fetch is looked up at call time so a harness
  // can stub window.fetch.
  //
  // Ranking is done client-side against a plain score-descending window rather
  // than filtering on nickname: nicknames are content-unvalidated, and sending
  // them back inside PostgREST's `nickname=in.(...)` grammar would mean
  // escaping attacker-shaped strings into a filter expression.
  function fetchResults(config, fetchImpl, timeoutMs) {
    if (!isConfigured(config)) {
      return Promise.resolve({ ok: false, kind: "unconfigured" });
    }

    var doFetch = fetchImpl;
    if (!doFetch) {
      if (typeof fetch === "undefined") {
        return Promise.resolve({ ok: false, kind: "failed", detail: "no fetch available" });
      }
      doFetch = function () { return fetch.apply(null, arguments); };
    }

    var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = null;

    var request = Promise.resolve()
      .then(function () {
        var endpoint = String(config.url).replace(/\/+$/, "") + REST_PATH
          + "?select=" + SELECT_COLUMNS
          + "&order=" + ORDER_CLAUSE
          + "&limit=" + FETCH_LIMIT;
        return doFetch(endpoint, {
          method: "GET",
          headers: {
            "apikey": config.anonKey,
            "Authorization": "Bearer " + config.anonKey
          },
          signal: controller ? controller.signal : undefined
        });
      })
      .then(function (res) {
        if (!res || !res.ok) {
          return { ok: false, kind: "failed", detail: "status " + (res ? res.status : 0) };
        }
        return Promise.resolve(res.json()).then(function (rows) {
          if (!Array.isArray(rows)) return { ok: false, kind: "failed", detail: "unexpected payload" };
          return { ok: true, kind: "loaded", rows: rows };
        }, function () {
          return { ok: false, kind: "failed", detail: "unreadable payload" };
        });
      })
      .catch(function (e) {
        return { ok: false, kind: "failed", detail: (e && e.message) ? e.message : "network error" };
      });

    var expired = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        resolve({ ok: false, kind: "failed", detail: "timed out" });
      }, timeout);
    });

    return Promise.race([request, expired]).then(function (outcome) {
      if (timer) clearTimeout(timer);
      return outcome;
    });
  }
```

Then extend the module's return object (currently lines 134–139):

```js
  return {
    isConfigured: isConfigured,
    buildResultRow: buildResultRow,
    classifySaveError: classifySaveError,
    saveResult: saveResult,
    fetchResults: fetchResults
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/run-tests.js`
Expected: `81 passed, 0 failed`, exit code `0`. (The 73 that already existed plus these 8.)

- [ ] **Step 5: Confirm no other runner regressed**

Run: `node tests/run-tests.js` and then open `tests/test.html` in a browser (or headless with a fresh profile) — both run this same file.
Expected: both report `81 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add js/results-api.js tests/test-suite.js
git commit -m "Read the leaderboard window from the results API"
```

---

### Task 2: `rankRows`, `shouldPoll` and `REFRESH_MS` in `js/leaderboard.js`

**Files:**
- Create: `js/leaderboard.js`
- Modify: `tests/test-suite.js` (UMD header + new tests)
- Modify: `tests/test.html` (one script tag)

**Interfaces:**
- Consumes: `GameLogic` (nothing yet — required by the UMD guard so later tasks can format time).
- Produces: `Leaderboard.rankRows(rows, limit) → [{...row, repeat:boolean}]` flat and ordered; `Leaderboard.shouldPoll(docLike) → boolean`; `Leaderboard.REFRESH_MS === 10000`; `Leaderboard.TOP_NAMES === 10`. Task 3 calls `rankRows` before `render`; Task 4 calls `shouldPoll` inside every poll tick.

- [ ] **Step 1: Wire the new module into the shared suite**

In `tests/test-suite.js`, change the UMD header (lines 1–9) so the suite also receives the new module:

```js
(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var GL = isNode ? require("../js/game-logic.js") : root.GameLogic;
  var RA = isNode ? require("../js/results-api.js") : root.ResultsApi;
  var LB = isNode ? require("../js/leaderboard.js") : root.Leaderboard;
  var api = factory(GL, RA, LB, root);
  if (isNode) module.exports = api;
  else root.TestSuite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL, RA, LB, rootRef) {
```

In `tests/test.html`, add the script tag between `../js/results-api.js` (line 22) and `test-suite.js` (line 23):

```html
  <script src="../js/leaderboard.js"></script>
```

`tests/run-tests.js` needs no change: it requires `test-suite.js`, which now requires `../js/leaderboard.js`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/test-suite.js` immediately before `return { tests: tests };`, after the Task 1 block:

```js
  /* ---- Leaderboard: ranking ---- */

  function lbRow(nickname, score, createdAt) {
    return {
      session_id: "s_" + nickname + "_" + score,
      nickname: nickname,
      total_score: score,
      correct_count: 4,
      bonuses_matched: 2,
      elapsed_ms: 91000,
      finished_at: "2026-10-13T12:00:00.000Z",
      created_at: createdAt || "2026-10-13T12:00:00.000Z"
    };
  }

  test("rankRows ranks ten distinct names in order with no repeats", function () {
    var rows = [];
    for (var i = 0; i < 14; i++) rows.push(lbRow("Player" + i, 100 - i));
    var out = LB.rankRows(rows, 10);
    assertEqual(out.length, 10, "truncated to ten rows");
    for (var j = 0; j < out.length; j++) {
      assertEqual(out[j].nickname, "Player" + j, "rank " + (j + 1) + " wrong");
      assertEqual(out[j].repeat, false, "a distinct name must not be a repeat");
    }
  });

  test("rankRows emits a repeat row directly beneath its own best row", function () {
    var rows = [lbRow("Bat", 90), lbRow("Cat", 80), lbRow("Bat", 70), lbRow("Dog", 60)];
    var out = LB.rankRows(rows, 10);
    assertEqual(out.length, 4, "three names, one of them twice");
    assertEqual(out[0].nickname, "Bat"); assertEqual(out[0].repeat, false, "Bat best");
    assertEqual(out[1].nickname, "Bat"); assertEqual(out[1].repeat, true, "Bat repeat sits with its name");
    assertEqual(out[2].nickname, "Cat"); assertEqual(out[2].repeat, false, "Cat ranks second");
    assertEqual(out[2].total_score, 80, "Cat keeps its own score");
    assertEqual(out[3].nickname, "Dog"); assertEqual(out[3].repeat, false, "Dog ranks third");
  });

  test("rankRows gives the earlier arrival the higher rank when scores tie", function () {
    var rows = [
      lbRow("Alpha", 50, "2026-10-13T10:00:00.000Z"),
      lbRow("Beta", 50, "2026-10-13T09:00:00.000Z")
    ];
    var out = LB.rankRows(rows, 10);
    assertEqual(out[0].nickname, "Alpha", "first in the ordered stream wins");
    assertEqual(out[1].nickname, "Beta", "second in the ordered stream follows");
  });

  test("rankRows keeps the first ten names and drops every unranked name", function () {
    var rows = [];
    for (var i = 0; i < 12; i++) rows.push(lbRow("P" + i, 100 - i));
    rows.push(lbRow("Ghost", 1));
    var out = LB.rankRows(rows, 10);
    var names = {};
    out.forEach(function (r) { names[r.nickname] = true; });
    assertEqual(Object.keys(names).length, 10, "ten distinct names");
    assertEqual(names.Ghost, undefined, "a name below the cut contributes nothing");
    assertEqual(names.P11, undefined, "the eleventh name is out");
  });

  test("rankRows returns only what exists when fewer than ten names qualify", function () {
    var out = LB.rankRows([lbRow("Bat", 9), lbRow("Cat", 8)], 10);
    assertEqual(out.length, 2, "no filler rows");
  });

  test("rankRows drops blank, whitespace and missing nicknames", function () {
    var out = LB.rankRows([lbRow("", 9), lbRow("   ", 8), lbRow("Bat", 7), lbRow(null, 6)], 10);
    assertEqual(out.length, 1, "only the real name survives");
    assertEqual(out[0].nickname, "Bat", "survivor");
  });

  test("rankRows returns an empty array for anything that is not an array", function () {
    assertEqual(LB.rankRows([], 10).length, 0, "empty array");
    assertEqual(LB.rankRows(null, 10).length, 0, "null");
    assertEqual(LB.rankRows(undefined, 10).length, 0, "undefined");
    assertEqual(LB.rankRows({}, 10).length, 0, "object");
  });

  test("rankRows emits four rows for a top name that repeats three times", function () {
    var rows = [lbRow("Bat", 100)];
    for (var i = 0; i < 9; i++) rows.push(lbRow("P" + i, 90 - i));
    rows.push(lbRow("Bat", 5));
    rows.push(lbRow("Bat", 4));
    rows.push(lbRow("Bat", 3));
    var out = LB.rankRows(rows, 10);
    var distinct = {};
    out.forEach(function (r) { distinct[r.nickname] = true; });
    assertEqual(Object.keys(distinct).length, 10, "still only ten names");
    assertEqual(out.length, 13, "ten names plus three repeats");
    assertEqual(out[10].repeat, true, "first repeat");
    assertEqual(out[11].repeat, true, "second repeat");
    assertEqual(out[12].nickname, "Bat", "the last repeat still sits with its name");
    assertEqual(out[12].repeat, true, "third repeat");
  });

  test("rankRows never mutates the rows it is given", function () {
    var rows = [lbRow("Bat", 90)];
    LB.rankRows(rows, 10);
    assertEqual(rows[0].repeat, undefined, "the source row must not be tagged");
  });

  test("shouldPoll stops a hidden document and allows a visible one", function () {
    assertEqual(LB.shouldPoll({ hidden: true }), false, "an abandoned tab must not poll");
    assertEqual(LB.shouldPoll({ hidden: false }), true, "a visible tab polls");
    assertEqual(LB.shouldPoll(null), true, "no document means no reason to stop");
  });

  test("REFRESH_MS is ten seconds and TOP_NAMES is ten", function () {
    assertEqual(LB.REFRESH_MS, 10000, "auto-refresh cadence");
    assertEqual(LB.TOP_NAMES, 10, "distinct names shown");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node tests/run-tests.js`
Expected: FAIL — cannot find module `../js/leaderboard.js` (the whole run errors out, not just the new tests).

- [ ] **Step 4: Write `js/leaderboard.js`**

Create `js/leaderboard.js`:

```js
(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var GL = isNode ? require("./game-logic.js") : root.GameLogic;
  var api = factory(GL, root);
  if (isNode) module.exports = api;
  else root.Leaderboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL, rootRef) {
  "use strict";

  var REFRESH_MS = 10000;
  var TOP_NAMES = 10;
  var COLUMNS = ["#", "Player", "Score", "Correct", "Bonus", "Time", "Finished"];
  var activeLoad = null;

  // Pure ranking over a stream the server already ordered by
  // total_score desc, created_at asc.
  //
  // 1. blank nicknames are dropped — otherwise they would all group into one
  //    phantom "" player and claim a rank nobody earned;
  // 2. rows are grouped by nickname in arrival order, so the first row seen
  //    for a name is that name's best score;
  // 3. only the first `limit` distinct names are kept;
  // 4. each kept name emits its best row first (repeat:false), then its other
  //    rows (repeat:true), so repeats sit directly beneath the name they
  //    belong to rather than scattering through the standings.
  //
  // Returns new objects; the input array is never touched.
  function rankRows(rows, limit) {
    if (!Array.isArray(rows)) return [];
    var max = (typeof limit === "number" && limit > 0) ? limit : TOP_NAMES;

    var order = [];
    var groups = Object.create ? Object.create(null) : {};

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var name = (typeof row.nickname === "string")
        ? row.nickname.replace(/^\s+|\s+$/g, "")
        : "";
      if (name === "") continue;
      if (!groups[name]) { groups[name] = []; order.push(name); }
      groups[name].push(row);
    }

    var out = [];
    var kept = 0;
    for (var g = 0; g < order.length && kept < max; g++) {
      var group = groups[order[g]];
      kept++;
      for (var r = 0; r < group.length; r++) {
        var copy = {};
        for (var key in group[r]) {
          if (Object.prototype.hasOwnProperty.call(group[r], key)) copy[key] = group[r][key];
        }
        copy.repeat = r > 0;
        out.push(copy);
      }
    }
    return out;
  }

  // A hidden document means an abandoned tab: skip the tick so it does not
  // hold the anon key at six requests a minute.
  function shouldPoll(docLike) {
    if (!docLike || typeof docLike.hidden !== "boolean") return true;
    return !docLike.hidden;
  }

  return {
    REFRESH_MS: REFRESH_MS,
    TOP_NAMES: TOP_NAMES,
    COLUMNS: COLUMNS,
    rankRows: rankRows,
    shouldPoll: shouldPoll,
    _active: function () { return activeLoad; },
    _setActive: function (fn) { activeLoad = fn; }
  };
});
```

`_active`/`_setActive` are deliberately underscore-prefixed placeholders that Tasks 3 and 4 replace with the real `reload`/`boot`; they exist so this commit is self-consistent without pretending to expose an API the later tasks define. When Task 3 adds `render`, delete both and add `render` instead.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/run-tests.js`
Expected: `92 passed, 0 failed`, exit code `0`. (81 from Task 1 plus these 11.)

- [ ] **Step 6: Confirm `tests/test.html` agrees**

Open `tests/test.html` with a fresh profile or serve it and open directly.
Expected: `92 passed, 0 failed`. If the two disagree, the UMD guard at the top of `js/leaderboard.js` or the new script tag in `tests/test.html` is wrong.

- [ ] **Step 7: Commit**

```bash
git add js/leaderboard.js tests/test-suite.js tests/test.html
git commit -m "Rank the leaderboard window into distinct names with greyed repeats"
```

---

### Task 3: `stats.html`, `render` and the integration harness

**Files:**
- Create: `stats.html`
- Create: `tests/stats-check.html`
- Modify: `js/leaderboard.js` (add `render`, `writeRows`, `writeSkeleton`, `writeMessage`, drop `_active`/`_setActive`)
- Modify: `css/style.css` (`.lb-*` block + `max-width: 559px` reflow)

**Interfaces:**
- Consumes: `Leaderboard.rankRows`, `Leaderboard.TOP_NAMES`, `Leaderboard.COLUMNS` (Task 2); `GameLogic.formatDuration`, `GameLogic.formatTimestamp`; `ResultsApi`/`window.SUPABASE_CONFIG` are referenced by `stats.html` but are **not** wired to a fetch until Task 4.
- Produces: `Leaderboard.render(doc, view)` where `view` is `{state, rows, status, message, link}` and `state` is one of `"loading" | "ready" | "empty" | "not-configured" | "error"`; `view.link` is `{href, text}` or `null`. The markup contract `stats.html` must satisfy: `#lb-status`, `#lb-table`, `#lb-body`, `#lb-message`, `#btn-lb-refresh`, `.lb-foot`. Task 4 wires `boot` against these same ids.

- [ ] **Step 1: Write `stats.html`**

Create `stats.html`. Note that there is **no boot script yet** — Task 4 adds it. Every `<head>` and `</head>` occurrence must be exact and singular: the harness in Step 3 string-replaces them.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Halloween Contest Leaderboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Creepster&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div class="fog" aria-hidden="true"></div>

<main class="card">
  <a class="lb-back" href="index.html">&larr; Back to the game</a>

  <header class="masthead">
    <h1 class="title">Halloween Contest Leaderboard</h1>
    <p id="lb-status" class="save-status" aria-live="polite">Loading&hellip;</p>
  </header>

  <button id="btn-lb-refresh" class="btn btn-ghost" type="button">Refresh</button>

  <div id="lb-board">
    <table id="lb-table" class="lb-table">
      <thead>
        <tr>
          <th>#</th><th>Player</th><th>Score</th><th>Correct</th>
          <th>Bonus</th><th>Time</th><th>Finished</th>
        </tr>
      </thead>
      <tbody id="lb-body"></tbody>
    </table>
    <p id="lb-message" class="lb-message" hidden></p>
  </div>

  <p class="lb-foot">Ranked from the top 500 results.</p>
</main>

<footer class="page-foot">Happy Halloween 🕸️</footer>

<script src="js/game-logic.js"></script>
<script src="js/supabase-config.js"></script>
<script src="js/results-api.js"></script>
<script src="js/leaderboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add the leaderboard CSS**

Append to `css/style.css`. The `@media (max-width: 559px)` rule is the complement of the file's existing `@media (min-width: 560px)`, so the two never overlap.

```css
/* ---- Leaderboard (stats.html) ---- */
.lb-back {
  display: inline-block;
  color: var(--muted);
  font-size: 14px;
  text-decoration: none;
  margin-bottom: 6px;
}
.lb-back:hover, .lb-back:focus-visible { color: var(--bone); }

.lb-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 4px; }
.lb-table th {
  text-align: left;
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 8px 6px;
  border-bottom: 1px solid rgba(168, 159, 145, 0.35);
}
/* `anywhere` keeps a long nickname or timestamp from widening the table: it
   drops the cell's min-content width to a single character, so the layout
   wraps instead of scrolling sideways. */
.lb-table td {
  padding: 9px 6px;
  border-bottom: 1px solid rgba(168, 159, 145, 0.14);
  color: var(--bone);
  overflow-wrap: anywhere;
}
.lb-table td.lb-rank { color: var(--orange); font-weight: 700; width: 2.5em; }
.lb-table tr.is-repeat td { color: var(--muted); opacity: 0.62; }
.lb-table tr.is-skeleton td {
  height: 18px;
  background: linear-gradient(90deg, rgba(168, 159, 145, 0.10), rgba(168, 159, 145, 0.04));
  border-bottom-color: rgba(168, 159, 145, 0.12);
}
.lb-message { color: var(--muted); text-align: center; padding: 26px 4px; font-size: 15px; }
.lb-message a { color: var(--orange); font-weight: 600; }
.lb-foot { color: var(--muted); font-size: 12px; text-align: center; margin-top: 14px; }

/* Seven columns do not fit at 360px. The header row is dropped and every cell
   reflows to its own labelled line, so no field is ever hidden. */
@media (max-width: 559px) {
  .lb-table thead { display: none; }
  .lb-table, .lb-table tbody, .lb-table tr, .lb-table td { display: block; width: 100%; }
  .lb-table tr { padding: 8px 0; border-bottom: 1px solid rgba(168, 159, 145, 0.18); }
  .lb-table td {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 2px;
    border: 0;
    text-align: right;
  }
  .lb-table td::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-align: left;
    flex: 0 0 auto;
  }
}
```

- [ ] **Step 3: Write the failing harness**

Create `tests/stats-check.html`. It drives the **real** `stats.html` through `srcdoc`, because `app-check.html` stubs `fetch` *after* the iframe's `load` event and this page will fetch on boot from Task 4 onward.

Two ordering rules are load-bearing and are asserted in Step 5:

- `<base href="../">` must be injected **before** the `<link rel="stylesheet">` inside `<head>`, or the stylesheet resolves to `/tests/css/style.css`, 404s, and every layout assertion runs against an unstyled page.
- The injected `<base>` must be short enough that `<meta charset="UTF-8">` still falls inside the first 1024 bytes, or the browser falls back to windows-1252 and the em dash in `Couldn't load — retrying` (Task 4) stops matching.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Halloween Contest — stats checklist</title>
<style>
  body { background: #0d0a14; color: #f5efe6; font-family: monospace; padding: 20px; }
  .pass { color: #86efac; }
  .fail { color: #fca5a5; }
  pre { white-space: pre-wrap; }
  iframe { width: 760px; height: 640px; border: 1px solid #7c3aed; }
  iframe.narrow { width: 360px; height: 560px; }
</style>
</head>
<body>
<h1>Leaderboard checklist (stats.html)</h1>
<p id="verdict">running…</p>
<pre id="report"></pre>
<iframe id="f" title="stats.html under test"></iframe>
<iframe id="narrow" class="narrow" title="stats.html at 360px" hidden></iframe>

<script>
(function () {
  var results = [];
  function rec(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: String(detail) }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function W(frame) { return frame.contentWindow; }
  function D(frame) { return frame.contentDocument; }
  function $(frame, id) { return D(frame).getElementById(id); }
  function click(el, win) { el.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); }
  var f = document.getElementById("f");
  var narrow = document.getElementById("narrow");

  // Fixture rows: ten distinct names in score order, one of which is markup,
  // plus a second run for the same first name at a much lower score.
  var NAMES = ["Bat", "Cat", "Dog", "Rat", "Owl",
               "<img src=x onerror=alert(1)>", "Crow", "Fox", "Wolf", "Toad"];
  function rawRows() {
    var out = [];
    for (var i = 0; i < NAMES.length; i++) {
      out.push({
        session_id: "s" + i,
        nickname: NAMES[i],
        total_score: 100 - i,
        correct_count: 8 - (i % 4),
        bonuses_matched: i % 3,
        elapsed_ms: 60000 + i * 1000,
        finished_at: "2026-10-13T12:0" + (i % 10) + ":00.000Z",
        created_at: "2026-10-13T13:00:00.000Z"
      });
    }
    out.push({
      session_id: "s99", nickname: "Bat", total_score: 5,
      correct_count: 1, bonuses_matched: 0, elapsed_ms: 30000,
      finished_at: "2026-10-13T14:00:00.000Z",
      created_at: "2026-10-13T14:00:00.000Z"
    });
    return out;
  }

  function ranked() { return W(f).Leaderboard.rankRows(rawRows(), 10); }

  // The <base> goes in first inside <head>, ahead of the stylesheet link, so
  // css/style.css resolves to the project root rather than /tests/css/.
  function buildPage() {
    return fetch("../stats.html?cb=" + Date.now())
      .then(function (r) { return r.text(); })
      .then(function (html) {
        return html.replace("<head>", "<head><base href=\"../\">");
      });
  }

  function load(frame) {
    return buildPage().then(function (html) {
      var done = new Promise(function (resolve) {
        frame.onload = function () { setTimeout(resolve, 150); };
      });
      frame.srcdoc = html;
      return done;
    });
  }

  function cellText(tr, index) { return tr.cells[index].textContent; }

  async function run() {
    /* --- 1..9: the real page, rendered by Leaderboard.render --- */
    await load(f);
    var d = D(f), win = W(f);

    rec("1. title is Halloween Contest Leaderboard",
      d.title === "Halloween Contest Leaderboard", "title=" + d.title);

    var bg = win.getComputedStyle(d.body).backgroundColor;
    rec("2. the page loads its stylesheet through the injected base",
      bg === "rgb(13, 10, 20)", "body background=" + bg);

    win.Leaderboard.render(d, { state: "ready", rows: ranked(), status: "Updated 18:42:07" });
    var rows = d.querySelectorAll("#lb-body tr");
    rec("3. eleven rows render — ten names plus one repeat", rows.length === 11,
      "rows=" + rows.length);

    var ranks = [];
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].classList.contains("is-repeat")) ranks.push(cellText(rows[i], 0));
    }
    rec("4. distinct rows are numbered 1 to 10",
      ranks.join(",") === "1,2,3,4,5,6,7,8,9,10", "ranks=" + ranks.join(","));

    var last = rows[rows.length - 1];
    rec("5. the repeat row is greyed and its rank cell is empty",
      last.classList.contains("is-repeat") && cellText(last, 0) === "" &&
        cellText(last, 1) === "Bat",
      "class=" + last.className + " rank='" + cellText(last, 0) + "'");

    var xssCell = null;
    for (var j = 0; j < rows.length; j++) {
      if (cellText(rows[j], 1).indexOf("<img") === 0) xssCell = rows[j].cells[1];
    }
    rec("6. a nickname containing markup stays literal text",
      xssCell !== null && xssCell.textContent === "<img src=x onerror=alert(1)>" &&
        xssCell.querySelector("img") === null,
      xssCell ? "cell='" + xssCell.textContent + "' imgs=" + xssCell.querySelectorAll("img").length
              : "no markup nickname rendered");

    var allLabelled = true;
    d.querySelectorAll("#lb-body td").forEach(function (td) {
      if (!td.getAttribute("data-label")) allLabelled = false;
    });
    rec("7. every cell carries a non-empty data-label", allLabelled, "allLabelled=" + allLabelled);

    // Fixture row 0 is Bat: score 100, correct 8 - (0 % 4) = 8, bonus 0 % 3 = 0,
    // elapsed 60000ms. The timestamp is compared against GameLogic rather than a
    // literal, because toLocaleString() depends on the machine's locale — the
    // point of the check is that the right field lands in the right column.
    var first = rows[0];
    rec("8. score, correct, bonus, time and finished land in the right columns",
      cellText(first, 2) === "100" && cellText(first, 3) === "8" &&
        cellText(first, 4) === "0" && cellText(first, 5) === "1m 00s" &&
        cellText(first, 6) === win.GameLogic.formatTimestamp("2026-10-13T12:00:00.000Z"),
      "score='" + cellText(first, 2) + "' correct='" + cellText(first, 3) +
        "' bonus='" + cellText(first, 4) + "' time='" + cellText(first, 5) +
        "' finished='" + cellText(first, 6) + "'");

    // A board re-renders with no catch around it, so a malformed row must coerce
    // rather than throw. elapsed_ms 0 formats to "0s", a bad timestamp to "".
    win.Leaderboard.render(d, { state: "ready", status: "Updated 18:42:27", rows: [{
      nickname: "Bad", total_score: "x", correct_count: null,
      bonuses_matched: undefined, elapsed_ms: "zzz",
      finished_at: "not a date", repeat: false
    }] });
    var bad = d.querySelectorAll("#lb-body tr")[0];
    rec("9. malformed numbers and a bad timestamp coerce instead of throwing",
      bad.cells[2].textContent === "0" && bad.cells[3].textContent === "0" &&
        bad.cells[4].textContent === "0" && bad.cells[5].textContent === "0s" &&
        bad.cells[6].textContent === "",
      "score='" + bad.cells[2].textContent + "' correct='" + bad.cells[3].textContent +
        "' bonus='" + bad.cells[4].textContent + "' time='" + bad.cells[5].textContent +
        "' finished='" + bad.cells[6].textContent + "'");

    win.Leaderboard.render(d, { state: "loading", status: "Loading…" });
    rec("10. the loading state shows three skeleton rows and no message",
      d.querySelectorAll("#lb-body tr.is-skeleton").length === 3 &&
        $(f, "lb-table").hidden === false && $(f, "lb-message").hidden === true,
      "skeletons=" + d.querySelectorAll("#lb-body tr.is-skeleton").length +
        " tableHidden=" + $(f, "lb-table").hidden);

    win.Leaderboard.render(d, { state: "empty", status: "Updated 18:42:17",
      message: "No results yet — finish a contest and your score appears here.",
      link: { href: "index.html", text: "Play now" } });
    var msg = $(f, "lb-message"), link = msg.querySelector("a");
    rec("11. the empty state says so and links to the game",
      $(f, "lb-table").hidden === true &&
        msg.textContent.indexOf("No results yet") === 0 && link !== null &&
        link.textContent === "Play now" && link.getAttribute("href") === "index.html",
      "tableHidden=" + $(f, "lb-table").hidden + " msg='" + msg.textContent + "'");

    win.Leaderboard.render(d, { state: "error", rows: ranked(), status: "Couldn't load — retrying" });
    rec("12. an error keeps the rows already on screen",
      d.querySelectorAll("#lb-body tr").length === 11 &&
        $(f, "lb-status").className.indexOf("is-error") !== -1,
      "rows=" + d.querySelectorAll("#lb-body tr").length +
        " class=" + $(f, "lb-status").className);

    /* --- 13: the same render inside a genuine 360px viewport --- */
    await load(narrow);
    var nd = D(narrow), nwin = W(narrow);
    nwin.Leaderboard.render(nd, { state: "ready", rows: nwin.Leaderboard.rankRows(rawRows(), 10),
                                  status: "Updated 18:42:07" });
    rec("13. seven columns reflow inside 360px without horizontal scroll",
      nd.documentElement.scrollWidth <= nd.documentElement.clientWidth &&
        nd.documentElement.clientWidth === 360,
      "scrollWidth=" + nd.documentElement.scrollWidth +
        " clientWidth=" + nd.documentElement.clientWidth);

    finish();
  }

  function finish() {
    var failed = results.filter(function (r) { return !r.ok; });
    document.getElementById("report").textContent = results.map(function (r) {
      return (r.ok ? "PASS  " : "FAIL  ") + r.name + (r.ok ? "" : "  [" + r.detail + "]");
    }).join("\n");
    var verdict = document.getElementById("verdict");
    verdict.textContent = (results.length - failed.length) + " passed, " + failed.length + " failed";
    verdict.className = failed.length ? "fail" : "pass";
    document.title = "stats checklist: " + verdict.textContent;
  }

  run().catch(function (e) {
    document.getElementById("verdict").textContent = "HARNESS ERROR " + e.message;
    document.getElementById("verdict").className = "fail";
    document.title = "stats checklist: HARNESS ERROR";
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 4: Run the harness to verify it fails**

Run: `python -m http.server 8777 --bind 127.0.0.1` from the project root (leave it running), then:

```
PROFILE=$(mktemp -d)
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --no-first-run --user-data-dir="$PROFILE" --dump-dom --virtual-time-budget=45000 \
  "http://127.0.0.1:8777/tests/stats-check.html?cb=$(date +%s)" | grep -o "stats checklist: [^<]*"
rm -rf "$PROFILE"
```

Expected: FAIL — `Leaderboard.render is not a function` (the harness errors before any assertion, since `render` does not exist yet).

- [ ] **Step 5: Implement `render` in `js/leaderboard.js`**

Add these functions inside the factory in `js/leaderboard.js`, and add `render` to the returned object. At the same time **delete the `_active`/`_setActive` placeholders and the `var activeLoad = null;` declaration from Task 2** — they are superseded by `render` here and by the real `reload` in Task 4.

```js
  function cell(doc, text, label, cls) {
    var td = doc.createElement("td");
    td.setAttribute("data-label", label);
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function num(v) { return Number(v) || 0; }

  function displayName(row) {
    if (!row) return "";
    return (typeof row.nickname === "string") ? row.nickname : String(row.nickname || "");
  }

  function writeRows(doc, body, rows) {
    body.textContent = "";
    var rank = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var isRepeat = row.repeat === true;
      if (!isRepeat) rank++;
      var tr = doc.createElement("tr");
      tr.className = "lb-row" + (isRepeat ? " is-repeat" : "");
      tr.appendChild(cell(doc, isRepeat ? "" : String(rank), "#", "lb-rank"));
      tr.appendChild(cell(doc, displayName(row), "Player", ""));
      tr.appendChild(cell(doc, String(num(row.total_score)), "Score", ""));
      tr.appendChild(cell(doc, String(num(row.correct_count)), "Correct", ""));
      tr.appendChild(cell(doc, String(num(row.bonuses_matched)), "Bonus", ""));
      tr.appendChild(cell(doc, GL.formatDuration(num(row.elapsed_ms)) || "", "Time", ""));
      tr.appendChild(cell(doc, GL.formatTimestamp(row.finished_at), "Finished", ""));
      body.appendChild(tr);
    }
  }

  function writeSkeleton(doc, body) {
    body.textContent = "";
    for (var i = 0; i < 3; i++) {
      var tr = doc.createElement("tr");
      tr.className = "lb-row is-skeleton";
      for (var c = 0; c < COLUMNS.length; c++) tr.appendChild(cell(doc, "", COLUMNS[c], ""));
      body.appendChild(tr);
    }
  }

  function writeMessage(doc, el, text, link) {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (text) el.appendChild(doc.createTextNode(text));
    if (link) {
      el.appendChild(doc.createTextNode(" "));
      var a = doc.createElement("a");
      a.setAttribute("href", link.href);
      a.appendChild(doc.createTextNode(link.text));
      el.appendChild(a);
    }
  }

  // The one writer for the whole page. Exactly one of the table and the
  // message is visible at a time, and a failed load never rewrites the tbody,
  // so old and new rows can never coexist.
  function render(doc, view) {
    if (!doc) return;
    var status = doc.getElementById("lb-status");
    var table = doc.getElementById("lb-table");
    var msg = doc.getElementById("lb-message");
    var body = doc.getElementById("lb-body");
    if (!status || !table || !msg || !body) return;

    var state = (view && view.state) ? view.state : "";
    status.textContent = (view && view.status) || "";
    status.className = "save-status" + (state === "error" ? " is-error" : "");

    var hasRows = body.childNodes.length > 0;
    var showTable = state === "loading" || state === "ready" || (state === "error" && hasRows);

    table.hidden = !showTable;
    msg.hidden = showTable;

    if (!showTable) {
      writeMessage(doc, msg, (view && view.message) || "", (view && view.link) || null);
      return;
    }
    if (state === "loading") writeSkeleton(doc, body);
    else if (state === "ready") writeRows(doc, body, (view && view.rows) || []);
    // state === "error" with rows already on screen: the tbody is left exactly
    // as it is. Nothing is appended, so a stale row can never sit beside a new
    // one, and a single dropped request never blanks a good leaderboard.
  }
```

The returned object becomes:

```js
  return {
    REFRESH_MS: REFRESH_MS,
    TOP_NAMES: TOP_NAMES,
    COLUMNS: COLUMNS,
    rankRows: rankRows,
    shouldPoll: shouldPoll,
    render: render
  };
```

- [ ] **Step 6: Run the harness to verify it passes**

Run: the headless command from Task 3 Step 4.
Expected: `stats checklist: 13 passed, 0 failed`.

- [ ] **Step 7: Verify the unit suite is untouched**

Run: `node tests/run-tests.js`
Expected: `92 passed, 0 failed` — Task 2's tests must not have moved.

- [ ] **Step 8: Check the page by eye at both widths**

```
PROFILE=$(mktemp -d)
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --no-first-run --user-data-dir="$PROFILE" --screenshot="$TEMP/stats-wide.png" \
  --window-size=900,900 --virtual-time-budget=45000 \
  "http://127.0.0.1:8777/stats.html?cb=$(date +%s)"
PROFILE2=$(mktemp -d)
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --no-first-run --user-data-dir="$PROFILE2" --screenshot="$TEMP/stats-narrow.png" \
  --window-size=360,900 --virtual-time-budget=45000 \
  "http://127.0.0.1:8777/stats.html?cb=$(date +%s)"
rm -rf "$PROFILE" "$PROFILE2"
```

Expected: an orange "Halloween Contest Leaderboard" title on the dark card, a visible `Back to the game` link, the Refresh button, an empty `#lb-board` (no rows until Task 4 boots the fetch) and the footnote. The page must not scroll sideways at either width. This is a visual check, not an assertion — read the PNGs.

- [ ] **Step 9: Commit**

```bash
git add stats.html css/style.css js/leaderboard.js tests/stats-check.html
git commit -m "Render the leaderboard page with a 360px-safe table"
```

---

### Task 4: Boot, states, polling and controls

**Files:**
- Modify: `js/leaderboard.js` (add `boot`, `reload`, `startPolling`, `stopPolling`)
- Modify: `stats.html` (add the boot script)
- Modify: `tests/stats-check.html` (stubbed fetch + assertions 14–21)

**Interfaces:**
- Consumes: `ResultsApi.isConfigured`, `ResultsApi.fetchResults` (Task 1); `Leaderboard.render`, `rankRows`, `shouldPoll`, `REFRESH_MS` (Tasks 2–3); markup ids from Task 3.
- Produces: `Leaderboard.reload() → Promise<outcome|null>`; `Leaderboard.startPolling(load, ms) → timerId`; `Leaderboard.stopPolling()`; `Leaderboard.boot(doc, api, config)`. The Refresh button, `visibilitychange` and every interval tick all funnel through `reload`, which is why the harness can drive the real pipeline by calling it.

- [ ] **Step 1: Extend the harness with a fetch stub**

In `tests/stats-check.html`, replace `buildPage` with a version that injects the stub into `<head>` ahead of `<base>`, and the config override into `</head>`:

```js
  // The stub is installed before any page script runs — app-check.html stubs
  // after `load`, which is too late for a page that fetches on boot. The
  // SUPABASE_CONFIG accessor lets a later assertion hand boot an unconfigured
  // config even though js/supabase-config.js has already assigned the real one.
  var STUB_BODY = [
    "window.__lbStub = { mode: 'rows', calls: [], cfg: null };",
    "var _realCfg = null;",
    "Object.defineProperty(window, 'SUPABASE_CONFIG', {",
    "  configurable: true,",
    "  get: function () { return window.__lbStub.cfg || _realCfg; },",
    "  set: function (v) { _realCfg = v; }",
    "});",
    "var NAMES = ['Bat','Cat','Dog','Rat','Owl','<img src=x onerror=alert(1)>','Crow','Fox','Wolf','Toad'];",
    "var FIXTURE = [];",
    "for (var i = 0; i < NAMES.length; i++) FIXTURE.push({",
    "  session_id: 's' + i, nickname: NAMES[i], total_score: 100 - i,",
    "  correct_count: 8 - (i % 4), bonuses_matched: i % 3,",
    "  elapsed_ms: 60000 + i * 1000,",
    "  finished_at: '2026-10-13T12:0' + (i % 10) + ':00.000Z',",
    "  created_at: '2026-10-13T13:00:00.000Z'",
    "});",
    "FIXTURE.push({ session_id: 's99', nickname: 'Bat', total_score: 5,",
    "  correct_count: 1, bonuses_matched: 0, elapsed_ms: 30000,",
    "  finished_at: '2026-10-13T14:00:00.000Z',",
    "  created_at: '2026-10-13T14:00:00.000Z' });",
    "window.fetch = function (url) {",
    "  window.__lbStub.calls.push(String(url));",
    "  var mode = window.__lbStub.mode;",
    "  if (mode === 'network') return Promise.reject(new TypeError('Failed to fetch'));",
    "  var done = { ok: true, status: 200,",
    "    json: function () { return Promise.resolve(mode === 'empty' ? [] : FIXTURE); } };",
    "  if (mode === 'slow') {",
    "    return new Promise(function (resolve) { setTimeout(function () { resolve(done); }, 400); });",
    "  }",
    "  return Promise.resolve(done);",
    "};"
  ].join("\n");

  function buildPage(opts) {
    var o = opts || {};
    var tail = "";
    if (o.cfg) {
      tail = "<script>window.__lbStub.cfg = " + JSON.stringify(o.cfg) + ";<\/script>";
    }
    return fetch("../stats.html?cb=" + Date.now())
      .then(function (r) { return r.text(); })
      .then(function (html) {
        return html
          .replace("<head>", "<head><base href=\"../\"><script>" + STUB_BODY + "<\/script>")
          .replace("</head>", tail + "</head>");
      });
  function load(frame, opts) {
    return buildPage(opts).then(function (html) {
      var done = new Promise(function (resolve) {
        frame.onload = function () { setTimeout(resolve, 150); };
      });
      frame.srcdoc = html;
      return done;
    });
  }
```

Task 3's `load(frame)` had no options; this version replaces it and is the one assertions 14–21 use, since assertion 20 has to hand boot an unconfigured config.

Note the two hazards this preserves from Task 3: `<base>` is still the **first** thing in `<head>` (ahead of the stylesheet link), and the whole injection stays far enough inside 1024 bytes that `<meta charset="UTF-8">` is still honoured.

Add a shared assertion helper used by the new steps:

```js
  function statusText() { return $(f, "lb-status").textContent; }
  function rowCount() { return D(f).querySelectorAll("#lb-body tr").length; }
  function calls() { return W(f).__lbStub.calls.length; }
```

- [ ] **Step 2: Write the failing assertions**

Insert this block into `run()` immediately before `finish()` (after the narrow-viewport assertion), so it becomes assertions 14–21:

```js
    /* --- 14..21: the real page, driven end to end --- */
    await load(f);
    var d2 = D(f), win2 = W(f);

    rec("14. boot fetches and renders on its own",
      rowCount() === 11 && statusText().indexOf("Updated ") === 0 &&
        $(f, "lb-table").hidden === false,
      "rows=" + rowCount() + " status='" + statusText() + "'");

    W(f).__lbStub.mode = "network";
    click($(f, "btn-lb-refresh"), win2);
    await wait(300);
    rec("15. a failed refresh keeps the rows and says so",
      rowCount() === 11 && statusText().indexOf("Couldn't load") === 0 &&
        $(f, "lb-status").className.indexOf("is-error") !== -1,
      "rows=" + rowCount() + " status='" + statusText() + "'");

    W(f).__lbStub.mode = "rows";
    click($(f, "btn-lb-refresh"), win2);
    await wait(300);
    rec("16. Refresh recovers to a fresh Updated stamp",
      rowCount() === 11 && statusText().indexOf("Updated ") === 0,
      "rows=" + rowCount() + " status='" + statusText() + "'");

    var before = calls();
    win2.Leaderboard.startPolling(win2.Leaderboard.reload, 100);
    await wait(450);
    win2.Leaderboard.stopPolling();
    var after = calls();
    rec("17. a short injected interval refreshes the board",
      after >= before + 2,
      "before=" + before + " after=" + after + " document.hidden=" + d2.hidden);

    // The stub holds every response for 400ms, so two reloads inside that
    // window must produce exactly one request — no overlap, no queue behind a
    // slow response.
    W(f).__lbStub.mode = "slow";
    var slowBefore = calls();
    var pending = win2.Leaderboard.reload();
    await wait(80);
    win2.Leaderboard.reload();
    await wait(80);
    var overlapped = calls();
    W(f).__lbStub.mode = "rows";
    await pending;
    await wait(600);
    rec("18. a load already in flight is never overlapped",
      overlapped === slowBefore + 1,
      "requests=" + (overlapped - slowBefore) + " during one slow window");

    var visBefore = calls();
    d2.dispatchEvent(new win2.Event("visibilitychange"));
    await wait(300);
    rec("19. returning to the tab loads immediately, not on the next tick",
      calls() === visBefore + 1 && statusText().indexOf("Updated ") === 0,
      "before=" + visBefore + " after=" + calls() + " document.hidden=" + d2.hidden);

    await load(f, { cfg: { url: "https://example.supabase.co", anonKey: "PASTE_YOUR_KEY_HERE" } });
    rec("20. an unconfigured deploy shows its message and hides the table",
      statusText() === "Not configured" && $(f, "lb-table").hidden === true &&
        $(f, "lb-message").hidden === false,
      "status='" + statusText() + "' tableHidden=" + $(f, "lb-table").hidden +
        " msgHidden=" + $(f, "lb-message").hidden);
    rec("21. an unconfigured deploy issues zero requests",
      calls() === 0, "calls=" + calls());
```

- [ ] **Step 3: Run the harness to verify it fails**

Run: `python -m http.server 8777 --bind 127.0.0.1` from the project root, then the headless command from Task 3 Step 4.
Expected: FAIL — `stats checklist: 13 passed, 8 failed`. Assertions 14–21 fail because `boot` does not exist yet; 1–13 must still pass.

- [ ] **Step 4: Implement boot, reload and polling**

In `js/leaderboard.js`, add `activeLoad`, `timerId` and the four functions beneath `render`, then add all four to the returned object:

```js
  var activeLoad = null;
  var timerId = null;

  // Runs one load and renders its outcome. Always resolves — fetchResults
  // already resolves, and render is wrapped here so a DOM surprise becomes a
  // failed load rather than a tick that stops polling for good.
  function loadWith(doc, api, config) {
    return api.fetchResults(config).then(function (res) {
      if (!res.ok) {
        // The previously rendered rows are left untouched; only the status
        // line changes. A leaderboard failure is transient, so polling keeps
        // running and Refresh still works.
        render(doc, { state: "error", status: "Couldn't load — retrying",
                      message: "Couldn't load the leaderboard — retrying." });
        return res;
      }
      var ranked = rankRows(res.rows, TOP_NAMES);
      render(doc, {
        state: ranked.length ? "ready" : "empty",
        rows: ranked,
        status: "Updated " + new Date().toLocaleTimeString(),
        message: "No results yet — finish a contest and your score appears here.",
        link: ranked.length ? null : { href: "index.html", text: "Play now" }
      });
      return res;
    }, function (e) {
      return { ok: false, kind: "failed", detail: (e && e.message) || "render error" };
    });
  }

  // The single entry point every trigger goes through: the Refresh button,
  // visibilitychange returning to visible, and each interval tick.
  function reload() {
    if (!activeLoad) return Promise.resolve(null);
    return activeLoad();
  }

  function startPolling(load, ms) {
    stopPolling();
    var every = (typeof ms === "number" && ms > 0) ? ms : REFRESH_MS;
    timerId = setInterval(function () {
      if (!shouldPoll(rootRef && rootRef.document)) return;
      load();
    }, every);
    return timerId;
  }

  function stopPolling() {
    if (timerId !== null && timerId !== undefined) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function boot(doc, api, config) {
    if (!doc || !api) return null;
    render(doc, { state: "loading", status: "Loading…" });

    // Unconfigured cannot change without a reload, so polling would only fire
    // a request that fails by definition every ten seconds.
    if (!api.isConfigured(config)) {
      render(doc, { state: "not-configured", status: "Not configured",
                    message: "The leaderboard is not configured yet." });
      return null;
    }

    var inFlight = false;
    activeLoad = function () {
      if (inFlight) return Promise.resolve(null);
      inFlight = true;
      return loadWith(doc, api, config).then(function (res) {
        inFlight = false;
        return res;
      });
    };

    var refresh = doc.getElementById("btn-lb-refresh");
    if (refresh && refresh.addEventListener) {
      refresh.addEventListener("click", function () { reload(); });
    }
    if (doc.addEventListener) {
      doc.addEventListener("visibilitychange", function () {
        if (doc.hidden) return;
        reload();
      });
    }

    reload();
    startPolling(reload, REFRESH_MS);
    return null;
  }
```

Two invariants this code is built around, both from the spec: **no tick ever overlaps a load in flight** (`inFlight` short-circuits), and **an unconfigured config stops polling permanently** (`stopPolling` on the `unconfigured` outcome, and `boot` returns before `startPolling`).

Add the four names to the returned object:

```js
  return {
    REFRESH_MS: REFRESH_MS,
    TOP_NAMES: TOP_NAMES,
    COLUMNS: COLUMNS,
    rankRows: rankRows,
    shouldPoll: shouldPoll,
    render: render,
    reload: reload,
    startPolling: startPolling,
    stopPolling: stopPolling,
    boot: boot
  };
```

- [ ] **Step 5: Boot the page**

In `stats.html`, add this immediately after the `js/leaderboard.js` script tag:

```html
<script>
  Leaderboard.boot(document, ResultsApi, window.SUPABASE_CONFIG);
</script>
```

- [ ] **Step 6: Run the harness to verify it passes**

Run: the headless command from Task 3 Step 4.
Expected: `stats checklist: 21 passed, 0 failed`.

If assertions 17 and 19 fail while the others pass, read their detail: `document.hidden=true` means headless reported the document hidden and `shouldPoll` correctly skipped the tick. Rerun with the page focused rather than weakening the assertion — a leaderboard that polls a hidden tab is exactly the behaviour §8.1 forbids.

- [ ] **Step 7: Verify every other runner**

Run from the project root, each with a **fresh** `--user-data-dir` and a `?cb=` cache-buster (a reused profile serves `js/*.js` from HTTP cache and can produce a false green):

| Command | Expected |
| --- | --- |
| `node tests/run-tests.js` | `92 passed, 0 failed`, exit code `0` |
| `tests/test.html` | `92 passed, 0 failed` |
| `tests/app-check.html` | `39 passed, 0 failed` |
| `tests/layout-check.html` | `37 passed, 0 failed` |
| `tests/boot-variants.html?variant=emptypool` | `6 passed, 0 failed` |
| `tests/boot-variants.html?variant=getitem` | `7 passed, 0 failed` |
| `.superpowers/sdd/halloween-contest/nostorage-index.html` | `<title>nostorage: PASS` |
| `tests/stats-check.html` | `21 passed, 0 failed` |

- [ ] **Step 8: Confirm the shipped page fetches the real endpoint shape**

Open `http://127.0.0.1:8777/stats.html?cb=$(date +%s)` in a browser with DevTools' network tab open, or check the browser console for an error.
Expected: one `GET /rest/v1/contest_results?select=…&order=total_score.desc,created_at.asc&limit=500` returning `200` with `[]`, the empty-state message and the `Play now` link, and no console errors. The table is empty in production, so an empty board is the correct result — not a bug.

- [ ] **Step 9: Commit**

```bash
git add js/leaderboard.js stats.html tests/stats-check.html
git commit -m "Boot the leaderboard, refresh it every ten seconds and survive failures"
```

---

### Task 5: Document the eighth runner and verify the whole branch

**Files:**
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: the verified verdicts from Task 4 Step 7.
- Produces: a README whose table matches what each runner actually prints.

- [ ] **Step 1: Re-confirm every verdict from a clean state**

Run all eight runners from Task 4 Step 7 one more time, each with a fresh profile and a fresh `?cb=`. Record the **actual** printed numbers.

Expected: `92 passed, 0 failed` for `node tests/run-tests.js` and `tests/test.html`, `21 passed, 0 failed` for `tests/stats-check.html`, and the six other verdicts unchanged from Task 4 Step 7.

If any number differs from this table, the number that goes into the README is the one the runner printed — never the one this plan predicts. A plan that guesses a verdict is worthless; a README that lies about one is worse.

- [ ] **Step 2: Update `tests/README.md`**

Change the opening line (line 3) from `Seven runners, one page each.` to `Eight runners, one page each.`

Change the two `test-suite` counts in the table (lines 9–10) from `73 passed, 0 failed` to the count recorded in Step 1.

Add this row immediately after the `layout-check.html` row (line 12):

```
| `tests/stats-check.html` | serve the folder, open `/tests/stats-check.html` | `21 passed, 0 failed` |
```

- [ ] **Step 3: Document what the new runner covers**

Add this bullet to the "What each one covers" section, immediately after the `layout-check.html` bullet:

```markdown
- **`stats-check.html`** — drives the real `stats.html` through an `srcdoc` iframe with `fetch`
  stubbed *before* any page script runs (`app-check.html` stubs after `load`, which is too late for
  a page that fetches on boot): ranks 1–10 over ten distinct names, a repeat row greyed beneath its
  own name with an empty rank cell, a `<img src=x onerror=…>` nickname landing as literal text with
  no element created, score/correct/bonus/time/finished each landing in their own column, malformed
  numbers and an unparseable timestamp coercing instead of throwing, the three-row loading
  skeleton, the empty state's copy and **Play now** link, an error that leaves the rendered rows
  untouched, boot fetching and rendering on its own, a failed refresh followed by a working recovery,
  a short injected refresh interval, a load in flight never being overlapped, `visibilitychange`
  loading immediately, an unconfigured config showing its message with zero requests, and the seven
  columns reflowed inside a genuine 360px iframe without horizontal scroll. It never contacts the
  live project — the stub also intercepts `SUPABASE_CONFIG`, so the not-configured path is reachable
  without editing `js/supabase-config.js`.
```

- [ ] **Step 4: Verify the README's claims match reality**

Read the new row and the new bullet against the verdict printed by `tests/stats-check.html` in Step 1.
Expected: the counts in the table equal the printed verdict, and every behaviour named in the bullet has an assertion in `tests/stats-check.html` (assertions 1–21).

- [ ] **Step 5: Commit**

```bash
git add tests/README.md
git commit -m "Document the stats checklist as the eighth runner"
```

- [ ] **Step 6: Confirm the working tree holds only what should stay uncommitted**

Run: `git status --short`
Expected: ` M .gitignore` and nothing else. The `.gitignore` change is deliberately left uncommitted and must never be staged.

- [ ] **Step 7: Do not push**

Leave every commit local. The published page at `https://alcebal2002.github.io/halloween-contest/stats.html` goes live the moment `main` reaches `origin`, so pushing is a separate, explicit decision.
