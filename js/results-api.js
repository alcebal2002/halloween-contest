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

  // 409 is PostgREST's answer to a primary-key collision; 23505 is the Postgres
  // unique-violation code, checked too in case a proxy reshapes the status.
  function classifySaveError(status, body) {
    if (status === 409) return "duplicate";
    if (body && body.code === "23505") return "duplicate";
    return "failed";
  }

  return {
    isConfigured: isConfigured,
    classifySaveError: classifySaveError
  };
});
