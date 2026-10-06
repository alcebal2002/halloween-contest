"use strict";
var suite = require("./test-suite.js");
var failed = 0;
suite.tests.forEach(function (t) {
  try {
    t.fn();
    console.log("PASS  " + t.name);
  } catch (e) {
    failed++;
    console.log("FAIL  " + t.name + " - " + (e && e.message ? e.message : e));
  }
});
console.log("");
console.log(suite.tests.length - failed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
