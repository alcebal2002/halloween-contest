# Halloween Contest — test runners

Seven runners, one page each. All of them report a verdict you can read at a glance
(the browser runners put it in the `<title>`), so a headless run is as readable as a
manual one.

| Runner | How to run | Expected verdict |
| --- | --- | --- |
| `node tests/run-tests.js` | Node ≥ 14, from the project root | `56 passed, 0 failed`, exit code `0` |
| `tests/test.html` | open directly (`file://`) or serve the folder | `56 passed, 0 failed` |
| `tests/app-check.html` | serve the folder, open `/tests/app-check.html` | `29 passed, 0 failed` |
| `tests/layout-check.html` | serve the folder, open `/tests/layout-check.html` | `36 passed, 0 failed` |
| `tests/boot-variants.html?variant=emptypool` | serve the folder, open `/tests/boot-variants.html?variant=emptypool` | `6 passed, 0 failed` |
| `tests/boot-variants.html?variant=getitem` | serve the folder, open `/tests/boot-variants.html?variant=getitem` | `7 passed, 0 failed` |
| `.superpowers/sdd/halloween-contest/nostorage-index.html` | serve the folder, open that path | `<title>nostorage: PASS` |

Serve the project root with any static server, e.g.

```
python -m http.server 8777 --bind 127.0.0.1
```

Headless (the browser runners write their verdict into `<title>`):

```
msedge --headless=new --dump-dom --virtual-time-budget=30000 \
  http://127.0.0.1:8777/tests/app-check.html
```

## What each one covers

- **`run-tests.js` / `test.html`** — the same `test-suite.js` in two environments (Node and
  browser), covering question validation and selection, the state machine (instructions →
  question → feedback → bonus → results), the poison-bonus points table (5 / 3 / 2 / 1 / 0), the
  per-position `matchPositions` helper, elapsed play time with the five-minute gap cap,
  timestamps, and storage validation (including a mid-bonus round-trip and the optional
  recorded order). If these two ever disagree, a UMD guard in `js/game-logic.js` or
  `js/questions.js` has broken.
- **`app-check.html`** — drives the real `index.html` in an iframe: nickname validation, the
  instructions screen, the persistent score bar (`Total Points: N - Question X/Y`), immediate
  feedback, the bonus round (open → pick four bottles → first-attempt match pays 5 → Next,
  and three misses settling at 1), the neon match highlight and its reset in the following
  round, the green flash on a partial match (locked controls, then empty slots for the next
  attempt), the reload that starts that round from empty slots, resume from the welcome-back
  card in all phases (progress mid-game; final score plus elapsed and finish time once finished),
  start over,
  swapped/corrupt data, keyboard start, and the results screen
  (points, total time, timestamp, 10 review rows).
- **`layout-check.html`** — renders the page in a genuine 360px viewport and walks the whole
  flow (nickname → instructions → question → feedback → bonus with two bottles picked → bonus
  resolved → results), asserting at every stop that the document does not scroll sideways, the
  card fits, and no element overflows. It also checks the score bar is hidden before the
  contest starts and that each step shows exactly one screen. (Edge/Chrome headless cannot be
  windowed below ~492px, so a `--window-size=360` screenshot is a left-crop of a wider layout
  and lies about overflow — this iframe does not.)
- **`boot-variants.html`** — injects a fault before `js/app.js` into a copy of the real page
  (no duplicated markup): an empty question pool, and storage that accepts writes but throws
  on reads.
- **`nostorage-index.html`** — generated copy of `index.html` with `localStorage` blocked
  entirely, then plays a full contest in memory (nickname → instructions → 10 questions →
  results). It is generated, never edited: after changing `index.html`, regenerate it with

  ```
  node tests/make-nostorage.js
  ```
