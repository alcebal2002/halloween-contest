(function () {
  "use strict";

  var pool = Array.isArray(typeof QUESTIONS !== "undefined" ? QUESTIONS : null) ? QUESTIONS : [];
  var storage = null;
  var storageAvailable = true;
  var state = null;
  var questions = [];
  var view = "nickname";        // nickname | instructions | welcomeBack | question | feedback | bonus | results | error
  var pendingPhase = null;      // stored phase to restore via Continue
  var lastFeedback = null;      // { correct: boolean, correctText: string }
  var bonusSelection = [];      // bottles picked for the attempt in progress (never persisted)
  var bonusFlash = null;        // { order: [..], hits: [bool x3] } while a check is being shown
  var flashTimer = null;        // clears bonusFlash after BONUS_BLINK_MS
  var note = "";                // "question set changed" note
  var el = {};

  var BOTTLE_GLYPHS = ["\u2620", "\u2697", "\u2623", "\u26b1"];   // matches the bottles in index.html
  var BOTTLE_NAMES = ["Toxic green", "Deep purple", "Blood red", "Cyanide cyan"];
  var SLOT_LABELS = ["1st", "2nd", "3rd", "4th"];
  var BONUS_BLINK_MS = 2000;    // how long a partial miss shows which positions were right

  var SCREENS = ["screen-nickname", "screen-instructions", "screen-welcome-back", "screen-question",
    "screen-feedback", "screen-bonus", "screen-results", "screen-error"];
  var HUD_VIEWS = ["instructions", "question", "feedback", "bonus", "results"];

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function emptyState() {
    return {
      sessionId: "", nickname: "", phase: "nickname", questionIndex: 0,
      questionOrder: [], answers: [], score: 0, bonus: null,
      startedAt: null, elapsedMs: 0, lastTickAt: null,
      lastAnswerAt: null, finishedAt: null
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

  // Cancels a running blink and drops the checked order it was showing.
  function clearBonusFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    bonusFlash = null;
  }

  function boot() {
    el = {
      banner: $("storage-banner"),
      hud: $("hud"),
      hudPoints: $("hud-points"),
      hudQuestion: $("hud-question"),
      nickname: $("nickname"),
      nicknameError: $("nickname-error"),
      nicknameNote: $("nickname-note"),
      start: $("btn-start"),
      ready: $("btn-ready"),
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
      bonusAttempts: $("bonus-attempts"),
      bonusIntro: $("bonus-intro"),
      bonusBottles: $("bonus-bottles"),
      bonusSlots: $("bonus-slots"),
      bonusVerdict: $("bonus-verdict"),
      bonusCheck: $("btn-bonus-check"),
      bonusReset: $("btn-bonus-reset"),
      bonusNext: $("btn-bonus-next"),
      rTitle: $("results-title"),
      rScore: $("results-score"),
      rTime: $("results-time"),
      rFinished: $("results-finished"),
      rReview: $("results-review"),
      playAgain: $("btn-play-again"),
      errorMessage: $("error-message")
    };

    storage = detectStorage();
    if (!storage) {
      storageAvailable = false;
      el.banner.hidden = false;
    } else {
      // v1 states were scored as a count of correct answers, which the v2 rules
      // cannot resume — drop the unreadable blob instead of leaving it behind.
      try { storage.removeItem("halloweenContest.state.v1"); } catch (e) { /* ignore */ }
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
    el.ready.addEventListener("click", onReady);
    el.continueBtn.addEventListener("click", onContinue);
    el.startOver.addEventListener("click", onStartOver);
    el.next.addEventListener("click", onNext);
    el.bonusCheck.addEventListener("click", onBonusCheck);
    el.bonusReset.addEventListener("click", onBonusReset);
    el.bonusNext.addEventListener("click", onNext);
    el.bonusBottles.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".bottle") : null;
      if (btn) onBottle(parseInt(btn.getAttribute("data-bottle"), 10));
    });
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
    bonusSelection = [];
    clearBonusFlash();
    persist();
    view = "instructions";
    render();
  }

  function onReady() {
    if (!state || state.phase !== "instructions") return;
    var next = GameLogic.beginPlay(state, new Date());
    if (next === state) return;
    state = next;
    persist();
    view = state.phase;
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
    if (view === "bonus") { clearBonusFlash(); bonusSelection = []; }
    render();
  }

  function onStartOver() {
    var nickname = (state && state.nickname) || (el.nickname && el.nickname.value) || "";
    state = GameLogic.beginPlay(GameLogic.createInitialState(nickname, pool), new Date());
    questions = GameLogic.resolveOrder(state, pool).questions;
    if (questions.length === 0) { showNoQuestions(); return; }
    lastFeedback = null;
    bonusSelection = [];
    clearBonusFlash();
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
    var next = GameLogic.advance(state, questions, new Date());
    if (next === state) return;
    state = next;
    persist();
    lastFeedback = null;
    bonusSelection = [];
    clearBonusFlash();
    view = state.phase; // instructions is unreachable here: "question", "bonus" or "results"
    render();
  }

  function onBottle(index) {
    if (bonusFlash) return;   // the last check is still on screen
    if (view !== "bonus" || !state.bonus || state.bonus.resolved) return;
    if (!Number.isInteger(index) || index < 0 || index >= state.bonus.target.length) return;
    var picked = bonusSelection.indexOf(index);
    if (picked !== -1) bonusSelection.splice(picked, 1);
    else if (bonusSelection.length < state.bonus.target.length) bonusSelection.push(index);
    render();
  }

  function onBonusReset() {
    if (bonusFlash) return;   // the last check is still on screen
    if (view !== "bonus" || !state.bonus || state.bonus.resolved) return;
    bonusSelection = [];
    render();
  }

  function onBonusCheck() {
    if (bonusFlash) return;   // a check is already being shown
    if (view !== "bonus" || !state.bonus || state.bonus.resolved) return;
    if (bonusSelection.length !== state.bonus.target.length) return;
    var next = GameLogic.resolveBonus(state, bonusSelection.slice(), new Date());
    if (next === state) return;
    state = next;
    // No bottles are kept after a check: only a full match leaves the order in
    // the slots. A partial miss first blinks the boxes that were right, then
    // clears them so the next attempt starts from an empty slate.
    bonusSelection = [];
    if (!state.bonus.resolved) {
      var hits = GameLogic.matchPositions(state.bonus.target, state.bonus.tried);
      if (hits && hits.indexOf(true) !== -1) {
        bonusFlash = { order: state.bonus.tried.slice(), hits: hits };
        flashTimer = setTimeout(function () {
          flashTimer = null;
          bonusFlash = null;
          render();
        }, BONUS_BLINK_MS);
      }
    }
    persist();
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

  // Always renders every slot, filling the ones the player has already picked.
  // `rings` marks the positions the last check got right (only passed while the
  // blink is on screen); `matched` is the settled full match.
  function slotMarkup(indices, size, matched, rings) {
    var markup = "";
    for (var i = 0; i < size; i++) {
      var bottle = indices[i];
      var filled = typeof bottle === "number";
      var cls = "slot" + (filled ? " is-filled slot-" + bottle : "") +
        (matched && filled ? " is-matched" : "") +
        (rings && rings[i] && filled ? " is-correct-pos" : "");
      markup += '<li class="' + cls + '">' +
        '<span class="slot-pos" aria-hidden="true">' + SLOT_LABELS[i] + "</span>" +
        '<span class="slot-glyph"' + (filled ? "" : ' aria-hidden="true"') + ">" +
        (filled ? BOTTLE_GLYPHS[bottle] : "&mdash;") + "</span>" +
        (filled ? '<span class="sr-only">' + BOTTLE_NAMES[bottle] + "</span>" : "") +
        "</li>";
    }
    return markup;
  }

  function updateHud() {
    var visible = HUD_VIEWS.indexOf(view) !== -1 && questions.length > 0;
    el.hud.hidden = !visible;
    if (!visible) return;
    var number = Math.min(state.questionIndex + 1, questions.length);
    el.hudPoints.textContent = "Total Points: " + state.score;
    el.hudQuestion.textContent = "Question " + number + "/" + questions.length;
  }

  function render() {
    updateHud();
    SCREENS.forEach(function (id) { $(id).hidden = true; });

    if (view === "nickname") {
      el.nicknameNote.hidden = note !== "changed";
      $("screen-nickname").hidden = false;
      return;
    }

    if (view === "instructions") {
      $("screen-instructions").hidden = false;
      return;
    }

    if (view === "welcomeBack") {
      var maxPoints = questions.length * GameLogic.MAX_POINTS_PER_QUESTION;
      el.welcomeName.textContent = "Welcome back, " + state.nickname;
      el.welcomeProgress.textContent = (pendingPhase === "results")
        ? "Finished - score " + state.score + " / " + maxPoints
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

    if (view === "bonus") {
      renderBonus();
      return;
    }

    if (view === "results") {
      el.rTitle.textContent = state.nickname + ", here are your results";
      el.rScore.textContent = state.score + " / " + (questions.length * GameLogic.MAX_POINTS_PER_QUESTION);
      el.rTime.textContent = "Total time: " + (GameLogic.formatDuration(state.elapsedMs) || "0s");
      el.rFinished.textContent = GameLogic.formatTimestamp(state.finishedAt)
        ? "Finished at " + GameLogic.formatTimestamp(state.finishedAt)
        : "";
      el.rReview.innerHTML = state.answers.map(function (a, i) {
        var q = questions[i] || null;
        var correctText = q ? q.options[q.correctIndex] : "?";
        var yourText = q ? q.options[a.selected] : "?";
        var tag = a.correct ? "\u2713 +" + a.points + " pts" : "\u2717 0 pts";
        return "<li class=\"" + (a.correct ? "ok" : "bad") + "\">" +
          '<span class="verdict-tag" aria-hidden="true">' + tag + "</span>" +
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

  function renderBonus() {
    // A stale view (state already moved on) falls back to a playable screen.
    if (state.phase !== "bonus" || !state.bonus) {
      view = state.phase === "bonus" ? "question" : state.phase;
      render();
      return;
    }

    var bonus = state.bonus;
    var entry = state.answers[state.questionIndex] || { points: 0 };
    var size = bonus.target.length;
    var frozen = !!bonusFlash;   // a check is being shown; input is locked out
    var indices = frozen ? bonusFlash.order : (bonus.resolved ? bonus.target : bonusSelection);

    // Once the round is settled the "how to pick" hint no longer applies.
    el.bonusIntro.hidden = bonus.resolved;
    el.bonusAttempts.innerHTML = bonus.resolved
      ? "Attempts used: <b>" + bonus.attemptsUsed + "</b> of " + GameLogic.BONUS_MAX_ATTEMPTS
      : "Attempts left: <b>" + (GameLogic.BONUS_MAX_ATTEMPTS - bonus.attemptsUsed) + "</b>";

    // Per-position feedback: while a partial miss is on screen the boxes that
    // were right blink green, then the order clears for the next attempt.
    var rings = frozen ? bonusFlash.hits : null;

    el.bonusSlots.innerHTML = slotMarkup(indices, size, bonus.resolved && bonus.matched, rings);

    if (bonus.resolved) {
      el.bonusVerdict.className = "verdict " + (bonus.matched ? "is-correct" : "is-warn");
      el.bonusVerdict.textContent = bonus.matched
        ? "Match on attempt " + bonus.attemptsUsed + "! +" + entry.points + " points for this question."
        : "No match - the order was " + bonus.target.map(function (i) { return BOTTLE_NAMES[i]; }).join(" > ") +
          ". You still keep 1 point.";
      el.bonusCheck.hidden = true;
      el.bonusReset.hidden = true;
      el.bonusNext.hidden = false;
    } else {
      el.bonusVerdict.className = "verdict" + (bonus.attemptsUsed > 0 ? " is-wrong" : "");
      el.bonusVerdict.textContent = bonus.attemptsUsed > 0 ? "No match - try again." : "";
      el.bonusCheck.hidden = false;
      el.bonusReset.hidden = false;
      el.bonusNext.hidden = true;
      el.bonusCheck.disabled = frozen || bonusSelection.length !== size;
      el.bonusReset.disabled = frozen || bonusSelection.length === 0;
    }

    Array.prototype.forEach.call(el.bonusBottles.querySelectorAll(".bottle"), function (btn) {
      var index = parseInt(btn.getAttribute("data-bottle"), 10);
      var picked = bonusSelection.indexOf(index) !== -1;
      btn.classList.toggle("is-picked", picked);
      btn.setAttribute("aria-pressed", picked ? "true" : "false");
      btn.disabled = frozen || bonus.resolved || (!picked && bonusSelection.length >= size);
    });

    $("screen-bonus").hidden = false;
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
