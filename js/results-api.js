(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ResultsApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_TIMEOUT_MS = 15000;
  var REST_PATH = "/rest/v1/contest_results";
  var NICKNAMES_PATH = "/rest/v1/nicknames";
  var SELECT_COLUMNS = "session_id,nickname,gft_id,total_score,correct_count,bonuses_matched,elapsed_ms,finished_at";
  var ORDER_CLAUSE = "total_score.desc,correct_count.desc,elapsed_ms.asc,created_at.asc";
  var LOWEST_ORDER_CLAUSE = "total_score.asc,correct_count.asc,elapsed_ms.desc,created_at.desc";
  var FETCH_LIMIT = 500;

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

  // Points are 15/10/8 for a matched bonus, 5 for a correct answer whose bonus
  // was missed, and 0 for a wrong answer — so anything above 5 is a won bonus.
  var BASE_POINTS = 5;
  function pointsOf(answer) {
    if (typeof answer.points === "number") return answer.points;
    return answer.correct ? BASE_POINTS : 0;
  }

  // Maps a finished contest to the row stored in contest_results. Returns null
  // for anything that is not a genuinely finished run, so the caller can skip
  // the request rather than send incomplete data.
  function buildResultRow(state) {
    if (!state || typeof state.sessionId !== "string" || state.sessionId === "") return null;
    if (!state.finishedAt || !Array.isArray(state.answers) || state.answers.length === 0) return null;
    if (typeof state.gftId !== "string" || !/^[A-Za-z0-9]{4}$/.test(state.gftId)) return null;

    var correct = 0;
    var bonuses = 0;
    state.answers.forEach(function (a) {
      if (!a) return;
      if (a.correct) correct++;
      // A bonus only ever pays on a correct answer, so requiring it here keeps
      // bonuses_matched at or below correct_count even for a tampered state —
      // the column the table's check constraint would otherwise reject.
      if (a.correct && pointsOf(a) > BASE_POINTS) bonuses++;
    });

    return {
      session_id: state.sessionId,
      nickname: String(state.nickname || ""),
      gft_id: state.gftId,
      total_score: Number(state.score) || 0,
      correct_count: correct,
      bonuses_matched: bonuses,
      elapsed_ms: Math.max(0, Math.round(Number(state.elapsedMs) || 0)),
      finished_at: state.finishedAt
    };
  }

  // Always resolves — never rejects, and never throws — so the caller can
  // render the outcome without a catch. The ambient fetch is looked up at call
  // time, which is what lets the browser harness stub window.fetch.
  function saveResult(config, row, fetchImpl, timeoutMs) {
    var doFetch = fetchImpl;
    if (!doFetch) {
      if (typeof fetch === "undefined") {
        return Promise.resolve({ ok: false, kind: "failed", detail: "no fetch available" });
      }
      doFetch = function () { return fetch.apply(null, arguments); };
    }

    var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = null;

    // The endpoint and the options are built inside the chain, so a malformed
    // config resolves as a failure instead of throwing out of a function whose
    // whole contract is that it resolves.
    var request = Promise.resolve()
      .then(function () {
        var endpoint = String(config.url).replace(/\/+$/, "") + REST_PATH;
        return doFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.anonKey,
            "Authorization": "Bearer " + config.anonKey,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(row),
          signal: controller ? controller.signal : undefined
        });
      })
      .then(function (res) {
        if (res && res.ok) return { ok: true, kind: "saved" };
        var status = res ? res.status : 0;
        var body = (res && typeof res.json === "function")
          ? res.json().catch(function () { return null; })
          : Promise.resolve(null);
        return body.then(function (b) {
          return { ok: false, kind: classifySaveError(status, b), detail: (b && b.message) || "" };
        });
      })
      .catch(function (e) {
        return { ok: false, kind: "failed", detail: (e && e.message) ? e.message : "network error" };
      });

    // One deadline for every environment. The abort is a best-effort cancel
    // sent alongside it: where AbortController is missing, or where the
    // transport ignores the signal, the race is what still resolves, so the
    // player gets the error and the retry rather than a status line frozen on
    // "Saving your results…" for good. Both branches always resolve, so the
    // race can never produce an unhandled rejection.
    var expired = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        resolve({ ok: false, kind: "failed", detail: "timed out" });
      }, timeout);
    });

    return Promise.race([request, expired]).then(function (outcome) {
      if (timer) clearTimeout(timer);
      return outcome;
    });
  }

  // Reads the leaderboard window. Same contract as saveResult: it always
  // resolves — never rejects, never throws — so the board can be updated
  // without a catch. The ambient fetch is looked up at call time so a harness
  // can stub window.fetch.
  //
  // Ranking is done client-side against a plain score-descending window rather
  // than filtering on nickname: nicknames are content-unvalidated, and sending
  // them back inside PostgREST's `nickname=in.(...)` grammar would mean
  // escaping attacker-shaped strings into a filter expression.
  function fetchResults(config, fetchImpl, timeoutMs) {
    return fetchWindow(config, ORDER_CLAUSE, fetchImpl, timeoutMs);
  }

  // The same window read from the other end — lowest score first; on a tie
  // fewer correct answers, then the longer time, then the later finisher — for the podium's bottom stand. A separate
  // query because the top-500 window would lose the lowest scores once the
  // table outgrows it.
  function fetchLowestResults(config, fetchImpl, timeoutMs) {
    return fetchWindow(config, LOWEST_ORDER_CLAUSE, fetchImpl, timeoutMs);
  }

  function fetchWindow(config, order, fetchImpl, timeoutMs) {
    if (!isConfigured(config)) {
      return Promise.resolve({ ok: false, kind: "unconfigured" });
    }

    var doFetch = fetchImpl;
    if (!doFetch) {
      if (typeof fetch === "undefined") {
        return Promise.resolve({ ok: false, kind: "failed", detail: "no fetch available" });
      }
      doFetch = function () { return fetch.apply(null, arguments); };
    }

    var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = null;

    var request = Promise.resolve()
      .then(function () {
        var endpoint = String(config.url).replace(/\/+$/, "") + REST_PATH
          + "?select=" + SELECT_COLUMNS
          + "&order=" + order
          + "&limit=" + FETCH_LIMIT;
        return doFetch(endpoint, {
          method: "GET",
          headers: {
            "apikey": config.anonKey,
            "Authorization": "Bearer " + config.anonKey
          },
          signal: controller ? controller.signal : undefined
        });
      })
      .then(function (res) {
        if (!res || !res.ok) {
          return { ok: false, kind: "failed", detail: "status " + (res ? res.status : 0) };
        }
        return Promise.resolve(res.json()).then(function (rows) {
          if (!Array.isArray(rows)) return { ok: false, kind: "failed", detail: "unexpected payload" };
          return { ok: true, kind: "loaded", rows: rows };
        }, function () {
          return { ok: false, kind: "failed", detail: "unreadable payload" };
        });
      })
      .catch(function (e) {
        return { ok: false, kind: "failed", detail: (e && e.message) ? e.message : "network error" };
      });

    var expired = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        resolve({ ok: false, kind: "failed", detail: "timed out" });
      }, timeout);
    });

    return Promise.race([request, expired]).then(function (outcome) {
      if (timer) clearTimeout(timer);
      return outcome;
    });
  }

  // Claims a GFT ID + nickname pair by inserting it. The case-insensitive unique
  // constraint is what turns a second use of the same pair — however it is
  // cased — into a 409/23505 duplicate, so no lookup query is needed and no
  // unvalidated string is ever sent inside PostgREST's filter grammar. Same
  // contract as saveResult: it always resolves — never rejects, never throws —
  // so the caller can fall back to letting the player start when the backend is
  // unreachable. The lowercase uniqueness column is generated by the database,
  // so only the nickname and GFT ID, in the case typed, are sent.
  function claimNickname(config, nickname, gftId, fetchImpl, timeoutMs) {
    if (typeof gftId !== "string" || !/^[A-Za-z0-9]{4}$/.test(gftId)) {
      return Promise.resolve({ ok: false, kind: "failed", detail: "GFT ID must contain exactly 4 letters or digits." });
    }
    if (!isConfigured(config)) {
      return Promise.resolve({ ok: false, kind: "unconfigured" });
    }

    var doFetch = fetchImpl;
    if (!doFetch) {
      if (typeof fetch === "undefined") {
        return Promise.resolve({ ok: false, kind: "failed", detail: "no fetch available" });
      }
      doFetch = function () { return fetch.apply(null, arguments); };
    }

    var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = null;

    var request = Promise.resolve()
      .then(function () {
        var endpoint = String(config.url).replace(/\/+$/, "") + NICKNAMES_PATH;
        return doFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.anonKey,
            "Authorization": "Bearer " + config.anonKey,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ nickname: String(nickname), gft_id: gftId }),
          signal: controller ? controller.signal : undefined
        });
      })
      .then(function (res) {
        if (res && res.ok) return { ok: true, kind: "claimed" };
        var status = res ? res.status : 0;
        var body = (res && typeof res.json === "function")
          ? res.json().catch(function () { return null; })
          : Promise.resolve(null);
        return body.then(function (b) {
          return { ok: false, kind: classifySaveError(status, b), detail: (b && b.message) || "" };
        });
      })
      .catch(function (e) {
        return { ok: false, kind: "failed", detail: (e && e.message) ? e.message : "network error" };
      });

    var expired = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        resolve({ ok: false, kind: "failed", detail: "timed out" });
      }, timeout);
    });

    return Promise.race([request, expired]).then(function (outcome) {
      if (timer) clearTimeout(timer);
      return outcome;
    });
  }

  // Reads the control dashboard figures with four parallel requests: exact
  // server-side counts of both tables (read from Content-Range, no rows sent)
  // plus the single best-score and fastest-time rows. Each figure settles on
  // its own, so one failed request only blanks its own tile. Same contract as
  // the other calls: always resolves, never rejects, never throws.
  function fetchDashboardStats(config, fetchImpl, timeoutMs) {
    if (!isConfigured(config)) {
      return Promise.resolve({ ok: false, kind: "unconfigured" });
    }

    var doFetch = fetchImpl;
    if (!doFetch) {
      if (typeof fetch === "undefined") {
        return Promise.resolve({ ok: false, kind: "failed", detail: "no fetch available" });
      }
      doFetch = function () { return fetch.apply(null, arguments); };
    }

    var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var base = String(config.url).replace(/\/+$/, "");
    var headers = { "apikey": config.anonKey, "Authorization": "Bearer " + config.anonKey };

    function guarded(work) {
      var controller = (typeof AbortController === "function") ? new AbortController() : null;
      var timer = null;
      var request = Promise.resolve()
        .then(function () { return work(controller ? controller.signal : undefined); })
        .catch(function (e) {
          return { ok: false, detail: (e && e.message) ? e.message : "network error" };
        });
      var expired = new Promise(function (resolve) {
        timer = setTimeout(function () {
          if (controller) controller.abort();
          resolve({ ok: false, detail: "timed out" });
        }, timeout);
      });
      return Promise.race([request, expired]).then(function (outcome) {
        if (timer) clearTimeout(timer);
        return outcome;
      });
    }

    function count(path) {
      return guarded(function (signal) {
        return doFetch(base + path + "?select=*", {
          method: "HEAD",
          headers: { "apikey": headers.apikey, "Authorization": headers.Authorization, "Prefer": "count=exact" },
          signal: signal
        }).then(function (res) {
          if (!res || !res.ok) return { ok: false, detail: "status " + (res ? res.status : 0) };
          var range = (res.headers && typeof res.headers.get === "function") ? res.headers.get("Content-Range") : null;
          var m = /\/(\d+)\s*$/.exec(range || "");
          if (!m) return { ok: false, detail: "missing count" };
          return { ok: true, value: parseInt(m[1], 10) };
        });
      });
    }

    function topRow(columns, order) {
      return guarded(function (signal) {
        return doFetch(base + REST_PATH + "?select=" + columns + "&order=" + order + "&limit=1", {
          method: "GET", headers: headers, signal: signal
        }).then(function (res) {
          if (!res || !res.ok) return { ok: false, detail: "status " + (res ? res.status : 0) };
          return Promise.resolve(res.json()).then(function (rows) {
            if (!Array.isArray(rows)) return { ok: false, detail: "unexpected payload" };
            return { ok: true, row: rows.length ? rows[0] : null };
          }, function () {
            return { ok: false, detail: "unreadable payload" };
          });
        });
      });
    }

    return Promise.all([
      count(NICKNAMES_PATH),
      count(REST_PATH),
      topRow("nickname,gft_id,total_score", ORDER_CLAUSE),
      topRow("nickname,gft_id,elapsed_ms", "elapsed_ms.asc,created_at.asc")
    ]).then(function (r) {
      return {
        ok: true,
        kind: "loaded",
        nicknames: r[0],
        contests: r[1],
        maxScore: r[2],
        minTime: r[3]
      };
    });
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
    classifySaveError: classifySaveError,
    saveResult: saveResult,
    fetchResults: fetchResults,
    fetchLowestResults: fetchLowestResults,
    claimNickname: claimNickname,
    fetchDashboardStats: fetchDashboardStats
  };
});
