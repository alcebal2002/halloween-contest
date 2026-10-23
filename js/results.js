(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var GL = isNode ? require("./game-logic.js") : root.GameLogic;
  var Ctl = isNode ? require("./control.js") : root.Control;
  var LB = isNode ? require("./leaderboard.js") : root.Leaderboard;
  var api = factory(GL, Ctl, LB, root);
  if (isNode) module.exports = api;
  else root.Results = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL, Ctl, LB, rootRef) {
  "use strict";

  var REFRESH_MS = 10000;
  var SCREAM_URL = "sounds/ghost-scream.mp3";

  // The scream is a real recording (CC0, see sounds/README.md). It is fetched
  // and decoded once, then replayed from the decoded buffer, because decoding
  // on every change would add a network round-trip to the moment the room
  // should hear the sound.
  var audio = { ctx: null, buffer: null, loading: false };

  function audioCtor() {
    return rootRef && (rootRef.AudioContext || rootRef.webkitAudioContext);
  }

  function loadScream(ctx) {
    if (audio.buffer || audio.loading) return;
    audio.loading = true;
    try {
      fetch(SCREAM_URL)
        .then(function (res) { return res.arrayBuffer(); })
        .then(function (bytes) {
          return new Promise(function (resolve, reject) {
            ctx.decodeAudioData(bytes, resolve, reject);
          });
        })
        .then(function (buffer) { audio.buffer = buffer; }, function () { /* silent */ })
        .then(function () { audio.loading = false; });
    } catch (e) { audio.loading = false; }
  }

  function unlockAudio() {
    var AC = audioCtor();
    if (!AC) return;
    try {
      if (!audio.ctx) audio.ctx = new AC();
      if (audio.ctx.state === "suspended") audio.ctx.resume();
      loadScream(audio.ctx);
    } catch (e) { audio.ctx = null; }
  }

  // Warm the buffer at boot too: a browser that allows audio without a gesture
  // (kiosk flags, prior engagement) then plays a change straight away, and the
  // rest still get their first click or key press to unlock it.
  function prepareAudio() {
    unlockAudio();
  }

  // A browser only allows audio after a user gesture, so this stays silent
  // until the page has been clicked or a key pressed once.
  function playGhostScream() {
    var ctx = audio.ctx;
    if (!ctx || ctx.state !== "running" || !audio.buffer) return;
    try {
      var src = ctx.createBufferSource();
      var gain = ctx.createGain();
      src.buffer = audio.buffer;
      gain.gain.value = 0.9;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* sound is decoration; never break the board */ }
  }

  var lastPodium = null;

  function boot(doc, api, config) {
    if (!doc || !api) return null;

    if (doc.addEventListener) {
      doc.addEventListener("pointerdown", unlockAudio);
      doc.addEventListener("keydown", unlockAudio);
    }
    prepareAudio();

    var status = doc.getElementById("res-status");

    function loadStats() {
      if (status) {
        status.className = "save-status";
        status.textContent = "Loading\u2026";
      }
      return api.fetchDashboardStats(config).then(function (res) {
        if (!res.ok) {
          if (status) {
            status.className = "save-status is-error";
            status.textContent = res.kind === "unconfigured"
              ? "The results store is not configured."
              : "Could not load the statistics.";
          }
          return;
        }
        if (Ctl && Ctl.tiles && Ctl.render) {
          Ctl.render(doc, Ctl.tiles(res));
        }
        if (status) {
          status.textContent = "Updated at " + new Date().toLocaleTimeString();
        }
      });
    }

    var inFlight = false;
    function loadLeaderboard() {
      if (inFlight) return Promise.resolve(null);
      inFlight = true;
      return api.fetchResults(config).then(function (res) {
        inFlight = false;
        if (!res.ok) {
          return res;
        }
        var ranked = LB.rankRows(res.rows, LB.TOP_NAMES);
        LB.render(doc, {
          state: ranked.length ? "ready" : "empty",
          rows: ranked,
          status: "",
          message: "No results yet — finish a contest and your score appears here.",
          link: ranked.length ? null : { href: "index.html", text: "Play now" }
        });
        // The three best distinct players, in order. A repeat run is skipped,
        // and the walk is bounded so a short board can never spin.
        var current = [];
        for (var i = 0; i < ranked.length && current.length < 3; i++) {
          var r = ranked[i];
          if (!r || r.repeat === true) continue;
          current.push([r.nickname, r.total_score, r.correct_count, r.elapsed_ms, r.finished_at || ""].join("|"));
        }
        if (lastPodium && current.length > 0) {
          for (var j = 0; j < current.length; j++) {
            if (lastPodium[j] !== current[j]) {
              playGhostScream();
              break;
            }
          }
        }
        lastPodium = current;
        return res;
      }, function (e) {
        inFlight = false;
        return { ok: false, kind: "failed", detail: (e && e.message) || "render error" };
      });
    }

    function loadAll() {
      return Promise.all([loadStats(), loadLeaderboard()]);
    }

    loadAll();
    if (typeof setInterval !== "undefined") {
      setInterval(function () {
        if (doc.hidden) return;
        loadAll();
      }, REFRESH_MS);
    }
    return null;
  }

  return { boot: boot };
});
