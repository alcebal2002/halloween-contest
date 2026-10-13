# Halloween Contest — Design Spec

**Date:** 2026-10-06
**Status:** Approved design, pending spec review
**Location:** `ai-games/halloween-contest/`

## 1. Purpose

A static HTML/CSS/JavaScript trivia game titled **"Halloween Contest"**. The user enters a
nickname and answers a sequence of Halloween trivia questions, each with exactly three options.
Progress is persisted to `localStorage` so closing and reopening the browser resumes the contest
at the question the user left off. Scoring is explicit: each question has one correct answer.

Success criteria:

- Reopening the browser mid-contest restores nickname, question position, score, and answers.
- The look and feel are Halloween-themed and dark.
- Question content lives in one swappable file so real JSON data can replace the placeholder set
  without touching application logic.

## 2. Scope

**In scope:** nickname capture, randomized question ordering, three-option questions, immediate
per-question feedback, resume/welcome-back flow, results screen with answer review and replay,
`localStorage` persistence, dark Halloween styling, pure-logic tests.

**Out of scope:** server-side storage, leaderboards, authentication, sound, accounts, multiple
questions types (all questions are three-option multiple choice with one correct answer), live
score display during play.

## 3. Screens and flow

The UI is a single page with five screen sections. One of them is visible at a time, selected by
`state.phase`.

| Phase | Screen | Contents |
|---|---|---|
| `nickname` | Welcome | Title **"Halloween Contest"**, tagline, nickname input, **Start** button |
| `welcomeBack` | Resume | "Welcome back, *nickname*", progress line ("Question 4 of 10", or "Finished - score X / M" when the stored phase is `results`). In that finished case the card also shows the run's elapsed time and finish time, then a blank gap, then **Continue** / **Start over**. **Continue** returns to the stored phase (`question`, `feedback`, or `results`) |
| `question` | Quiz | Progress header, question text, three option buttons |
| `feedback` | Quiz (locked) | Chosen option green/red, correct option always shown green (the outcome is announced to screen readers via a visually hidden "Correct!" / "Not quite — correct answer: …" line; nothing is shown on screen), **Next** button |
| `results` | Summary | Nickname, score `X / M`, finish timestamp, full answer review, **Play again** |

Transition rules:

```
nickname   --Start-->              question (index 0, fresh order)
welcomeBack--Continue-->           the stored phase (question / feedback / results)
welcomeBack--Start over-->         question (new sessionId, new order, score reset)
question   --option clicked-->     feedback (record answer, update score, lastAnswerAt)
feedback   --Next-->               question (index + 1)  |  results (if last question answered)
results    --Play again-->         question (new sessionId, new order, score reset)
```

Notes:

- **No live score counter during play.** Score is revealed only on the results screen.
- **No auto-advance after feedback.** An explicit **Next** button prevents accidental skips.
- Option buttons are disabled immediately after the first click (double-click safety).
- The nickname form is submitted with the **Start** button or the Enter key.

## 4. State schema

Storage key: `halloweenContest.state.v1`

```json
{
  "sessionId": "hc_550e8400-e29b-41d4-a716-446655440000",
  "nickname": "Player1",
  "phase": "question",
  "questionIndex": 3,
  "questionOrder": [7, 2, 11, 4, 9, 1, 12, 5, 8, 3],
  "answers": [
    { "questionId": 7, "selected": 1, "correct": true },
    { "questionId": 2, "selected": 0, "correct": false }
  ],
  "score": 1,
  "lastAnswerAt": "2026-10-06T14:52:11.000Z",
  "finishedAt": null
}
```

Field semantics:

- `sessionId` — `hc_` prefix plus `crypto.randomUUID()`. Regenerated **only** on **Play again**
  and **Start over**.
- `nickname` — trimmed user input, 1–20 characters.
- `phase` — one of `nickname`, `welcomeBack`, `question`, `feedback`, `results`.
- `questionIndex` — 0-based index into `questionOrder`. During `question` and `feedback` it
  identifies the question currently on screen (during `feedback` it still points at the
  question just answered); advancing from `feedback` increments it by one.
- `questionOrder` — array of question `id`s, shuffled once when a contest starts and persisted.
  This is required: without it, resume would re-shuffle the deck and the user would face
  different questions mid-contest.
- `answers` — one entry per answered question, in answer order. Enables the results review.
- `score` — count of `answers` where `correct` is true.
- `lastAnswerAt` — ISO-8601 timestamp of the **most recent answer given, correct or not**.
  Updated on every answer.
- `finishedAt` — set equal to `lastAnswerAt` at the moment the final question is answered;
  `null` until then. Displayed on the results screen as the moment the user finished the
  questionnaire, formatted in the user's local time.

The whole object is written with `localStorage.setItem` on **every** state transition, so
nickname, position, score, and answers can never drift apart.

Initial load: if no stored state exists (or it is unreadable), the app starts with a fresh
object at `phase = "nickname"` with `score = 0`, `answers = []`, `lastAnswerAt = null`,
`finishedAt = null`. If stored state exists with phase `question`, `feedback`, or `results`,
the app opens on `welcomeBack` rather than the stored phase directly.

## 5. Files

```
halloween-contest/
├── index.html          semantic sections for the five screens; links css + 3 scripts
├── css/
│   └── style.css       theme tokens, layout, buttons, feedback colors, review list
├── js/
│   ├── questions.js    var QUESTIONS = [ … ]      ← the only file swapped for real data
│   ├── game-logic.js   pure logic: validation, selection, state machine, storage I/O
│   │                   (no DOM, no globals — loadable from Node and the browser)
│   └── app.js          boot, render(), handlers, persistence; DOM-only side effects
├── tests/
│   ├── test-suite.js   shared assertions (UMD: runs under Node and the browser)
│   ├── run-tests.js    Node runner          → node tests/run-tests.js
│   ├── test.html       browser runner, opened directly
│   ├── app-check.html  drives the real page in an iframe: the §8 checklist
│   ├── layout-check.html  renders the page in a true 360px viewport and asserts no overflow
│   └── boot-variants.html injects §7 boot faults (empty pool, blocked reads)
└── docs/superpowers/specs/
    └── 2026-10-06-halloween-contest-design.md
```

Scripts are plain, non-module, loaded in dependency order (`questions.js`, `game-logic.js`,
`app.js`) at the end of `<body>`, so `QUESTIONS` and `GameLogic` are defined when `app.js`
initialises and the page still runs from `file://`. No build step, no dependencies.

### Question format

```json
{
  "id": 3,
  "text": "Which classic monster is owed a tooth by the Tooth Fairy?",
  "options": ["Dracula", "Frankenstein's monster", "The Mummy"],
  "correctIndex": 1
}
```

Constraints enforced at selection time: exactly 3 options; `correctIndex` in `0..2`; non-empty
`text`; unique numeric `id`. Invalid entries are skipped; if no valid question remains, the error
screen in §7 is shown.

### Placeholder data

`questions.js` ships with roughly 15 Halloween trivia questions. Each contest draws **10**
(shuffled) — or all valid questions if fewer than 10 exist. When the real JSON arrives it
replaces the contents of this file in the same shape.

## 6. Visual style

Dark and atmospheric, centered card layout, max-width 640px, responsive down to phone widths.

- **Palette**
  - Background base `#0d0a14`, card surface `#14101c`, raised panel `#1c1726`
  - Pumpkin orange `#ff7a1a` (primary actions, title glow)
  - Deep purple `#7c3aed` (accents, borders)
  - Blood red `#dc2626` (wrong answer), green `#16a34a` (correct answer)
  - Bone white `#f5efe6` (body text), muted `#a89f91` (secondary text)
- **Atmosphere:** subtle radial vignette / fog gradient over the background, soft orange glow
  behind the card, a gentle flicker animation on the title, 🎃👻🦇 decorative accents.
- **Typography:** serif display font (Creepster) for headings, humanist sans (Inter) for body
  copy and controls — Google Fonts link with local fallback stacks (`Georgia` / system sans)
  so the page still looks right offline (`file://`, no network).
- **Components:** dark raised option buttons with orange hover/focus ring; visible keyboard
  focus; feedback state colors paired with an icon (✓ / ✗) so color is not the only signal;
  results review as a list of rows (question · your answer · verdict, plus the correct answer
  on its own line when you were wrong).

## 7. Error and edge handling

| Case | Behaviour |
|---|---|
| Corrupt or missing stored JSON | Ignore it, start at the `nickname` phase |
| `localStorage` unavailable (private mode) | Keep state in memory; show a banner: "Progress can't be saved in this browser." |
| Stored `questionOrder` no longer matches loaded questions (data file swapped mid-contest) | Discard stale progress, return to `nickname` with the field pre-filled and the note "The question set changed — starting over." |
| `QUESTIONS` missing, empty, or all entries invalid | Error screen with a readable message instead of a blank page |
| User reloads during `feedback` | The answer and `phase = "feedback"` are persisted; after the welcome-back card, **Continue** restores the marked options (and the screen-reader verdict) and **Next** button exactly as before |
| Empty nickname or longer than 20 chars | Inline validation message, no state change |
| Double-click on an option | Buttons disabled on first click |
| Answers with zero correct answers | Results screen still shows `lastAnswerAt` as the finish moment (no special case — `lastAnswerAt` tracks the latest answer regardless of correctness) |

## 8. Testing

No test tooling exists in this repo, so testing is split into:

1. **`tests/test.html`** — plain browser assertions over the pure logic, with a pass/fail list
   rendered on the page:
   - shuffle produces a permutation and covers every valid question id
   - seeded shuffle is deterministic (test uses a seeded RNG)
   - state transition table (start, answer, next, finish, restart) produces the expected
     `phase`, `questionIndex`, `score`, and `finishedAt`
   - `lastAnswerAt` updates on every answer; `finishedAt` equals `lastAnswerAt` after the final
     answer
   - storage read/write round-trip, and fallback when `localStorage` throws
   - question validation rejects bad entries (2 or 4 options, out-of-range `correctIndex`,
     empty text, duplicate ids)
2. **Manual checklist** (recorded in the implementation plan):
   - reload on every phase restores the same screen and position
   - **Start over** / **Play again** generate a new `sessionId` and reset score
   - finish with 0 correct answers shows a finish timestamp
   - corrupted stored state starts fresh without a console error
   - keyboard-only navigation: Tab through options, Enter to submit the nickname
   - narrow viewport (≈360px) does not overflow

## 9. Approach

Approach A — a screen-state machine with one persisted state object as the single source of
truth; `render()` shows the screen matching `state.phase`. Rejected alternatives: independent
`localStorage` keys per field (can drift apart across writes or tabs) and a minimal inline
script (no separation, tangled DOM logic; conflicts with the split-file requirement).

---

## 10. Amendment — poison bonus round, score bar, elapsed time (2026-10-11)

Sections 1–9 describe the shipped v1. This section records the approved v2 additions and is
the current contract wherever the two disagree.

### 10.1 Flow

`nickname → instructions → question → feedback → bonus? → … → results`

- **Instructions** appears only after a fresh **Start**. **Continue** (resume), **Play again**
  and **Start over** go straight to question 1.
- **Bonus** follows the feedback screen when — and only when — the answer was correct. A wrong
  answer skips it entirely.

### 10.2 Scoring

| Outcome | Points for the question |
|---|---|
| Correct, matched the bottle order on the 1st attempt | **11** (1 + a 10-point bonus) |
| Correct, matched on the 2nd attempt | **6** (1 + a 5-point bonus) |
| Correct, matched on the 3rd attempt | **4** (1 + a 3-point bonus) |
| Correct, no match after 3 attempts | **1** |
| Wrong answer | **0** |

Maximum **110 points** (10 questions × 11). Internally a correct answer pays 1 point at answer
time and the resolved bonus adds the remainder (10 / 5 / 3 / 0), so `score` is always the sum of
`answers[].points` — that equality is enforced by `validateStoredState`.

### 10.3 Bonus round interaction

Four poison bottles on the tray — toxic green, deep purple, blood red and cyanide cyan — each a
simple glossy neon vial (a round glass body, a short neck and a cork) drawn once as `#vial` and
reused everywhere, with the caption naming the colour (colour is never the only signal). The
player's order shows the same vial in each slot, and an unfilled slot is a dim, empty bottle.
The player clicks bottles to build an order left to right, **Check order** compares it with the
hidden permutation, **Clear** resets the picks. A miss leaves the round open with one attempt
consumed; the round settles on a match or on the third miss, then the summary replaces the
controls and **Next** continues. The hidden order is shown once the round settles.

On a match, each of the four filled slots is ringed in neon green (`--neon`, `#39ff14`) with a
soft glow that pulses (the pulse is disabled under `prefers-reduced-motion`), so the player can
see that every position matched. Only the **border** (and its glow) changes — the bottle inside
keeps its own colour and fill. The highlight is derived from `bonus.matched` at render time,
not stored: leaving the round clears it, so the next bonus opens with empty slots, no glow and
the bottles selectable again. A settled miss never lights the slots.

A match also flashes its award in the middle of the screen: a large `+10` / `+5` / `+3` (the
`+` and `bonus.award`) that fades in and out over two seconds. `#bonus-flash` is fixed and
viewport-centred and purely decorative (`aria-hidden`); the bonus summary line beneath the
slots carries the same award for screen readers. Under `prefers-reduced-motion` the award still
appears but without the pop. It is cleared by the same transition that clears the partial-miss
blink of the next paragraph.

Every check empties the slots again — the order is kept only on a match. When a check leaves at
least one bottle in the right position but does not solve the order, those borders flash neon
green for two seconds (four quick blinks; a steady border of the same colour under
`prefers-reduced-motion`) and the round then clears the boxes for the next attempt, with the
bottles and the controls locked while the flash is on screen. Only the border blinks; the bottle
inside is untouched. A check that gets nothing right clears at
once. The flash is derived from `bonus.tried`, the order submitted on the last check (an optional
stored field), never from the live selection; leaving or reloading the round drops it, so a
mid-round reload starts from empty slots with the attempts already spent. With four distinct
bottles the number of positions that can match is 0, 1, 2 or 4 (never 3), so a partial result
flashes one or two slots.

### 10.4 Score bar

`#hud` sits at the top of the card from the instructions screen through to the results, and is
hidden on the nickname and welcome-back screens. Format: `Total Points: 10 - Question 3/10`.
While a bonus is unresolved it shows the score before that bonus is settled.

### 10.5 Elapsed time

`startedAt` (Start), `elapsedMs` (accumulated), `lastTickAt` (last transition). Play time is
summed across every transition; a gap longer than **5 minutes** is ignored, so closing the tab
and coming back does not inflate the total. `finishedAt` is stamped when the results screen
opens, not at the last answer. The results screen shows `formatDuration(elapsedMs)`
(e.g. `6m 12s`) and the finish timestamp.

### 10.6 Storage

`STORAGE_KEY` is **`halloweenContest.state.v2`** — v1 states are not migrated (the old `score`
meant "correct answers", which cannot be mapped onto the new table). The legacy v1 key is
deleted on boot. New fields: `bonus { questionId, target, tried, attemptsUsed, matched,
resolved, award }`, `startedAt`, `elapsedMs`, `lastTickAt`; `answers[]` gains `points`. New
phases: `instructions`, `bonus`. `bonus.tried` (the last checked order, for the per-position
flash of §10.3) is optional: a state saved before it existed still validates, with nothing to
flash until the next check. Validation additionally rejects a bonus outside the bonus phase, a
non-permutation `target` or `tried`, more than three attempts, and any score that disagrees with
the sum of the recorded points.

### 10.7 Tests

`tests/test-suite.js` (Node and browser, 92 tests) covers the points table, bonus
validation, the per-position `matchPositions` helper, elapsed-time accumulation and the gap cap,
plus everything in §8.
`tests/app-check.html` (42 checks) drives the real page through instructions, HUD, both bonus
outcomes (the neon match highlight, the big centred "+10 / +5 / +3" award flash, the green flash
on a partial match and the empty slots it
leaves — including after a reload — and the settled miss), resume from every phase, and the
results screen.
`tests/layout-check.html` (37
checks) repeats the 360px overflow assertion at every step of the flow.
`tests/make-nostorage.js` regenerates the `localStorage`-blocked copy of `index.html`.
