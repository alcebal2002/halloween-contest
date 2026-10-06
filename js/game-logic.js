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

  // Answers must line up with the phase: a question waiting to be answered has
  // exactly one fewer answer than its index, feedback exactly one more.
  if (state.phase === "question" && state.answers.length !== state.questionIndex) return null;
  if (state.phase === "feedback" && state.answers.length !== state.questionIndex + 1) return null;

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
  isValidQuestion: isValidQuestion,
  shuffle: shuffle,
  selectQuestions: selectQuestions,
  validateNickname: validateNickname,
  createNewSessionId: createNewSessionId,
  createInitialState: createInitialState,
  resolveOrder: resolveOrder,
  answerQuestion: answerQuestion,
  advance: advance,
  formatTimestamp: formatTimestamp,
  validateStoredState: validateStoredState,
  loadState: loadState,
  saveState: saveState,
  clearState: clearState
};
if (typeof module !== "undefined" && module.exports) module.exports = GameLogic;
