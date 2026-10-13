(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ResultsApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_TIMEOUT_MS = 15000;
  var REST_PATH = "/rest/v1/contest_results";

  // True only when the config carries a real https endpoint and a key that is
  // neither empty nor the placeholder shipped in supabase-config.js.
  function isConfigured(config) {
    if (!config || typeof config.url !== "string" || typeof config.anonKey !== "string") return false;
    if (!/^https:\/\//.test(config.url)) return false;
    var key = config.anonKey.replace(/^\s+|\s+$/g, "");
    if (key.length < 20) return false;
    if (key.toUpperCase().indexOf("PASTE") !== -1) return false;
    return true;
  }

  // Points are 5/3/2 for a matched bonus, 1 for a correct answer whose bonus was
  // missed, and 0 for a wrong answer — so anything above 1 is a won bonus.
  function pointsOf(answer) {
    if (typeof answer.points === "number") return answer.points;
    return answer.correct ? 1 : 0;
  }

  // Maps a finished contest to the row stored in contest_results. Returns null
  // for anything that is not a genuinely finished run, so the caller can skip
  // the request rather than send incomplete data.
  function buildResultRow(state) {
    if (!state || typeof state.sessionId !== "string" || state.sessionId === "") return null;
    if (!state.finishedAt || !Array.isArray(state.answers) || state.answers.length === 0) return null;

    var correct = 0;
    var bonuses = 0;
    state.answers.forEach(function (a) {
      if (!a) return;
      if (a.correct) correct++;
      if (pointsOf(a) > 1) bonuses++;
    });

    return {
      session_id: state.sessionId,
      nickname: String(state.nickname || ""),
      total_score: Number(state.score) || 0,
      correct_count: correct,
      bonuses_matched: bonuses,
      elapsed_ms: Math.max(0, Math.round(Number(state.elapsedMs) || 0)),
      finished_at: state.finishedAt
    };
  }

  // 409 is PostgREST's answer to a primary-key collision; 23505 is the Postgres
  // unique-violation code, checked too in case a proxy reshapes the status.
  function classifySaveError(status, body) {
    if (status === 409) return "duplicate";
    if (body && body.code === "23505") return "duplicate";
    return "failed";
  }

  return {
    isConfigured: isConfigured,
    buildResultRow: buildResultRow,
    classifySaveError: classifySaveError
  };
});
