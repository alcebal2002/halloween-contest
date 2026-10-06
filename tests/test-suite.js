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

  /* ---- Task 2: state machine ---- */

  function buildContest(GL_, pool, nickname) {
    var state = GL_.createInitialState(nickname, pool, { rng: seededRandom(7) });
    var resolved = GL_.resolveOrder(state, pool);
    return { state: state, questions: resolved.questions };
  }

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

  /* ---- Review fixes: spec §8 coverage + defensive invariants ---- */

  test("validateStoredState round-trips a finished contest with finishedAt and answers intact", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var s = ctx.state;
    for (var i = 0; i < ctx.questions.length; i++) {
      var pick = (i === 0) ? ctx.questions[i].correctIndex : (ctx.questions[i].correctIndex + 1) % 3;
      s = GL.answerQuestion(s, ctx.questions, pick, new Date(Date.UTC(2026, 9, 31, 20, 0, i)));
      s = GL.advance(s, ctx.questions);
    }
    assertEqual(s.phase, "results");
    var restored = GL.validateStoredState(JSON.parse(JSON.stringify(s)), pool);
    assert(restored !== null, "finished state rejected on resume");
    assertEqual(restored.finishedAt, s.finishedAt, "finishedAt lost in the round-trip");
    assertEqual(restored.lastAnswerAt, s.lastAnswerAt, "lastAnswerAt lost in the round-trip");
    assertEqual(restored.answers.length, ctx.questions.length, "answers lost in the round-trip");
    assertEqual(restored.answers[0].correct, true, "first answer contents changed");
    assertEqual(restored.answers[1].correct, false, "second answer contents changed");
    assertEqual(restored.score, 1, "score changed in the round-trip");
  });

  test("lastAnswerAt is overwritten by every subsequent answer", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var first = GL.answerQuestion(ctx.state, ctx.questions, 0, new Date("2026-10-06T10:00:00.000Z"));
    assertEqual(first.lastAnswerAt, "2026-10-06T10:00:00.000Z");
    var second = GL.answerQuestion(GL.advance(first, ctx.questions), ctx.questions, 1, new Date("2026-10-06T10:05:00.000Z"));
    assertEqual(second.lastAnswerAt, "2026-10-06T10:05:00.000Z", "lastAnswerAt did not advance to the newer answer");
    assert(second.lastAnswerAt !== first.lastAnswerAt, "stale timestamp kept");
  });

  test("validateNickname counts characters, not UTF-16 code units", function () {
    var elevenEmoji = "\uD83C\uDF83".repeat(11);
    assertEqual(elevenEmoji.length, 22, "precondition: 11 emoji are 22 UTF-16 units");
    assertEqual(GL.validateNickname(elevenEmoji).ok, true, "11 emoji should count as 11 characters");
    var twentyOne = "\uD83C\uDF83".repeat(21);
    assertEqual(GL.validateNickname(twentyOne).ok, false, "21 emoji must still be rejected");
  });

  test("validateStoredState rejects answers that do not match phase and questionIndex", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var noAnswers = Object.assign({}, ctx.state, { phase: "feedback", answers: [] });
    assertEqual(GL.validateStoredState(noAnswers, pool), null, "feedback with no answers accepted");
    var tooMany = Object.assign({}, ctx.state, {
      phase: "question", questionIndex: 1,
      answers: [
        { questionId: ctx.questions[0].id, selected: 0, correct: true },
        { questionId: ctx.questions[1].id, selected: 1, correct: false }
      ]
    });
    assertEqual(GL.validateStoredState(tooMany, pool), null, "question phase with an answer already recorded accepted");
    var inSync = Object.assign({}, ctx.state, {
      phase: "question", questionIndex: 1,
      answers: [{ questionId: ctx.questions[0].id, selected: 0, correct: true }]
    });
    assert(GL.validateStoredState(inSync, pool) !== null, "an in-sync mid-contest state was rejected");
  });

  return { tests: tests };
});
