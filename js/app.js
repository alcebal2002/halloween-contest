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
      showNoQuestions();
      wire();
      return;
    }

    var raw = null;
    try {
      raw = (storage && storage.getItem(GameLogic.STORAGE_KEY)) || null;
    } catch (e) {
      raw = null; // storage readable for writes but not reads — start fresh
    }
    var loaded = storage && raw ? GameLogic.loadState(storage, pool) : null;
    if (!loaded) {
      state = emptyState();
      view = "nickname";
      if (raw) {
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        // Unparseable JSON is simply ignored (spec §7, corrupt state). Only a
        // readable state we cannot resume means the question set changed.
        if (parsed) {
          note = "changed";
          el.nicknameNote.hidden = false;
          var peek = GameLogic.validateNickname(parsed.nickname);
          if (peek.ok) {
            state.nickname = peek.nickname;
            el.nickname.value = peek.nickname;
          }
        } else {
          GameLogic.clearState(storage);
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
    el.nickname.addEventListener("input", function () {
      el.nicknameError.hidden = true;
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
    // "welcomeBack" names a screen, never a playable phase — resume the question.
    if (view === "welcomeBack") view = "question";
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
