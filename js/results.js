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
  var audioCtx = null;

  function unlockAudio() {
    var AC = rootRef && (rootRef.AudioContext || rootRef.webkitAudioContext);
    if (!AC) return;
    try {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }

  function playGhostScream() {
    var ctx = audioCtx;
    if (!ctx || ctx.state !== "running") return;
    try {
      var t = ctx.currentTime;
      var dur = 2.4;
      var master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(0.6, t + 0.3);
      master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      master.connect(ctx.destination);

      // Try to use the downloaded sound file
      var req = new XMLHttpRequest();
      req.open('GET', 'sounds/ghost-scream.wav', true);
      req.responseType = 'arraybuffer';
      req.onload = function() {
        try {
          ctx.decodeAudioData(req.response, function(buffer) {
            var src = ctx.createBufferSource();
            src.buffer = buffer;
            var g = ctx.createGain();
            g.gain.setValueAtTime(0.8, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, buffer.duration));
            src.connect(g);
            g.connect(master);
            src.start(t);
            src.stop(t + Math.min(dur, buffer.duration));
          });
        } catch(e) {}
      };
      req.send();
    } catch (e) { /* sound is decoration; never break the board */ }
  }

  var lastPodium = null;

  function boot(doc, api, config) {
    if (!doc || !api) return null;

    if (doc.addEventListener) {
      doc.addEventListener("pointerdown", unlockAudio);
      doc.addEventListener("keydown", unlockAudio);
    }

    var status = doc.getElementById("res-status");
    var button = doc.getElementById("ctl-refresh");

    function loadStats() {
      if (status) {
        status.className = "save-status";
        status.textContent = "Loading\u2026";
      }
      if (button) button.disabled = true;
      return api.fetchDashboardStats(config).then(function (res) {
        if (button) button.disabled = false;
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
        // Check for changes in top 3 to play sound
        if (ranked.length >= 3) {
          var current = [];
          for (var i = 0; i < 3; i++) {
            if (!ranked[i] || ranked[i].repeat) {
              // need to find first non-repeat
            }
            var r = ranked[i];
            if (r && !r.repeat) current.push([r.nickname, r.total_score, r.correct_count, r.elapsed_ms].join("|"));
            else i--; // skip repeats
          }
          if (lastPodium && current.length === 3) {
            for (var j = 0; j < 3; j++) {
              if (lastPodium[j] !== current[j]) {
                playGhostScream();
                break;
              }
            }
          }
          lastPodium = current;
        }
        return res;
      }, function (e) {
        inFlight = false;
        return { ok: false, kind: "failed", detail: (e && e.message) || "render error" };
      });
    }

    function loadAll() {
      return Promise.all([loadStats(), loadLeaderboard()]);
    }

    if (button) button.addEventListener("click", loadAll);
    loadAll();
    if (typeof setInterval !== "undefined") {
      setInterval(function() {
        if (doc.hidden) return;
        loadAll();
      }, REFRESH_MS);
    }
    return null;
  }

  return { boot: boot };
});
