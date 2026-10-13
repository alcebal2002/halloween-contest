#!/usr/bin/env node
/* Regenerates the storage-blocked copy of index.html used by the
   `.superpowers/sdd/halloween-contest/nostorage-index.html` runner.

   Run from the project root after changing index.html:

       node tests/make-nostorage.js
*/
"use strict";

var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var source = path.join(root, "index.html");
var target = path.join(root, ".superpowers", "sdd", "halloween-contest", "nostorage-index.html");

var STUB = [
  "<script>",
  "/* Test copy: block localStorage before any game script runs (spec §7 row:",
  "   \"localStorage unavailable → banner + playable in memory\"). */",
  "try {",
  "  Object.defineProperty(window, \"localStorage\", {",
  "    configurable: true,",
  "    get: function () { throw new Error(\"blocked by test\"); }",
  "  });",
  "} catch (e) { window.__stubFailed = e.message; }",
  "<\/script>",
  ""
].join("\n");

var DRIVER = [
  "<script>",
  "document.addEventListener(\"DOMContentLoaded\", function () {",
  "  var out = [];",
  "  try { window.localStorage.getItem(\"x\"); out.push(\"stubActive=false\"); }",
  "  catch (e) { out.push(\"stubActive=true\"); }",
  "  if (window.__stubFailed) out.push(\"stubFailed=\" + window.__stubFailed);",
  "",
  "  var banner = document.getElementById(\"storage-banner\");",
  "  out.push(\"bannerVisibleAfterBoot=\" + !banner.hidden);",
  "",
  "  document.getElementById(\"nickname\").value = \"NoSave\";",
  "  document.getElementById(\"btn-start\").click();",
  "  out.push(\"viewAfterStart=\" + HalloweenApp.getView());",
  "  out.push(\"instructionsShown=\" + !document.getElementById(\"screen-instructions\").hidden);",
  "  document.getElementById(\"btn-ready\").click();",
  "  out.push(\"viewAfterReady=\" + HalloweenApp.getView());",
  "",
  "  for (var i = 0; i < 10; i++) {",
  "    var st = HalloweenApp.getState();",
  "    var q = HalloweenApp.getQuestions()[st.questionIndex];",
  "    var wrong = (q.correctIndex + 1) % 3;",
  "    document.querySelectorAll(\"#question-options .option\")[wrong].click();",
  "    if (HalloweenApp.getView() === \"feedback\") document.getElementById(\"btn-next\").click();",
  "  }",
  "",
  "  out.push(\"finalView=\" + HalloweenApp.getView());",
  "  out.push(\"score=\" + HalloweenApp.getState().score);",
  "  out.push(\"nicknameKept=\" + HalloweenApp.getState().nickname);",
  "  out.push(\"bannerStillVisible=\" + !banner.hidden);",
  "  out.push(\"hudVisible=\" + !document.getElementById(\"hud\").hidden);",
  "  out.push(\"saveStatusHidden=\" + document.getElementById(\"results-save\").hidden);",
  "",
  "  var checks = [",
  "    out[0] === \"stubActive=true\",",
  "    out[1] === \"bannerVisibleAfterBoot=true\",",
  "    out[2] === \"viewAfterStart=instructions\",",
  "    out[3] === \"instructionsShown=true\",",
  "    out[4] === \"viewAfterReady=question\",",
  "    out[5] === \"finalView=results\",",
  "    out[6] === \"score=0\",",
  "    out[7] === \"nicknameKept=NoSave\",",
  "    out[8] === \"bannerStillVisible=true\",",
  "    out[9] === \"hudVisible=true\",",
  "    out[10] === \"saveStatusHidden=true\"",
  "  ];",
  "  var pass = checks.every(Boolean);",
  "",
  "  var pre = document.createElement(\"pre\");",
  "  pre.id = \"nostorage\";",
  "  pre.textContent = (pass ? \"PASS\" : \"FAIL\") +",
  "    \"  storage unavailable: banner shown, contest playable in memory\" + String.fromCharCode(10) +",
  "    out.join(String.fromCharCode(10));",
  "  pre.className = pass ? \"pass\" : \"fail\";",
  "  document.body.appendChild(pre);",
  "  document.title = \"nostorage: \" + (pass ? \"PASS\" : \"FAIL\");",
  "});",
  "<\/script>",
  ""
].join("\n");

var html = fs.readFileSync(source, "utf8");

html = html
  .split(/\r?\n/)
  .filter(function (line) {
    return line.indexOf("fonts.googleapis.com") === -1 && line.indexOf("fonts.gstatic.com") === -1;
  })
  .join("\n")
  .replace("<!DOCTYPE html>", "<!DOCTYPE html>\n<!--\n  GENERATED TEST ARTIFACT — not shipped.\n  A copy of index.html (paths made server-absolute) with localStorage blocked\n  before the game scripts load, plus a driver that plays a full contest.\n  Regenerate: node tests/make-nostorage.js\n-->")
  .replace("<title>Halloween Contest</title>", "<title>Halloween Contest — storage-blocked test</title>")
  .replace(/href="css\//g, 'href="/css/')
  .replace(/src="js\//g, 'src="/js/')
  // The key ships in its own file, so the copy cannot rewrite it. Blank it
  // immediately after that file loads, before app.js can reach the results
  // screen and post a real row. Runs after the path rewrite above.
  .replace("<script src=\"/js/supabase-config.js\"></script>",
    "<script src=\"/js/supabase-config.js\"></script>\n<script>window.SUPABASE_CONFIG.anonKey = \"\";</script>")
  .replace("<body>\n", "<body>\n" + STUB)
  .replace("</body>", DRIVER + "</body>");

// String.replace skips silently when its target moves, and a copy that quietly
// kept the real key would post a real row the first time a test played through
// to the results screen. Refuse to write unless the blanking script landed and
// no key leaked into the copy by any other route. Neither token appears in
// index.html itself, so both checks are unambiguous here.
if (html.indexOf("window.SUPABASE_CONFIG.anonKey") === -1) {
  throw new Error(
    "make-nostorage: the Supabase key was not blanked — index.html no longer " +
    "contains <script src=\"/js/supabase-config.js\"></script>. " +
    "Refusing to write a copy that would post real rows."
  );
}
if (html.indexOf("sb_publishable") !== -1) {
  throw new Error(
    "make-nostorage: a publishable key is present in the generated copy. " +
    "Refusing to write it."
  );
}

fs.writeFileSync(target, html, "utf8");
process.stdout.write("wrote " + path.relative(root, target) + " (" + html.length + " bytes)\n");
