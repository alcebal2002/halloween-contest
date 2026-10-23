# GFT Halloween Contest

A browser-based Halloween trivia contest with a bottle-order bonus game, resumable local progress, and optional shared results backed by Supabase. The application is a static website: no build step, package installation, or application server is required.

## Functionality

### Contest Flow

1. Enter a mandatory GFT ID (exactly four ASCII letters or digits) and a nickname of up to 20 characters, then read the instructions. IDs keep the case typed and are matched case-insensitively; the results and podium pages show them in uppercase. When Supabase is configured, the app registers the GFT ID + nickname pair, case-insensitively. A previously used pair offers a choice to confirm that identity or choose another; a network failure does not block play.
2. Answer ten multiple-choice questions, each with three options. The default selection draws four traditions questions, four folklore questions, and two film questions, then shuffles their order.
3. See immediate feedback and the correct answer. A correct answer earns five points and unlocks the Poison Bonus; an incorrect answer earns zero and skips the bonus.
4. In the bonus, arrange four distinct colored bottles to match a hidden random order. There are three attempts. Partial matches briefly highlight correct positions; an unsuccessful final attempt reveals the target order.
5. Finish with a total score, elapsed play time, completion timestamp, and a question-by-question answer review. Play again starts a new randomized session under the same nickname and GFT ID.

The score and question progress remain visible during play. The layout adapts to mobile and desktop screens, with labeled controls, screen-reader text, and reduced-motion handling for visual effects.

### Scoring

| Outcome | Base Points | Bonus Points | Question Total |
| --- | ---: | ---: | ---: |
| Correct answer, bonus matched on attempt 1 | 5 | 10 | 15 |
| Correct answer, bonus matched on attempt 2 | 5 | 5 | 10 |
| Correct answer, bonus matched on attempt 3 | 5 | 3 | 8 |
| Correct answer, no bonus match | 5 | 0 | 5 |
| Incorrect answer | 0 | 0 | 0 |

The maximum score for a ten-question contest is **150 points**.

### Saved Progress and Results

- Progress is stored in browser `localStorage`, including the nickname, GFT ID (`gftId`), selected questions, answers, score, phase, timing, and bonus state. Reloading offers a welcome-back screen with the option to continue or start over. Older saved contests without a valid GFT ID return to registration with the nickname prefilled and an explanation that a new contest is needed.
- An unfinished bottle selection is not persisted; returning to an unresolved bonus starts with empty selection slots while preserving the round's saved state.
- If browser storage is unavailable, the game still runs in memory but cannot retain progress across reloads. Invalid or incompatible saved data is handled without preventing a fresh game.
- Elapsed time is accumulated at game actions. Gaps longer than five minutes are excluded entirely; this is not a continuously measured active-time stopwatch.
- With Supabase configured, completed sessions are submitted automatically. Failed saves offer a retry. A local save marker and the database's unique session ID prevent repeated submissions of the same session from creating extra rows.
- Only a result summary is sent to Supabase: session ID, nickname, GFT ID (`gft_id`), total score, correct-answer count, matched-bonus count, elapsed milliseconds, and finish timestamp. Detailed answers and bonus targets remain in local state.

### Leaderboard and Podium

| Page | Purpose |
| --- | --- |
| [index.html](index.html) | Nickname entry, instructions, quiz, bonus rounds, resume flow, and final results. |
| [results.html](results.html) | Combined dashboard and leaderboard: four contest KPI tiles across the top, then the top ten distinct names with additional runs grouped beneath each name's best run. Columns show rank, player, GFT ID, score with correct-answer count, elapsed time, and finish time. Refreshes every ten seconds and blinks the top three (with a wolf howl) when they change. |
| [podium.html](podium.html) | Top-three display with animated canvas confetti. Loads a snapshot once per page load. |

The results page refreshes every ten seconds, loads immediately, and offers a single **Enable sound** button that disappears once audio is unlocked. If a later request fails, previously loaded rows remain visible with an error status.

Both standings pages use up to **500 result rows**. Only runs within that fetched window can appear. Players are displayed as `Nickname [GFT ID]` and grouped by nickname + GFT ID, so different IDs sharing a nickname remain separate players. Nickname grouping trims surrounding whitespace but remains case-sensitive; registration checks the pair case-insensitively. Historical database rows without an ID display only the nickname.

## Technical Overview

### Technologies

| Technology | Use |
| --- | --- |
| HTML5 | Three static pages, forms, buttons, tables, and accessible screen structure. |
| CSS3 | Shared theme, responsive layouts, transitions, animations, and reduced-motion styles. |
| Vanilla JavaScript | Game state transitions, DOM rendering, event handling, ranking, and network requests. No frontend framework or bundler. |
| Web Storage API | Local session persistence and the completed-session save marker. |
| Fetch API, Promises, AbortController | Direct REST requests with a 15-second default timeout and structured failure handling. |
| SVG and Canvas 2D | Reusable bottle artwork and animated podium confetti. |
| Google Fonts | Creepster and Inter, loaded from an external stylesheet. |
| Supabase / PostgreSQL / PostgREST | Optional shared result and nickname tables exposed through REST, with constraints and row-level security. No Supabase JavaScript SDK is used. |
| Node.js | Dependency-free command-line test runner; not required to play or host the app. |

### Code Organization

| File | Responsibility |
| --- | --- |
| [js/questions.js](js/questions.js) | Question bank and category metadata. |
| [js/game-logic.js](js/game-logic.js) | DOM-independent question selection, state transitions, scoring, bonus rules, timing, and persistence validation. |
| [js/app.js](js/app.js) | Game screens, user interactions, local storage access, nickname registration, and result submission. |
| [js/results-api.js](js/results-api.js) | Result payload construction, REST requests, timeouts, and duplicate/error classification. |
| [js/supabase-config.js](js/supabase-config.js) | Browser-visible Supabase URL and public API key. |
| [js/leaderboard.js](js/leaderboard.js) | Ranking/grouping, table rendering, and visibility-aware polling. |
| [js/podium.js](js/podium.js) | Top-three selection and one-time podium loading. |
| [js/confetti.js](js/confetti.js) | Canvas particle animation for the podium. |
| [css/style.css](css/style.css) | Shared styling for all three pages. |
| [sql/001-create-contest-results.sql](sql/001-create-contest-results.sql) | Result table, constraints, grants, and access policies. |
| [sql/002-create-nicknames.sql](sql/002-create-nicknames.sql) | Nickname registry with a generated lowercase uniqueness key and access policies. |
| [sql/003-add-gft-id.sql](sql/003-add-gft-id.sql) | Adds GFT IDs to both tables and makes registry uniqueness apply to the ID + nickname pair. |

Scripts are loaded directly by the HTML pages. Reusable logic modules also support CommonJS exports so the same implementation can be exercised in Node tests. The main playable state sequence is instructions, question, feedback, optional bonus, then the next question or results; nickname and welcome-back screens handle entry and resumption.

## Running Locally

Open [index.html](index.html) in a modern browser for basic play. No compilation is needed. For consistent browser storage behavior and the iframe-based browser tests, serve the project root over HTTP. For example, with Python installed:

```sh
python -m http.server 8777 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:8777/`. Any static web host can serve the same files without a build step.

**The checked-in Supabase configuration contains a project URL and public key.** Normal play with that configuration can register nicknames and submit completed results to that project. For local-only play, set `window.SUPABASE_CONFIG.anonKey` to an empty string in [js/supabase-config.js](js/supabase-config.js). Result saving is then disabled, and the leaderboard and podium show a not-configured message. Remote fonts and shared results require network access; the quiz itself does not require a backend once its files are loaded.

## Supabase Setup

1. Create a Supabase project you control.
2. In its SQL editor, run [sql/001-create-contest-results.sql](sql/001-create-contest-results.sql), followed by [sql/002-create-nicknames.sql](sql/002-create-nicknames.sql), then [sql/003-add-gft-id.sql](sql/003-add-gft-id.sql). For an existing installation, run only the new `003` migration before deploying this version of the site. These scripts are not repeatable. The migration preserves historical rows with NULL IDs, requires four letters/digits (either case) on new writes, and replaces nickname-only uniqueness with pair uniqueness. No historical ID is fabricated.
3. Set the project HTTPS URL and browser-safe public key in [js/supabase-config.js](js/supabase-config.js). The configuration property is named `anonKey` and the checked-in configuration uses a publishable key.
4. Serve the site and finish a contest to exercise result submission, then open the leaderboard.

The application calls `/rest/v1/contest_results` for result insertion and reading, and `/rest/v1/nicknames` for identity registration. The SQL enables row-level security and grants anonymous and authenticated roles insert/select access, with no update/delete policies. The results table uses `session_id` as its primary key; the nickname table enforces uniqueness on `(lower(nickname), gft_id)`. Registration uses an insert-first check: a duplicate pair returns HTTP 409/Postgres 23505 rather than requiring a separate lookup.

### Security and Data Considerations

Never put a Supabase service-role or other secret key in browser code. A public key is intentionally visible; database grants and row-level security define what callers can do.

This is a casual contest implementation, not an authenticated or tamper-resistant competition system. Players can confirm reuse of an existing nickname, correct answers and bonus targets are available client-side, and result scores are supplied by the browser rather than verified by a trusted server. Database constraints reject some invalid data but do not prove that a score was earned. Nicknames and result summaries are publicly readable under the supplied policies, so avoid sensitive personal information.

## Editing the Question Bank

Update [js/questions.js](js/questions.js), preserving its JavaScript array and browser/Node export structure. Each question needs a unique integer `id`, non-empty `text`, exactly three non-empty string `options`, and a zero-based `correctIndex` from 0 to 2. The optional `category` is `traditions`, `folklore`, or `films`.

Invalid entries and duplicate IDs are excluded during selection. Missing or unknown categories enter a general fallback bucket. If a category lacks enough questions, other categories fill the gap; if fewer than ten valid unique questions exist, the contest uses the available questions. An empty valid bank produces an error screen. Preserve IDs for existing questions when possible because saved sessions refer to those IDs.

## Testing

From the project root, with Node.js installed:

```sh
node tests/run-tests.js
```

The shared suite covers game logic, question selection, scoring, persistence, result API behavior, ranking, podium logic, and confetti helpers. It uses local fixtures and request stubs rather than requiring a live Supabase project. The runner exits with a nonzero status on failure.

For browser checks, open [tests/test.html](tests/test.html), or serve the project and use [tests/app-check.html](tests/app-check.html), [tests/layout-check.html](tests/layout-check.html), and [tests/boot-variants.html](tests/boot-variants.html). These exercise the actual screens, mobile layout, leaderboard, and startup fault handling. See [tests/README.md](tests/README.md) for runner options and the generated no-storage check; use each run's reported verdict rather than assuming a fixed test count.