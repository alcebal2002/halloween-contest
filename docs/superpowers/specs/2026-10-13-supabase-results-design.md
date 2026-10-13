# Halloween Contest — Supabase Results Design Spec

**Date:** 2026-10-13
**Status:** Approved design, pending spec review
**Location:** `ai-games/halloween-contest/`
**Depends on:** `docs/superpowers/specs/2026-10-06-halloween-contest-design.md`

## 1. Purpose

Push each finished contest to a Supabase table so results can be read and analysed later,
outside the player's browser. Today a finished run only exists in `localStorage`, which is lost
when the browser is cleared and is invisible to anyone else.

Success criteria:

- A finished contest produces exactly one row in `public.contest_results`.
- The row's primary key is the contest's random session id, so a second submission for the same
  session is rejected by the database rather than overwriting the first.
- A duplicate submission surfaces a visible error to the player; a network failure offers a retry.
- Reopening a finished contest never produces a spurious duplicate error.
- No build step, no bundler, no runtime third-party dependency are introduced.

## 2. Decisions taken during design

| # | Question | Decision |
|---|---|---|
| 1 | Who may read results | Anyone. `SELECT` is open to anonymous callers, which also leaves the door open for a leaderboard later (not built now). |
| 2 | Failure UX | A status line on the results screen plus a **Retry** button. |
| 3 | Row contents | The minimum data listed in the request — nothing more. |
| 4 | Reload of a finished run | A local marker remembers the stored session id, so the results screen shows "already saved" instead of re-attempting. |
| 5 | Connection approach | Direct REST with `fetch`. No Supabase client library, no CDN script. |

## 3. Scope

**In scope:** the table and its security policies, a results API module, a committed configuration
file, the save trigger and status UI on the results screen, duplicate and network error handling,
and tests.

**Out of scope:** a leaderboard or any other read UI, authentication or accounts, updating or
deleting rows, per-question answer detail, analytics dashboards, and any build tooling.

## 4. Architecture

Three concerns stay separate, matching the existing repo's style:

```
index.html ──▶ js/supabase-config.js   (values only: url + anon key)
           ──▶ js/app.js               (when to save, what the player sees)
           ──▶ js/results-api.js       (pure mapping + the HTTP call; no DOM)
```

`js/results-api.js` owns no knowledge of the DOM and touches no globals other than its exported
namespace, so the Node suite can exercise it exactly as it already exercises `js/game-logic.js`
(via the `module.exports` UMD guard).

The anon key is shipped to the browser by necessity — a static site has nowhere else to put it.
It is a publishable key by design; all real enforcement lives in the database's row-level security
(§5).

## 5. Database

Committed at `sql/001-create-contest-results.sql`, run once by the project owner in the Supabase
SQL editor.

```sql
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

How the stated requirements are met:

| Requirement | Mechanism |
|---|---|
| Primary key is the random session id | `session_id text primary key` — the value already generated as `hc_…` by `createInitialState` |
| Cannot be overwritten | The application issues a plain `INSERT`; PostgREST's upsert header (`Prefer: resolution=merge-duplicates`) is never sent |
| No duplication — a repeat is an error | A second row for an existing key raises Postgres `23505`, which PostgREST returns as HTTP `409` |
| Nothing is silently mutated afterwards | No `update` and no `delete` policy exists, so the API refuses both for every caller |
| Readable for later analysis | `select` policy for anonymous callers |

Deliberate omissions: no upper bound is placed on `total_score` or `correct_count` beyond `>= 0`,
because any ceiling would hard-code the current points table (`MAX_POINTS_PER_QUESTION`) and would
break every insert the day those constants change. `bonuses_matched <= correct_count` is safe — a
bonus can only be won on a question already answered correctly.

## 6. Configuration

`js/supabase-config.js`, loaded in `index.html` before `js/app.js`:

```js
window.SUPABASE_CONFIG = {
  url: "https://lyzuxvcsjavxhlovgeeu.supabase.co",
  anonKey: ""
};
```

The owner pastes the anon key from **Project Settings → API** into `anonKey` and commits it. That
is safe and intended: the anon key is public, and row-level security is the actual boundary.

While `anonKey` is empty or still a placeholder the application makes no request and shows no
status line at all, so a misconfigured deployment never confuses players with a broken-looking
results screen. This is a deliberate choice: a silently unconfigured install is preferred over an
error shown to every player.

## 7. Results API module (`js/results-api.js`)

Exposed as `window.ResultsApi` in the browser and `module.exports` in Node.

| Function | Contract |
|---|---|
| `isConfigured(config)` | `true` only when `config.url` is an `https://` URL and `config.anonKey` is a non-placeholder string (non-empty, ≥ 20 characters, not containing `PASTE`). |
| `buildResultRow(state)` | Maps finished game state to a row (below). Returns `null` — and the caller makes no request — when the state is not a finished run. |
| `saveResult(config, row, fetchImpl, timeoutMs)` | Issues the `POST`. **Always resolves**, never rejects: `{ ok: true, kind: "saved" }`, `{ ok: false, kind: "duplicate" }`, or `{ ok: false, kind: "failed", detail }`. Network errors, timeouts and non-`409` statuses all resolve as `"failed"`. `timeoutMs` defaults to 15000 and is enforced with `AbortController`; an abort resolves as `"failed"`. |
| `classifySaveError(status, body)` | `status === 409` or `body.code === "23505"` → `"duplicate"`, otherwise `"failed"`. |

### 7.1 Row mapping

| Column | Source |
|---|---|
| `session_id` | `state.sessionId` |
| `nickname` | `state.nickname` |
| `total_score` | `state.score` |
| `correct_count` | answers where `correct` is true |
| `bonuses_matched` | answers whose `points > 1` — the bonus pays 5, 3 or 2 for a matched bonus, 1 for a correct answer whose bonus was missed, 0 for a wrong answer |
| `elapsed_ms` | `Math.max(0, Math.round(state.elapsedMs))` |
| `finished_at` | `state.finishedAt` (ISO 8601 string) |

For an answer record with no `points` field, the value is treated as `correct ? 1 : 0`, mirroring
the backfill already performed by `validateStoredState`, so `bonuses_matched` stays correct.

`buildResultRow` returns `null` when `state.finishedAt` is missing or `state.answers` is empty —
a state that has not actually been finished.

### 7.2 Request

```
POST {url}/rest/v1/contest_results
Content-Type: application/json
apikey: {anonKey}
Authorization: Bearer {anonKey}
Prefer: return=minimal

{ "session_id": "hc_…", "nickname": "Bat", "total_score": 34, … }
```

The request deliberately omits any `resolution=` header, so a duplicate key can only ever be
reported, never merged.

## 8. Save trigger and state

Saving happens when the results screen renders — the single place a finished run is shown,
covering both a fresh finish and **Continue** from the welcome-back card.

`js/app.js` keeps one variable for the current session:

| Value | Meaning |
|---|---|
| `idle` | not yet attempted this session |
| `saving` | request in flight |
| `saved` | server confirmed; marker written |
| `already` | The local marker matches this session — no request is made |
| `duplicate` | server rejected the key as already present |
| `failed` | network, timeout or server error; retry offered |

A `localStorage` key `halloweenContest.saved.v1` stores the last successfully stored session id.
It is written **only** after the server confirms, and is compared against `state.sessionId` before
any request is made. This is what distinguishes "I already saved this" from "someone else used my
id" — without it, every reload of a finished contest would raise a false duplicate error.

If `localStorage` is unavailable, the marker cannot be recorded, so a later reload attempts the
save again and the server's duplicate rejection is surfaced honestly. No special casing is added
for that path.

When `buildResultRow` returns `null` — a state that is not actually finished — no request is made
and no status line appears, exactly as in the unconfigured case. This is a guard against sending
incomplete data, not a player-facing condition.

## 9. UI

Two elements are added to `#screen-results`, between the answer review and **Play again**:

```html
<p id="results-save" class="save-status" aria-live="polite" hidden></p>
<button id="btn-results-retry" class="btn btn-ghost" type="button" hidden>Retry save</button>
```

| Condition | Status text | Retry visible |
|---|---|---|
| Not configured | *(element stays hidden)* | no |
| Marker matches this session | Results already saved. | no |
| Request in flight | Saving your results… | no |
| Success | Results saved. | no |
| Duplicate (`409` / `23505`) | This session's results are already stored. | no |
| Network, timeout or server error | Couldn't save your results. | **yes** |

The retry button re-runs the save for the same session. **Play again** is unaffected: it starts a
new session id, which no longer matches the marker, so the next finished run attempts its own
save.

`css/style.css` gains `.save-status`, following the muted, small-text idiom of `.field-note`, plus
spacing above the retry button.

## 10. Error handling

- Every failure path resolves; nothing propagates an exception to the player's screen.
- A `409` is the only condition that ends retry availability, because it is permanent: the row
  already exists and no retry can change that.
- A timeout is treated as a normal failure with a retry offered, since the insert may in fact have
  succeeded; retrying then yields a `409`, which is reported truthfully as already stored.
- The player is never shown a stack trace, an HTTP status, or a Postgres message.

## 11. Testing

**Unit (`tests/test-suite.js`, runs under `node tests/run-tests.js` and in `tests/test.html`):**
`isConfigured` rejects a blank key, a short key and a `PASTE…` placeholder, and accepts a real
shaped key; `buildResultRow` maps a full finished state including `bonuses_matched` for a mix of
5/3/2/1/0 point answers, backfills a missing `points` field, and returns `null` for an unfinished
state; `classifySaveError` returns `duplicate` for `409` and for a `23505` body and `failed` for
`500` and for a network throw; `saveResult` sends the expected headers, omits any upsert header,
and resolves `saved`, `duplicate` and `failed` from a stubbed `fetch`.

**Integration (`tests/app-check.html`, drives the real `index.html` in an iframe):** with `fetch`
stubbed, finishing a contest shows "Saving your results…" then "Results saved."; a stubbed `409`
shows the already-stored message with no retry button; a stubbed network failure shows the failure
message with a working retry that succeeds on the second attempt; a reloaded finished run shows
"Results already saved." without issuing a request.

`tests/make-nostorage.js` requires no change: it rewrites `index.html` generically.

## 12. Known limitations

- **Fabricated scores are possible.** `INSERT` is open to anyone holding the anon key, so a
  determined person can post invented results straight to the REST endpoint. Closing this needs
  authentication or signed submissions, which is materially more than was asked for. Accepted for
  now and recorded rather than left implicit.
- **No way to correct a stored row.** By design there is no update path. A mistaken row must be
  removed by the owner in the Supabase dashboard.
- **A finished run with an unreachable network can be retried, not queued.** Nothing is written
  when the browser closes mid-save.

## 13. Deliverables

| Path | Kind |
|---|---|
| `sql/001-create-contest-results.sql` | new |
| `js/supabase-config.js` | new |
| `js/results-api.js` | new |
| `index.html` | changed — two script tags, two results-screen elements |
| `css/style.css` | changed — `.save-status` |
| `js/app.js` | changed — save trigger, marker, status rendering, retry wiring |
| `tests/test-suite.js` | changed — unit coverage |
| `tests/app-check.html` | changed — stubbed-fetch scenarios |
