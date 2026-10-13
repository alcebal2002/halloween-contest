# Supabase Results Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push each finished Halloween Contest to a `public.contest_results` table in Supabase — one row per session id, never overwritable — with a visible status line and a retry for transient failures.

**Architecture:** A dependency-free `js/results-api.js` module maps finished game state to a row and POSTs it to PostgREST with Supabase's publishable key. `js/app.js` owns *when* to save and *what* the player sees, remembering the last stored session id in `localStorage` so a reload never raises a false duplicate error. Row-level security permits insert and select only, and the session id primary key turns a repeat submission into HTTP 409.

**Tech Stack:** Vanilla ES5-style JavaScript, no build step, no bundler, no runtime dependency. PostgREST over `fetch`. Tests run in both Node and the browser through the existing dual suite.

**Spec:** `docs/superpowers/specs/2026-10-13-supabase-results-design.md` — the plan argues from the spec; executors read both.

**Already done before this plan starts:** the table exists and has been verified to expose exactly the eight columns the spec names; `js/supabase-config.js` is committed with the publishable key; the anon `INSERT` policy has been proven to accept requests (a deliberately invalid payload returned a Postgres constraint error rather than a permission error).

## Global Constraints

- No build step, no bundler, no `package.json`, no npm install. (spec §1)
- No runtime third-party dependency: no CDN script, no Supabase client library. (spec §4, decision 5)
- Style: ES5 only — `var`, `function`, string concatenation. No arrow functions, template literals, `const`/`let`, or classes. Match `js/game-logic.js` and `js/app.js` exactly.
- Modules use the existing UMD guard shape (`module.exports` in Node, a single global in the browser).
- Every existing runner must stay green: `node tests/run-tests.js`, `tests/test.html`, `tests/app-check.html`, `tests/layout-check.html`, `tests/boot-variants.html?variant=emptypool`, `tests/boot-variants.html?variant=getitem`, and the generated `nostorage-index.html`.
- The publishable key is committed by design. No secret may be added anywhere, and the key must never be described as secret.
- Never send `Prefer: resolution=…`. A duplicate must surface as an error, never merge. (spec §7.2)
- Commit subjects are plain imperative sentences with no Conventional Commits prefix — for example `Save finished contests to Supabase results table`.
- **Test runs must never write to the real table.** Every harness that can reach the results screen disables the remote save first. The row count in `contest_results` is identical before and after all verification.
- The endpoint is `https://lyzuxvcsjavxhlovgeeu.supabase.co/rest/v1/contest_results`.

## Review Focus

Five things the spec implies but no single task's happy path exercises, most likely to bite first:

1. **A harness reaching the results screen would post real rows into the production table.** Expected: zero requests reach `supabase.co` during any test run. Pinned in Task 4 (app-check asserts the stub, never the network), Task 7 (layout-check asserts the status line is hidden because the key is blanked; the nostorage driver asserts the same).
2. **A reload of a finished run must not fire a second request.** Expected: when the marker matches the session id, `fetch` is called zero times and the line reads "Results already saved." Pinned in Task 6.
3. **A duplicate must permanently remove the retry button** — retrying a 409 can never succeed and only confuses the player. Expected: no retry button after a duplicate. Pinned in Task 5.
4. **`Play again` must arm a fresh save**, or the second run in a browser never uploads. Expected: a new session id produces a new request. Pinned in Task 6.
5. **A network failure must offer a retry that actually works**, and success after retry must write the marker so the reload path stays calm. Expected: button shown, second attempt saves, marker written. Pinned in Task 5.

---

### Task 1: The committed SQL script, `results-api.js` shell, `isConfigured`, `classifySaveError`

**Files:**
- Create: `sql/001-create-contest-results.sql`, `js/results-api.js`
- Modify: `tests/test-suite.js:1-9` (UMD guard), `tests/test.html:21` (script tag)
- Test: `tests/test-suite.js`

**Interfaces:**
- Produces: `ResultsApi.isConfigured(config) -> boolean`; `ResultsApi.classifySaveError(status, body) -> "duplicate" | "failed"`. Later tasks consume both.

- [ ] **Step 1: Write the committed SQL script**

Create `sql/001-create-contest-results.sql`:

```sql
-- Table for finished Halloween Contest results.
-- The owner runs this once in the Supabase SQL editor; it is committed so the
-- schema can be rebuilt identically from the repository alone.
--
-- Requirements it enforces:
--   * session_id is the primary key, so a repeated submission is rejected by the
--     database (Postgres 23505 -> HTTP 409) rather than overwriting anything.
--   * row-level security allows insert and select only. There is deliberately no
--     update and no delete policy, so no row can ever be changed through the API.

create table public.contest_results (
  session_id      text primary key,
  nickname        text not null check (char_length(nickname) between 1 and 24),
  total_score     integer not null check (total_score >= 0),
  correct_count   integer not null check (correct_count >= 0),
  bonuses_matched integer not null check (bonuses_matched >= 0),
  elapsed_ms      integer not null check (elapsed_ms >= 0),
  finished_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint bonuses_within_correctes check (bonuses_matched <= correct_count)
);

grant select, insert on public.contest_results to anon, authenticated;

alter table public.contest_results enable row level security;

create policy "anyone may submit a result"
  on public.contest_results for insert to anon, authenticated
  with check (true);

create policy "anyone may read results"
  on public.contest_results for select to anon, authenticated
  using (true);
```

- [ ] **Step 2: Do not run it**

The owner has already created this table, and it was verified to expose exactly these eight
columns. **Do not execute this script** — running it against an existing table raises an error,
and the goal is a reproducible record, not a migration. The SQL is documentation only.

- [ ] **Step 3: Add the `results-api.js` script tag to `tests/test.html`**

Immediately after the existing `game-logic.js` tag (line 21):

```html
  <script src="../js/results-api.js"></script>
```

- [ ] **Step 4: Teach `tests/test-suite.js` to load the new module**

Replace lines 1-9 with:

```js
(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var GL = isNode ? require("../js/game-logic.js") : root.GameLogic;
  var RA = isNode ? require("../js/results-api.js") : root.ResultsApi;
  var api = factory(GL, RA);
  if (isNode) module.exports = api;
  else root.TestSuite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL, RA) {
```

- [ ] **Step 5: Write the failing tests**

Append to `tests/test-suite.js`, before the closing `return { tests: tests, helpers: … }` block:

```js
  /* ---- Supabase results: configuration and error classification ---- */

  test("isConfigured accepts a real URL and publishable key", function () {
    assertEqual(RA.isConfigured({
      url: "https://lyzuxvcsjavxhlovgeeu.supabase.co",
      anonKey: "sb_publishable_1RuEXLVz36fvPQHs27DRQA_rmOFvNej"
    }), true, "a correctly shaped config must be accepted");
  });

  test("isConfigured rejects a blank key, a short key and a PASTE placeholder", function () {
    var url = "https://lyzuxvcsjavxhlovgeeu.supabase.co";
    assertEqual(RA.isConfigured({ url: url, anonKey: "" }), false, "blank key");
    assertEqual(RA.isConfigured({ url: url, anonKey: "sb_publishable_1" }), false, "too short");
    assertEqual(RA.isConfigured({ url: url, anonKey: "PASTE_YOUR_KEY_HERE" }), false, "placeholder");
  });

  test("isConfigured rejects a missing, non-https or malformed config", function () {
    assertEqual(RA.isConfigured(null), false, "null config");
    assertEqual(RA.isConfigured({}), false, "empty object");
    assertEqual(RA.isConfigured({ url: "http://example.com", anonKey: "x".repeat(40) }), false, "http");
    assertEqual(RA.isConfigured({ url: "not-a-url", anonKey: "x".repeat(40) }), false, "no scheme");
  });

  test("classifySaveError maps 409 and 23505 to duplicate", function () {
    assertEqual(RA.classifySaveError(409, null), "duplicate", "status 409");
    assertEqual(RA.classifySaveError(400, { code: "23505" }), "duplicate", "body code 23505");
  });

  test("classifySaveError maps every other outcome to failed", function () {
    assertEqual(RA.classifySaveError(500, null), "failed", "500");
    assertEqual(RA.classifySaveError(400, { code: "23514" }), "failed", "check violation");
    assertEqual(RA.classifySaveError(0, null), "failed", "no response at all");
  });
```

- [ ] **Step 6: Run the tests to confirm they fail**

```bash
node tests/run-tests.js
```

Expected: FAIL lines for all five new tests — `ResultsApi is not defined` or `Cannot read properties of undefined`.

- [ ] **Step 7: Write the module**

Create `js/results-api.js`:

```js
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ResultsApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_TIMEOUT_MS = 15000;
  var REST_PATH = "/rest/v1/contest_results";

  // True only when the config carries a real https endpoint and a key that is
  // neither empty nor the placeholder shipped in supabase-config.js.
  function isConfigured(config) {
    if (!config || typeof config.url !== "string" || typeof config.anonKey !== "string") return false;
    if (!/^https:\/\//.test(config.url)) return false;
    var key = config.anonKey.replace(/^\s+|\s+$/g, "");
    if (key.length < 20) return false;
    if (key.toUpperCase().indexOf("PASTE") !== -1) return false;
    return true;
  }

  // 409 is PostgREST's answer to a primary-key collision; 23505 is the Postgres
  // unique-violation code, checked too in case a proxy reshapes the status.
  function classifySaveError(status, body) {
    if (status === 409) return "duplicate";
    if (body && body.code === "23505") return "duplicate";
    return "failed";
  }

  return {
    isConfigured: isConfigured,
    classifySaveError: classifySaveError
  };
});
```

- [ ] **Step 8: Run the tests to confirm they pass**

```bash
node tests/run-tests.js
```

Expected: `61 passed, 0 failed` (the original 56 plus 5 new), exit code `0`.

- [ ] **Step 9: Commit**

```bash
git add sql/001-create-contest-results.sql js/results-api.js tests/test-suite.js tests/test.html
git commit -m "Add Supabase results module: config check and error classification"
```

---

### Task 2: `buildResultRow`

**Files:**
- Modify: `js/results-api.js`
- Test: `tests/test-suite.js`

**Interfaces:**
- Produces: `ResultsApi.buildResultRow(state) -> object | null`. The object has exactly the keys `session_id`, `nickname`, `total_score`, `correct_count`, `bonuses_matched`, `elapsed_ms`, `finished_at`. Task 4 posts it unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-suite.js`:

```js
  /* ---- Supabase results: row mapping ---- */

  function finishedState(overrides) {
    var base = {
      sessionId: "hc_abc-123",
      nickname: "Bat",
      score: 12,
      elapsedMs: 91234.6,
      finishedAt: "2026-10-13T12:00:00.000Z",
      answers: [
        { questionId: 1, selected: 0, correct: true,  points: 5 },
        { questionId: 2, selected: 1, correct: true,  points: 3 },
        { questionId: 3, selected: 2, correct: true,  points: 2 },
        { questionId: 4, selected: 0, correct: true,  points: 1 },
        { questionId: 5, selected: 1, correct: false, points: 0 }
      ]
    };
    if (overrides) {
      for (var k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) base[k] = overrides[k];
    }
    return base;
  }

  test("buildResultRow maps a finished state to the seven stored columns", function () {
    var row = RA.buildResultRow(finishedState());
    assertEqual(row.session_id, "hc_abc-123", "session_id");
    assertEqual(row.nickname, "Bat", "nickname");
    assertEqual(row.total_score, 12, "total_score");
    assertEqual(row.correct_count, 4, "correct_count counts every correct answer");
    assertEqual(row.bonuses_matched, 3, "bonuses_matched counts points > 1 only");
    assertEqual(row.elapsed_ms, 91235, "elapsed_ms is rounded to whole ms");
    assertEqual(row.finished_at, "2026-10-13T12:00:00.000Z", "finished_at passes through unchanged");
    assertEqual(Object.keys(row).length, 7, "no extra columns are invented");
  });

  test("buildResultRow backfills a missing points field the way game-logic does", function () {
    var row = RA.buildResultRow(finishedState({
      answers: [
        { questionId: 1, selected: 0, correct: true },
        { questionId: 2, selected: 1, correct: false }
      ]
    }));
    assertEqual(row.correct_count, 1, "correct_count");
    assertEqual(row.bonuses_matched, 0, "a correct answer without points is not a bonus");
  });

  test("buildResultRow never returns a negative elapsed time", function () {
    assertEqual(RA.buildResultRow(finishedState({ elapsedMs: -5 })).elapsed_ms, 0, "clamped at zero");
  });

  test("buildResultRow refuses a state that is not finished", function () {
    assertEqual(RA.buildResultRow(null), null, "null state");
    assertEqual(RA.buildResultRow(finishedState({ finishedAt: null })), null, "no finishedAt");
    assertEqual(RA.buildResultRow(finishedState({ answers: [] })), null, "no answers");
    assertEqual(RA.buildResultRow(finishedState({ sessionId: "" })), null, "no session id");
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
node tests/run-tests.js
```

Expected: four new FAIL lines — `RA.buildResultRow is not a function`.

- [ ] **Step 3: Write the implementation**

In `js/results-api.js`, add above the `return` block:

```js
  // Points are 5/3/2 for a matched bonus, 1 for a correct answer whose bonus was
  // missed, and 0 for a wrong answer — so anything above 1 is a won bonus.
  function pointsOf(answer) {
    if (typeof answer.points === "number") return answer.points;
    return answer.correct ? 1 : 0;
  }

  // Maps a finished contest to the row stored in contest_results. Returns null
  // for anything that is not a genuinely finished run, so the caller can skip
  // the request rather than send incomplete data.
  function buildResultRow(state) {
    if (!state || typeof state.sessionId !== "string" || state.sessionId === "") return null;
    if (!state.finishedAt || !Array.isArray(state.answers) || state.answers.length === 0) return null;

    var correct = 0;
    var bonuses = 0;
    state.answers.forEach(function (a) {
      if (!a) return;
      if (a.correct) correct++;
      if (pointsOf(a) > 1) bonuses++;
    });

    return {
      session_id: state.sessionId,
      nickname: String(state.nickname || ""),
      total_score: Number(state.score) || 0,
      correct_count: correct,
      bonuses_matched: bonuses,
      elapsed_ms: Math.max(0, Math.round(Number(state.elapsedMs) || 0)),
      finished_at: state.finishedAt
    };
  }
```

Add `buildResultRow: buildResultRow,` to the returned object.

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
node tests/run-tests.js
```

Expected: `65 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add js/results-api.js tests/test-suite.js
git commit -m "Map finished game state to a Supabase results row"
```

---

### Task 3: `saveResult`

**Files:**
- Modify: `js/results-api.js`
- Test: `tests/test-suite.js`

**Interfaces:**
- Consumes: `isConfigured`, `classifySaveError`, `buildResultRow`.
- Produces: `ResultsApi.saveResult(config, row, fetchImpl?, timeoutMs?) -> Promise<{ok: boolean, kind: "saved"|"duplicate"|"failed", detail?: string}>`. It **always resolves**. `fetchImpl` is optional and defaults to the ambient `fetch`, looked up at call time so browser tests can stub `window.fetch`. Task 4 calls it with only two arguments.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-suite.js`:

```js
  /* ---- Supabase results: the request ---- */

  function saveConfig() {
    return { url: "https://lyzuxvcsjavxhlovgeeu.supabase.co", anonKey: "sb_publishable_test_key_for_unit_tests" };
  }
  function saveRow() {
    return {
      session_id: "hc_abc-123", nickname: "Bat", total_score: 12,
      correct_count: 4, bonuses_matched: 3, elapsed_ms: 91235,
      finished_at: "2026-10-13T12:00:00.000Z"
    };
  }
  function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } };
  }

  test("saveResult posts the row with the publishable key and no upsert header", function () {
    var seen = {};
    var fetchImpl = function (url, opts) {
      seen.url = url; seen.opts = opts;
      return Promise.resolve(jsonResponse(201, {}));
    };
    return RA.saveResult(saveConfig(), saveRow(), fetchImpl).then(function (res) {
      assertEqual(res.ok, true, "a 201 is a save");
      assertEqual(res.kind, "saved", "kind");
      assertEqual(seen.url, "https://lyzuxvcsjavxhlovgeeu.supabase.co/rest/v1/contest_results", "endpoint");
      assertEqual(seen.opts.method, "POST", "method");
      assertEqual(seen.opts.headers["apikey"], saveConfig().anonKey, "apikey header");
      assertEqual(seen.opts.headers["Authorization"], "Bearer " + saveConfig().anonKey, "bearer header");
      assertEqual(seen.opts.headers["Prefer"], "return=minimal", "minimal representation");
      assertEqual(JSON.parse(seen.opts.body).session_id, "hc_abc-123", "body carries the row");
      var upsertHeader = Object.keys(seen.opts.headers).filter(function (h) {
        return /resolution/i.test(h) || /merge/i.test(seen.opts.headers[h]);
      });
      assertEqual(upsertHeader.length, 0, "an upsert header must never be sent");
    });
  });

  test("saveResult resolves duplicate on a 409 carrying 23505", function () {
    var fetchImpl = function () {
      return Promise.resolve(jsonResponse(409, {
        code: "23505",
        message: "duplicate key value violates unique constraint \"contest_results_pkey\"",
        details: "Key (session_id)=(hc_abc-123) already exists.", hint: null
      }));
    };
    return RA.saveResult(saveConfig(), saveRow(), fetchImpl).then(function (res) {
      assertEqual(res.ok, false, "a duplicate is not a save");
      assertEqual(res.kind, "duplicate", "kind");
    });
  });

  test("saveResult resolves failed when fetch rejects", function () {
    var fetchImpl = function () { return Promise.reject(new TypeError("Failed to fetch")); };
    return RA.saveResult(saveConfig(), saveRow(), fetchImpl).then(function (res) {
      assertEqual(res.ok, false, "a rejected request is not a save");
      assertEqual(res.kind, "failed", "kind");
      assert(res.detail.length > 0, "the detail should say what happened");
    });
  });

  test("saveResult resolves failed on a 500 even when the body cannot be parsed", function () {
    var fetchImpl = function () {
      return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.reject(new Error("bad json")); } });
    };
    return RA.saveResult(saveConfig(), saveRow(), fetchImpl).then(function (res) {
      assertEqual(res.kind, "failed", "kind");
    });
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
node tests/run-tests.js
```

Expected: the suite fails — `RA.saveResult is not a function`. Note these tests return promises, so also confirm `tests/run-tests.js` is extended (Step 3) before trusting a green run.

- [ ] **Step 3: Make `tests/run-tests.js` await promise-returning tests**

Replace `tests/run-tests.js` with:

```js
"use strict";
var suite = require("./test-suite.js");
var failed = 0;

function runOne(t) {
  return Promise.resolve().then(function () { return t.fn(); }).then(function () {
    console.log("PASS  " + t.name);
  }, function (e) {
    failed++;
    console.log("FAIL  " + t.name + " - " + (e && e.message ? e.message : e));
  });
}

suite.tests.reduce(function (chain, t) {
  return chain.then(function () { return runOne(t); });
}, Promise.resolve()).then(function () {
  console.log("");
  console.log(suite.tests.length - failed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
});
```

Tests now run sequentially and each may return a promise. Confirm the existing 65 tests still pass before proceeding.

- [ ] **Step 4: Write the implementation**

In `js/results-api.js`, add above the `return` block:

```js
  // Always resolves — never rejects — so the caller can render the outcome
  // without a catch. The ambient fetch is looked up at call time, which is what
  // lets the browser harness stub window.fetch.
  function saveResult(config, row, fetchImpl, timeoutMs) {
    var doFetch = fetchImpl;
    if (!doFetch) {
      if (typeof fetch === "undefined") {
        return Promise.resolve({ ok: false, kind: "failed", detail: "no fetch available" });
      }
      doFetch = function () { return fetch.apply(null, arguments); };
    }

    var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeout) : null;
    var endpoint = String(config.url).replace(/\/+$/, "") + REST_PATH;

    return Promise.resolve()
      .then(function () {
        return doFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.anonKey,
            "Authorization": "Bearer " + config.anonKey,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(row),
          signal: controller ? controller.signal : undefined
        });
      })
      .then(function (res) {
        if (res && res.ok) return { ok: true, kind: "saved" };
        var status = res ? res.status : 0;
        var body = (res && typeof res.json === "function")
          ? res.json().catch(function () { return null; })
          : Promise.resolve(null);
        return body.then(function (b) {
          return { ok: false, kind: classifySaveError(status, b), detail: (b && b.message) || "" };
        });
      })
      .catch(function (e) {
        return { ok: false, kind: "failed", detail: (e && e.message) ? e.message : "network error" };
      })
      .then(function (outcome) {
        if (timer) clearTimeout(timer);
        return outcome;
      });
  }
```

Add `saveResult: saveResult,` to the returned object.

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
node tests/run-tests.js
```

Expected: `69 passed, 0 failed`, exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add js/results-api.js tests/test-suite.js tests/run-tests.js
git commit -m "Post results to Supabase with duplicate detection and a safe timeout"
```

---

### Task 4: Results-screen markup, CSS, and the happy-path save

**Files:**
- Modify: `index.html` (two new elements), `css/style.css`, `js/app.js`
- Modify: `tests/app-check.html`

**Interfaces:**
- Consumes: `ResultsApi.isConfigured`, `buildResultRow`, `saveResult` (Task 3).
- Produces: the status line `#results-save` and retry button `#btn-results-retry`; `maybeSaveResults()` called from the results branch of `render()`; `cloudSave` state with values `idle | saving | saved | already | duplicate | failed`.

- [ ] **Step 1: Add the markup to `index.html`**

Inside `#screen-results`, between the `#results-review` list and the `btn-play-again` button:

```html
    <p id="results-save" class="save-status" aria-live="polite" hidden></p>
    <button id="btn-results-retry" class="btn btn-ghost" type="button" hidden>Retry save</button>
```

- [ ] **Step 2: Add the styles**

Append to `css/style.css`, near the `.field-note` rule:

```css
.save-status { color: var(--muted); font-size: 14px; text-align: center; margin: 16px 0 8px; }
.save-status.is-saved { color: #86efac; }
.save-status.is-duplicate { color: var(--orange); }
.save-status.is-error { color: #fca5a5; }
#btn-results-retry { margin-bottom: 10px; }
```

- [ ] **Step 3: Install the fetch stub in `tests/app-check.html`**

Add after the existing `function reload()` (line 40-45), and change the `f.onload` line inside `reload()` to call it:

```js
  // The harness must never reach the real Supabase project: every save is
  // answered from here. Set saveStub.mode to drive a different outcome.
  var saveStub = { mode: "success", calls: [] };
  function installSaveStub() {
    saveStub.calls = [];
    W().fetch = function (url, opts) {
      saveStub.calls.push({ url: String(url), opts: opts });
      if (saveStub.mode === "duplicate") {
        return Promise.resolve({
          ok: false, status: 409,
          json: function () {
            return Promise.resolve({
              code: "23505",
              message: "duplicate key value violates unique constraint \"contest_results_pkey\"",
              details: null, hint: null
            });
          }
        });
      }
      if (saveStub.mode === "network") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({}); } });
    };
  }
```

```js
  function reload() {
    return new Promise(function (resolve) {
      f.onload = function () { installSaveStub(); setTimeout(resolve, 150); };
      f.src = "../index.html?cb=" + Date.now();
    });
  }
```

Add an async step helper next to the existing `step` function (line 65):

```js
  async function astep(name, fn) {
    try { await fn(); } catch (e) { rec(name, false, "threw: " + e.message); }
  }
```

- [ ] **Step 4: Write the failing happy-path step**

Insert immediately before the verdict block (the line `var failed = results.filter(function (r) { return !r.ok; });`):

```js
    /* ---- Supabase save ---- */

    await astep("s1. finishing saves the result and reports it on the results screen", async function () {
      saveStub.mode = "success";
      await reload();
      for (var i = 0; i < 10 && app().getView() !== "results"; i++) answerWrong();
      await wait(120);
      var line = $("results-save");
      var retry = $("btn-results-retry");
      var call = saveStub.calls[0];
      rec("s1. finishing saves the result and reports it on the results screen",
        app().getView() === "results" &&
          !line.hidden && line.textContent === "Results saved." &&
          retry.hidden &&
          saveStub.calls.length === 1 &&
          call.url.indexOf("/rest/v1/contest_results") !== -1 &&
          call.opts.headers["apikey"].indexOf("sb_") === 0,
        "text='" + line.textContent + "' retryHidden=" + retry.hidden +
          " calls=" + saveStub.calls.length + " url=" + (call ? call.url : "none"));
    });
```

- [ ] **Step 5: Run the test to confirm it fails**

```bash
python -m http.server 8777 --bind 127.0.0.1
```

Then, in a second terminal:

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --no-first-run --user-data-dir="C:/Users/AOCS/AppData/Local/Temp/opencode/edge-profile" --dump-dom --virtual-time-budget=30000 "http://127.0.0.1:8777/tests/app-check.html" 2>/dev/null | grep -oE "<title>[^<]*</title>|FAIL  [^<]*"
```

Expected: `FAIL  s1. finishing saves the result and reports it on the results screen`, title `app checklist: … 1 failed`.

- [ ] **Step 6: Implement the save in `js/app.js`**

Add the module-level variable next to the existing ones (after `var bonusFlash = null;`):

```js
  var cloudSave = "idle";        // idle | saving | saved | already | duplicate | failed
  var SAVE_MARKER_KEY = "halloweenContest.saved.v1";
  var SAVE_TEXT = {
    saving: "Saving your results…",
    saved: "Results saved.",
    already: "Results already saved.",
    duplicate: "This session's results are already stored.",
    failed: "Couldn't save your results."
  };
```

Add the element references to the `el` object in `boot()`:

```js
      rReview: $("results-review"),
      saveStatus: $("results-save"),
      saveRetry: $("btn-results-retry"),
```

Wire the retry button in `wire()`:

```js
    el.saveRetry.addEventListener("click", onSaveRetry);
```

Add these functions above `render()`:

```js
  function storedSessionId() {
    try { return (storage && storage.getItem(SAVE_MARKER_KEY)) || null; } catch (e) { return null; }
  }

  function markStored(sessionId) {
    try { if (storage) storage.setItem(SAVE_MARKER_KEY, sessionId); } catch (e) { /* ignore */ }
  }

  function renderSaveStatus() {
    var text = SAVE_TEXT[cloudSave];
    el.saveStatus.hidden = !text;
    el.saveStatus.textContent = text || "";
    el.saveStatus.className = "save-status" +
      ((cloudSave === "saved" || cloudSave === "already") ? " is-saved" : "") +
      (cloudSave === "duplicate" ? " is-duplicate" : "") +
      (cloudSave === "failed" ? " is-error" : "");
    el.saveRetry.hidden = cloudSave !== "failed";
  }

  // Runs once per session, when the results screen first renders.
  function maybeSaveResults() {
    if (cloudSave !== "idle") return;
    var config = (typeof window !== "undefined" && window.SUPABASE_CONFIG) || null;
    if (!ResultsApi.isConfigured(config)) { renderSaveStatus(); return; }
    if (storedSessionId() === state.sessionId) { cloudSave = "already"; renderSaveStatus(); return; }
    var row = ResultsApi.buildResultRow(state);
    if (!row) { renderSaveStatus(); return; }
    cloudSave = "saving";
    renderSaveStatus();
    ResultsApi.saveResult(config, row).then(function (res) {
      if (res.ok) { cloudSave = "saved"; markStored(state.sessionId); }
      else if (res.kind === "duplicate") { cloudSave = "duplicate"; }
      else { cloudSave = "failed"; }
      renderSaveStatus();
    });
  }

  function onSaveRetry() {
    if (cloudSave !== "failed") return;
    cloudSave = "idle";
    maybeSaveResults();
  }
```

Call it from the results branch of `render()`, immediately before `$("screen-results").hidden = false;`:

```js
      maybeSaveResults();
      $("screen-results").hidden = false;
```

Add `cloudSave = "idle";` to both `onStart()` and `onStartOver()`, next to the existing `bonusSelection = [];` line, so a fresh run arms its own save.

Add the two script tags to `index.html` before the `app.js` tag (line 144):

```html
<script src="js/supabase-config.js"></script>
<script src="js/results-api.js"></script>
```

- [ ] **Step 7: Run the test to confirm it passes**

Re-run the headless command from Step 5.

Expected: `32 passed, 0 failed` (31 existing plus the new s1).

- [ ] **Step 8: Commit**

```bash
git add index.html css/style.css js/app.js tests/app-check.html
git commit -m "Save finished contests to the Supabase results table"
```

---

### Task 5: Failure paths — duplicate, network error, and retry

**Files:**
- Modify: `tests/app-check.html`
- Modify: none in `js/app.js` (Task 4 already implemented every branch); this task proves them.

**Interfaces:**
- Consumes: `saveStub.mode` and `saveStub.calls` (Task 4), `astep`, `answerWrong`.

- [ ] **Step 1: Write the failing steps**

Insert after the s1 step:

```js
    await astep("s2. a duplicate submission reports it and offers no retry", async function () {
      saveStub.mode = "duplicate";
      await reload();
      for (var i = 0; i < 10 && app().getView() !== "results"; i++) answerWrong();
      await wait(120);
      var line = $("results-save");
      var retry = $("btn-results-retry");
      rec("s2. a duplicate submission reports it and offers no retry",
        !line.hidden &&
          line.textContent === "This session's results are already stored." &&
          retry.hidden &&
          saveStub.calls.length === 1,
        "text='" + line.textContent + "' retryHidden=" + retry.hidden + " calls=" + saveStub.calls.length);
    });

    await astep("s3. a network failure offers a retry that succeeds on the second attempt", async function () {
      saveStub.mode = "network";
      await reload();
      for (var i = 0; i < 10 && app().getView() !== "results"; i++) answerWrong();
      await wait(120);
      var line = $("results-save");
      var retry = $("btn-results-retry");
      var failedSeen = !line.hidden && line.textContent === "Couldn't save your results." && !retry.hidden;
      saveStub.mode = "success";
      click(retry);
      await wait(120);
      rec("s3. a network failure offers a retry that succeeds on the second attempt",
        failedSeen &&
          line.textContent === "Results saved." &&
          retry.hidden &&
          saveStub.calls.length === 2,
        "failedSeen=" + failedSeen + " text='" + line.textContent + "' calls=" + saveStub.calls.length);
    });
```

- [ ] **Step 2: Run the tests to confirm they pass**

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --no-first-run --user-data-dir="C:/Users/AOCS/AppData/Local/Temp/opencode/edge-profile" --dump-dom --virtual-time-budget=30000 "http://127.0.0.1:8777/tests/app-check.html" 2>/dev/null | grep -oE "<title>[^<]*</title>|FAIL  [^<]*"
```

Expected: `34 passed, 0 failed`. If s3 fails on the retry click, the bug is in `onSaveRetry` — check that it resets `cloudSave` to `idle` before calling `maybeSaveResults()`.

- [ ] **Step 3: Commit**

```bash
git add tests/app-check.html
git commit -m "Cover duplicate and network failures on the results save"
```

---

### Task 6: Reload of a finished run, and `Play again` arming a new save

**Files:**
- Modify: `tests/app-check.html`
- Modify: `docs/superpowers/specs/2026-10-13-supabase-results-design.md` (§8 table)

**Interfaces:**
- Consumes: `storedSessionId`/`markStored` (Task 4), `saveStub`.

- [ ] **Step 1: Write the failing steps**

Insert after the s3 step:

```js
    await astep("s4. reloading a finished run shows 'already saved' and sends nothing", async function () {
      saveStub.mode = "success";
      await reload();
      for (var i = 0; i < 10 && app().getView() !== "results"; i++) answerWrong();
      await wait(120);
      var firstRunCalls = saveStub.calls.length;
      await reload();
      click($("btn-continue"));
      await wait(150);
      var line = $("results-save");
      rec("s4. reloading a finished run shows 'already saved' and sends nothing",
        app().getView() === "results" &&
          !line.hidden && line.textContent === "Results already saved." &&
          saveStub.calls.length === firstRunCalls,
        "text='" + line.textContent + "' calls=" + saveStub.calls.length + " firstRun=" + firstRunCalls);
    });

    await astep("s5. Play again arms a fresh save for the new session id", async function () {
      saveStub.mode = "success";
      await reload();
      click($("btn-continue"));
      await wait(80);
      var before = saveStub.calls.length;
      click($("btn-play-again"));
      await wait(80);
      for (var i = 0; i < 10 && app().getView() !== "results"; i++) answerWrong();
      await wait(120);
      var line = $("results-save");
      rec("s5. Play again arms a fresh save for the new session id",
        app().getView() === "results" &&
          line.textContent === "Results saved." &&
          saveStub.calls.length === before + 1,
        "text='" + line.textContent + "' calls=" + saveStub.calls.length + " before=" + before);
    });
```

- [ ] **Step 2: Run the tests to confirm they pass**

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --no-first-run --user-data-dir="C:/Users/AOCS/AppData/Local/Temp/opencode/edge-profile" --dump-dom --virtual-time-budget=30000 "http://127.0.0.1:8777/tests/app-check.html" 2>/dev/null | grep -oE "<title>[^<]*</title>|FAIL  [^<]*"
```

Expected: `36 passed, 0 failed`.

- [ ] **Step 3: Align the spec's state table with the implemented `already` state**

In `docs/superpowers/specs/2026-10-13-supabase-results-design.md`, §8, add a row to the `cloudSave` table after `saved`:

```markdown
| `already` | The local marker matches this session — no request is made |
```

- [ ] **Step 4: Commit**

```bash
git add tests/app-check.html docs/superpowers/specs/2026-10-13-supabase-results-design.md
git commit -m "Cover the finished-run reload and Play again save paths"
```

---

### Task 7: Protect the remaining harnesses, update the docs, verify everything

**Files:**
- Modify: `tests/layout-check.html`, `tests/make-nostorage.js`, `tests/README.md`

**Interfaces:**
- Consumes: `ResultsApi.isConfigured` returning `false` for a blanked key (Task 1), so no request is made and the status line stays hidden.

- [ ] **Step 1: Disable the remote save in `tests/layout-check.html`**

Insert after `await wait(400);` (line 72), before `var d = D();`:

```js
      // Reaching the results screen must not post a real row: blank the key so
      // ResultsApi.isConfigured() refuses and the status line stays hidden.
      try { W().SUPABASE_CONFIG.anonKey = ""; } catch (e) { /* ignore */ }
```

Add to the results-screen section of that walkthrough, next to the existing results assertions:

```js
      rec("results: no save status is shown when Supabase is not configured",
        $("results-save").hidden && $("btn-results-retry").hidden,
        "saveStatusHidden=" + $("results-save").hidden);
```

- [ ] **Step 2: Blank the key in the generated nostorage copy**

In `tests/make-nostorage.js`, add to the `.replace()` chain (after the `title` replacement):

```js
  .replace(/anonKey:\s*"[^"]*"/, 'anonKey: ""')
```

Add a driver check. After the existing `out.push("hudVisible=…")` line, add:

```js
  out.push("saveStatusHidden=" + document.getElementById("results-save").hidden);
```

and append to the `checks` array:

```js
    out[10] === "saveStatusHidden=true"
```

- [ ] **Step 3: Regenerate the nostorage artifact**

```bash
node tests/make-nostorage.js
```

Expected: `wrote .superpowers/sdd/halloween-contest/nostorage-index.html`.

- [ ] **Step 4: Run every runner**

```bash
node tests/run-tests.js
```

Then serve and run each browser runner headless:

```bash
python -m http.server 8777 --bind 127.0.0.1
```

```bash
for t in test.html app-check.html layout-check.html "boot-variants.html?variant=emptypool" "boot-variants.html?variant=getitem"; do
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --no-first-run --user-data-dir="C:/Users/AOCS/AppData/Local/Temp/opencode/edge-profile" --dump-dom --virtual-time-budget=30000 "http://127.0.0.1:8777/tests/$t" 2>/dev/null | grep -oE "<title>[^<]*</title>"
done
```

Expected: every title reads `… 0 failed`, and `node tests/run-tests.js` reports `69 passed, 0 failed`.

- [ ] **Step 5: Confirm the harnesses wrote nothing to the real table**

```bash
curl -s "https://lyzuxvcsjavxhlovgeeu.supabase.co/rest/v1/contest_results?select=session_id" -H "apikey: sb_publishable_1RuEXLVz36fvPQHs27DRQA_rmOFvNej" -H "Authorization: Bearer sb_publishable_1RuEXLVz36fvPQHs27DRQA_rmOFvNej"
```

Expected: `[]`. If any row appears, a harness reached the live project — stop and fix it before continuing.

- [ ] **Step 6: Update `tests/README.md`**

Record the new verdict counts in the table at the top (`node tests/run-tests.js`, `test.html`, `app-check.html`) and extend the "What each one covers" bullet for `app-check.html` with:

```markdown
  the Supabase save on the results screen (happy path, duplicate rejection, network
  failure with a working retry, and the reload that sends nothing because the local
  marker already records the session),
```

Add `layout-check.html`'s new assertion to its bullet, and note that `nostorage-index.html` also asserts the save status stays hidden.

- [ ] **Step 7: Verify the real database contract end to end, then clean up**

This is the only step that touches the real table. It proves the primary key and the duplicate rule against the actual project, and it leaves one row behind that the dashboard must delete — the API has no delete policy by design.

```bash
node -e "
const url='https://lyzuxvcsjavxhlovgeeu.supabase.co/rest/v1/contest_results';
const key='sb_publishable_1RuEXLVz36fvPQHs27DRQA_rmOFvNej';
const row={session_id:'hc_smoke_test_delete_me',nickname:'SmokeTest',total_score:5,correct_count:1,bonuses_matched:1,elapsed_ms:1000,finished_at:'2026-10-13T12:00:00.000Z'};
const headers={'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+key,'Prefer':'return=minimal'};
const post=()=>fetch(url,{method:'POST',headers,body:JSON.stringify(row)});
post().then(r=>console.log('first insert:',r.status)).then(()=>
  post().then(async r2=>{const b=await r2.json().catch(()=>null);console.log('duplicate:',r2.status,JSON.stringify(b));}));
"
```

Expected: `first insert: 201` then `duplicate: 409 {"code":"23505",…}`.

- [ ] **Step 8: Ask the owner to delete the smoke row**

Report to the owner: the row `hc_smoke_test_delete_me` must be deleted from `contest_results` in the Supabase dashboard (**Table Editor** → row menu → Delete), because the API intentionally offers no delete path. Then confirm with the `select` curl from Step 5 that the table is empty again.

- [ ] **Step 9: Commit**

The regenerated `nostorage-index.html` lives under `.superpowers/`, which is gitignored — it is a
local artifact regenerated by `make-nostorage.js`, so it must **not** be added here.

```bash
git add tests/layout-check.html tests/make-nostorage.js tests/README.md
git commit -m "Keep test harnesses off the live results table and document the save coverage"
```
