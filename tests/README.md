# Halloween Contest — test runners

Four runners, one page each. All of them report a verdict you can read at a glance
(the browser runners put it in the `<title>`), so a headless run is as readable as a
manual one.

| Runner | How to run | Expected verdict |
| --- | --- | --- |
| `node tests/run-tests.js` | Node ≥ 14, from the project root | `32 passed, 0 failed`, exit code `0` |
| `tests/test.html` | open directly (`file://`) or serve the folder | `32 passed, 0 failed` |
| `tests/app-check.html` | serve the folder, open `/tests/app-check.html` | `16 passed, 0 failed` |
| `tests/layout-check.html` | serve the folder, open `/tests/layout-check.html` | `8 passed, 0 failed` |
| `tests/boot-variants.html?variant=emptypool` | serve the folder, open `/tests/boot-variants.html?variant=emptypool` | `6 passed, 0 failed` |
| `tests/boot-variants.html?variant=getitem` | serve the folder, open `/tests/boot-variants.html?variant=getitem` | `6 passed, 0 failed` |
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
  browser), covering question validation and selection, the state machine, timestamps, and
  storage validation. If these two ever disagree, a UMD guard in `js/game-logic.js` or
  `js/questions.js` has broken.
- **`app-check.html`** — drives the real `index.html` in an iframe: nickname validation,
  immediate feedback, resume from the welcome-back card in all three phases, start over,
  play again, swapped/corrupt data, keyboard start.
- **`layout-check.html`** — renders the page in a genuine 360px viewport and asserts there is
  no horizontal overflow. (Edge/Chrome headless cannot be windowed below ~492px, so a
  `--window-size=360` screenshot is a left-crop of a wider layout and lies about overflow.)
- **`boot-variants.html`** — injects a fault before `js/app.js` into a copy of the real page
  (no duplicated markup): an empty question pool, and storage that accepts writes but throws
  on reads.
- **`nostorage-index.html`** — generated copy of `index.html` with `localStorage` blocked
  entirely, then plays a full contest in memory. Regenerate it if `index.html` changes.
