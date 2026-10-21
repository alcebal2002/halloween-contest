/* Pure game logic: no DOM, no localStorage. Loadable in Node and the browser. */
"use strict";

var STORAGE_KEY = "halloweenContest.state.v2";
var QUESTIONS_PER_CONTEST = 10;
var MAX_NICKNAME_LENGTH = 20;
var VALID_PHASES = ["nickname", "instructions", "welcomeBack", "question", "feedback", "bonus", "results"];

/* Scoring: a correct answer pays 5 base points, and the poison bonus pays 10 on
   top for a match on the 1st attempt, 5 on the 2nd and 3 on the 3rd, so the
   question total is 15 / 10 / 8. A correct answer that never matches keeps its 5
   points; a wrong answer pays 0 and never opens the bonus. */
var BONUS_AWARD_POINTS = [10, 5, 3]; // bonus paid for a match on attempt 1, 2, 3
var BONUS_BASE_POINTS = 5;           // paid by the answer itself, before the bonus
var BONUS_MISS_POINTS = BONUS_BASE_POINTS; // correct answer, three failed attempts
/* Whole-question total for a match on attempt 1, 2, 3: the award plus the base. */
var BONUS_TOTAL_POINTS = BONUS_AWARD_POINTS.map(function (award) { return award + BONUS_BASE_POINTS; });
var MAX_POINTS_PER_QUESTION = BONUS_TOTAL_POINTS[0];
var BONUS_MAX_ATTEMPTS = 3;
var BONUS_COLOR_COUNT = 4;           // poison bottles in play (tray order 0..3)

/* A gap longer than this (closed tab, idle, resumed the next day) is not counted
   as play time, so the elapsed total always reads like a plausible sitting. */
var ELAPSED_MAX_GAP_MS = 5 * 60 * 1000;

/* Question mix: a contest is deliberately balanced so film questions can never
   be the majority. Questions may carry a `category`; an untagged question (or an
   unknown slug) lands in the `general` bucket, which has no quota and is only
   tapped to fill a deficit. That keeps an external bank without categories on
   today's plain uniform draw. */
var CATEGORY_QUOTAS = { traditions: 4, folklore: 4, films: 2 };
var KNOWN_CATEGORIES = ["traditions", "folklore", "films"];

function categoryOf(q) {
  return q && KNOWN_CATEGORIES.indexOf(q.category) >= 0 ? q.category : "general";
}

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
  var valid = dedupeById(list.filter(isValidQuestion));
  // Draw order: the three known buckets first, then the untagged catch-all.
  var order = KNOWN_CATEGORIES.concat("general");
  var buckets = {};
  order.forEach(function (cat) { buckets[cat] = []; });
  valid.forEach(function (q) { buckets[categoryOf(q)].push(q); });
  order.forEach(function (cat) { buckets[cat] = shuffle(buckets[cat], rng); });

  var picked = [];
  KNOWN_CATEGORIES.forEach(function (cat) {
    picked = picked.concat(buckets[cat].slice(0, CATEGORY_QUOTAS[cat]));
  });

  /* A short bucket (a small bank, or an external file with few of a category)
     would leave the contest unfinished. Fill the deficit one question at a time,
     cycling the categories, so no single bucket absorbs the whole shortfall. */
  var cursor = {};
  KNOWN_CATEGORIES.forEach(function (cat) { cursor[cat] = CATEGORY_QUOTAS[cat]; });
  cursor.general = 0;

  while (picked.length < QUESTIONS_PER_CONTEST) {
    var progressed = false;
    for (var i = 0; i < order.length && picked.length < QUESTIONS_PER_CONTEST; i++) {
      var cat = order[i];
      if (cursor[cat] < buckets[cat].length) {
        picked.push(buckets[cat][cursor[cat]++]);
        progressed = true;
      }
    }
    if (!progressed) break; // no supply left anywhere
  }

  // Shuffle the final deck so the category order is not predictable.
  return shuffle(picked, rng);
}

function validateNickname(raw) {
  var nickname = typeof raw === "string" ? raw.trim() : "";
  if (!nickname) return { ok: false, reason: "Enter a nickname to start." };
  // Count code points, not UTF-16 units, so an emoji nickname is not halved.
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
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

function toDate(now) {
  var at = now instanceof Date ? now : new Date(now === undefined || now === null ? Date.now() : now);
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

/* Accumulates play time on `next` from the gap since the last recorded tick.
   Mutates `next` only; returns the resolved timestamp so callers can stamp it. */
function applyTick(next, state, now) {
  var at = toDate(now);
  var last = typeof state.lastTickAt === "string" ? new Date(state.lastTickAt).getTime() : NaN;
  var gap = at.getTime() - last;
  if (!Number.isNaN(last) && gap > 0 && gap <= ELAPSED_MAX_GAP_MS) {
    next.elapsedMs = (typeof state.elapsedMs === "number" && state.elapsedMs >= 0 ? state.elapsedMs : 0) + gap;
  }
  next.lastTickAt = at.toISOString();
  return at;
}

function createInitialState(nickname, pool, options) {
  var opts = options || {};
  var started = toDate(opts.now).toISOString();
  return {
    sessionId: opts.sessionId || createNewSessionId(),
    nickname: nickname,
    phase: "instructions",
    questionIndex: 0,
    questionOrder: selectQuestions(pool, opts.rng).map(function (q) { return q.id; }),
    answers: [],
    score: 0,
    bonus: null,
    startedAt: started,
    elapsedMs: 0,
    lastTickAt: started,
    lastAnswerAt: null,
    finishedAt: null
  };
}

/* The user has read the rules screen and wants to play. */
function beginPlay(state, now) {
  if (!state || state.phase !== "instructions") return state;
  var next = cloneState(state);
  applyTick(next, state, now);
  next.phase = "question";
  next.questionIndex = 0;
  return next;
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
  var correct = selected === q.correctIndex;
  var next = cloneState(state);
  var at = applyTick(next, state, now);
  next.answers = state.answers.concat([{
    questionId: q.id,
    selected: selected,
    correct: correct,
    points: correct ? BONUS_BASE_POINTS : 0
  }]);
  next.score = state.score + (correct ? BONUS_BASE_POINTS : 0);
  next.lastAnswerAt = at.toISOString();
  next.phase = "feedback";
  return next;
}

/* The bottle indices in play, in tray order: [0, 1, ..., BONUS_COLOR_COUNT - 1]. */
function bottleIndices() {
  var list = [];
  for (var i = 0; i < BONUS_COLOR_COUNT; i++) list.push(i);
  return list;
}

function createBonus(questionId, rng) {
  return {
    questionId: questionId,
    target: shuffle(bottleIndices(), rng),
    // The order submitted on the last check; null until the player checks one.
    tried: null,
    attemptsUsed: 0,
    matched: false,
    resolved: false,
    award: 0
  };
}

function isPermutation(list) {
  if (!Array.isArray(list) || list.length !== BONUS_COLOR_COUNT) return false;
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (!Number.isInteger(v) || v < 0 || v >= BONUS_COLOR_COUNT || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

function sameOrder(a, b) {
  for (var i = 0; i < BONUS_COLOR_COUNT; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/* Whole-question total for a match on a given attempt (1-based). */
function pointsForAttempt(attempt) {
  if (Number.isInteger(attempt) && attempt >= 1 && attempt <= BONUS_MAX_ATTEMPTS) {
    return BONUS_TOTAL_POINTS[attempt - 1];
  }
  return BONUS_MISS_POINTS;
}

/* Which positions of a submitted order sit where the hidden target wants them.
   Only meaningful for full permutations; anything else yields null. */
function matchPositions(target, tried) {
  if (!isPermutation(target) || !isPermutation(tried)) return null;
  return target.map(function (bottle, i) { return tried[i] === bottle; });
}

function resolveBonus(state, guess, now) {
  if (!state || state.phase !== "bonus" || !state.bonus || state.bonus.resolved) return state;
  if (!isPermutation(guess)) return state;
  var entry = state.answers[state.questionIndex];
  if (!entry || entry.questionId !== state.bonus.questionId || !entry.correct) return state;

  var next = cloneState(state);
  applyTick(next, state, now);
  var bonus = next.bonus;
  bonus.tried = guess.slice();   // kept for the per-position feedback, even on a miss
  bonus.attemptsUsed += 1;
  bonus.matched = sameOrder(guess, bonus.target);
  if (bonus.matched || bonus.attemptsUsed >= BONUS_MAX_ATTEMPTS) {
    bonus.resolved = true;
    var target = next.answers[state.questionIndex];
    var total = bonus.matched ? pointsForAttempt(bonus.attemptsUsed) : BONUS_MISS_POINTS;
    bonus.award = total - target.points;
    target.points = total;
    next.score = state.score + bonus.award;
  }
  return next;
}

/* Moves the play forward: a wrong answer skips the bonus, a correct one opens it,
   and a resolved bonus (or the last question) closes it. */
function advance(state, questions, now) {
  if (!state) return state;
  if (state.phase === "feedback") {
    var last = state.answers[state.answers.length - 1];
    if (!last || !last.correct) return moveToNext(state, questions, now);
    var opened = cloneState(state);
    applyTick(opened, state, now);
    opened.phase = "bonus";
    opened.bonus = createBonus(last.questionId);
    return opened;
  }
  if (state.phase === "bonus") {
    if (!state.bonus || !state.bonus.resolved) return state;
    return moveToNext(state, questions, now);
  }
  return state;
}

function moveToNext(state, questions, now) {
  var list = Array.isArray(questions) ? questions : [];
  var next = cloneState(state);
  applyTick(next, state, now);
  next.bonus = null;
  if (state.questionIndex >= list.length - 1) {
    next.phase = "results";
    next.finishedAt = next.lastTickAt;
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

function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  var total = Math.floor(ms / 1000);
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  if (h > 0) return h + "h " + pad(m) + "m " + pad(s) + "s";
  if (m > 0) return m + "m " + pad(s) + "s";
  return s + "s";
}

/* Rebuilds and checks the bonus stored on disk. Returns the clean object or null. */
function validateBonus(raw, answers, questionIndex) {
  if (!raw || typeof raw !== "object") return null;
  if (!Number.isInteger(raw.questionId)) return null;
  if (!isPermutation(raw.target)) return null;
  if (!Number.isInteger(raw.attemptsUsed) || raw.attemptsUsed < 0 || raw.attemptsUsed > BONUS_MAX_ATTEMPTS) return null;
  if (typeof raw.matched !== "boolean" || typeof raw.resolved !== "boolean") return null;
  if (!Number.isInteger(raw.award) || raw.award < 0 || raw.award > MAX_POINTS_PER_QUESTION) return null;
  if (raw.matched && !raw.resolved) return null;
  // Optional: states saved before per-position feedback existed simply have no `tried`.
  if (raw.tried != null && !isPermutation(raw.tried)) return null;

  var entry = answers[questionIndex];
  if (!entry || entry.questionId !== raw.questionId || !entry.correct) return null;

  if (!raw.resolved) {
    if (raw.matched || raw.award !== 0 || entry.points !== BONUS_BASE_POINTS) return null;
  } else if (raw.matched) {
    var total = pointsForAttempt(raw.attemptsUsed);
    if (raw.attemptsUsed < 1 || raw.attemptsUsed > BONUS_MAX_ATTEMPTS) return null;
    if (entry.points !== total || raw.award !== total - BONUS_BASE_POINTS) return null;
  } else {
    if (raw.attemptsUsed !== BONUS_MAX_ATTEMPTS ||
        raw.award !== 0 ||
        entry.points !== BONUS_MISS_POINTS) return null;
  }

  return {
    questionId: raw.questionId,
    target: raw.target.slice(),
    tried: raw.tried == null ? null : raw.tried.slice(),
    attemptsUsed: raw.attemptsUsed,
    matched: raw.matched,
    resolved: raw.resolved,
    award: raw.award
  };
}

function validateStoredState(raw, pool) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.sessionId !== "string" || raw.sessionId === "") return null;
  var nickname = validateNickname(raw.nickname);
  if (!nickname.ok) return null;
  if (VALID_PHASES.indexOf(raw.phase) === -1) return null;
  if (!Array.isArray(raw.answers) || !Array.isArray(raw.questionOrder)) return null;
  if (!Number.isInteger(raw.score) || raw.score < 0) return null;
  if (!Number.isInteger(raw.questionIndex) || raw.questionIndex < 0) return null;
  if (typeof raw.elapsedMs !== "number" || !Number.isFinite(raw.elapsedMs) || raw.elapsedMs < 0) return null;
  if (raw.startedAt != null && typeof raw.startedAt !== "string") return null;
  if (raw.lastTickAt != null && typeof raw.lastTickAt !== "string") return null;
  if (raw.finishedAt != null && typeof raw.finishedAt !== "string") return null;

  var answers = [];
  var total = 0;
  for (var i = 0; i < raw.answers.length; i++) {
    var a = raw.answers[i];
    if (!a || typeof a !== "object" ||
        typeof a.questionId !== "number" ||
        typeof a.correct !== "boolean" ||
        !Number.isInteger(a.selected) || a.selected < 0 || a.selected > 2) return null;
    var points;
    if (a.points === undefined || a.points === null) {
      points = a.correct ? BONUS_BASE_POINTS : 0;
    } else {
      if (!Number.isInteger(a.points) || a.points < 0 || a.points > MAX_POINTS_PER_QUESTION) return null;
      points = a.points;
    }
    total += points;
    answers.push({ questionId: a.questionId, selected: a.selected, correct: a.correct, points: points });
  }
  // The score is a running total of the points on record — nothing else.
  if (total !== raw.score) return null;

  var bonus = null;
  if (raw.phase === "bonus") {
    bonus = validateBonus(raw.bonus, answers, raw.questionIndex);
    if (!bonus) return null;
  } else if (raw.bonus != null) {
    return null; // a bonus round may only exist while one is being played
  }

  var state = {
    sessionId: raw.sessionId,
    nickname: nickname.nickname,
    phase: raw.phase,
    questionIndex: raw.questionIndex,
    questionOrder: raw.questionOrder.slice(),
    answers: answers,
    score: raw.score,
    bonus: bonus,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    elapsedMs: raw.elapsedMs,
    lastTickAt: typeof raw.lastTickAt === "string" ? raw.lastTickAt : null,
    lastAnswerAt: typeof raw.lastAnswerAt === "string" ? raw.lastAnswerAt : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null
  };

  // Answers must line up with the phase: a question waiting to be answered has
  // exactly one fewer answer than its index, feedback and bonus exactly one more.
  if (state.phase === "instructions" && (state.questionIndex !== 0 || answers.length !== 0)) return null;
  if (state.phase === "question" && answers.length !== state.questionIndex) return null;
  if (state.phase === "feedback" && answers.length !== state.questionIndex + 1) return null;
  if (state.phase === "bonus" && answers.length !== state.questionIndex + 1) return null;
  if (state.phase === "results" && answers.length !== state.questionIndex + 1) return null;

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

var GameLogic = {
  STORAGE_KEY: STORAGE_KEY,
  QUESTIONS_PER_CONTEST: QUESTIONS_PER_CONTEST,
  MAX_NICKNAME_LENGTH: MAX_NICKNAME_LENGTH,
  VALID_PHASES: VALID_PHASES,
  MAX_POINTS_PER_QUESTION: MAX_POINTS_PER_QUESTION,
  BONUS_MAX_ATTEMPTS: BONUS_MAX_ATTEMPTS,
  BONUS_AWARD_POINTS: BONUS_AWARD_POINTS,
  BONUS_TOTAL_POINTS: BONUS_TOTAL_POINTS,
  BONUS_BASE_POINTS: BONUS_BASE_POINTS,
  BONUS_MISS_POINTS: BONUS_MISS_POINTS,
  ELAPSED_MAX_GAP_MS: ELAPSED_MAX_GAP_MS,
  CATEGORY_QUOTAS: CATEGORY_QUOTAS,
  KNOWN_CATEGORIES: KNOWN_CATEGORIES,
  categoryOf: categoryOf,
  isValidQuestion: isValidQuestion,
  shuffle: shuffle,
  selectQuestions: selectQuestions,
  validateNickname: validateNickname,
  createNewSessionId: createNewSessionId,
  createInitialState: createInitialState,
  beginPlay: beginPlay,
  resolveOrder: resolveOrder,
  answerQuestion: answerQuestion,
  resolveBonus: resolveBonus,
  matchPositions: matchPositions,
  pointsForAttempt: pointsForAttempt,
  advance: advance,
  formatTimestamp: formatTimestamp,
  formatDuration: formatDuration,
  validateStoredState: validateStoredState,
  loadState: loadState,
  saveState: saveState,
  clearState: clearState
};
if (typeof module !== "undefined" && module.exports) module.exports = GameLogic;
