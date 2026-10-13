"use strict";
var suite = require("./test-suite.js");
var failed = 0;

function runOne(t) {
  return Promise.resolve().then(function () { return t.fn(); }).then(function () {
    console.log("PASS  " + t.name);
  }, function (e) {
    failed++;
    console.log("FAIL  " + t.name + " - " + (e && e.message ? e.message : e));
  });
}

suite.tests.reduce(function (chain, t) {
  return chain.then(function () { return runOne(t); });
}, Promise.resolve()).then(function () {
  console.log("");
  console.log(suite.tests.length - failed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
});
