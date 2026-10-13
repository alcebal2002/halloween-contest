# Halloween Contest — Leaderboard (`stats.html`) Design Spec

**Date:** 2026-10-13
**Status:** Approved design, pending spec review
**Location:** `ai-games/halloween-contest/`
**Depends on:** `docs/superpowers/specs/2026-10-06-halloween-contest-design.md`,
`docs/superpowers/specs/2026-10-13-supabase-results-design.md`

## 1. Purpose

Publish the finished results already stored in `public.contest_results` as a public leaderboard
page, so a player or an observer can see the standings without running a contest.

Success criteria:

- A page named `stats.html` with the title **Halloween Contest Leaderboard**.
- It refreshes itself every 10 seconds.
- It lists the **10 highest-scoring distinct nicknames**, best result first.
- Where one nickname holds several of the leading results, its best row is shown in the normal
  style and its other rows are greyed out directly beneath it, so no run is hidden and no player
  occupies two places in the standings.
- Every listed row carries total score, correct answers, bonus matched, elapsed time and finish
  time.
- No build step, no bundler, no runtime third-party dependency are introduced.

## 2. Decisions taken during design

| # | Question | Decision |
|---|---|---|
| 1 | Scope of the fetch | One windowed request: `order=total_score.desc,created_at.asc&limit=500`, ranked and de-duplicated **client-side** in a pure function. Nicknames are content-unvalidated, so filtering server-side with `nickname=in.(…)` would require escaping attacker-shaped strings into PostgREST's filter grammar — a hazard avoided entirely by not sending nicknames back to the server. |
| 2 | What a nickname's rank is | Its **first appearance** in the score-descending stream is its best row; that same ordering is the tie-break for equal scores. Names are grouped in arrival order and the first 10 distinct ones are taken. |
| 3 | Repeats of a top-10 name | **Every** such row is shown, greyed, directly after its own best row. The list may therefore exceed 10 rows while never exceeding 10 distinct names. Rows belonging to names outside the top 10 are dropped. |
| 4 | "Elapsed timestamp" | It is a **duration**, not a point in time. Rendered with `GameLogic.formatDuration` — the same function the results screen already uses — so the leaderboard reads exactly as the player's own result did. |
| 5 | Finish time | `GameLogic.formatTimestamp`, likewise already used by the results screen. |
| 6 | Correct / Bonus display | Plain counts (`8`, `3`), **not** `8/10`. `QUESTIONS_PER_CONTEST` exists in `js/game-logic.js` but is absent from its export list, so `/10` would hard-code the total and start lying if `js/questions.js` ever changed length. |
| 7 | Failure UX | Unlike the results screen — where a duplicate permanently ends retry — a leaderboard failure is **transient**: the message shows, the manual Refresh works, and automatic polling keeps running. |
| 8 | Connection approach | Direct REST with `fetch`, reusing `js/results-api.js`. No Supabase client library, no CDN script. |
| 9 | Where the ranking lives | New module `js/leaderboard.js`, UMD/ES5, so the pure algorithm is exercisable from Node. |
| 10 | Mobile | One `<table>` reflowed by CSS below `560px`, not a second render path. |

## 3. Scope

**In scope:** `stats.html`, a new `js/leaderboard.js`, a `fetchResults` function added to
`js/results-api.js`, leaderboard styling in `css/style.css`, the script tags the page needs, and
tests.

**Out of scope:** authentication or accounts, pagination or infinite scroll, filtering and search,
sorting by any column other than score, showing rows outside the 500-row window, write operations
of any kind, modifying the game screens, and any build tooling.

## 4. Architecture

```
stats.html ──▶ js/supabase-config.js   (values only: url + anon key)
           ──▶ js/game-logic.js        (formatDuration, formatTimestamp)
           ──▶ js/results-api.js       (fetchResults — the HTTP call; no DOM)
           ──▶ js/leaderboard.js       (rankRows, render, polling)
```

`js/results-api.js` stays free of DOM knowledge, exactly as it is today. `js/leaderboard.js` owns
both the pure ranking function and the rendering, following the same UMD guard so Node receives
`rankRows` while the browser receives the whole namespace.

`js/game-logic.js` is included **only** for its two formatters. It performs no work at load time
and touches neither the DOM nor `localStorage` outside its `loadState`/`saveState` functions, so
loading it on a page that never plays a game is inert.

## 5. Request

```
GET {url}/rest/v1/contest_results
    ?select=session_id,nickname,total_score,correct_count,bonuses_matched,elapsed_ms,finished_at
    &order=total_score.desc,created_at.asc
    &limit=500
apikey: {anonKey}
Authorization: Bearer {anonKey}
```

`created_at` is used for ordering without being selected; PostgREST permits this. The `500` is a
named constant (`FETCH_LIMIT`), not a literal.

### 5.1 `fetchResults(config, fetchImpl, timeoutMs)`

Added to `js/results-api.js`. It **always resolves — never rejects, never throws** — mirroring
`saveResult`:

| Outcome | When |
|---|---|
| `{ ok: true, kind: "loaded", rows: [...] }` | `2xx` with a JSON array (which may be empty) |
| `{ ok: false, kind: "unconfigured" }` | `isConfigured(config)` is false — **no request is made** |
| `{ ok: false, kind: "failed", detail }` | non-`2xx`, a non-array body, a rejected `fetch`, or the deadline expiring |

It reuses `isConfigured`, the `AbortController` + `Promise.race` deadline, and
`DEFAULT_TIMEOUT_MS` (15000) already proven in `saveResult`. `fetchImpl` is looked up at call
time, which is what lets a harness inject a stub.

## 6. Ranking — `rankRows(rows, limit)`

Pure: no DOM, no clock, no globals. Input is the raw array from the server, already ordered
`total_score desc, created_at asc`.

1. Drop every row whose `nickname` is missing or empty after trimming. Otherwise all such rows
   would group into one phantom `""` player and claim a rank neither earned.
2. Walk the array in order, grouping rows by `nickname`, preserving arrival order within each
   group. The first row seen for a name is its best — the score-descending order does this for
   free, and `created_at asc` makes equal scores deterministic.
3. Take the groups in order of their best row's arrival, keep the first `limit` (10) groups.
4. Emit, for each kept group in rank order: its best row marked `repeat: false`, then its
   remaining rows marked `repeat: true`.

Rows outside the kept groups are discarded. The result is flat and ordered, so rendering is a
plain walk with no further grouping.

| Case | Result |
|---|---|
| Ten distinct names | ranks 1–10, no repeats |
| One name twice in the leading scores | its best row ranked, its second row greyed beneath it |
| Equal `total_score` | tie broken by arrival (`created_at asc`), so the earlier finish ranks higher |
| More than 10 distinct names | only the first 10 |
| Fewer than 10 distinct names | only those, **no filler rows** |
| Empty input | empty output |
| Empty/whitespace nickname | row dropped |
| A name ranked outside the top 10 | **all** of its rows dropped |
| A top-10 name with three repeats | four rows emitted for that one name |

## 7. Rendering

### 7.1 Columns

Seven headers, in order: `#`, `Player`, `Score`, `Correct`, `Bonus`, `Time`, `Finished`.

`Time` is `GameLogic.formatDuration(elapsed_ms)`; `Finished` is
`GameLogic.formatTimestamp(finished_at)`. Both already exist and are exported.

### 7.2 Rank and greyed repeats

The `#` column numbers **distinct names only**, `1`–`10`. A repeat row's rank cell is **empty** —
it is the same player's other run, not another place in the standings. Repeat rows carry the class
`is-repeat`, which greys them while leaving their Score / Correct / Bonus / Time / Finished fully
readable: the point of showing them is that the player's full leading history is visible.

### 7.3 Safety

**Every cell is written with `textContent`, never `innerHTML`.** `validateNickname` enforces only
non-empty and ≤ 24 code points, so a nickname may contain markup. This is the page's XSS boundary
and it is absolute; it matches the convention already used throughout `js/app.js`.

### 7.4 Malformed data

Every successful load rebuilds the board in one call with no `catch` wrapped around the render
itself, so no row may throw:

- `total_score`, `correct_count`, `bonuses_matched`, `elapsed_ms` → `Number(x) || 0`, the same
  coercion `buildResultRow` uses.
- A `finished_at` that `Date` cannot parse renders as an empty cell; `formatTimestamp` already
  returns `""` for that.
- `nickname` is stringified before grouping, and rows failing §6 rule 1 never reach rendering.

### 7.5 Mobile

Seven columns do not fit at 360px. Below `560px` the CSS drops `<thead>` and reflows each row to
two compact lines using `td::before { content: attr(data-label) }`, with each cell carrying a
`data-label` matching its column header. One DOM, one render path, no field ever hidden — which
matters because mobile is where the original icon problem was reported.

## 8. States and polling

The header carries the **Refresh button and status line permanently**; no state adds or removes
controls. `#lb-board` contains both the table and `#lb-message`, and exactly one of the two is
visible at a time:

- **Table visible, `#lb-message` hidden** — Loading, Ready, and Error with prior rows.
- **`#lb-message` visible, table hidden** — Empty, Not configured, and Error on first load.
  Showing a header row over an empty `<tbody>` would read as a broken table, so the empty state
  is a message, not an empty grid.

A Loading board renders the table with three rows carrying `is-skeleton` — seven empty `<td>`s
each — so the grid's shape is already on screen when the data lands. `#lb-message`'s text is set
per state; in the Empty state it additionally contains the **Play now** anchor.

| State | `#lb-board` | `#lb-status` | Polling |
|---|---|---|---|
| Loading (first load) | three skeleton rows | `Loading…` | — |
| Ready | ranked rows | `Updated 18:42:07` | every 10s |
| Empty | empty message | `Updated 18:42:07` | every 10s |
| Not configured | not-configured message | `Not configured` | **stopped permanently** |
| Error with prior rows | **previous rows kept** | `Couldn't load — retrying` | keeps running |
| Error on first load | error message | `Couldn't load — retrying` | keeps running |

- **Error keeps the previous rows.** A single failed refresh must not blank a good leaderboard;
  the status line already declares the data stale.
- **Not configured stops polling for good** — every request would fail by definition and only a
  reload can change the config. The Refresh button remains but the status line says
  `Not configured` rather than implying a retry can succeed.
- **Empty is normal, not an error.** Copy: *"No results yet — finish a contest and your score
  appears here."* followed by a **Play now** link to `index.html`, so a leaderboard with zero
  entries is not a dead end. This is the state production shows today, the table being empty.
- The status line's time is `new Date().toLocaleTimeString()` at the moment a load settles.

### 8.1 Polling rules

- `REFRESH_MS = 10000`, a named constant.
- A tick is **skipped entirely when `document.hidden`**, so an abandoned tab does not hold the
  anon key at six requests a minute. `shouldPoll(docLike)` exposes this as a pure check.
- A tick is **skipped while a load is in flight** — no overlapping requests, no queue behind a
  slow response.
- `visibilitychange` back to visible triggers an **immediate** load, so a returning reader is not
  left on stale data for up to ten seconds.
- `startPolling(load, ms)` / `stopPolling()` — `stopPolling` is required by the not-configured
  state; the optional `ms` exists so a harness can observe ticks in milliseconds. Production
  passes nothing and gets `REFRESH_MS`.
- `status` is `aria-live="polite"`, so a screen reader is told when data changes without being
  interrupted mid-sentence.

## 9. UI

```html
<a class="lb-back" href="index.html">Back to the game</a>
<h1 class="title">Halloween Contest Leaderboard</h1>
<p id="lb-status" class="save-status" aria-live="polite">Loading…</p>
<button id="btn-lb-refresh" class="btn btn-ghost" type="button">Refresh</button>

<div id="lb-board">
  <table class="lb-table">
    <thead><tr><th>#</th><th>Player</th><th>Score</th><th>Correct</th>
               <th>Bonus</th><th>Time</th><th>Finished</th></tr></thead>
    <tbody id="lb-body"></tbody>
  </table>
  <p id="lb-message" hidden></p>
</div>

<p class="lb-foot">Ranked from the top 500 results.</p>
```

Each `<td>` carries `data-label` equal to its column header.

**The footnote is not decoration.** The request is `order=total_score.desc&limit=500`, so this is
the **top 500 scores** — not the latest 500, and not everything. Without the line, a reader
reasonably assumes they are seeing all results, and that assumption becomes wrong the moment the
table passes 500 rows.

`css/style.css` gains `.lb-table`, `.lb-row`, `.is-repeat`, `.lb-rank`, `.lb-foot`, `.lb-back`
and the `max-width: 559px` reflow (the complement of the existing `min-width: 560px` rule),
reusing the existing `--muted`, `--panel` and `.save-status` idioms rather than inventing a
palette. `.save-status` carries `.is-error` while a load is failing and no modifier otherwise.

## 10. Error handling

- Every failure path resolves; nothing propagates an exception to the board.
- The player is never shown an HTTP status, a Postgres message or a stack trace.
- Failure is always retried — automatically by the next tick, or manually by Refresh. Nothing
  about a leaderboard failure is permanent, which is precisely why it differs from the results
  screen's duplicate handling.
- On a **successful** load the board is rebuilt from scratch by a single render call; on a
  **failed** load the board is not touched at all. There is no path on which old and new rows
  coexist, and no partial render is possible.

## 11. Testing

**Unit (`tests/test-suite.js`, runs under `node tests/run-tests.js` and in `tests/test.html`):**

`rankRows` — the whole table in §6: distinct ranking, repeat placement, blank ranks, the
`created_at` tie-break, truncation at 10, no filler below 10, empty input, empty-nickname
skipping, dropping all rows of an unranked name, and output exceeding 10 rows for a repeated
name.

`fetchResults` — `200` with an array → `loaded`; a non-array body → `failed`; `4xx`/`5xx` →
`failed`; a rejected `fetch` → `failed`; a request that never settles → `failed` on the deadline;
an unconfigured config → `unconfigured` **with the stub asserting zero calls**. Every case injects
`fetchImpl`, so the suite provably opens no socket.

`shouldPoll` — `hidden` true → false, `hidden` false → true.

**Integration (`tests/stats-check.html`, new — drives the real `stats.html`):**

The page fetches on boot, so `app-check`'s technique of stubbing `fetch` *after* `load` would
already be too late. The harness instead loads `stats.html` through **`srcdoc`, prepending the
stub script and a `<base href="../">`** — the stub is installed before any page script runs, and
the `<base>` keeps the relative `css/` and `js/` URLs resolving to the project root.

Asserts: the `<title>` is `Halloween Contest Leaderboard`; rows render with ranks 1–10; repeat
rows are greyed and their rank cell is empty; a fixture nickname of `<img src=x onerror=…>` lands
as **literal text with no element created**; every `<td>` carries a non-empty `data-label`; the
empty-state copy and its **Play now** link; the not-configured state issues **zero requests**;
an error keeps the previously rendered rows; and a refresh occurs at a short injected interval.

One narrow-viewport step in the same runner loads a second iframe at **360px** — through the same
stubbed `srcdoc`, so it too reaches production for nothing — and asserts `scrollWidth <=
clientWidth`, mirroring what `tests/layout-check.html` already does for the game.

**No test ever contacts production Supabase.** Anonymous reads are permitted, so such a test would
write nothing — but the table is empty, so it could not exercise a single row, and live data would
make every assertion nondeterministic. All fetches are stubbed. This is deliberately stricter
than the rule governing saves.

`tests/README.md` goes from seven runners to **eight**: the header line, a new
`stats-check.html` row with its verdict, and the updated counts for `test-suite` / `test.html`.
Every runner is verified green on a fresh profile with a cache-buster before completion.

## 12. Known limitations

- **Fabricated scores remain visible.** The insert path is open to anyone holding the anon key
  (recorded in the previous spec), and a leaderboard makes the effect *public* rather than merely
  stored. Closing it needs authentication, which is materially more than was asked for. Accepted
  and recorded rather than left implicit.
- **Rows outside the top 500 are invisible**, regardless of age. Raising `FETCH_LIMIT` is a
  one-line change; it is left at 500 so a single request stays cheap against the anon key.
- **No pagination or search.** Ten names and their repeats is the entire surface.
- **The page publishes on push to `main`.** GitHub Pages serves this repository from the branch
  root with no workflow, so committing `stats.html` makes
  `https://alcebal2002.github.io/halloween-contest/stats.html` live on the next push. The anon key
  is already public by design; no new secret is exposed by publishing this page.
- **Nothing in the game links to this page.** §3 puts "modifying the game screens" out of scope,
  so `stats.html` is reachable only by URL — `https://alcebal2002.github.io/halloween-contest/stats.html`
  or a local serve. The page links *to* the game (Back to the game, Play now) but not back. Adding
  one anchor to `index.html` would be a single line; it is deliberately left out rather than
  smuggled into a spec that declared it out of scope.
- **A stale tab shows stale data.** Polling pauses while `document.hidden` by design; the status
  line's timestamp is what tells a reader how old the numbers are.

## 13. Deliverables

| Path | Kind |
|---|---|
| `stats.html` | new |
| `js/leaderboard.js` | new |
| `js/results-api.js` | changed — `fetchResults` and its exports |
| `css/style.css` | changed — leaderboard table, `is-repeat`, `is-skeleton`, footnote, `559px` reflow |
| `tests/test-suite.js` | changed — `rankRows`, `fetchResults`, `shouldPoll` coverage |
| `tests/stats-check.html` | new — stubbed-fetch integration runner |
| `tests/README.md` | changed — eight runners, updated verdicts |
