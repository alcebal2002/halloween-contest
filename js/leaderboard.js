(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var GL = isNode ? require("./game-logic.js") : root.GameLogic;
  var api = factory(GL, root);
  if (isNode) module.exports = api;
  else root.Leaderboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL, rootRef) {
  "use strict";

  var REFRESH_MS = 10000;
  var TOP_NAMES = 10;
  var COLUMNS = ["#", "Player", "Score", "Time", "Finished"];

  // Pure ranking over a stream the server already ordered by
  // total_score desc, created_at asc.
  //
  // 1. blank nicknames are dropped — otherwise they would all group into one
  //    phantom "" player and claim a rank nobody earned;
  // 2. rows are grouped by nickname in arrival order, so the first row seen
  //    for a name is that name's best score;
  // 3. only the first `limit` distinct names are kept;
  // 4. each kept name emits its best row first (repeat:false), then its other
  //    rows (repeat:true), so repeats sit directly beneath the name they
  //    belong to rather than scattering through the standings.
  //
  // Returns new objects; the input array is never touched.
  function rankRows(rows, limit) {
    if (!Array.isArray(rows)) return [];
    var max = (typeof limit === "number" && limit > 0) ? limit : TOP_NAMES;

    var order = [];
    var groups = Object.create ? Object.create(null) : {};

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var name = (typeof row.nickname === "string")
        ? row.nickname.replace(/^\s+|\s+$/g, "")
        : "";
      if (name === "") continue;
      if (!groups[name]) { groups[name] = []; order.push(name); }
      groups[name].push(row);
    }

    var out = [];
    var kept = 0;
    for (var g = 0; g < order.length && kept < max; g++) {
      var group = groups[order[g]];
      kept++;
      for (var r = 0; r < group.length; r++) {
        var copy = {};
        for (var key in group[r]) {
          if (Object.prototype.hasOwnProperty.call(group[r], key)) copy[key] = group[r][key];
        }
        copy.repeat = r > 0;
        out.push(copy);
      }
    }
    return out;
  }

  // A hidden document means an abandoned tab: skip the tick so it does not
  // hold the anon key at six requests a minute.
  function shouldPoll(docLike) {
    if (!docLike || typeof docLike.hidden !== "boolean") return true;
    return !docLike.hidden;
  }

  function cell(doc, text, label, cls) {
    var td = doc.createElement("td");
    td.setAttribute("data-label", label);
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function num(v) { return Number(v) || 0; }

  // The Score column folds the old Correct count into the cell as a single
  // "total (correct)" reading, e.g. "25 (7)". The total is the headline; the
  // count in parentheses explains it. (Bonus points are already part of the
  // total, so they are not repeated here.) Folding the count in frees a column
  // and hands the width to the player name.
  function scoreText(row) {
    return num(row.total_score) + " (" + num(row.correct_count) + ")";
  }

  function displayName(row) {
    if (!row) return "";
    return (typeof row.nickname === "string") ? row.nickname : String(row.nickname || "");
  }

  function podiumKey(row) {
    return [displayName(row), num(row.total_score), num(row.correct_count),
            num(row.elapsed_ms), row.finished_at || ""].join("|");
  }

  // What the top three ranks showed on the previous render. Null until the
  // first rows are drawn, so opening the page never blinks.
  var lastPodium = null;

  // Synthesised scream (Web Audio, no asset): a shrieking sawtooth glide with
  // vibrato, a detuned second voice and a breathy noise layer. Browsers block
  // audio until the page has had a user gesture, so the context is created
  // (or resumed) on the first click/key and a change before that stays silent.
  var audioCtx = null;

  function unlockAudio() {
    var AC = rootRef && (rootRef.AudioContext || rootRef.webkitAudioContext);
    if (!AC) return;
    try {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }

  function playScream() {
    var ctx = audioCtx;
    if (!ctx || ctx.state !== "running") return;
    try {
      // Ghost moan, ~3s: a low, hollow "uhhhhmmmmm" that fades in out of
      // nothing, sags slowly in pitch, and closes from an open "uhh" into a
      // muffled "mmm" hum. Soft waveforms, a slow wobble, two slightly
      // detuned voices for a beating, otherworldly feel, a long echo tail and
      // a faint draught of air underneath. Nothing sharp or high.
      var t = ctx.currentTime;
      var dur = 3.2;
      var master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(0.55, t + 0.9);
      master.gain.setValueAtTime(0.55, t + 2.0);
      master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      master.connect(ctx.destination);

      var echo = ctx.createDelay(1);
      echo.delayTime.value = 0.35;
      var feedback = ctx.createGain();
      feedback.gain.value = 0.45;
      var echoTone = ctx.createBiquadFilter();
      echoTone.type = "lowpass";
      echoTone.frequency.value = 800;
      echo.connect(echoTone);
      echoTone.connect(feedback);
      feedback.connect(echo);
      echoTone.connect(master);

      // Open "uhh" (filter ~1000 Hz) closing to a hummed "mmm" (~300 Hz).
      var voice = ctx.createBiquadFilter();
      voice.type = "lowpass";
      voice.frequency.setValueAtTime(500, t);
      voice.frequency.linearRampToValueAtTime(1000, t + 0.9);
      voice.frequency.setValueAtTime(1000, t + 1.6);
      voice.frequency.exponentialRampToValueAtTime(300, t + 2.4);
      voice.Q.value = 2;
      voice.connect(master);
      voice.connect(echo);

      [[1, "triangle", 0.6, 0], [1, "sine", 0.4, 9], [2, "sine", 0.12, -5]].forEach(function (v) {
        var ratio = v[0];
        var osc = ctx.createOscillator();
        osc.type = v[1];
        osc.detune.value = v[3];
        osc.frequency.setValueAtTime(120 * ratio, t);
        osc.frequency.exponentialRampToValueAtTime(165 * ratio, t + 1.0);
        osc.frequency.exponentialRampToValueAtTime(150 * ratio, t + 1.8);
        osc.frequency.exponentialRampToValueAtTime(105 * ratio, t + dur);
        var lfo = ctx.createOscillator();
        var lfoGain = ctx.createGain();
        lfo.frequency.setValueAtTime(3, t);
        lfo.frequency.linearRampToValueAtTime(4.5, t + dur);
        lfoGain.gain.value = 4 * ratio;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        var g = ctx.createGain();
        g.gain.value = v[2];
        osc.connect(g);
        g.connect(voice);
        osc.start(t); lfo.start(t);
        osc.stop(t + dur); lfo.stop(t + dur);
      });

      var len = Math.floor(ctx.sampleRate * dur);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var noise = ctx.createBufferSource();
      noise.buffer = buf;
      var wind = ctx.createBiquadFilter();
      wind.type = "bandpass";
      wind.frequency.setValueAtTime(300, t);
      wind.frequency.linearRampToValueAtTime(600, t + 1.2);
      wind.frequency.linearRampToValueAtTime(250, t + dur);
      wind.Q.value = 1.5;
      var noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.08;
      noise.connect(wind);
      wind.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(t);
      noise.stop(t + dur);
    } catch (e) { /* sound is decoration; never break the board */ }
  }

  function writeRows(doc, body, rows) {
    body.textContent = "";
    var prev = lastPodium;
    var anyChanged = false;
    var podiumNow = [];
    var rank = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var isRepeat = row.repeat === true;
      if (!isRepeat) rank++;
      // The podium (1st/2nd/3rd) gets its own class so the styling can
      // highlight it without the renderer knowing any colours.
      var podium = (!isRepeat && rank <= 3) ? " is-rank-" + rank : "";
      var tr = doc.createElement("tr");
      // A top-three rank whose content differs from the last render blinks
      // (pure CSS animation, about 3 seconds) so the room notices the change.
      var changed = "";
      if (podium) {
        var key = podiumKey(row);
        podiumNow[rank - 1] = key;
        if (prev && prev[rank - 1] !== key) { changed = " is-changed"; anyChanged = true; }
      }
      tr.className = "lb-row" + (isRepeat ? " is-repeat" : "") + podium + changed;
      tr.appendChild(cell(doc, isRepeat ? "" : String(rank), "#", "lb-rank"));
      tr.appendChild(cell(doc, displayName(row), "Player", "lb-player"));
      tr.appendChild(cell(doc, scoreText(row), "Score", ""));
      tr.appendChild(cell(doc, GL.formatDuration(num(row.elapsed_ms)) || "", "Time", ""));
      tr.appendChild(cell(doc, GL.formatTimestamp(row.finished_at), "Finished", ""));
      body.appendChild(tr);
    }
    lastPodium = podiumNow;
    if (anyChanged) playScream();
  }

  function writeSkeleton(doc, body) {
    body.textContent = "";
    for (var i = 0; i < 3; i++) {
      var tr = doc.createElement("tr");
      tr.className = "lb-row is-skeleton";
      for (var c = 0; c < COLUMNS.length; c++) tr.appendChild(cell(doc, "", COLUMNS[c], ""));
      body.appendChild(tr);
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

  // The one writer for the whole page. Exactly one of the table and the
  // message is visible at a time, and a failed load never rewrites the tbody,
  // so old and new rows can never coexist.
  function render(doc, view) {
    if (!doc) return;
    var status = doc.getElementById("lb-status");
    var table = doc.getElementById("lb-table");
    var msg = doc.getElementById("lb-message");
    var body = doc.getElementById("lb-body");
    if (!table || !msg || !body) return;

    var state = (view && view.state) ? view.state : "";
    // The status line is optional: the combined results page has one status
    // line for the whole page, so it renders the board without it.
    if (status) {
      status.textContent = (view && view.status) || "";
      status.className = "save-status" + (state === "error" ? " is-error" : "");
    }

    // "Prior rows" means rows that actually carry data. A skeleton is the
    // loading placeholder, so a failure on the very first load must fall
    // through to the message (spec §8, "Error on first load") instead of
    // parking three grey bars under an error line forever.
    var hasRows = false;
    var trs = body.getElementsByTagName("tr");
    for (var t = 0; t < trs.length; t++) {
      if (trs[t].className.indexOf("is-skeleton") === -1) { hasRows = true; break; }
    }
    var showTable = state === "loading" || state === "ready" || (state === "error" && hasRows);

    table.hidden = !showTable;
    msg.hidden = showTable;

    if (!showTable) {
      // Clearing the tbody keeps `hasRows` honest across a later error: rows
      // that are no longer on screen must not resurface behind the message.
      body.textContent = "";
      writeMessage(doc, msg, (view && view.message) || "", (view && view.link) || null);
      return;
    }
    if (state === "loading") writeSkeleton(doc, body);
    else if (state === "ready") writeRows(doc, body, (view && view.rows) || []);
    // state === "error" with rows already on screen: the tbody is left exactly
    // as it is. Nothing is appended, so a stale row can never sit beside a new
    // one, and a single dropped request never blanks a good leaderboard.
  }

  var activeLoad = null;
  var timerId = null;

  // Runs one load and renders its outcome. Always resolves — fetchResults
  // already resolves, and render is wrapped here so a DOM surprise becomes a
  // failed load rather than a tick that stops polling for good.
  function loadWith(doc, api, config) {
    return api.fetchResults(config).then(function (res) {
      if (!res.ok) {
        // The previously rendered rows are left untouched; only the status
        // line changes. A leaderboard failure is transient, so polling keeps
        // running and Refresh still works.
        render(doc, { state: "error", status: "Couldn't load — retrying",
                      message: "Couldn't load the leaderboard — retrying." });
        return res;
      }
      var ranked = rankRows(res.rows, TOP_NAMES);
      render(doc, {
        state: ranked.length ? "ready" : "empty",
        rows: ranked,
        status: "Updated " + new Date().toLocaleTimeString(),
        message: "No results yet — finish a contest and your score appears here.",
        link: ranked.length ? null : { href: "index.html", text: "Play now" }
      });
      return res;
    }, function (e) {
      return { ok: false, kind: "failed", detail: (e && e.message) || "render error" };
    });
  }

  // The single entry point every trigger goes through: the Refresh button,
  // visibilitychange returning to visible, and each interval tick.
  function reload() {
    if (!activeLoad) return Promise.resolve(null);
    return activeLoad();
  }

  function startPolling(load, ms) {
    stopPolling();
    var every = (typeof ms === "number" && ms > 0) ? ms : REFRESH_MS;
    timerId = setInterval(function () {
      if (!shouldPoll(rootRef && rootRef.document)) return;
      load();
    }, every);
    return timerId;
  }

  function stopPolling() {
    if (timerId !== null && timerId !== undefined) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function boot(doc, api, config) {
    if (!doc || !api) return null;
    render(doc, { state: "loading", status: "Loading…" });

    // Unconfigured cannot change without a reload, so polling would only fire
    // a request that fails by definition every ten seconds.
    if (!api.isConfigured(config)) {
      render(doc, { state: "not-configured", status: "Not configured",
                    message: "The leaderboard is not configured yet." });
      return null;
    }

    var inFlight = false;
    activeLoad = function () {
      if (inFlight) return Promise.resolve(null);
      inFlight = true;
      return loadWith(doc, api, config).then(function (res) {
        inFlight = false;
        return res;
      });
    };

    var refresh = doc.getElementById("btn-lb-refresh");
    if (refresh && refresh.addEventListener) {
      refresh.addEventListener("click", function () { reload(); });
    }
    if (doc.addEventListener) {
      doc.addEventListener("pointerdown", unlockAudio);
      doc.addEventListener("keydown", unlockAudio);
      doc.addEventListener("visibilitychange", function () {
        if (doc.hidden) return;
        reload();
      });
    }

    reload();
    startPolling(reload, REFRESH_MS);
    return null;
  }

  return {
    REFRESH_MS: REFRESH_MS,
    TOP_NAMES: TOP_NAMES,
    COLUMNS: COLUMNS,
    rankRows: rankRows,
    shouldPoll: shouldPoll,
    render: render,
    reload: reload,
    startPolling: startPolling,
    stopPolling: stopPolling,
    boot: boot
  };
});
