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
  var HOWL_URL = "sounds/wolf-howl.mp3";
  // The recording runs ~11s. A blink should be a punctuation mark, not a
  // soundtrack, so playback fades out and stops after this many seconds.
  var HOWL_SECONDS = 4;

  // The howl is a real recording (CC0, see sounds/README.md). It is fetched
  // and decoded once, then replayed from the decoded buffer, because decoding
  // on every change would add a network round-trip to the moment the room
  // should hear the sound.
  var audio = { ctx: null, buffer: null, loading: false, queued: false };
  // Set while an unlock preview is waiting for resume(): the same tap fires
  // pointerdown and the button's click, and both must not howl.
  var previewArmed = false;

  function audioCtor() {
    return rootRef && (rootRef.AudioContext || rootRef.webkitAudioContext);
  }

  function loadScream(ctx) {
    if (audio.buffer || audio.loading) return;
    audio.loading = true;
    try {
      fetch(HOWL_URL)
        .then(function (res) { return res.arrayBuffer(); })
        .then(function (bytes) {
          return new Promise(function (resolve, reject) {
            ctx.decodeAudioData(bytes, resolve, reject);
          });
        })
        .then(function (buffer) {
          audio.buffer = buffer;
          // A change that landed while the file was still decoding is honoured
          // as soon as the buffer is ready, instead of being lost.
          if (audio.queued) { audio.queued = false; playHowl(); }
        }, function (err) {
          // The board must never break because a sound failed. Say so in the
          // console, though: a wrong file (an HTML error page saved as .mp3)
          // would otherwise fail silently forever.
          if (rootRef && rootRef.console) {
            rootRef.console.warn("Wolf howl failed to load: " + HOWL_URL, err);
          }
        })
        .then(function () { audio.loading = false; });
    } catch (e) { audio.loading = false; }
  }

  function unlockAudio(preview) {
    var AC = audioCtor();
    if (!AC) return;
    var wasBlocked = !audio.ctx || audio.ctx.state !== "running";
    var wantPreview = !!wasBlocked && !!preview && !previewArmed;
    if (wantPreview) previewArmed = true;
    try {
      if (!audio.ctx) audio.ctx = new AC();
      var resumed = (audio.ctx.state === "suspended" && audio.ctx.resume)
        ? audio.ctx.resume()
        : null;
      Promise.resolve(resumed).then(function () {
        if (!audio.ctx || audio.ctx.state !== "running") {
          if (wantPreview) previewArmed = false;
          return;
        }
        hideSoundButton();
        // Play once when a gesture finally unlocks audio, so the click has
        // audible feedback and the operator knows the howl is working. Boot
        // never previews: a permissive browser would howl on page load.
        if (wantPreview) {
          previewArmed = false;
          playHowl();
        }
      }, function () {
        // Still blocked until the next gesture: allow a later click to try.
        if (wantPreview) previewArmed = false;
      });
      loadScream(audio.ctx);
    } catch (e) { audio.ctx = null; previewArmed = false; }
  }

  // Warm the buffer at boot too: a browser that allows audio without a gesture
  // (kiosk flags, prior engagement) then plays a change straight away, and the
  // rest still get their first click or key press to unlock it.
  function prepareAudio() {
    unlockAudio(false);
  }

  // A browser only allows audio after a user gesture, so this stays silent
  // until the page has been clicked or a key pressed once. A change that
  // arrives before the recording has decoded is queued rather than dropped.
  function playHowl() {
    var ctx = audio.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (!audio.buffer) {
      if (audio.loading) audio.queued = true;
      return;
    }
    try {
      var t = ctx.currentTime;
      var dur = Math.min(HOWL_SECONDS, audio.buffer.duration);
      var src = ctx.createBufferSource();
      var gain = ctx.createGain();
      src.buffer = audio.buffer;
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.setValueAtTime(0.9, t + Math.max(0, dur - 0.7));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch (e) { /* sound is decoration; never break the board */ }
  }

  var lastPodium = null;
  var soundBtn = null;

  function hideSoundButton() {
    if (soundBtn && soundBtn.parentNode) soundBtn.parentNode.removeChild(soundBtn);
    soundBtn = null;
  }

  // Modern browsers hold audio suspended until the page has had a user gesture.
  // A results screen is often opened and left alone, so nothing would ever
  // unlock it: this button is the gesture, and it disappears once the context
  // is running.
  function showSoundButton(doc) {
    if (soundBtn || !doc || !doc.body) return;
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "btn sound-btn";
    b.textContent = "\ud83d\udd0a Enable sound";
    b.addEventListener("click", function () {
      unlockAudio(true);
      if (audio.ctx && audio.ctx.state === "running") hideSoundButton();
    });
    doc.body.appendChild(b);
    soundBtn = b;
  }

  function syncSoundButton(doc) {
    if (audio.ctx && audio.ctx.state === "running") hideSoundButton();
    else showSoundButton(doc);
  }

  function boot(doc, api, config) {
    if (!doc || !api) return null;

    if (doc.addEventListener) {
      doc.addEventListener("pointerdown", function () { unlockAudio(true); });
      doc.addEventListener("keydown", function () { unlockAudio(true); });
    }
    prepareAudio();
    // Give a permissive browser a moment to run the context before offering the
    // button, so it only appears when sound is genuinely blocked.
    setTimeout(function () { syncSoundButton(doc); }, 600);

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
              playHowl();
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

  return {
    boot: boot,
    // Read-only view of the audio plumbing, used by the browser check and handy
    // when the howl is silent: it says whether the context runs and whether
    // the recording finished decoding.
    audioInfo: function () {
      return {
        ctxState: audio.ctx ? audio.ctx.state : "none",
        buffered: !!audio.buffer,
        loading: !!audio.loading,
        duration: audio.buffer ? audio.buffer.duration : 0
      };
    }
  };
});
