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
    if (!row) return "";
    return (typeof row.nickname === "string") ? row.nickname : String(row.nickname || "");
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

  function correctText(n) {
    return num(n) + " correct";
  }

  function fillSlot(doc, place, row, loading) {
    var slot = doc.querySelector('[data-place="' + place + '"]');
    if (!slot) return;
    var nameEl = slot.querySelector(".podium-name");
    var scoreEl = slot.querySelector(".podium-score");
    var correctEl = slot.querySelector(".podium-correct");
    var hasRow = !!row;

    if (nameEl) nameEl.textContent = hasRow ? displayName(row) : (loading ? "…" : "—");
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
  function render(doc, view) {
    if (!doc) return;
    var status = doc.getElementById("pd-status");
    var board = doc.getElementById("pd-board");
    var msg = doc.getElementById("pd-message");
    if (!status || !board || !msg) return;

    var state = (view && view.state) ? view.state : "";
    status.textContent = (view && view.status) || "";
    status.className = "save-status" + (state === "error" ? " is-error" : "");

    var rows = (view && view.rows) || [];
    for (var place = 1; place <= PLACE; place++) {
      fillSlot(doc, place, rows[place - 1] || null, state === "loading");
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

  function boot(doc, api, config) {
    if (!doc || !api) return null;
    render(doc, { state: "loading", status: "Loading…" });

    if (!api.isConfigured(config)) {
      render(doc, { state: "not-configured", status: "Not configured",
                    message: "The podium is not configured yet." });
      return null;
    }

    // The initial (and only) query.
    loadWith(doc, api, config);
    return null;
  }

  return {
    PLACE: PLACE,
    topThree: topThree,
    render: render,
    boot: boot
  };
});
