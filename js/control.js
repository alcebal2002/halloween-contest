(function (root, factory) {
  "use strict";
  var isNode = (typeof module !== "undefined" && module.exports);
  var GL = isNode ? require("./game-logic.js") : root.GameLogic;
  var api = factory(GL);
  if (isNode) module.exports = api;
  else root.Control = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL) {
  "use strict";

  var EMPTY = "\u2014";

  // Turns the fetchDashboardStats outcome into the text of each tile, so the
  // DOM code below only copies strings. A failed figure reads "Error", a table
  // with no rows yet reads as a dash.
  function tiles(stats) {
    function countTile(fig) {
      if (!fig || !fig.ok) return { value: "Error", sub: "", error: true };
      return { value: String(fig.value), sub: "", error: false };
    }
    function rowTile(fig, pick) {
      if (!fig || !fig.ok) return { value: "Error", sub: "", error: true };
      if (!fig.row) return { value: EMPTY, sub: "No results yet", error: false };
      return { value: pick(fig.row), sub: "by " + String(fig.row.nickname || ""), error: false };
    }
    return {
      nicknames: countTile(stats.nicknames),
      contests: countTile(stats.contests),
      maxScore: rowTile(stats.maxScore, function (r) { return String(Number(r.total_score) || 0); }),
      minTime: rowTile(stats.minTime, function (r) { return GL.formatDuration(Number(r.elapsed_ms) || 0) || EMPTY; })
    };
  }

  function render(doc, view) {
    Object.keys(view).forEach(function (key) {
      var card = doc.getElementById("kpi-" + key);
      if (!card) return;
      card.querySelector(".kpi-value").textContent = view[key].value;
      card.querySelector(".kpi-sub").textContent = view[key].sub;
      card.classList.toggle("is-error", view[key].error);
    });
  }

  function boot(doc, api, config) {
    var status = doc.getElementById("ctl-status");
    var button = doc.getElementById("ctl-refresh");

    function load() {
      status.className = "save-status";
      status.textContent = "Loading\u2026";
      if (button) button.disabled = true;
      return api.fetchDashboardStats(config).then(function (res) {
        if (button) button.disabled = false;
        if (!res.ok) {
          status.className = "save-status is-error";
          status.textContent = res.kind === "unconfigured"
            ? "The results store is not configured."
            : "Could not load the statistics.";
          return;
        }
        render(doc, tiles(res));
        status.textContent = "Updated at " + new Date().toLocaleTimeString();
      });
    }

    if (button) button.addEventListener("click", load);
    return load();
  }

  return { tiles: tiles, render: render, boot: boot };
});
