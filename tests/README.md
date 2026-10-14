# Halloween Contest — test runners

Eight runners, one page each. All of them report a verdict you can read at a glance
(the browser runners put it in the `<title>`), so a headless run is as readable as a
manual one.

| Runner | How to run | Expected verdict |
| --- | --- | --- |
| `node tests/run-tests.js` | Node ≥ 14, from the project root | `99 passed, 0 failed`, exit code `0` |
| `tests/test.html` | open directly (`file://`) or serve the folder | `99 passed, 0 failed` |
| `tests/app-check.html` | serve the folder, open `/tests/app-check.html` | `50 passed, 0 failed` |
| `tests/layout-check.html` | serve the folder, open `/tests/layout-check.html` | `39 passed, 0 failed` |
| `tests/stats-check.html` | serve the folder, open `/tests/stats-check.html` | `22 passed, 0 failed` |
| `tests/boot-variants.html?variant=emptypool` | serve the folder, open `/tests/boot-variants.html?variant=emptypool` | `6 passed, 0 failed` |
| `tests/boot-variants.html?variant=getitem` | serve the folder, open `/tests/boot-variants.html?variant=getitem` | `7 passed, 0 failed` |
| `.superpowers/sdd/halloween-contest/nostorage-index.html` | serve the folder, open that path | `<title>nostorage: PASS` |

Serve the project root with any static server, e.g.

```
python -m http.server 8777 --bind 127.0.0.1
```

Headless (the browser runners write their verdict into `<title>`):

```
PROFILE=$(mktemp -d)
msedge --headless=new --disable-gpu --no-first-run --user-data-dir="$PROFILE" \
  --dump-dom --virtual-time-budget=45000 \
  "http://127.0.0.1:8777/tests/app-check.html?cb=$(date +%s)"
rm -rf "$PROFILE"
```

Use a throwaway `--user-data-dir` for every run. A reused profile serves `js/*.js` from its HTTP
cache, so a runner can report yesterday's code — this has produced both a false pass and a false
failure. The `?cb=` cache-buster covers the document but not the scripts it loads, which is why the
profile has to be fresh.

## What each one covers

- **`run-tests.js` / `test.html`** — the same `test-suite.js` in two environments (Node and
  browser), covering question validation and selection, the state machine (instructions →
  question → feedback → bonus → results), the poison-bonus points table (the question totals
  11 / 6 / 4 / 1 / 0, i.e. a +10 / +5 / +3 award on top of the 1-point correct answer), the
  per-position `matchPositions` helper, elapsed play time with the five-minute gap cap,
  timestamps, and storage validation (including a mid-bonus round-trip and the optional
  recorded order). Tests may return a promise, and both runners await each one in
  order, so an async failure is reported instead of silently passing. If these two
  ever disagree, a UMD guard in `js/game-logic.js` or
  `js/questions.js` has broken.
- **`app-check.html`** — drives the real `index.html` in an iframe: nickname validation, the
  instructions screen, the persistent score bar (`Total Points: N - Question X/Y`), the
  four-bottle poison tray (a glossy neon vial, drawn once and reused, with the
  colour named under each bottle and a dim empty vial in every unfilled order slot), immediate
  feedback (with the "+1" a correct answer flashes, no flash on a wrong one, and the
  button reading "Poison Bonus!" after a correct answer but "Next" after a wrong one), the bonus round
  (open → pick four bottles → first-attempt match pays an 11-point
  question, with a big centred "+10" that fades in for a couple of seconds → Next,
  and three misses settling at 1), the neon match highlight and its reset in the following
  round, the green flash on a partial match (locked controls, then empty slots for the next
  attempt), the settled miss that reveals the order with each slot marked green (right) or neon
  red (wrong), the reload that starts that round from empty slots, resume from the welcome-back
  card in all phases (progress mid-game; final score plus elapsed and finish time once finished),
  start over,
  swapped/corrupt data, keyboard start, and the results screen
  (points, total time, timestamp, 10 review rows), plus the Supabase save on that
  screen (happy path — including the transient "Saving your results…" state before
  it settles — duplicate rejection with no retry, network failure with a
  working retry, the reload that sends nothing because the local marker
  already records the session, and a save still in flight when `Play again`
  is pressed, which must not swallow the next run's save or stamp its marker).
  Every save is answered from a stub, so no test
  run can reach the live project. Starting a contest also claims the nickname
  against the `nicknames` table before the instructions screen opens; the same
  runner covers that path (a fresh name is inserted and play begins, a name
  already in the table offers **Confirm NickName** / **Choose another one**,
  confirming plays under it and writes nothing new, declining keeps the typed
  name and asks again on the next Start, and an unreachable check lets the
  player start anyway). Nickname claims go to their own stub and call log, so the
  result-save counts stay independent of how many times a contest was started.
- **`layout-check.html`** — renders the page in a genuine 360px viewport and walks the whole
  flow (nickname → instructions → question → feedback → bonus with two bottles picked → bonus
  resolved → results), asserting at every stop that the document does not scroll sideways, the
  card fits, and no element overflows. It also checks the score bar is hidden before the
  contest starts and that each step shows exactly one screen. It blanks the
  Supabase key first, and asserts the results screen then shows no save status —
  this walkthrough must never post a row. (Edge/Chrome headless cannot be
  windowed below ~492px, so a `--window-size=360` screenshot is a left-crop of a wider layout
  and lies about overflow — this iframe does not.)
- **`stats-check.html`** — drives the real `stats.html` through an `srcdoc` iframe with `fetch`
  stubbed *before* any page script runs (`app-check.html` stubs after `load`, which is too late for
  a page that fetches on boot): ranks 1-10 over ten distinct names, a repeat row greyed beneath its
  own name with an empty rank cell, a `<img src=x onerror=...>` nickname landing as literal text
  with no element created, score/correct/bonus/time/finished each landing in their own column,
  malformed numbers and an unparseable timestamp coercing instead of throwing, the three-row
  loading skeleton, the empty state's copy and **Play now** link, an error that leaves the rendered
  rows untouched, an error on *first* load falling through to the message instead of parking the
  skeleton, boot fetching and rendering on its own, a failed refresh followed by a working
  recovery, a short injected refresh interval, a load in flight never being overlapped,
  `visibilitychange` loading immediately, an unconfigured config showing its message with zero
  requests, and the seven columns reflowed inside a genuine 360px iframe without horizontal scroll.
  It never contacts the live project: the stub intercepts both `fetch` and `SUPABASE_CONFIG`, so
  the not-configured path is reachable without editing `js/supabase-config.js`.
- **`boot-variants.html`** — injects a fault before `js/app.js` into a copy of the real page
  (no duplicated markup): an empty question pool, and storage that accepts writes but throws
  on reads. It blanks the Supabase key first, so Start stays synchronous and never reaches the
  live project — the storage fault, not a network race, is what these variants exercise.
- **`nostorage-index.html`** — generated copy of `index.html` with `localStorage` blocked
  entirely, then plays a full contest in memory (nickname → instructions → 10 questions →
  results), asserting the save status stays hidden too (the generator blanks the
  Supabase key for the same reason `layout-check.html` does, and refuses to write
  its copy at all unless that blanking actually landed — a silently skipped
  replacement would otherwise let a test post a real row). It is generated, never
  edited: after changing `index.html`, regenerate it with

  ```
  node tests/make-nostorage.js
  ```
