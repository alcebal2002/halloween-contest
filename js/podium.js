(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var LB = isNode ? require("./leaderboard.js") : root.Leaderboard;
  var api = factory(LB);
  if (isNode) module.exports = api;
  else root.Podium = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (LB) {
  "use strict";

  var PLACE = 3;

  function num(v) { return Number(v) || 0; }

  function displayName(row) {
    return LB.displayName(row);
  }

  // Pure: the three best distinct names, best first. rankRows already orders by
  // score with the earlier arrival winning ties and folds each name's repeat
  // runs beneath it; dropping the repeats leaves exactly the podium. Keeping
  // this a pure function is what lets the placement be unit-tested without a
  // DOM.
  function topThree(rows) {
    var ranked = LB.rankRows(rows, PLACE);
    var out = [];
    for (var i = 0; i < ranked.length; i++) {
      var r = ranked[i];
      if (!r || r.repeat === true) continue;
      out.push(r);
      if (out.length === PLACE) break;
    }
    return out;
  }

  // Better run first: higher score, then more correct answers, then the
  // shorter time. 0 means the two runs cannot be told apart.
  function compareRuns(a, b) {
    return (num(b.total_score) - num(a.total_score))
      || (num(b.correct_count) - num(a.correct_count))
      || (num(a.elapsed_ms) - num(b.elapsed_ms));
  }

  // Pure: the three lowest distinct names, worst first. Each name is judged by
  // its best run, so a player who improved on a replay is not held to the
  // weaker one. Ties go to fewer correct answers, then to the LONGER time (the
  // best of the worst stays highest on this stand); rows arrive in that server
  // order, so the arrival index settles anything still equal.
  // exclude lists names already on the top stand; they are skipped here so no
  // one appears on both stands (the top stand takes priority).
  function bottomThree(rows, exclude) {
    if (!Array.isArray(rows)) return [];
    var skip = Object.create(null);
    (exclude || []).forEach(function (n) {
      skip[LB.playerKey(typeof n === "object" ? n : { nickname: n })] = true;
    });
    var best = Object.create ? Object.create(null) : {};
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var name = (typeof row.nickname === "string") ? row.nickname.replace(/^\s+|\s+$/g, "") : "";
      var identity = LB.playerKey(row);
      if (name === "" || skip[identity]) continue;
      if (!best[identity]) { best[identity] = { row: row, at: i }; order.push(identity); }
      else if (compareRuns(row, best[identity].row) < 0) best[identity].row = row;
    }
    var picks = order.map(function (n) { return best[n]; });
    picks.sort(function (a, b) {
      return (num(a.row.total_score) - num(b.row.total_score))
        || (num(a.row.correct_count) - num(b.row.correct_count))
        || (num(b.row.elapsed_ms) - num(a.row.elapsed_ms))
        || (a.at - b.at);
    });
    return picks.slice(0, PLACE).map(function (p) { return p.row; });
  }

  function correctText(n) {
    return num(n) + " correct";
  }

  // Nickname on the first line, the GFT ID (when there is one) centred below it.
  function setName(el, row) {
    var doc = el.ownerDocument;
    while (el.firstChild) el.removeChild(el.firstChild);
    var nick = doc.createElement("span");
    nick.className = "podium-nick";
    nick.textContent = String(row.nickname || "");
    el.appendChild(nick);
    if (row.gft_id) {
      var id = doc.createElement("span");
      id.className = "podium-gft";
      id.textContent = "[" + String(row.gft_id).toUpperCase() + "]";
      el.appendChild(id);
    }
  }

  function fillSlot(board, place, row, loading) {
    var slot = board.querySelector('[data-place="' + place + '"]');
    if (!slot) return;
    var nameEl = slot.querySelector(".podium-name");
    var scoreEl = slot.querySelector(".podium-score");
    var correctEl = slot.querySelector(".podium-correct");
    var hasRow = !!row;

    if (nameEl) {
      if (hasRow) setName(nameEl, row);
      else nameEl.textContent = loading ? "…" : "—";
    }
    if (scoreEl) scoreEl.textContent = hasRow ? String(num(row.total_score)) : "–";
    if (correctEl) correctEl.textContent = hasRow ? correctText(row.correct_count) : "";

    if (slot.classList) {
      if (hasRow) slot.classList.add("has-player");
      else slot.classList.remove("has-player");
    }
  }

  function writeMessage(doc, el, text, link) {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (text) el.appendChild(doc.createTextNode(text));
    if (link) {
      el.appendChild(doc.createTextNode(" "));
      var a = doc.createElement("a");
      a.setAttribute("href", link.href);
      a.appendChild(doc.createTextNode(link.text));
      el.appendChild(a);
    }
  }

  // The single writer. Shows the stand while loading, ready, or when a later
  // error leaves earlier results on screen; otherwise it shows the message.
  // ids picks the stand: the default is the top one, BOTTOM_IDS the bottom.
  var TOP_IDS = { status: "pd-status", board: "pd-board", message: "pd-message" };
  var BOTTOM_IDS = { status: "pd-bottom-status", board: "pd-bottom", message: "pd-bottom-message" };

  function render(doc, view, ids) {
    if (!doc) return;
    var which = ids || TOP_IDS;
    var status = doc.getElementById(which.status);
    var board = doc.getElementById(which.board);
    var msg = doc.getElementById(which.message);
    if (!status || !board || !msg) return;

    var state = (view && view.state) ? view.state : "";
    status.textContent = (view && view.status) || "";
    status.className = "save-status" + (state === "error" ? " is-error" : "");

    var rows = (view && view.rows) || [];
    for (var place = 1; place <= PLACE; place++) {
      fillSlot(board, place, rows[place - 1] || null, state === "loading");
    }

    var showBoard = state === "loading" || state === "ready" || (state === "error" && rows.length > 0);
    board.hidden = !showBoard;
    msg.hidden = showBoard;
    if (!showBoard) {
      writeMessage(doc, msg, (view && view.message) || "", (view && view.link) || null);
    }
  }

  // One-shot: fetch the window once and render it. The podium is a snapshot,
  // not a live board, so nothing here schedules a later fetch.
  function loadWith(doc, api, config) {
    return api.fetchResults(config).then(function (res) {
      if (!res.ok) {
        // A single load: there is no retry, so the failure is reported as-is.
        render(doc, { state: "error", status: "Couldn't load",
                      message: "Couldn't load the podium." });
        return res;
      }
      var podium = topThree(res.rows);
      render(doc, {
        state: podium.length ? "ready" : "empty",
        rows: podium,
        status: "Updated " + new Date().toLocaleTimeString(),
        message: "No results yet — finish a contest and the podium appears here.",
        link: podium.length ? null : { href: "index.html", text: "Play now" }
      });
      return res;
    }, function (e) {
      return { ok: false, kind: "failed", detail: (e && e.message) || "render error" };
    });
  }

  function loadBottomWith(doc, api, config, exclude) {
    return api.fetchLowestResults(config).then(function (res) {
      if (!res.ok) {
        render(doc, { state: "error", status: "Couldn't load",
                      message: "Couldn't load the bottom three." }, BOTTOM_IDS);
        return res;
      }
      var rows = bottomThree(res.rows, exclude);
      render(doc, {
        state: rows.length ? "ready" : "empty",
        rows: rows,
        status: "",
        message: "No results yet."
      }, BOTTOM_IDS);
      return res;
    }, function (e) {
      return { ok: false, kind: "failed", detail: (e && e.message) || "render error" };
    });
  }

  // Synthesised applause (Web Audio, no asset), ~5s: hundreds of short noise
  // "claps" scattered at random, swelling in, holding, then thinning out.
  function applauseBuffer(ctx, dur) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * dur);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.02;
      var claps = Math.floor(dur * 90);
      for (var c = 0; c < claps; c++) {
        var at = Math.random() * dur;
        // Fewer claps near the very start and the tail.
        var shape = Math.min(1, at / 0.6) * Math.min(1, (dur - at) / 1.8);
        if (Math.random() > shape) continue;
        var start = Math.floor(at * rate);
        var clapLen = Math.floor(rate * (0.008 + Math.random() * 0.012));
        var amp = 0.15 + Math.random() * 0.35;
        for (var k = 0; k < clapLen && start + k < len; k++) {
          data[start + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / (clapLen / 4));
        }
      }
    }
    return buf;
  }

  // The recording (see sounds/README.md) is fetched and decoded up front so it
  // can start the moment the browser allows sound. If it can't load, the
  // synthesised applause above plays instead.
  var CLIP_URL = "sounds/applause-cheer.mp3";
  var clip = { buffer: null, state: "idle", pending: false };

  function loadClip(ctx) {
    if (clip.state !== "idle" || !ctx || typeof fetch !== "function") return;
    clip.state = "loading";
    fetch(CLIP_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.arrayBuffer();
      })
      .then(function (bytes) {
        return new Promise(function (resolve, reject) { ctx.decodeAudioData(bytes, resolve, reject); });
      })
      .then(function (buffer) { clip.buffer = buffer; clip.state = "ready"; },
            function () { clip.state = "failed"; })
      .then(function () {
        if (clip.pending) { clip.pending = false; playApplause(ctx); }
      });
  }

  function playClip(ctx) {
    try {
      var src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.connect(ctx.destination);
      src.start(ctx.currentTime);
    } catch (e) { /* sound is decoration; never break the podium */ }
  }

  function playApplause(ctx) {
    if (clip.state === "loading") { clip.pending = true; return; }
    if (clip.buffer) { playClip(ctx); return; }
    try {
      var t = ctx.currentTime;
      var dur = 5;
      var src = ctx.createBufferSource();
      src.buffer = applauseBuffer(ctx, dur);
      var tone = ctx.createBiquadFilter();
      tone.type = "highpass";
      tone.frequency.value = 500;
      tone.Q.value = 0.5;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(1.6, t + 0.5);
      gain.gain.setValueAtTime(1.6, t + 3.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(tone);
      tone.connect(gain);
      gain.connect(ctx.destination);
      src.start(t);
      src.stop(t + dur);
    } catch (e) { /* sound is decoration; never break the podium */ }
  }

  // Plays once when the podium appears. Browsers usually block audio on a
  // freshly opened page, so if it can't start now it plays on the first
  // click or key press instead.
  // A visible button appears when the browser blocks the sound, so it is
  // obvious that one click is needed.
  var sound = { ctx: null, wanted: false, played: false, btn: null };

  function audioCtor() {
    var root = typeof globalThis !== "undefined" ? globalThis : this;
    return root && (root.AudioContext || root.webkitAudioContext);
  }

  function tryPlay() {
    if (!sound.wanted || sound.played || !sound.ctx || sound.ctx.state !== "running") return;
    sound.played = true;
    if (sound.btn && sound.btn.parentNode) sound.btn.parentNode.removeChild(sound.btn);
    playApplause(sound.ctx);
  }

  // Called inside a click/key handler: creating or resuming the context
  // there is what browsers accept as permission to play.
  function unlock() {
    var AC = audioCtor();
    if (!AC) return;
    try {
      if (!sound.ctx) sound.ctx = new AC();
      loadClip(sound.ctx);
      var p = sound.ctx.resume ? sound.ctx.resume() : null;
      Promise.resolve(p).then(tryPlay, function () {});
      tryPlay();
    } catch (e) { /* no sound available */ }
  }

  function listenForUnlock(doc) {
    if (!doc || !doc.addEventListener || !audioCtor()) return;
    doc.addEventListener("pointerdown", unlock);
    doc.addEventListener("keydown", unlock);
    try { sound.ctx = new (audioCtor())(); } catch (e) { sound.ctx = null; }
    loadClip(sound.ctx);
  }

  function showSoundButton(doc) {
    if (sound.played || sound.btn || !doc.body) return;
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "btn sound-btn";
    b.textContent = "🔊 Play applause";
    b.addEventListener("click", unlock);
    doc.body.appendChild(b);
    sound.btn = b;
  }

  function cheer(doc) {
    if (!audioCtor()) return;
    sound.wanted = true;
    tryPlay();
    if (sound.played) return;
    if (sound.ctx && sound.ctx.resume) {
      Promise.resolve(sound.ctx.resume()).then(tryPlay, function () {});
    }
    setTimeout(function () { if (!sound.played) showSoundButton(doc); }, 400);
  }

  function boot(doc, api, config) {
    if (!doc || !api) return null;
    listenForUnlock(doc);
    render(doc, { state: "loading", status: "Loading…" });
    render(doc, { state: "loading", status: "" }, BOTTOM_IDS);

    if (!api.isConfigured(config)) {
      render(doc, { state: "not-configured", status: "Not configured",
                    message: "The podium is not configured yet." });
      render(doc, { state: "not-configured", status: "", message: "" }, BOTTOM_IDS);
      return null;
    }

    // The initial (and only) queries, one per stand, so either can fail alone.
    // The bottom stand waits for the top one so it can skip its names.
    loadWith(doc, api, config).then(function (res) {
      if (res && res.ok && topThree(res.rows).length) cheer(doc);
      var top = (res && res.ok) ? topThree(res.rows) : [];
      return loadBottomWith(doc, api, config, top);
    });
    return null;
  }

  return {
    PLACE: PLACE,
    topThree: topThree,
    bottomThree: bottomThree,
    BOTTOM_IDS: BOTTOM_IDS,
    render: render,
    boot: boot
  };
});
