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

  /* ---- shared helpers ---- */

  function wrongIndex(q) { return (q.correctIndex + 1) % 3; }

  // A contest that is ready to play (nickname captured, instructions passed).
  function buildContest(GL_, pool, nickname, options) {
    var opts = options || {};
    opts.rng = seededRandom(7);
    var fresh = GL_.createInitialState(nickname, pool, opts);
    var state = GL_.beginPlay(fresh, opts.now);
    return { state: state, questions: GL_.resolveOrder(state, pool).questions };
  }

  // A permutation that can never equal the hidden target (rotate by one).
  function missGuess(state) {
    var t = state.bonus.target;
    return t.slice(1).concat(t[0]);
  }

  // Every ordering of a list of distinct values (used by the match tests).
  function permutations(list) {
    if (list.length <= 1) return [list.slice()];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var rest = list.slice(0, i).concat(list.slice(i + 1));
      permutations(rest).forEach(function (tail) { out.push([list[i]].concat(tail)); });
    }
    return out;
  }

  // Answer one question and step past it, running the bonus dry (three misses),
  // so a correct answer in this helper is always worth the 1 consolation point.
  function playStep(GL_, state, questions, correct, now) {
    var q = questions[state.questionIndex];
    state = GL_.answerQuestion(state, questions, correct ? q.correctIndex : wrongIndex(q), now);
    state = GL_.advance(state, questions, now);
    for (var i = 0; state.phase === "bonus" && !state.bonus.resolved; i++) {
      state = GL_.resolveBonus(state, missGuess(state), now);
      if (i >= GL_.BONUS_MAX_ATTEMPTS) throw new Error("bonus never resolved");
    }
    if (state.phase === "bonus") state = GL_.advance(state, questions, now);
    return state;
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

  test("createInitialState parks a fresh contest on the instructions phase", function () {
    var at = new Date("2026-10-11T10:00:00.000Z");
    var s = GL.createInitialState("Player", makePool(25), { rng: seededRandom(99), now: at });
    assertEqual(s.phase, "instructions");
    assertEqual(s.questionIndex, 0);
    assertEqual(s.score, 0);
    assertEqual(s.answers.length, 0);
    assertEqual(s.bonus, null, "no bonus before play starts");
    assertEqual(s.elapsedMs, 0, "a fresh contest has played for zero seconds");
    assertEqual(s.startedAt, "2026-10-11T10:00:00.000Z");
    assertEqual(s.lastTickAt, "2026-10-11T10:00:00.000Z");
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

  test("beginPlay leaves the instructions phase for question 1 and is ignored elsewhere", function () {
    var at = new Date("2026-10-11T10:00:00.000Z");
    var fresh = GL.createInitialState("Player", makePool(12), { rng: seededRandom(99), now: at });
    var started = GL.beginPlay(fresh, new Date("2026-10-11T10:00:30.000Z"));
    assertEqual(started.phase, "question");
    assertEqual(started.questionIndex, 0);
    assertEqual(started.elapsedMs, 30000, "reading the instructions counts as play time");
    assertEqual(GL.beginPlay(started, at), started, "beginPlay outside instructions must be a no-op");
    assertEqual(GL.beginPlay(null, at), null, "beginPlay(null) must not throw");
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

  test("answerQuestion records a correct answer, its base point, and phase feedback", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var q = ctx.questions[0];
    var at = new Date("2026-10-11T14:52:11.000Z");
    var next = GL.answerQuestion(ctx.state, ctx.questions, q.correctIndex, at);
    assertEqual(next.phase, "feedback");
    assertEqual(next.score, 1, "a correct answer is worth 1 point before the bonus");
    assertEqual(next.answers.length, 1);
    assertEqual(next.answers[0].correct, true);
    assertEqual(next.answers[0].points, 1, "base point must be recorded on the answer");
    assertEqual(next.answers[0].questionId, q.id);
    assertEqual(next.lastAnswerAt, "2026-10-11T14:52:11.000Z");
    assertEqual(next.finishedAt, null, "the contest is not finished until the results screen");
    assertEqual(next.bonus, null, "the bonus is created on advance, not on answering");
  });

  test("answerQuestion leaves the score alone for a wrong answer", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var wrong = wrongIndex(ctx.questions[0]);
    var next = GL.answerQuestion(ctx.state, ctx.questions, wrong, new Date());
    assertEqual(next.score, 0);
    assertEqual(next.answers[0].correct, false);
    assertEqual(next.answers[0].points, 0, "a wrong answer is worth nothing");
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

  test("advance from a wrong answer skips the bonus and moves to the next question", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var wrong = wrongIndex(ctx.questions[0]);
    var answered = GL.answerQuestion(ctx.state, ctx.questions, wrong, new Date());
    var next = GL.advance(answered, ctx.questions, new Date());
    assertEqual(next.phase, "question");
    assertEqual(next.questionIndex, 1);
    assertEqual(next.score, 0);
    assertEqual(next.bonus, null, "no bonus round for a wrong answer");
    assertEqual(next.answers.length, 1);
  });

  test("advance from a correct answer opens the bonus round", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var answered = GL.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    var next = GL.advance(answered, ctx.questions, new Date());
    assertEqual(next.phase, "bonus");
    assertEqual(next.questionIndex, 0, "the bonus belongs to the question just answered");
    assertEqual(next.score, 1, "points are only settled once the bonus resolves");
    assertEqual(next.bonus.attemptsUsed, 0);
    assertEqual(next.bonus.resolved, false);
    assertEqual(next.bonus.matched, false);
    assertEqual(next.bonus.award, 0);
    assertEqual(next.bonus.questionId, ctx.questions[0].id);
    assertEqual(JSON.stringify(next.bonus.target.slice().sort()), "[0,1,2,3]", "target must be a permutation of the four bottles");
  });

  test("advance is a no-op until the bonus round is resolved", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var s = GL.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    s = GL.advance(s, ctx.questions, new Date());
    assertEqual(s.phase, "bonus");
    assertEqual(GL.advance(s, ctx.questions, new Date()), s, "unresolved bonus must block advancing");
    var partial = GL.resolveBonus(s, missGuess(s), new Date());
    assertEqual(partial.bonus.resolved, false, "one miss does not resolve the bonus");
    assertEqual(GL.advance(partial, ctx.questions, new Date()), partial, "part-played bonus must still block advancing");
  });

  test("advance on the final question goes to results and stamps finishedAt", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var s = ctx.state;
    var at = new Date("2026-10-31T21:00:00.000Z");
    for (var i = 0; i < ctx.questions.length - 1; i++) {
      s = GL.advance(GL.answerQuestion(s, ctx.questions, wrongIndex(ctx.questions[i]), at), ctx.questions, at);
    }
    assertEqual(s.phase, "question");
    assertEqual(s.questionIndex, ctx.questions.length - 1);
    var lastAt = new Date("2026-10-31T21:05:00.000Z");
    var answered = GL.answerQuestion(s, ctx.questions, wrongIndex(ctx.questions[s.questionIndex]), lastAt);
    var done = GL.advance(answered, ctx.questions, lastAt);
    assertEqual(done.phase, "results");
    assertEqual(done.questionIndex, ctx.questions.length - 1);
    assertEqual(done.finishedAt, "2026-10-31T21:05:00.000Z", "finishedAt must be stamped when the results screen opens");
    assertEqual(done.lastAnswerAt, "2026-10-31T21:05:00.000Z");
  });

  test("the last question can finish through a resolved bonus", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var s = ctx.state;
    var at = new Date("2026-10-31T21:00:00.000Z");
    for (var i = 0; i < ctx.questions.length - 1; i++) {
      s = playStep(GL, s, ctx.questions, false, at);
    }
    assertEqual(s.questionIndex, ctx.questions.length - 1);
    s = GL.answerQuestion(s, ctx.questions, ctx.questions[s.questionIndex].correctIndex, at);
    s = GL.advance(s, ctx.questions, at);
    assertEqual(s.phase, "bonus");
    s = GL.resolveBonus(s, s.bonus.target, at);
    assertEqual(s.score, 5, "matching the first attempt on the last question is worth 5");
    s = GL.advance(s, ctx.questions, at);
    assertEqual(s.phase, "results");
    assertEqual(s.finishedAt, "2026-10-31T21:00:00.000Z");
  });

  test("zero-correct run still records lastAnswerAt and finishedAt", function () {
    var ctx = buildContest(GL, makePool(25), "Unlucky");
    var s = ctx.state;
    var at = new Date("2026-10-31T21:00:00.000Z");
    for (var i = 0; i < ctx.questions.length; i++) {
      s = playStep(GL, s, ctx.questions, false, at);
    }
    assertEqual(s.phase, "results");
    assertEqual(s.score, 0);
    assert(!!s.lastAnswerAt, "lastAnswerAt missing");
    assert(!!s.finishedAt, "finishedAt missing");
    assert(!Number.isNaN(new Date(s.finishedAt).getTime()), "finishedAt must be a valid timestamp");
  });

  test("restarting keeps the nickname but resets progress and session id", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var played = GL.answerQuestion(ctx.state, ctx.questions, 0, new Date());
    var fresh = GL.createInitialState(played.nickname, makePool(25), { rng: Math.random });
    assertEqual(fresh.nickname, "Hero");
    assertEqual(fresh.phase, "instructions");
    assertEqual(fresh.questionIndex, 0);
    assertEqual(fresh.answers.length, 0);
    assertEqual(fresh.score, 0);
    assertEqual(fresh.bonus, null);
    assertEqual(fresh.lastAnswerAt, null);
    assertEqual(fresh.finishedAt, null);
    assertEqual(fresh.elapsedMs, 0, "a restart resets the clock");
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

  /* ---- Task 3: the poison bonus round ---- */

  function openBonus(GL_, pool) {
    var ctx = buildContest(GL_, pool, "Hero");
    var answered = GL_.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    var bonus = GL_.advance(answered, ctx.questions, new Date());
    assertEqual(bonus.phase, "bonus", "test setup must land on the bonus phase");
    return { state: bonus, questions: ctx.questions };
  }

  function playAttempts(GL_, attempts) {
    // attempts: array of booleans — true to match on that attempt
    var ctx = openBonus(GL, makePool(25));
    var s = ctx.state;
    for (var i = 0; i < attempts.length; i++) {
      var guess = attempts[i] ? s.bonus.target.slice() : missGuess(s);
      s = GL.resolveBonus(s, guess, new Date());
    }
    return s;
  }

  test("bonus points: matching the 1st attempt is worth 5", function () {
    var s = playAttempts(GL, [true]);
    assertEqual(s.bonus.resolved, true);
    assertEqual(s.bonus.matched, true);
    assertEqual(s.bonus.attemptsUsed, 1);
    assertEqual(s.answers[0].points, 5, "first attempt must pay 5 points");
    assertEqual(s.score, 5);
  });

  test("bonus points: matching the 2nd attempt is worth 3", function () {
    var s = playAttempts(GL, [false, true]);
    assertEqual(s.bonus.attemptsUsed, 2);
    assertEqual(s.answers[0].points, 3, "second attempt must pay 3 points");
    assertEqual(s.score, 3);
  });

  test("bonus points: matching the 3rd attempt is worth 2", function () {
    var s = playAttempts(GL, [false, false, true]);
    assertEqual(s.bonus.attemptsUsed, 3);
    assertEqual(s.bonus.resolved, true, "the third attempt is the last one");
    assertEqual(s.answers[0].points, 2, "third attempt must pay 2 points");
    assertEqual(s.score, 2);
  });

  test("bonus points: three misses still pay 1 for the correct answer", function () {
    var s = playAttempts(GL, [false, false, false]);
    assertEqual(s.bonus.resolved, true);
    assertEqual(s.bonus.matched, false);
    assertEqual(s.bonus.attemptsUsed, 3);
    assertEqual(s.answers[0].points, 1, "running out of attempts keeps the 1 base point");
    assertEqual(s.score, 1);
  });

  test("a wrong answer never opens the bonus and pays nothing", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var s = GL.answerQuestion(ctx.state, ctx.questions, wrongIndex(ctx.questions[0]), new Date());
    s = GL.advance(s, ctx.questions, new Date());
    assertEqual(s.phase, "question", "a wrong answer must skip the bonus round");
    assertEqual(s.bonus, null);
    assertEqual(s.score, 0);
    assertEqual(s.answers[0].points, 0);
  });

  test("resolveBonus ignores guesses that are not a permutation of the four bottles", function () {
    var ctx = openBonus(GL, makePool(25));
    var s = ctx.state;
    var guesses = [
      [0, 0, 1, 2],       // repeated bottle
      [0, 1, 2],          // too short
      [0, 1, 2, 4],       // unknown bottle
      [0, 1, 2, 2.5],     // not an index
      "0123",             // not an array
      null
    ];
    for (var i = 0; i < guesses.length; i++) {
      assertEqual(GL.resolveBonus(s, guesses[i], new Date()), s, "invalid guess accepted: " + JSON.stringify(guesses[i]));
    }
    assertEqual(s.bonus.attemptsUsed, 0, "an invalid guess must not burn an attempt");
  });

  test("resolveBonus ignores guesses outside the bonus phase or after it resolves", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var answered = GL.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    assertEqual(GL.resolveBonus(answered, [0, 1, 2, 3], new Date()), answered, "no bonus to resolve during feedback");
    var resolved = playAttempts(GL, [true]);
    assertEqual(GL.resolveBonus(resolved, [0, 1, 2, 3], new Date()), resolved, "a resolved bonus must not accept more guesses");
    assertEqual(resolved.bonus.attemptsUsed, 1, "attempt count changed after resolution");
    assertEqual(resolved.score, 5, "score changed after resolution");
  });

  test("every resolved bonus keeps the question total inside 0..5", function () {
    var combos = [[true], [false, true], [false, false, true], [false, false, false]];
    var expected = [5, 3, 2, 1];
    for (var i = 0; i < combos.length; i++) {
      var s = playAttempts(GL, combos[i]);
      assertEqual(s.answers[0].points, expected[i], "attempt pattern " + JSON.stringify(combos[i]));
      assert(s.score >= 0 && s.score <= GL.MAX_POINTS_PER_QUESTION, "score out of range: " + s.score);
    }
  });

  /* ---- Task 4: elapsed play time ---- */

  test("elapsed time accumulates across answers and advances", function () {
    var pool = makePool(25);
    var t0 = new Date("2026-10-11T10:00:00.000Z");
    var ctx = buildContest(GL, pool, "Hero", { now: t0 });
    var s = ctx.state;
    assertEqual(s.elapsedMs, 0);
    s = GL.answerQuestion(s, ctx.questions, wrongIndex(ctx.questions[0]), new Date(t0.getTime() + 60000));
    assertEqual(s.elapsedMs, 60000, "one minute of answering must be counted");
    s = GL.advance(s, ctx.questions, new Date(t0.getTime() + 120000));
    assertEqual(s.elapsedMs, 120000, "advancing must keep the clock running");
    assertEqual(s.questionIndex, 1);
  });

  test("elapsed time ignores gaps longer than five minutes", function () {
    var pool = makePool(25);
    var t0 = new Date("2026-10-11T10:00:00.000Z");
    var ctx = buildContest(GL, pool, "Hero", { now: t0 });
    var s = ctx.state;
    s = GL.answerQuestion(s, ctx.questions, wrongIndex(ctx.questions[0]), new Date(t0.getTime() + 60000));
    s = GL.advance(s, ctx.questions, new Date(t0.getTime() + 120000));
    assertEqual(s.elapsedMs, 120000, "setup must have accumulated two minutes");
    var afterBreak = GL.answerQuestion(s, ctx.questions, wrongIndex(ctx.questions[1]), new Date(t0.getTime() + 120000 + 600000));
    assertEqual(afterBreak.elapsedMs, 120000, "a ten minute gap must not count as play time");
    var backAtIt = GL.advance(afterBreak, ctx.questions, new Date(t0.getTime() + 120000 + 600000 + 30000));
    assertEqual(backAtIt.elapsedMs, 150000, "play must resume counting right after the gap");
  });

  test("formatDuration renders seconds, minutes and hours and blanks invalid input", function () {
    assertEqual(GL.formatDuration(0), "0s");
    assertEqual(GL.formatDuration(42000), "42s");
    assertEqual(GL.formatDuration(372000), "6m 12s");
    assertEqual(GL.formatDuration(3723000), "1h 02m 03s");
    assertEqual(GL.formatDuration(-1), "");
    assertEqual(GL.formatDuration("1000"), "");
    assertEqual(GL.formatDuration(null), "");
    assertEqual(GL.formatDuration(NaN), "");
  });

  /* ---- Task 5: storage ---- */

  test("validateStoredState rejects malformed objects", function () {
    var pool = makePool(25);
    assertEqual(GL.validateStoredState(null, pool), null);
    assertEqual(GL.validateStoredState({ phase: "question" }, pool), null);
    var good = GL.createInitialState("Hero", pool, { rng: seededRandom(3) });
    var badPhase = Object.assign({}, good, { phase: "sideways" });
    assertEqual(GL.validateStoredState(badPhase, pool), null);
    var badIndex = Object.assign({}, Object.assign({}, good, { phase: "question" }), { questionIndex: 999 });
    assertEqual(GL.validateStoredState(badIndex, pool), null);
    var badNick = Object.assign({}, good, { nickname: "   " });
    assertEqual(GL.validateStoredState(badNick, pool), null);
    var badClock = Object.assign({}, good, { elapsedMs: -5 });
    assertEqual(GL.validateStoredState(badClock, pool), null);
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
    assertEqual(restored.answers[0].points, 1);
    assertEqual(restored.lastAnswerAt, answered.lastAnswerAt);
  });

  test("validateStoredState round-trips a mid-bonus state with its attempts", function () {
    var pool = makePool(25);
    var ctx = openBonus(GL, pool);
    var halfPlayed = GL.resolveBonus(ctx.state, missGuess(ctx.state), new Date());
    assertEqual(halfPlayed.bonus.attemptsUsed, 1);
    var restored = GL.validateStoredState(JSON.parse(JSON.stringify(halfPlayed)), pool);
    assert(restored !== null, "mid-bonus state rejected on resume");
    assertEqual(restored.phase, "bonus");
    assertEqual(restored.bonus.attemptsUsed, 1, "the attempt used before the reload was lost");
    assertEqual(restored.bonus.target.length, 4, "the hidden order must survive a reload");
    assertEqual(restored.bonus.resolved, false);
    assertEqual(restored.score, 1, "the base point must still be counted after a reload");
    var resumed = GL.resolveBonus(restored, restored.bonus.target, new Date());
    assertEqual(resumed.bonus.resolved, true, "the second attempt must be usable after a reload");
    assertEqual(resumed.answers[0].points, 3, "matching on the second attempt must pay 3 after a reload");
  });

  test("validateStoredState rejects a corrupt bonus", function () {
    var pool = makePool(25);
    var ctx = openBonus(GL, pool);
    var base = JSON.parse(JSON.stringify(ctx.state));

    var repeatedTarget = JSON.parse(JSON.stringify(base));
    repeatedTarget.bonus.target = [0, 0, 1, 2];
    assertEqual(GL.validateStoredState(repeatedTarget, pool), null, "target with a repeated bottle accepted");

    var tooManyAttempts = JSON.parse(JSON.stringify(base));
    tooManyAttempts.bonus.attemptsUsed = 4;
    assertEqual(GL.validateStoredState(tooManyAttempts, pool), null, "four attempts accepted");

    var orphanBonus = JSON.parse(JSON.stringify(base));
    orphanBonus.bonus.questionId = 9999;
    assertEqual(GL.validateStoredState(orphanBonus, pool), null, "bonus for another question accepted");

    var bonusOnFeedback = JSON.parse(JSON.stringify(base));
    bonusOnFeedback.phase = "feedback";
    assertEqual(GL.validateStoredState(bonusOnFeedback, pool), null, "a bonus must not exist during feedback");

    var bonusOnQuestion = JSON.parse(JSON.stringify(base));
    bonusOnQuestion.phase = "question";
    bonusOnQuestion.questionIndex = 1;
    bonusOnQuestion.answers = bonusOnQuestion.answers.slice(0, 1);
    assertEqual(GL.validateStoredState(bonusOnQuestion, pool), null, "a bonus must not exist while answering");

    var missingBonus = JSON.parse(JSON.stringify(base));
    missingBonus.bonus = null;
    assertEqual(GL.validateStoredState(missingBonus, pool), null, "bonus phase without a bonus accepted");
  });

  test("validateStoredState rejects a score that disagrees with the recorded points", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var answered = GL.answerQuestion(ctx.state, ctx.questions, ctx.questions[0].correctIndex, new Date());
    var inflated = JSON.parse(JSON.stringify(answered));
    inflated.score = 5;
    assertEqual(GL.validateStoredState(inflated, pool), null, "score inflated without points behind it");
    var deflated = JSON.parse(JSON.stringify(answered));
    deflated.score = 0;
    assertEqual(GL.validateStoredState(deflated, pool), null, "score deflated without points behind it");
    var honest = JSON.parse(JSON.stringify(answered));
    assert(GL.validateStoredState(honest, pool) !== null, "a consistent score must be accepted");
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
    var at = new Date("2026-10-31T20:00:00.000Z");
    for (var i = 0; i < ctx.questions.length; i++) {
      s = playStep(GL, s, ctx.questions, i === 0, new Date(at.getTime() + i * 60000));
    }
    assertEqual(s.phase, "results");
    assertEqual(s.score, 1, "one correct answer (base point, bonus missed) and nine wrong ones");
    var restored = GL.validateStoredState(JSON.parse(JSON.stringify(s)), pool);
    assert(restored !== null, "finished state rejected on resume");
    assertEqual(restored.finishedAt, s.finishedAt, "finishedAt lost in the round-trip");
    assertEqual(restored.lastAnswerAt, s.lastAnswerAt, "lastAnswerAt lost in the round-trip");
    assertEqual(restored.answers.length, ctx.questions.length, "answers lost in the round-trip");
    assertEqual(restored.answers[0].correct, true, "first answer contents changed");
    assertEqual(restored.answers[1].correct, false, "second answer contents changed");
    assertEqual(restored.answers[0].points, 1, "points lost in the round-trip");
    assertEqual(restored.score, 1, "score changed in the round-trip");
    assertEqual(restored.bonus, null, "the bonus must be cleared once the contest ends");
    assert(restored.elapsedMs > 0, "the finished contest must carry a play time");
  });

  test("lastAnswerAt is overwritten by every subsequent answer", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var first = GL.answerQuestion(ctx.state, ctx.questions, 0, new Date("2026-10-11T10:00:00.000Z"));
    assertEqual(first.lastAnswerAt, "2026-10-11T10:00:00.000Z");
    var second = GL.answerQuestion(GL.advance(first, ctx.questions, new Date("2026-10-11T10:01:00.000Z")), ctx.questions, 1, new Date("2026-10-11T10:05:00.000Z"));
    assertEqual(second.lastAnswerAt, "2026-10-11T10:05:00.000Z", "lastAnswerAt did not advance to the newer answer");
    assert(second.lastAnswerAt !== first.lastAnswerAt, "stale timestamp kept");
  });

  test("validateNickname counts characters, not UTF-16 code units", function () {
    var elevenEmoji = "\uD83C\uDF83".repeat(11);
    assertEqual(elevenEmoji.length, 22, "precondition: 11 emoji are 22 UTF-16 units");
    assertEqual(GL.validateNickname(elevenEmoji).ok, true, "11 emoji should count as 11 characters");
    var twentyOneEmoji = "\uD83C\uDF83".repeat(21);
    assertEqual(GL.validateNickname(twentyOneEmoji).ok, false, "21 emoji must still be rejected");
  });

  test("validateStoredState rejects answers that do not match phase and questionIndex", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var noAnswers = Object.assign({}, ctx.state, { phase: "feedback", answers: [] });
    assertEqual(GL.validateStoredState(noAnswers, pool), null, "feedback with no answers accepted");
    var tooMany = Object.assign({}, ctx.state, {
      phase: "question", questionIndex: 1, score: 3,
      answers: [
        { questionId: ctx.questions[0].id, selected: 0, correct: true, points: 3 },
        { questionId: ctx.questions[1].id, selected: 1, correct: false, points: 0 }
      ]
    });
    assertEqual(GL.validateStoredState(tooMany, pool), null, "question phase with an answer already recorded accepted");
    var inSync = Object.assign({}, ctx.state, {
      phase: "question", questionIndex: 1, score: 1,
      answers: [{ questionId: ctx.questions[0].id, selected: 0, correct: true, points: 1 }]
    });
    assert(GL.validateStoredState(inSync, pool) !== null, "an in-sync mid-contest state was rejected");
  });

  test("a stored instructions phase resumes on the instructions screen", function () {
    var pool = makePool(25);
    var fresh = GL.createInitialState("Hero", pool, { rng: seededRandom(11) });
    var restored = GL.validateStoredState(JSON.parse(JSON.stringify(fresh)), pool);
    assert(restored !== null, "fresh state rejected");
    assertEqual(restored.phase, "instructions");
    assertEqual(restored.questionIndex, 0);
    assertEqual(restored.answers.length, 0);
    assert(GL.beginPlay(restored).phase === "question", "Continue must be able to start the play");
  });

  /* ---- partial position feedback (spec §10.3) ---- */

  test("matchPositions flags exactly the positions the submitted order got right", function () {
    assertEqual(GL.matchPositions([0, 1, 2, 3], [0, 1, 2, 3]).join(","), "true,true,true,true",
      "a full match must flag all four positions");
    assertEqual(GL.matchPositions([0, 1, 2, 3], [0, 1, 3, 2]).join(","), "true,true,false,false",
      "the first two positions match");
    assertEqual(GL.matchPositions([0, 1, 2, 3], [0, 3, 1, 2]).join(","), "true,false,false,false",
      "only the first position matches");
    assertEqual(GL.matchPositions([0, 1, 2, 3], [3, 0, 1, 2]).join(","), "false,false,false,false",
      "a rotating miss must flag nothing");
  });

  test("matchPositions can never report exactly three hits with four distinct bottles", function () {
    var perms = permutations([0, 1, 2, 3]);
    var seen = {};
    perms.forEach(function (target) {
      perms.forEach(function (guess) {
        var hits = GL.matchPositions(target, guess).filter(Boolean).length;
        assert(hits !== 3, "three hits from " + JSON.stringify(guess) + " against " + JSON.stringify(target));
        seen[hits] = true;
      });
    });
    assert(seen[0] && seen[1] && seen[2] && seen[4], "0, 1, 2 and 4 hits must all be reachable");
  });

  test("matchPositions rejects a target or a submitted order that is not a permutation", function () {
    assertEqual(GL.matchPositions(null, [0, 1, 2, 3]), null, "missing target accepted");
    assertEqual(GL.matchPositions([0, 1, 2, 3], [0, 1, 2, 0]), null, "repeated bottle accepted");
    assertEqual(GL.matchPositions([0, 1, 2, 3], [0, 1, 2]), null, "short order accepted");
    assertEqual(GL.matchPositions([0, 1, 2, 3], "0123"), null, "string order accepted");
  });

  test("resolveBonus records the submitted order for position feedback", function () {
    var ctx = buildContest(GL, makePool(25), "Hero");
    var state = ctx.state;
    var qs = ctx.questions;
    state = GL.answerQuestion(state, qs, qs[0].correctIndex, new Date());
    state = GL.advance(state, qs, new Date());
    assert(state.phase === "bonus" && state.bonus.tried == null,
      "a fresh bonus must not claim a previous attempt");
    var guess = missGuess(state);
    state = GL.resolveBonus(state, guess, new Date());
    assert(state.bonus.resolved === false, "one miss must not settle the round");
    assert(Array.isArray(state.bonus.tried) && state.bonus.tried.join(",") === guess.join(","),
      "the submitted order was not recorded, got " + JSON.stringify(state.bonus.tried));
    state = GL.resolveBonus(state, state.bonus.target, new Date());
    assertEqual(state.bonus.tried.join(","), state.bonus.target.join(","),
      "a match must record the winning order too");
  });

  test("validateStoredState keeps the recorded order, accepts states without it and rejects bad ones", function () {
    var pool = makePool(25);
    var ctx = buildContest(GL, pool, "Hero");
    var state = ctx.state;
    var qs = ctx.questions;
    state = GL.answerQuestion(state, qs, qs[0].correctIndex, new Date());
    state = GL.advance(state, qs, new Date());
    state = GL.resolveBonus(state, missGuess(state), new Date());

    var restored = GL.validateStoredState(JSON.parse(JSON.stringify(state)), pool);
    assert(restored !== null, "a mid-bonus state with a recorded order was rejected");
    assertEqual(restored.bonus.tried.join(","), state.bonus.tried.join(","),
      "the recorded order was not preserved");

    // A state written before this field existed must still load: no progress loss.
    var legacy = JSON.parse(JSON.stringify(state));
    delete legacy.bonus.tried;
    var old = GL.validateStoredState(legacy, pool);
    assert(old !== null, "an older state without a recorded order must stay valid");
    assertEqual(old.bonus.tried, null, "a missing recorded order must load as null");

    [[0, 0, 1, 2], [0, 1, 2], [0, 1, 2, 4], "0123", 7, true].forEach(function (bad) {
      var broken = JSON.parse(JSON.stringify(state));
      broken.bonus.tried = bad;
      assertEqual(GL.validateStoredState(broken, pool), null,
        "invalid recorded order accepted: " + JSON.stringify(bad));
    });
  });

  return { tests: tests };
});
