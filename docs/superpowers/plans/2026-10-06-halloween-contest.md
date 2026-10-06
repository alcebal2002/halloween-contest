# Halloween Contest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dark, Halloween-themed trivia web game titled "Halloween Contest" that asks three-option questions, scores answers, and resumes from `localStorage` after a browser restart.

**Architecture:** Approach A — a screen-state machine driven by a single persisted state object. Pure game logic lives in `js/game-logic.js` (no DOM, no storage access) so it runs identically under Node for tests and in the browser; `js/app.js` owns rendering and event wiring and writes the state object to `localStorage` on every transition. Question data lives alone in `js/questions.js` so real JSON can replace it without touching logic.

**Tech Stack:** Vanilla HTML/CSS/ES5-compatible JavaScript. No build step, no dependencies, no framework. Runs from `file://`. Tests: Node built-in `assert`-free plain assertions via `node tests/run-tests.js`, plus `tests/test.html` for in-browser runs.

**Spec:** `docs/superpowers/specs/2026-10-06-halloween-contest-design.md` — the plan argues from the spec; read it before implementing.

## Global Constraints

- Page `<title>` must be exactly `Halloween Contest`.
- Exactly **3** options per question; exactly **1** correct answer (`correctIndex` in `0..2`).
- Nickname: trimmed, **1–20** characters (`MAX_NICKNAME_LENGTH = 20`).
- Questions per contest: **10** (`QUESTIONS_PER_CONTEST = 10`), shuffled once per contest.
- `localStorage` key: `halloweenContest.state.v1` (`GameLogic.STORAGE_KEY`).
- Timestamps stored as ISO-8601 strings (`Date#toISOString`); rendered with `Date#toLocaleString`.
- `lastAnswerAt` updates on **every** answer (correct or not); `finishedAt === lastAnswerAt` after the final question.
- Palette: bg `#0d0a14`, card `#14101c`, panel `#1c1726`, orange `#ff7a1a`, purple `#7c3aed`, red `#dc2626`, green `#16a34a`, bone `#f5efe6`, muted `#a89f91`.
- No external runtime dependencies. Google Fonts `<link>` is allowed but **must** have a local serif fallback stack so the page works offline.
- **No version control:** `ai-games` is not a git repository. Every "Commit" step in this plan is replaced by **saving the file**. Do not run `git` commands.
- Pure logic (`js/game-logic.js`, `js/questions.js`, `tests/test-suite.js`) must remain loadable in both Node (CommonJS) and the browser (`var` globals + `module.exports` guard).

## Review Focus

Inputs and conditions the spec calls out that a casual implementation gets wrong; each has a test in the task named.

1. **Reopening during `feedback`** — resume must restore the verdict and Next button, not a blank or re-answered question. → Task 3 `validateStoredState preserves the feedback phase`, Task 5 manual checklist item 1.
2. **Data file swapped mid-contest** (`questionOrder` ids no longer exist) — progress must be discarded and the nickname screen shown pre-filled with a note, never a crash. → Task 3 `loadState returns null when the stored order no longer resolves`, Task 5 checklist item 5.
3. **`localStorage` unavailable or throwing** (private mode / quota) — play must continue in memory with the banner visible. → Task 3 `saveState returns false when setItem throws` and `loadState returns null when getItem throws`, Task 5 checklist item 6.
4. **Double-clicking an option** — score must never double-count; the state must be unchanged. → Task 2 `answerQuestion is ignored unless the phase is question`.
5. **Finishing with zero correct answers** — results must still show a finish timestamp. → Task 2 `zero-correct run still records lastAnswerAt and finishedAt`.
6. **Corrupt stored JSON** — must fall back to a fresh start without throwing. → Task 3 `loadState returns null on invalid JSON`.

---

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | Markup for all six screens; loads CSS and the three scripts in order |
| `css/style.css` | Theme tokens, card layout, buttons, feedback colors, review list, responsive rules |
| `js/questions.js` | `var QUESTIONS = [...]` — the only file swapped when real data arrives |
| `js/game-logic.js` | Pure logic: validation, shuffle/selection, state transitions, storage read/write helpers |
| `js/app.js` | Boot, `render()`, event handlers, persistence side effects |
| `tests/test-suite.js` | Shared assertion suite consumed by both runners |
| `tests/run-tests.js` | Node runner (`node tests/run-tests.js`) |
| `tests/test.html` | Browser runner (open directly) |

---

### Task 1: Question data + validation and selection logic

**Files:**
- Create: `js/questions.js`
- Create: `js/game-logic.js`
- Create: `tests/test-suite.js`
- Create: `tests/run-tests.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (later tasks rely on these exact names):
  - `QUESTIONS` — `Array<{id:number, text:string, options:string[3], correctIndex:0|1|2}>`
  - `GameLogic.STORAGE_KEY: string`, `GameLogic.QUESTIONS_PER_CONTEST: number`, `GameLogic.MAX_NICKNAME_LENGTH: number`, `GameLogic.VALID_PHASES: string[]`
  - `GameLogic.isValidQuestion(q: any): boolean`
  - `GameLogic.shuffle(list: any[], rng?: () => number): any[]`
  - `GameLogic.selectQuestions(pool: any[], rng?: () => number): Array<question>`

- [x] **Step 1: Create the test runner scaffolding (expected to fail — suite not written yet)**

Create `tests/run-tests.js`:

```js
"use strict";
var suite = require("./test-suite.js");
var failed = 0;
suite.tests.forEach(function (t) {
  try {
    t.fn();
    console.log("PASS  " + t.name);
  } catch (e) {
    failed++;
    console.log("FAIL  " + t.name + " - " + (e && e.message ? e.message : e));
  }
});
console.log("");
console.log(suite.tests.length - failed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
```

- [x] **Step 2: Write the failing tests**

Create `tests/test-suite.js`:

```js
(function (root, factory) {
  "use strict";
  var GL = (typeof module !== "undefined" && module.exports)
    ? require("../js/game-logic.js")
    : root.GameLogic;
  var api = factory(GL);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TestSuite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL) {
  "use strict";

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || "assertEqual") + " - expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
    }
  }

  function validQuestion(id) {
    return { id: id, text: "Question " + id, options: ["A", "B", "C"], correctIndex: (id % 3) };
  }
  function makePool(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(validQuestion(i));
    return out;
  }
  function seededRandom(seed) {
    var s = seed;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }
  function fakeStorage(throwOnSet) {
    var map = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { if (throwOnSet) throw new Error("QuotaExceededError"); map[k] = String(v); },
      removeItem: function (k) { delete map[k]; }
    };
  }

  /* ---- Task 1: validation and selection ---- */

  test("isValidQuestion accepts a valid question", function () {
    assert(GL.isValidQuestion(validQuestion(1)));
  });

  test("isValidQuestion rejects anything other than exactly three options", function () {
    assert(!GL.isValidQuestion({ id: 1, text: "T", options: ["A", "B"], correctIndex: 0 }), "2 options accepted");
    assert(!GL.isValidQuestion({ id: 2, text: "T", options: ["A", "B", "C", "D"], correctIndex: 0 }), "4 options accepted");
    assert(!GL.isValidQuestion({ id: 3, text: "T", options: "ABC", correctIndex: 0 }), "non-array options accepted");
  });

  test("isValidQuestion rejects out-of-range or non-integer correctIndex", function () {
    assert(!GL.isValidQuestion({ id: 1, text: "T", options: ["A", "B", "C"], correctIndex: 3 }), "3 accepted");
    assert(!GL.isValidQuestion({ id: 2, text: "T", options: ["A", "B", "C"], correctIndex: -1 }), "-1 accepted");
    assert(!GL.isValidQuestion({ id: 3, text: "T", options: ["A", "B", "C"], correctIndex: 1.5 }), "fraction accepted");
  });

  test("isValidQuestion rejects blank text, blank options, and bad ids", function () {
    assert(!GL.isValidQuestion({ id: 1, text: "   ", options: ["A", "B", "C"], correctIndex: 0 }), "blank text accepted");
    assert(!GL.isValidQuestion({ id: 2, text: "T", options: ["A", "", "C"], correctIndex: 0 }), "blank option accepted");
    assert(!GL.isValidQuestion({ id: "7", text: "T", options: ["A", "B", "C"], correctIndex: 0 }), "string id accepted");
    assert(!GL.isValidQuestion(null), "null accepted");
  });

  test("selectQuestions returns at most QUESTIONS_PER_CONTEST valid unique ids", function () {
    var picked = GL.selectQuestions(makePool(25));
    assertEqual(picked.length, 10, "cap not applied to a pool of 25");
    var shortPick = GL.selectQuestions(makePool(4));
    assertEqual(shortPick.length, 4, "must return everything when the pool is smaller than the cap");
    var ids = picked.map(function (q) { return q.id; });
    assertEqual(new Set(ids).size, ids.length, "duplicate ids returned");
    picked.forEach(function (q) { assert(GL.isValidQuestion(q), "invalid question returned"); });
  });

  test("selectQuestions drops duplicate ids and invalid entries", function () {
    var pool = [validQuestion(1), validQuestion(1), validQuestion(2), { id: 3, text: "T", options: ["A"], correctIndex: 0 }];
    var picked = GL.selectQuestions(pool);
    var ids = picked.map(function (q) { return q.id; }).sort();
    assertEqual(JSON.stringify(ids), JSON.stringify([1, 2]), "dedupe/validation did not apply");
  });

  test("selectQuestions returns an empty array for an empty pool", function () {
    assertEqual(GL.selectQuestions([]).length, 0);
    assertEqual(GL.selectQuestions(null).length, 0);
  });

  test("shuffle is deterministic for a seeded rng and preserves members", function () {
    var input = [1, 2, 3, 4, 5, 6, 7, 8];
    var a = GL.shuffle(input, seededRandom(42));
    var b = GL.shuffle(input, seededRandom(42));
    assertEqual(JSON.stringify(a), JSON.stringify(b), "seeded shuffle not deterministic");
    assertEqual(JSON.stringify(a.slice().sort()), JSON.stringify(input.slice().sort()), "members changed");
    assertEqual(input.length, 8, "input mutated");
  });

  return { tests: tests };
});
```

- [x] **Step 3: Run the tests and confirm they fail**

Run: `node tests/run-tests.js`
Expected: FAIL with `Cannot find module '../js/game-logic.js'`.

- [x] **Step 4: Create `js/questions.js`**

```js
/* Question bank. Replace the contents of this file with the real JSON later —
   keep the same shape: { id, text, options: [3 strings], correctIndex } */
"use strict";
var QUESTIONS = [
  { id: 1, text: "Which vegetable was once believed to ward off vampires?", options: ["Turnip", "Garlic", "Onion"], correctIndex: 1 },
  { id: 2, text: "What is the fear of Halloween called?", options: ["Samhainophobia", "Acrophobia", "Claustrophobia"], correctIndex: 0 },
  { id: 3, text: "Which country originated the Day of the Dead?", options: ["Spain", "Brazil", "Mexico"], correctIndex: 2 },
  { id: 4, text: "Which Shakespeare play features three witches?", options: ["Macbeth", "Hamlet", "Othello"], correctIndex: 0 },
  { id: 5, text: "Which festival does Halloween descend from?", options: ["Samhain", "Beltane", "Imbolc"], correctIndex: 0 },
  { id: 6, text: "What do you call a group of witches?", options: ["A flock", "A coven", "A parliament"], correctIndex: 1 },
  { id: 7, text: "How many legs does a typical spider have?", options: ["Six", "Eight", "Ten"], correctIndex: 1 },
  { id: 8, text: "Which undead creature is reanimated from a corpse and travels in a shuffling horde?", options: ["Zombie", "Vampire", "Banshee"], correctIndex: 0 },
  { id: 9, text: "Which bird is most often seen as a bad omen?", options: ["Sparrow", "Robin", "Raven"], correctIndex: 2 },
  { id: 10, text: "Which city hosts the famous Village Halloween Parade?", options: ["Chicago", "New York", "Boston"], correctIndex: 1 },
  { id: 11, text: "What is the fear of ghosts called?", options: ["Phasmophobia", "Acrophobia", "Necrophobia"], correctIndex: 0 },
  { id: 12, text: "Which animal is a classic Halloween superstition symbol?", options: ["Black cat", "Golden fish", "Tortoise"], correctIndex: 0 },
  { id: 13, text: "In \"It's the Great Pumpkin, Charlie Brown\", who waits in the pumpkin patch?", options: ["Linus", "Charlie Brown", "Schroeder"], correctIndex: 0 },
  { id: 14, text: "Which classic monster is cursed to transform under a full moon?", options: ["Werewolf", "Mummy", "Ghost"], correctIndex: 0 },
  { id: 15, text: "What is the Halloween prank of unrolling toilet paper over a house called?", options: ["Egging", "TP-ing", "Soap the windows"], correctIndex: 1 },
  { id: 16, text: "Which classic vampire lives in Castle Dracula in Transylvania?", options: ["Count Dracula", "The Phantom", "The Creature"], correctIndex: 0 },
  { id: 17, text: "Which color is most associated with Halloween pumpkins?", options: ["Orange", "Blue", "Pink"], correctIndex: 0 }
];
if (typeof module !== "undefined" && module.exports) module.exports = QUESTIONS;
```

- [x] **Step 5: Create `js/game-logic.js` (Task 1 portion)**

```js
/* Pure game logic: no DOM, no localStorage. Loadable in Node and the browser. */
"use strict";

var STORAGE_KEY = "halloweenContest.state.v1";
var QUESTIONS_PER_CONTEST = 10;
var MAX_NICKNAME_LENGTH = 20;
var VALID_PHASES = ["nickname", "welcomeBack", "question", "feedback", "results"];

function isValidQuestion(q) {
  return !!q &&
    typeof q === "object" &&
    typeof q.id === "number" && Number.isInteger(q.id) &&
    typeof q.text === "string" && q.text.trim() !== "" &&
    Array.isArray(q.options) && q.options.length === 3 &&
    q.options.every(function (o) { return typeof o === "string" && o.trim() !== ""; }) &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 2;
}

function shuffle(list, rng) {
  var random = typeof rng === "function" ? rng : Math.random;
  var out = (list || []).slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(random() * (i + 1));
    var tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function dedupeById(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var key = list[i].id;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(list[i]);
  }
  return out;
}

function selectQuestions(pool, rng) {
  var list = Array.isArray(pool) ? pool : [];
  var valid = list.filter(isValidQuestion);
  var unique = dedupeById(valid);
  return shuffle(unique, rng).slice(0, QUESTIONS_PER_CONTEST);
}

var GameLogic = {
  STORAGE_KEY: STORAGE_KEY,
  QUESTIONS_PER_CONTEST: QUESTIONS_PER_CONTEST,
  MAX_NICKNAME_LENGTH: MAX_NICKNAME_LENGTH,
  VALID_PHASES: VALID_PHASES,
  isValidQuestion: isValidQuestion,
  shuffle: shuffle,
  selectQuestions: selectQuestions
};
if (typeof module !== "undefined" && module.exports) module.exports = GameLogic;
```

Note: `selectQuestions` returns **question objects** here; `createInitialState` (Task 2) maps them to the id-only `questionOrder` array required by the spec.

- [x] **Step 6: Run the tests and confirm they pass**

Run: `node tests/run-tests.js`
Expected: all Task 1 tests PASS, `0 failed`.

- [x] **Step 7: Save all four files.**

---

### Task 2: State machine (create, answer, advance, restart, nickname)

**Files:**
- Modify: `js/game-logic.js` (append; keep existing exports)
- Modify: `tests/test-suite.js` (append tests before the final `return`)

**Interfaces:**
- Consumes: Task 1 (`GameLogic.isValidQuestion`, `GameLogic.selectQuestions`).
- Produces:
  - `GameLogic.validateNickname(raw: any): {ok:boolean, nickname?:string, reason?:string}`
  - `GameLogic.createNewSessionId(): string` (`"hc_" + uuid`)
  - `GameLogic.createInitialState(nickname: string, pool: any[], options?: {sessionId?:string, rng?:function}): state`
  - `GameLogic.resolveOrder(state: object, pool: any[]): {ok:boolean, reason:""|"empty"|"missing", questions: question[]}`
  - `GameLogic.answerQuestion(state, questions, selected: number, now?: Date): state`
  - `GameLogic.advance(state, questions): state`
  - `GameLogic.formatTimestamp(iso: string|null): string`

`state` shape (identical to spec §4):
`{sessionId, nickname, phase, questionIndex, questionOrder:number[], answers:{questionId,selected,correct}[], score:number, lastAnswerAt:string|null, finishedAt:string|null}`

- [x] **Step 1: Append the failing tests** (insert before `return { tests: tests };` in `tests/test-suite.js`)

```js
  /* ---- Task 2: state machine ---- */

  test("createInitialState starts at phase question with an order of valid ids", function () {
    var s = GL.createInitialState("Player", makePool(25), { rng: seededRandom(99) });
    assertEqual(s.phase, "question");
    assertEqual(s.questionIndex, 0);
    assertEqual(s.score, 0);
    assertEqual(s.answers.length, 0);
    assertEqual(s.lastAnswerAt, null);
    assertEqual(s.finishedAt, null);
    assert(s.questionOrder.length === 10, "expected 10 ordered questions, got " + s.questionOrder.length);
    s.questionOrder.forEach(function (id) {
      assert(typeof id === "number", "questionOrder must hold ids, not objects");
    });
  });

  test("createInitialState generates a session id prefixed with hc_", function () {
    var s = GL.createInitialState("Player", makePool(12), { rng: seededRandom(99) });
    assert(s.sessionId.indexOf("hc_") === 0, "bad sessionId " + s.sessionId);
    var s2 = GL.createInitialState("Player", makePool(12), { rng: seededRandom(99) });
    assert(s.sessionId !== s2.sessionId, "session ids must differ between contests");
  });

  test("validateNickname trims and enforces 1-20 characters", function () {
    assertEqual(GL.validateNickname("  Bat  ").nickname, "Bat");
    assertEqual(GL.validateNickname("").ok, false);
    assertEqual(GL.validateNickname("     ").ok, false);
    assertEqual(GL.validateNickname("a".repeat(20)).ok, true);
    assertEqual(GL.validateNickname("a".repeat(21)).ok, false);
    assertEqual(GL.validateNickname(null).ok, false);
    assertEqual(GL.validateNickname(42).ok, false);
  });

  test("answerQuestion records a correct answer and sets phase feedback", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var q = ctx.questions[0];
    var at = new Date("2026-10-06T14:52:11.000Z");
    var next = GL.answerQuestion(ctx.state, ctx.questions, q.correctIndex, at);
    assertEqual(next.phase, "feedback");
    assertEqual(next.score, 1);
    assertEqual(next.answers.length, 1);
    assertEqual(next.answers[0].correct, true);
    assertEqual(next.answers[0].questionId, q.id);
    assertEqual(next.lastAnswerAt, "2026-10-06T14:52:11.000Z");
  });

  test("answerQuestion leaves the score alone for a wrong answer", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var wrong = (ctx.questions[0].correctIndex + 1) % 3;
    var next = GL.answerQuestion(ctx.state, ctx.questions, wrong, new Date());
    assertEqual(next.score, 0);
    assertEqual(next.answers[0].correct, false);
    assertEqual(next.phase, "feedback");
    assert(!!next.lastAnswerAt, "lastAnswerAt must be set even when wrong");
  });

  test("answerQuestion is ignored unless the phase is question", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var once = GL.answerQuestion(ctx.state, ctx.questions, 0, new Date());
    var twice = GL.answerQuestion(once, ctx.questions, 1, new Date());
    assertEqual(twice, once, "double click must return the identical state");
    assertEqual(twice.answers.length, 1, "answer recorded twice");
    assertEqual(twice.score, once.score, "score double counted");
  });

  test("advance moves to the next question and keeps the score", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var answered = GL.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    var next = GL.advance(answered, ctx.questions);
    assertEqual(next.phase, "question");
    assertEqual(next.questionIndex, 1);
    assertEqual(next.score, 1);
    assertEqual(next.answers.length, 1);
  });

  test("advance on the final question goes to results and stamps finishedAt", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var s = ctx.state;
    for (var i = 0; i < ctx.questions.length - 1; i++) {
      s = GL.advance(GL.answerQuestion(s, ctx.questions, 0, new Date()), ctx.questions);
    }
    assertEqual(s.phase, "question");
    assertEqual(s.questionIndex, ctx.questions.length - 1);
    var lastAt = new Date("2026-10-31T21:00:00.000Z");
    var answered = GL.answerQuestion(s, ctx.questions, ctx.questions[s.questionIndex].correctIndex, lastAt);
    assertEqual(answered.finishedAt, "2026-10-31T21:00:00.000Z", "finishedAt must equal lastAnswerAt");
    var done = GL.advance(answered, ctx.questions);
    assertEqual(done.phase, "results");
    assertEqual(done.questionIndex, ctx.questions.length - 1);
  });

  test("zero-correct run still records lastAnswerAt and finishedAt", function () {
    var ctx = buildContest(GL, makePool(25), "Unlucky");
    var s = ctx.state;
    for (var i = 0; i < ctx.questions.length; i++) {
      var wrong = (ctx.questions[i].correctIndex + 1) % 3;
      s = GL.answerQuestion(s, ctx.questions, wrong, new Date());
      s = GL.advance(s, ctx.questions);
    }
    assertEqual(s.phase, "results");
    assertEqual(s.score, 0);
    assert(!!s.lastAnswerAt, "lastAnswerAt missing");
    assertEqual(s.finishedAt, s.lastAnswerAt, "finish timestamp must be the latest answer time");
  });

  test("restarting keeps the nickname but resets progress and session id", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var played = GL.answerQuestion(ctx.state, ctx.questions, 0, new Date());
    var fresh = GL.createInitialState(played.nickname, makePool(25), { rng: Math.random });
    assertEqual(fresh.nickname, "Hero");
    assertEqual(fresh.phase, "question");
    assertEqual(fresh.questionIndex, 0);
    assertEqual(fresh.answers.length, 0);
    assertEqual(fresh.score, 0);
    assertEqual(fresh.lastAnswerAt, null);
    assertEqual(fresh.finishedAt, null);
    assert(fresh.sessionId !== played.sessionId, "sessionId must be regenerated");
  });

  test("resolveOrder reports missing when the stored order no longer resolves", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var okResult = GL.resolveOrder(ctx.state, makePool(25));
    assertEqual(okResult.ok, true);
    var swapped = GL.resolveOrder(ctx.state, makePool(1));
    assertEqual(swapped.ok, false);
    assertEqual(swapped.reason, "missing");
    var empty = GL.resolveOrder({ questionOrder: [] }, makePool(25));
    assertEqual(empty.ok, false);
    assertEqual(empty.reason, "empty");
  });

  test("formatTimestamp renders a valid date and blanks invalid input", function () {
    assert(GL.formatTimestamp("2026-10-06T14:52:11.000Z").length > 0);
    assertEqual(GL.formatTimestamp(null), "");
    assertEqual(GL.formatTimestamp("not a date"), "");
    assertEqual(GL.formatTimestamp(undefined), "");
  });
```

Add these two helpers anywhere above the tests (they keep the test bodies short):

```js
  function buildContest(GL_, pool, nickname) {
    var state = GL_.createInitialState(nickname, pool, { rng: seededRandom(7) });
    var resolved = GL_.resolveOrder(state, pool);
    return { state: state, questions: resolved.questions };
  }
```

- [x] **Step 2: Run the tests and confirm the new ones fail**

Run: `node tests/run-tests.js`
Expected: new tests FAIL with `GL.createInitialState is not a function` (Task 1 tests still PASS).

- [x] **Step 3: Implement the state machine**

Append to `js/game-logic.js` (before the `var GameLogic = {` block), then add every new name to the `GameLogic` object:

```js
function validateNickname(raw) {
  var nickname = typeof raw === "string" ? raw.trim() : "";
  if (!nickname) return { ok: false, reason: "Enter a nickname to start." };
  if (nickname.length > MAX_NICKNAME_LENGTH) {
    return { ok: false, reason: "Nickname must be " + MAX_NICKNAME_LENGTH + " characters or fewer." };
  }
  return { ok: true, nickname: nickname };
}

function createNewSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "hc_" + crypto.randomUUID();
  }
  return "hc_" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function createInitialState(nickname, pool, options) {
  var opts = options || {};
  return {
    sessionId: opts.sessionId || createNewSessionId(),
    nickname: nickname,
    phase: "question",
    questionIndex: 0,
    questionOrder: selectQuestions(pool, opts.rng).map(function (q) { return q.id; }),
    answers: [],
    score: 0,
    lastAnswerAt: null,
    finishedAt: null
  };
}

function resolveOrder(state, pool) {
  var order = state && state.questionOrder;
  if (!Array.isArray(order) || order.length === 0) return { ok: false, reason: "empty", questions: [] };
  var byId = {};
  (Array.isArray(pool) ? pool : []).forEach(function (q) { if (isValidQuestion(q)) byId[q.id] = q; });
  var questions = [];
  for (var i = 0; i < order.length; i++) {
    var q = byId[order[i]];
    if (!q) return { ok: false, reason: "missing", questions: [] };
    questions.push(q);
  }
  return { ok: true, reason: "", questions: questions };
}

function answerQuestion(state, questions, selected, now) {
  if (!state || state.phase !== "question") return state;
  var q = questions && questions[state.questionIndex];
  if (!q) return state;
  if (!Number.isInteger(selected) || selected < 0 || selected > 2) return state;
  var at = now instanceof Date ? now : new Date(now || Date.now());
  var correct = selected === q.correctIndex;
  var next = cloneState(state);
  next.answers = state.answers.concat([{ questionId: q.id, selected: selected, correct: correct }]);
  next.score = state.score + (correct ? 1 : 0);
  next.lastAnswerAt = at.toISOString();
  next.phase = "feedback";
  if (state.questionIndex === questions.length - 1) next.finishedAt = next.lastAnswerAt;
  return next;
}

function advance(state, questions) {
  if (!state || state.phase !== "feedback") return state;
  var next = cloneState(state);
  if (state.questionIndex >= questions.length - 1) {
    next.phase = "results";
  } else {
    next.questionIndex = state.questionIndex + 1;
    next.phase = "question";
  }
  return next;
}

function formatTimestamp(iso) {
  if (typeof iso !== "string") return "";
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}
```

Then extend the export block:

```js
var GameLogic = {
  STORAGE_KEY: STORAGE_KEY,
  QUESTIONS_PER_CONTEST: QUESTIONS_PER_CONTEST,
  MAX_NICKNAME_LENGTH: MAX_NICKNAME_LENGTH,
  VALID_PHASES: VALID_PHASES,
  isValidQuestion: isValidQuestion,
  shuffle: shuffle,
  selectQuestions: selectQuestions,
  validateNickname: validateNickname,
  createNewSessionId: createNewSessionId,
  createInitialState: createInitialState,
  resolveOrder: resolveOrder,
  answerQuestion: answerQuestion,
  advance: advance,
  formatTimestamp: formatTimestamp
};
```

- [x] **Step 4: Run the tests and confirm they pass**

Run: `node tests/run-tests.js`
Expected: `0 failed`.

- [x] **Step 5: Save both files.**

---

### Task 3: Storage, resume validation, and the Review Focus failure modes

**Files:**
- Modify: `js/game-logic.js`
- Modify: `tests/test-suite.js`

**Interfaces:**
- Consumes: Task 1–2 functions.
- Produces:
  - `GameLogic.validateStoredState(raw: any, pool: any[]): state|null`
  - `GameLogic.loadState(storage: Storage, pool: any[]): state|null` (never throws)
  - `GameLogic.saveState(storage: Storage, state): boolean`
  - `GameLogic.clearState(storage: Storage): void` (never throws)

- [x] **Step 1: Append the failing tests** (before `return { tests: tests };`)

```js
  /* ---- Task 3: storage ---- */

  test("validateStoredState rejects malformed objects", function () {
    var pool = makePool(25);
    assertEqual(GL.validateStoredState(null, pool), null);
    assertEqual(GL.validateStoredState({ phase: "question" }, pool), null);
    var good = GL.createInitialState("Hero", pool, { rng: seededRandom(3) });
    var badPhase = Object.assign({}, good, { phase: "sideways" });
    assertEqual(GL.validateStoredState(badPhase, pool), null);
    var badIndex = Object.assign({}, good, { questionIndex: 999 });
    assertEqual(GL.validateStoredState(badIndex, pool), null);
    var badNick = Object.assign({}, good, { nickname: "   " });
    assertEqual(GL.validateStoredState(badNick, pool), null);
  });

  test("validateStoredState round-trips a saved contest unchanged", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var answered = GL.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    var parsed = JSON.parse(JSON.stringify(answered));
    var restored = GL.validateStoredState(parsed, pool);
    assert(restored !== null, "valid state rejected");
    assertEqual(restored.sessionId, answered.sessionId);
    assertEqual(restored.phase, "feedback");
    assertEqual(restored.score, 1);
    assertEqual(restored.questionIndex, 0);
    assertEqual(restored.lastAnswerAt, answered.lastAnswerAt);
  });

  test("loadState returns null on invalid JSON", function () {
    var s = fakeStorage(false);
    s.setItem(GL.STORAGE_KEY, "{not json");
    assertEqual(GL.loadState(s, makePool(25)), null);
  });

  test("loadState returns null when getItem throws", function () {
    var throwing = { getItem: function () { throw new Error("SecurityError"); }, setItem: function () {}, removeItem: function () {} };
    assertEqual(GL.loadState(throwing, makePool(25)), null);
  });

  test("loadState returns null when the stored order no longer resolves", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var s = fakeStorage(false);
    s.setItem(GL.STORAGE_KEY, JSON.stringify(ctx.state));
    assert(GL.loadState(s, pool) !== null, "same pool must load");
    assertEqual(GL.loadState(s, makePool(1)), null, "swapped data set must not resume stale progress");
  });

  test("loadState returns null when no state is stored", function () {
    assertEqual(GL.loadState(fakeStorage(false), makePool(5)), null);
  });

  test("saveState returns false when setItem throws and true otherwise", function () {
    var state = GL.createInitialState("Hero", makePool(25), { rng: seededRandom(5) });
    assertEqual(GL.saveState(fakeStorage(true), state), false);
    var ok = fakeStorage(false);
    assertEqual(GL.saveState(ok, state), true);
    assert(GL.loadState(ok, makePool(25)) !== null, "saved state did not reload");
  });

  test("clearState never throws on a locked or missing storage", function () {
    var throwing = { getItem: function () { throw new Error("x"); }, setItem: function () { throw new Error("x"); }, removeItem: function () { throw new Error("x"); } };
    GL.clearState(throwing);
    GL.clearState(fakeStorage(false));
  });
```

- [x] **Step 2: Run and confirm the new tests fail**

Run: `node tests/run-tests.js`
Expected: FAIL with `GL.validateStoredState is not a function`.

- [x] **Step 3: Implement storage helpers**

Append to `js/game-logic.js` and add all four names to the `GameLogic` export object:

```js
function validateStoredState(raw, pool) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.sessionId !== "string" || raw.sessionId === "") return null;
  var nickname = validateNickname(raw.nickname);
  if (!nickname.ok) return null;
  if (VALID_PHASES.indexOf(raw.phase) === -1) return null;
  if (!Array.isArray(raw.answers) || !Array.isArray(raw.questionOrder)) return null;
  if (typeof raw.score !== "number" || !Number.isInteger(raw.score) || raw.score < 0) return null;
  if (!Number.isInteger(raw.questionIndex) || raw.questionIndex < 0) return null;

  var answers = [];
  for (var i = 0; i < raw.answers.length; i++) {
    var a = raw.answers[i];
    if (!a || typeof a !== "object" || typeof a.questionId !== "number" ||
        !Number.isInteger(a.selected) || a.selected < 0 || a.selected > 2) return null;
    answers.push({ questionId: a.questionId, selected: a.selected, correct: !!a.correct });
  }

  var state = {
    sessionId: raw.sessionId,
    nickname: nickname.nickname,
    phase: raw.phase,
    questionIndex: raw.questionIndex,
    questionOrder: raw.questionOrder.slice(),
    answers: answers,
    score: raw.score,
    lastAnswerAt: typeof raw.lastAnswerAt === "string" ? raw.lastAnswerAt : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null
  };

  // The nickname screen may legitimately have no contest yet.
  if (state.phase === "nickname") return state;

  var resolved = resolveOrder(state, pool);
  if (!resolved.ok) return null;
  if (state.questionIndex >= resolved.questions.length) return null;
  return state;
}

function loadState(storage, pool) {
  try {
    var raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateStoredState(JSON.parse(raw), pool);
  } catch (e) {
    return null;
  }
}

function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

function clearState(storage) {
  try { storage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}
```

- [x] **Step 4: Run and confirm all tests pass**

Run: `node tests/run-tests.js`
Expected: `0 failed`.

- [x] **Step 5: Save both files.**

---

### Task 4: Markup and Halloween theme

**Files:**
- Create: `index.html`
- Create: `css/style.css`

**Interfaces:**
- Consumes: nothing at runtime yet (scripts are linked but `app.js` arrives in Task 5).
- Produces (Task 5 relies on these exact ids):
  `#storage-banner`, `#screen-nickname` (with `#nickname`, `#nickname-error`, `#nickname-note`, `#btn-start`),
  `#screen-welcome-back` (`#welcome-back-name`, `#welcome-back-progress`, `#btn-continue`, `#btn-start-over`),
  `#screen-question` (`#question-progress`, `#question-text`, `#question-options`),
  `#screen-feedback` (`#feedback-progress`, `#feedback-text`, `#feedback-options`, `#feedback-verdict`, `#btn-next`),
  `#screen-results` (`#results-score`, `#results-finished`, `#results-review`, `#btn-play-again`),
  `#screen-error` (`#error-message`).

- [x] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Halloween Contest</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Creepster&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div class="fog" aria-hidden="true"></div>

<p id="storage-banner" class="storage-banner" hidden>Progress can't be saved in this browser.</p>

<main class="card">
  <header class="masthead">
    <span class="deco" aria-hidden="true">🎃 👻 🦇</span>
    <h1 class="title">Halloween Contest</h1>
    <p class="tagline">Answer the questions if you dare.</p>
  </header>

  <section id="screen-nickname" class="screen">
    <div class="field">
      <label for="nickname">Nickname</label>
      <input id="nickname" type="text" maxlength="24" autocomplete="off" placeholder="e.g. GhostRider">
      <p id="nickname-error" class="field-error" role="alert" hidden></p>
      <p id="nickname-note" class="field-note" hidden>The question set changed &mdash; starting over.</p>
    </div>
    <button id="btn-start" class="btn btn-primary" type="button">Start</button>
  </section>

  <section id="screen-welcome-back" class="screen" hidden>
    <h2 id="welcome-back-name"></h2>
    <p id="welcome-back-progress" class="progress"></p>
    <div class="actions">
      <button id="btn-continue" class="btn btn-primary" type="button">Continue</button>
      <button id="btn-start-over" class="btn btn-ghost" type="button">Start over</button>
    </div>
  </section>

  <section id="screen-question" class="screen" hidden>
    <p id="question-progress" class="progress"></p>
    <h2 id="question-text"></h2>
    <div id="question-options" class="options" role="group" aria-label="Answer options"></div>
  </section>

  <section id="screen-feedback" class="screen" hidden>
    <p id="feedback-progress" class="progress"></p>
    <h2 id="feedback-text"></h2>
    <div id="feedback-options" class="options" aria-live="polite"></div>
    <p id="feedback-verdict" class="verdict"></p>
    <button id="btn-next" class="btn btn-primary" type="button">Next</button>
  </section>

  <section id="screen-results" class="screen" hidden>
    <p class="progress">Finished</p>
    <h2 id="results-title"></h2>
    <p id="results-score" class="score"></p>
    <p id="results-finished" class="finished-at"></p>
    <ol id="results-review" class="review"></ol>
    <button id="btn-play-again" class="btn btn-primary" type="button">Play again</button>
  </section>

  <section id="screen-error" class="screen" hidden>
    <h2>Something went wrong</h2>
    <p id="error-message" class="field-error"></p>
  </section>
</main>

<footer class="page-foot">Happy Halloween 🕸️</footer>

<script src="js/questions.js"></script>
<script src="js/game-logic.js"></script>
<script src="js/app.js"></script>
</body>
</html>
```

- [x] **Step 2: Create `css/style.css`**

```css
:root {
  --bg: #0d0a14;
  --card: #14101c;
  --panel: #1c1726;
  --orange: #ff7a1a;
  --purple: #7c3aed;
  --red: #dc2626;
  --green: #16a34a;
  --bone: #f5efe6;
  --muted: #a89f91;
  --radius: 14px;
  --serif: "Creepster", "Georgia", "Times New Roman", serif;
  --sans: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body { min-height: 100%; }

body {
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(124, 58, 237, 0.28), transparent 60%),
    radial-gradient(900px 500px at 50% 115%, rgba(255, 122, 26, 0.16), transparent 60%),
    var(--bg);
  color: var(--bone);
  font-family: var(--sans);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 32px 16px;
  min-height: 100vh;
}

.fog {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(0, 0, 0, 0.75) 100%);
  z-index: 0;
}

.storage-banner {
  position: relative;
  z-index: 1;
  background: rgba(220, 38, 38, 0.16);
  border: 1px solid var(--red);
  color: #fecaca;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 14px;
}

.card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 640px;
  background: linear-gradient(180deg, var(--card), #100d17);
  border: 1px solid rgba(124, 58, 237, 0.45);
  border-radius: var(--radius);
  box-shadow: 0 0 60px rgba(255, 122, 26, 0.12), 0 24px 60px rgba(0, 0, 0, 0.6);
  padding: 32px 28px 36px;
}

.masthead { text-align: center; margin-bottom: 26px; }
.deco { display: block; font-size: 26px; letter-spacing: 6px; margin-bottom: 8px; }

.title {
  font-family: var(--serif);
  font-weight: 400;
  font-size: clamp(38px, 8vw, 58px);
  letter-spacing: 2px;
  color: var(--orange);
  text-shadow: 0 0 18px rgba(255, 122, 26, 0.55), 0 0 44px rgba(255, 122, 26, 0.25);
  animation: flicker 5s infinite;
}

.tagline { color: var(--muted); margin-top: 6px; font-size: 15px; }

@keyframes flicker {
  0%, 100% { opacity: 1; }
  47% { opacity: 1; }
  48% { opacity: 0.72; }
  49% { opacity: 1; }
  71% { opacity: 0.85; }
  72% { opacity: 1; }
}

.screen { animation: rise 0.25s ease-out; }

@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

h2 {
  font-family: var(--serif);
  font-weight: 400;
  font-size: clamp(22px, 4.5vw, 30px);
  line-height: 1.35;
  margin: 14px 0 20px;
  color: var(--bone);
}

.progress {
  color: var(--orange);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.field { margin-bottom: 20px; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; letter-spacing: 1px; text-transform: uppercase; }

.field input {
  width: 100%;
  background: var(--panel);
  border: 1px solid rgba(168, 159, 145, 0.35);
  border-radius: 10px;
  color: var(--bone);
  font-size: 18px;
  padding: 13px 14px;
  outline: none;
}
.field input:focus { border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 122, 26, 0.25); }

.field-error { color: #fca5a5; font-size: 14px; margin-top: 8px; }
.field-note { color: var(--muted); font-size: 14px; margin-top: 8px; font-style: italic; }

.options { display: flex; flex-direction: column; gap: 12px; }

.btn {
  font-family: var(--sans);
  font-size: 16px;
  font-weight: 600;
  border-radius: 10px;
  padding: 14px 20px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.btn:focus-visible { outline: 3px solid var(--purple); outline-offset: 2px; }
.btn-primary { background: var(--orange); color: #1a0f04; width: 100%; }
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255, 122, 26, 0.35); }
.btn-ghost { background: transparent; color: var(--muted); border-color: rgba(168, 159, 145, 0.4); }
.btn-ghost:hover { color: var(--bone); border-color: var(--bone); }
.actions { display: flex; flex-direction: column; gap: 10px; }

.option {
  text-align: left;
  background: var(--panel);
  border: 1px solid rgba(124, 58, 237, 0.35);
  color: var(--bone);
  border-radius: 10px;
  padding: 15px 16px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
}
.option:hover:not(:disabled) { border-color: var(--orange); background: #221b30; transform: translateY(-1px); }
.option:focus-visible { outline: 3px solid var(--purple); outline-offset: 2px; }
.option:disabled { cursor: default; opacity: 1; }
.option .mark { font-weight: 700; width: 20px; text-align: center; }
.option.is-correct { border-color: var(--green); background: rgba(22, 163, 74, 0.18); }
.option.is-wrong { border-color: var(--red); background: rgba(220, 38, 38, 0.18); }
.option.is-muted { opacity: 0.5; }

.verdict { margin: 18px 0; font-size: 16px; font-weight: 600; min-height: 22px; }
.verdict.is-correct { color: #86efac; }
.verdict.is-wrong { color: #fca5a5; }

.score { font-size: clamp(34px, 9vw, 52px); font-family: var(--serif); color: var(--orange); margin: 6px 0; }
.finished-at { color: var(--muted); font-size: 14px; margin-bottom: 18px; }

.review { list-style: none; display: flex; flex-direction: column; gap: 10px; margin-bottom: 22px; }
.review li {
  background: var(--panel);
  border: 1px solid rgba(168, 159, 145, 0.2);
  border-left-width: 4px;
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 14px;
}
.review li.ok { border-left-color: var(--green); }
.review li.bad { border-left-color: var(--red); }
.review .q { font-weight: 600; margin-bottom: 6px; }
.review .a { color: var(--muted); }
.review .a b { color: var(--bone); font-weight: 600; }
.review .verdict-tag { float: right; font-weight: 700; }
.review li.ok .verdict-tag { color: #86efac; }
.review li.bad .verdict-tag { color: #fca5a5; }

.page-foot { position: relative; z-index: 1; color: var(--muted); font-size: 13px; }

@media (min-width: 560px) {
  .actions { flex-direction: row; }
  .actions .btn { width: auto; flex: 1; }
  .btn-primary { width: 100%; }
}
```

- [x] **Step 3: Verify visually**

Run: open `index.html` in the browser (browser preview). Confirm: title reads **Halloween Contest**, dark purple/orange theme, nickname screen visible (all other screens hidden by `hidden`), page readable at 360px width.

Expected: nickname screen renders; no console errors other than `QUESTIONS is defined but never used` / `GameLogic is not defined`-style warnings from the missing `app.js` — `js/app.js` does not exist yet, so the browser will report a **404 / failed to load `js/app.js`**. That is expected at this task.

- [x] **Step 4: Save both files.**

---

### Task 5: App wiring (boot, render, handlers, persistence)

**Files:**
- Create: `js/app.js`

**Interfaces:**
- Consumes: `QUESTIONS` (Task 1), `GameLogic.*` (Tasks 1–3), DOM ids (Task 4).
- Produces: a working game; plus the debug handle `window.HalloweenApp = { getState, getView, getQuestions }` used by the manual checklist.

- [x] **Step 1: Create `js/app.js`**

```js
(function () {
  "use strict";

  var pool = Array.isArray(typeof QUESTIONS !== "undefined" ? QUESTIONS : null) ? QUESTIONS : [];
  var storage = null;
  var storageAvailable = true;
  var state = null;
  var questions = [];
  var view = "nickname";        // nickname | welcomeBack | question | feedback | results | error
  var pendingPhase = null;      // stored phase to restore via Continue
  var lastFeedback = null;      // { correct: boolean, correctText: string }
  var note = "";                // "question set changed" note
  var el = {};

  var SCREENS = ["screen-nickname", "screen-welcome-back", "screen-question", "screen-feedback", "screen-results", "screen-error"];

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function emptyState() {
    return {
      sessionId: "", nickname: "", phase: "nickname", questionIndex: 0,
      questionOrder: [], answers: [], score: 0, lastAnswerAt: null, finishedAt: null
    };
  }

  function detectStorage() {
    try {
      var probe = "__hc_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function persist() {
    if (!storage || !storageAvailable) return;
    if (!GameLogic.saveState(storage, state)) {
      storageAvailable = false;
      el.banner.hidden = false;
    }
  }

  function showNoQuestions() {
    view = "error";
    el.errorMessage.textContent = "No questions are available right now. Please add questions to js/questions.js and reload.";
    render();
  }

  function boot() {
    el = {
      banner: $("storage-banner"),
      nickname: $("nickname"),
      nicknameError: $("nickname-error"),
      nicknameNote: $("nickname-note"),
      start: $("btn-start"),
      welcomeName: $("welcome-back-name"),
      welcomeProgress: $("welcome-back-progress"),
      continueBtn: $("btn-continue"),
      startOver: $("btn-start-over"),
      qProgress: $("question-progress"),
      qText: $("question-text"),
      qOptions: $("question-options"),
      fProgress: $("feedback-progress"),
      fText: $("feedback-text"),
      fOptions: $("feedback-options"),
      fVerdict: $("feedback-verdict"),
      next: $("btn-next"),
      rTitle: $("results-title"),
      rScore: $("results-score"),
      rFinished: $("results-finished"),
      rReview: $("results-review"),
      playAgain: $("btn-play-again"),
      errorMessage: $("error-message")
    };

    storage = detectStorage();
    if (!storage) {
      storageAvailable = false;
      el.banner.hidden = false;
    }

    if (pool.filter(GameLogic.isValidQuestion).length === 0) {
      view = "error";
      el.errorMessage.textContent = "No questions are available right now. Please add questions to js/questions.js and reload.";
      render();
      wire();
      return;
    }

    var raw = (storage && storage.getItem(GameLogic.STORAGE_KEY)) || null;
    var loaded = storage && raw ? GameLogic.loadState(storage, pool) : null;
    if (!loaded) {
      state = emptyState();
      view = "nickname";
      // Something was stored but could not be resumed (corrupt JSON, or the data
      // file changed): pre-fill the nickname and explain, per spec §7.
      if (raw) {
        note = "changed";
        el.nicknameNote.hidden = false;
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        var peek = parsed ? GameLogic.validateNickname(parsed.nickname) : { ok: false };
        if (peek.ok) {
          state.nickname = peek.nickname;
          el.nickname.value = peek.nickname;
        }
      }
    } else if (loaded.phase === "nickname") {
      state = loaded;
      view = "nickname";
      el.nickname.value = loaded.nickname;
    } else {
      state = loaded;
      questions = GameLogic.resolveOrder(state, pool).questions;
      pendingPhase = state.phase;
      view = "welcomeBack";
    }

    render();
    wire();
  }

  function wire() {
    el.start.addEventListener("click", onStart);
    el.nickname.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); onStart(); }
    });
    el.continueBtn.addEventListener("click", onContinue);
    el.startOver.addEventListener("click", onStartOver);
    el.next.addEventListener("click", onNext);
    el.playAgain.addEventListener("click", onStartOver);
  }

  function onStart() {
    var check = GameLogic.validateNickname(el.nickname.value);
    if (!check.ok) {
      el.nicknameError.hidden = false;
      el.nicknameError.textContent = check.reason;
      el.nickname.focus();
      return;
    }
    el.nicknameError.hidden = true;
    state = GameLogic.createInitialState(check.nickname, pool);
    questions = GameLogic.resolveOrder(state, pool).questions;
    if (questions.length === 0) { showNoQuestions(); return; }
    lastFeedback = null;
    persist();
    view = "question";
    render();
  }

  function onContinue() {
    questions = GameLogic.resolveOrder(state, pool).questions;
    if (questions.length === 0) { showNoQuestions(); return; }
    view = pendingPhase || state.phase;
    pendingPhase = null;
    if (view === "feedback") restoreFeedback();
    render();
  }

  function onStartOver() {
    state = GameLogic.createInitialState(state.nickname || (el.nickname && el.nickname.value) || "", pool);
    questions = GameLogic.resolveOrder(state, pool).questions;
    lastFeedback = null;
    persist();
    view = "question";
    render();
  }

  function onAnswer(selected) {
    if (state.phase !== "question") return;
    var q = questions[state.questionIndex];
    var next = GameLogic.answerQuestion(state, questions, selected, new Date());
    if (next === state) return;
    lastFeedback = {
      correct: next.answers[next.answers.length - 1].correct,
      correctText: q.options[q.correctIndex]
    };
    state = next;
    persist();
    view = "feedback";
    render();
  }

  function onNext() {
    state = GameLogic.advance(state, questions);
    persist();
    lastFeedback = null;
    view = state.phase; // "question" or "results"
    render();
  }

  function restoreFeedback() {
    var last = state.answers[state.answers.length - 1];
    var q = questions[state.questionIndex];
    if (!last || !q) return;
    lastFeedback = { correct: last.correct, correctText: q.options[q.correctIndex] };
  }

  function optionMarkup(q, correctIndex, mode, selected) {
    var letters = ["A", "B", "C"];
    return q.options.map(function (text, i) {
      var cls = "option";
      var mark = letters[i];
      if (mode === "feedback") {
        if (i === correctIndex) { cls += " is-correct"; mark = "\u2713"; }
        else if (i === selected) { cls += " is-wrong"; mark = "\u2717"; }
        else { cls += " is-muted"; }
      }
      var disabled = mode === "feedback" ? " disabled" : "";
      return '<button class="' + cls + '" type="button" data-index="' + i + '"' + disabled + '>' +
        '<span class="mark" aria-hidden="true">' + mark + "</span><span>" + esc(text) + "</span></button>";
    }).join("");
  }

  function render() {
    SCREENS.forEach(function (id) { $(id).hidden = true; });

    if (view === "nickname") {
      el.nicknameNote.hidden = note !== "changed";
      $("screen-nickname").hidden = false;
      return;
    }

    if (view === "welcomeBack") {
      el.welcomeName.textContent = "Welcome back, " + state.nickname;
      el.welcomeProgress.textContent = (pendingPhase === "results")
        ? "Finished - score " + state.score + " / " + questions.length
        : "Question " + (state.questionIndex + 1) + " of " + questions.length;
      $("screen-welcome-back").hidden = false;
      return;
    }

    if (view === "question") {
      el.qProgress.textContent = "Question " + (state.questionIndex + 1) + " of " + questions.length;
      var q = questions[state.questionIndex];
      el.qText.textContent = q.text;
      el.qOptions.innerHTML = optionMarkup(q, q.correctIndex, "question", -1);
      Array.prototype.forEach.call(el.qOptions.querySelectorAll(".option"), function (btn) {
        btn.addEventListener("click", function () { onAnswer(parseInt(btn.getAttribute("data-index"), 10)); });
      });
      $("screen-question").hidden = false;
      return;
    }

    if (view === "feedback") {
      if (!lastFeedback) restoreFeedback();
      var fq = questions[state.questionIndex];
      var last = state.answers[state.answers.length - 1];
      el.fProgress.textContent = "Question " + (state.questionIndex + 1) + " of " + questions.length;
      el.fText.textContent = fq.text;
      el.fOptions.innerHTML = optionMarkup(fq, fq.correctIndex, "feedback", last ? last.selected : -1);
      el.fVerdict.className = "verdict " + (lastFeedback && lastFeedback.correct ? "is-correct" : "is-wrong");
      el.fVerdict.textContent = lastFeedback && lastFeedback.correct
        ? "Correct!"
        : "Not quite - correct answer: " + (lastFeedback ? lastFeedback.correctText : "");
      $("screen-feedback").hidden = false;
      return;
    }

    if (view === "results") {
      el.rTitle.textContent = state.nickname + ", here are your results";
      el.rScore.textContent = state.score + " / " + questions.length;
      el.rFinished.textContent = GameLogic.formatTimestamp(state.finishedAt)
        ? "Finished at " + GameLogic.formatTimestamp(state.finishedAt)
        : "";
      el.rReview.innerHTML = state.answers.map(function (a, i) {
        var q = questions[i] || null;
        var correctText = q ? q.options[q.correctIndex] : "?";
        var yourText = q ? q.options[a.selected] : "?";
        return "<li class=\"" + (a.correct ? "ok" : "bad") + "\">" +
          '<span class="verdict-tag" aria-hidden="true">' + (a.correct ? "\u2713 correct" : "\u2717 wrong") + "</span>" +
          '<p class="q">' + (i + 1) + ". " + (q ? esc(q.text) : "Question removed") + "</p>" +
          '<p class="a">Your answer: <b>' + esc(yourText) + "</b></p>" +
          (a.correct ? "" : '<p class="a">Correct: <b>' + esc(correctText) + "</b></p>") +
          "</li>";
      }).join("");
      $("screen-results").hidden = false;
      return;
    }

    $("screen-error").hidden = false;
  }

  window.HalloweenApp = {
    getState: function () { return state; },
    getView: function () { return view; },
    getQuestions: function () { return questions.slice(); },
    answer: onAnswer,
    next: onNext
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
```

- [x] **Step 2: Run the headless suite (must stay green)**

Run: `node tests/run-tests.js`
Expected: `0 failed` (logic untouched by this task).

- [x] **Step 3: Execute the manual checklist** (open `index.html` in the browser)

1. **Resume during feedback:** start, answer a question, reload the page → welcome-back card → **Continue** → the verdict and **Next** button are shown, score unchanged.
2. **Resume mid-question:** reload on a question screen → welcome-back shows "Question N of M" → Continue returns to the same question.
3. **Replay resets:** finish the contest → **Play again** → `window.HalloweenApp.getState().sessionId` differs from the previous run, score is 0.
4. **Start over** regenerates the session id and clears answers.
5. **Swapped data:** in DevTools, edit the stored `questionOrder` to `[9999]`, reload → nickname screen pre-filled, note "The question set changed - starting over." visible, no console error.
6. **Storage unavailable:** run with `Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } })` before load, or use a private window that blocks storage → banner visible, contest still playable end-to-end.
7. **Keyboard:** Tab reaches the input and each option; Enter in the input starts the game; Enter/Space activates the focused option.
8. **Zero-correct finish:** answer everything wrong → results show `0 / N` **and** a finish timestamp.
9. **Validation:** empty nickname → inline error, no state change; 21 characters → inline error.
10. **Narrow viewport (≈360px):** no horizontal overflow, options tappable.

- [x] **Step 4: Fix any checklist failure and re-run the failing item.**

- [x] **Step 5: Save the file.**

---

### Task 6: Browser test runner and final verification

**Files:**
- Create: `tests/test.html`

**Interfaces:**
- Consumes: `tests/test-suite.js` (`window.TestSuite.tests`).
- Produces: an openable report page.

- [x] **Step 1: Create `tests/test.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Halloween Contest - Tests</title>
<style>
  body { background: #0d0a14; color: #f5efe6; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px; }
  h1 { color: #ff7a1a; font-weight: 400; }
  .pass { color: #86efac; }
  .fail { color: #fca5a5; }
  li { margin: 6px 0; font-family: monospace; }
  #summary { font-size: 20px; margin: 16px 0; }
</style>
</head>
<body>
<h1>Halloween Contest — test results</h1>
<p id="summary">Running…</p>
<ol id="results"></ol>
<script src="../js/questions.js"></script>
<script src="../js/game-logic.js"></script>
<script src="test-suite.js"></script>
<script>
  (function () {
    var list = document.getElementById("results");
    var failed = 0;
    TestSuite.tests.forEach(function (t) {
      var li = document.createElement("li");
      try {
        t.fn();
        li.className = "pass";
        li.textContent = "PASS  " + t.name;
      } catch (e) {
        failed++;
        li.className = "fail";
        li.textContent = "FAIL  " + t.name + " — " + e.message;
      }
      list.appendChild(li);
    });
    document.getElementById("summary").textContent =
      (TestSuite.tests.length - failed) + " passed, " + failed + " failed";
    document.getElementById("summary").className = failed ? "fail" : "pass";
  })();
</script>
</body>
</html>
```

- [x] **Step 2: Run both runners and compare**

Run: `node tests/run-tests.js`
Expected: `0 failed`.

Run: open `tests/test.html` in the browser.
Expected: identical pass/fail counts, `0 failed`.

- [x] **Step 3: Re-run the full manual checklist from Task 5 Step 3 end-to-end once more**, plus: open `tests/test.html` from `file://` (not via a server) to confirm no CORS/module issues.

- [x] **Step 4: Spec spot-check.** Confirm against `docs/superpowers/specs/2026-10-06-halloween-contest-design.md`: title string, 3 options, nickname ≤20, storage key, `lastAnswerAt`/`finishedAt` semantics, palette values, all five screens plus the error screen, welcome-back Continue restoring the stored phase, `questionOrder` persisted.

- [x] **Step 5: Save the file.**

---

## Self-Review notes

- **Spec coverage:** §3 screens → Tasks 4–5; §4 state schema + timestamps → Task 2 (creation/transitions) and Task 3 (validation); §5 files/questions format → Tasks 1, 4, 5; §6 visual style → Task 4; §7 error/edge handling → Tasks 3 (storage/data swap/corruption), 5 (banner, error screen, validation, double-click); §8 testing → Tasks 1–3 (logic suite), 5 (manual checklist), 6 (`test.html`).
- **Type consistency:** `GameLogic` export names match every call site in `app.js` and the test suite; DOM ids in Task 5 match Task 4 exactly.
- **No placeholders:** every step carries runnable code or an explicit command.
- **Review Focus:** all six lines have a test or a checklist item in the owning task.
