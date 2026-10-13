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
  var COLUMNS = ["#", "Player", "Score", "Correct", "Bonus", "Time", "Finished"];
  var activeLoad = null;

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

  return {
    REFRESH_MS: REFRESH_MS,
    TOP_NAMES: TOP_NAMES,
    COLUMNS: COLUMNS,
    rankRows: rankRows,
    shouldPoll: shouldPoll,
    _active: function () { return activeLoad; },
    _setActive: function (fn) { activeLoad = fn; }
  };
});
