# Execution ledger — `stats.html` leaderboard plan

Plan: `docs/superpowers/plans/2026-10-13-stats-leaderboard.md`
Mode: native (inline) execution.

| # | Task | State | Commit |
| --- | --- | --- | --- |
| 1 | `fetchResults` in `js/results-api.js` | done | `3c44a81` |
| 2 | `rankRows` / `shouldPoll` / `REFRESH_MS` | done | `ceb2ad7` |
| 3 | `stats.html` + `render` + harness | done | `7eaa06a` |
| 4 | boot, states, polling, controls | done | `878d25c` |
| 5 | README + whole-branch verification | done | `2b41c99` |

## Rulings

**R1 — Plan test 8 contradicted the spec; test corrected to the spec.**
The plan's `rankRows emits four rows for a top name that repeats three times`
asserted `out[10].repeat`, `out[11].repeat`, `out[12].nickname === "Bat"` — i.e.
"ten best rows first, then all repeats". That is incompatible with the plan's own
test 2 ("a repeat row directly beneath its own best row") and with the binding spec:
`specs/2026-10-13-stats-leaderboard-design.md` decision 3 ("greyed, **directly after
its own best row**") and §6 step 4 ("Emit, for each kept group in rank order: its best
row marked `repeat: false`, then its remaining rows marked `repeat: true`").
The implementation follows the spec (grouped emission); the four wrong assertions now
check `out[1]`, `out[2]`, `out[3]`. Length 13 and the ten-distinct-names check were
already correct under the spec reading and are unchanged.
Consequence for Task 3: the `#` column must number distinct names only (spec §7.2),
so `render` increments the rank counter solely on `repeat === false`.

**R2 — Same defect in the Task 3 harness, assertion 5; corrected likewise.**
The harness's fixture is ten distinct names plus a second run for `Bat`. Under
spec-grouped emission that repeat lands at `rows[1]`, not at `rows[rows.length-1]`
(which is `Toad`). The assertion now checks `rows[1]` and additionally asserts the
row above it is the same player, which is the property the spec actually promises.

**R3 — `render` counted skeleton rows as "prior rows"; fixed per spec §8.**
The plan's `hasRows = body.childNodes.length > 0` means a first-load failure
(Loading → Error) leaves three `is-skeleton` rows on screen and hides `#lb-message`.
Spec §8 defines that state as **"Error on first load | error message"**, and §7 says
"Showing a header row over an empty `<tbody>` would read as a broken table".
Fix: `hasRows` counts only rows without `is-skeleton`, and the tbody is cleared
whenever `#lb-message` is shown, so a stale board cannot resurface behind a message.
Harness assertion 12 also had no prior rows to keep — it ran after the empty state —
so it now renders `ready` first, which is the state the assertion is named for.
The first-load branch was covered by **no assertion anywhere** (Task 4's block only
covers not-configured), so a new assertion 13 was added; the narrow-viewport check
becomes 14 and Task 4's block becomes 15–22, taking `tests/README.md` from 21 to 22.

**R4 — The narrow harness iframe was `hidden`, so the viewport assertion measured 0×0.**
A `display:none` iframe has no layout box, so `clientWidth` and `scrollWidth` were
both 0 and the assertion could never pass. The `hidden` attribute was removed.
Measurement was then re-expressed: `documentElement.clientWidth` came back **345**,
not 360, because the frame's own vertical scrollbar occupies 15px once eleven
seven-line rows overflow the 560px-tall iframe — the layout itself was correct
(`scrollWidth === clientWidth === 345`, i.e. no sideways scroll). The assertion now
checks `narrow.clientWidth === 360` (the frame's content box = the real viewport)
plus `scrollWidth <= clientWidth`, which is exactly "a 360px viewport that does not
scroll sideways". The plan's `getBoundingClientRect().width === 360` was rejected for
the same reason: it returns 362, the content box plus the 1px frame border.

**R5 — Gotcha: `--screenshot --window-size=360,900` lays out wider than 360 and crops.**
The plan's Step 8 recipe produced a 360×900 PNG in which the title sat on one line
(~442px of text) with the card's right border outside the frame — reading exactly like a
real overflow. It was not: the PNG is the *window* size, but the page laid out at a
larger width and the image was then cropped to 360. Confirmed two ways — rendering the
same page inside a genuine `width:360px` iframe (title wraps to three lines, both card
edges at x=18/x=342, no sideways scroll) and the harness's own
`scrollWidth === clientWidth`. **When a narrow screenshot looks broken, re-shoot it
inside a fixed-width iframe at a normal window size before believing it.**
(`tests/README.md` already documented this same trap under `layout-check.html`, so the
finding confirms repo precedent rather than introducing it — the plan's Step 8 recipe
just hadn't inherited it.)

**R9 — The ledger itself is committed, which Step 6 did not anticipate.**
Step 6 expects `git status --short` to show only ` M .gitignore`. It also shows this
file, because the plan never planned a ledger. Committing it is deliberate: without it
the eight rulings above are invisible, and a future reader would see tests that differ
from the plan's text with no explanation. After this commit the tree holds only the
deliberately uncommitted `.gitignore`.

**Verified verdicts (Task 5 Step 1, fresh profile + fresh `?cb=` each):**

| Runner | Printed |
| --- | --- |
| `node tests/run-tests.js` | `92 passed, 0 failed`, exit 0 |
| `tests/test.html` | `92 passed, 0 failed` |
| `tests/app-check.html` | `39 passed, 0 failed` |
| `tests/layout-check.html` | `37 passed, 0 failed` |
| `tests/stats-check.html` | `22 passed, 0 failed` |
| `boot-variants?variant=emptypool` | `6 passed, 0 failed` |
| `boot-variants?variant=getitem` | `7 passed, 0 failed` |
| `nostorage-index.html` | `<title>nostorage: PASS` |


**R6 — Task 4 Step 1's `buildPage` was missing its closing `}`.**
The plan's snippet ends `      });` and then declares `function load(...)` inside
`buildPage`'s body, which is a syntax error: the whole harness would fail to parse and
every assertion would be lost. The brace was added. (Found by reading the plan before
executing it, not by a red test.)

**R7 — The stub injection pushed `<meta charset>` to byte 1474, past the 1024 limit.**
The plan states the injection "stays far enough inside 1024 bytes that `<meta charset>`
is still honoured". Measured: `STUB_BODY` is **1378 bytes**, so injecting after `<head>`
lands the charset declaration at byte **1474**. The browser then ignores it and falls
back to windows-1252, decoding every UTF-8 em dash in the page as `â€"` — which would
break `"Couldn't load — retrying"` and `"No results yet — finish a contest…"`.
Fix: inject after `<meta charset="UTF-8">` instead of after `<head>`. The charset stays
at byte 62, and `<base href="../">` still precedes the `<link rel="stylesheet">`, which
is the only ordering the stylesheet actually depends on.

**R8 — The plan's Step 3 tally ("13 passed, 8 failed") was unreachable; harness now reports on throw.**
`win2.Leaderboard.startPolling(...)` raises `TypeError` before `finish()` runs, so the
catch path printed only `HARNESS ERROR` and discarded the report — leaving no way to
tell whether assertions 1–14 had regressed. The catch now calls `finish()` first. The
red run records **1–14 PASS, 15–17 FAIL, 18 throws**, which is the intended signal.


