(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Confetti = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rootRef) {
  "use strict";

  // The celebration throws the three Halloween marquee creatures instead of
  // confetti paper. Each particle is one of these, drawn as a vector sprite.
  var KINDS = ["bat", "spider", "pumpkin"];

  function num(v) { return Number(v) || 0; }
  function pick(rng) {
    var r = rng();
    if (r < 0) r = 0; else if (r >= 1) r = 0.999999;
    return KINDS[Math.floor(r * KINDS.length)];
  }

  // Pure and deterministic given an rng: builds the particle set that the
  // animation loop then advances. Keeping construction separate from the loop
  // is what lets the shapes and bounds be unit-tested without a canvas.
  function createParticles(width, height, count, rng) {
    var rand = (typeof rng === "function") ? rng : Math.random;
    var w = num(width) > 0 ? num(width) : 0;
    var h = num(height) > 0 ? num(height) : 0;
    var n = (typeof count === "number" && count > 0) ? Math.floor(count) : 0;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        kind: pick(rand),
        x: rand() * w,
        y: rand() * h,
        size: 16 + rand() * 18,
        vy: 26 + rand() * 54,          // px/second, always falling
        swayAmp: 12 + rand() * 34,     // px of horizontal drift per second
        swayFreq: 0.6 + rand() * 1.6,  // radians/second of the sway
        phase: rand() * Math.PI * 2,
        spin: (rand() - 0.5) * 2.2,    // radians/second
        angle: rand() * Math.PI * 2
      });
    }
    return out;
  }

  // Advances every particle in place. Falls, sways and spins; a particle that
  // leaves one edge re-enters from the opposite one, so the curtain never
  // thins out.
  function advance(particles, dt, width, height) {
    if (!particles || !particles.length) return;
    var step = num(dt);
    if (step <= 0) return;
    var w = num(width);
    var h = num(height);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (!p) continue;
      p.phase += p.swayFreq * step;
      p.y += p.vy * step;
      p.x += Math.cos(p.phase) * p.swayAmp * step;
      p.angle += p.spin * step;

      if (p.y - p.size > h) p.y = -p.size;
      if (p.x < -p.size) p.x = w + p.size;
      else if (p.x > w + p.size) p.x = -p.size;
    }
  }

  /* ---- sprites: each centred on the origin, roughly `s` px across ---- */

  function drawPumpkin(ctx, s) {
    var r = s * 0.5;
    ctx.fillStyle = "#ff7a1a";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(96, 34, 0, 0.45)";
    ctx.lineWidth = Math.max(1, s * 0.055);
    for (var i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(i * r * 0.34, 0, r * 0.3, r * 0.78, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#3fa34d";
    ctx.beginPath();
    ctx.rect(-s * 0.055, -r * 0.82 - s * 0.22, s * 0.11, s * 0.24);
    ctx.fill();

    ctx.fillStyle = "#2a1206";
    ctx.beginPath(); ctx.moveTo(-r * 0.42, -r * 0.12); ctx.lineTo(-r * 0.14, -r * 0.34); ctx.lineTo(-r * 0.14, -r * 0.02); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.42, -r * 0.12); ctx.lineTo(r * 0.14, -r * 0.34); ctx.lineTo(r * 0.14, -r * 0.02); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.2);
    ctx.lineTo(-r * 0.2, r * 0.04);
    ctx.lineTo(0, r * 0.3);
    ctx.lineTo(r * 0.2, r * 0.04);
    ctx.lineTo(r * 0.42, r * 0.2);
    ctx.lineTo(r * 0.26, r * 0.48);
    ctx.lineTo(-r * 0.26, r * 0.48);
    ctx.closePath();
    ctx.fill();
  }

  function drawBat(ctx, s) {
    var r = s * 0.5;
    ctx.fillStyle = "#a78bfa";
    for (var side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.12, -r * 0.1);
      ctx.quadraticCurveTo(side * r * 0.85, -r * 0.95, side * r * 1.4, -r * 0.28);
      ctx.quadraticCurveTo(side * r * 0.95, -r * 0.02, side * r * 0.78, r * 0.36);
      ctx.quadraticCurveTo(side * r * 0.45, -r * 0.02, side * r * 0.12, r * 0.26);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.2, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -r * 0.34, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.44);
    ctx.lineTo(-r * 0.06, -r * 0.82);
    ctx.lineTo(0, -r * 0.5);
    ctx.lineTo(r * 0.06, -r * 0.82);
    ctx.lineTo(r * 0.2, -r * 0.44);
    ctx.closePath();
    ctx.fill();
  }

  function drawSpider(ctx, s) {
    var r = s * 0.5;
    ctx.strokeStyle = "#c4b5fd";
    ctx.fillStyle = "#c4b5fd";
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.lineCap = "round";

    for (var i = 0; i < 4; i++) {
      var y = -r * 0.4 + i * r * 0.3;
      for (var side = -1; side <= 1; side += 2) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(side * r * 0.72, y - r * 0.34);
        ctx.lineTo(side * r * 1.06, y + r * 0.16);
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.ellipse(0, r * 0.22, r * 0.4, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -r * 0.34, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff4d4d";
    ctx.beginPath(); ctx.arc(-r * 0.13, -r * 0.44, r * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.13, -r * 0.44, r * 0.07, 0, Math.PI * 2); ctx.fill();
  }

  function drawSprite(ctx, kind, s) {
    if (kind === "bat") drawBat(ctx, s);
    else if (kind === "spider") drawSpider(ctx, s);
    else drawPumpkin(ctx, s);
  }

  function draw(ctx, particles, width, height) {
    ctx.clearRect(0, 0, width, height);
    if (!particles) return;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (!p) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      drawSprite(ctx, p.kind, p.size);
      ctx.restore();
    }
  }

  function prefersReducedMotion(win) {
    try {
      return !!(win && typeof win.matchMedia === "function"
        && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  // A density that fills a phone screen without swamping a desktop one.
  function countFor(width, height) {
    var n = Math.round((num(width) * num(height)) / 14000);
    if (n < 24) n = 24;
    if (n > 90) n = 90;
    return n;
  }

  // Starts the falling creature curtain on `canvas`. Returns a handle with
  // stop(), or null when there is no canvas, no 2d context, or the visitor
  // asked for reduced motion (in which case nothing is drawn at all). All
  // animation is decorative; the caller keeps the canvas aria-hidden.
  function start(canvas, options) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    var opts = options || {};
    var win = opts.window || rootRef;
    var ctx = null;
    try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
    if (!ctx) return null;
    if (opts.reducedMotion === true) return null;
    if (opts.reducedMotion !== false && prefersReducedMotion(win)) return null;

    var dpr = num(win && win.devicePixelRatio) || 1;
    if (dpr > 2) dpr = 2;
    var particles = [];
    var width = 1;
    var height = 1;

    function measure() {
      var rect = (typeof canvas.getBoundingClientRect === "function") ? canvas.getBoundingClientRect() : null;
      width = Math.max(1, Math.round((rect && rect.width) || num(canvas.clientWidth) || num(win && win.innerWidth) || 1));
      height = Math.max(1, Math.round((rect && rect.height) || num(canvas.clientHeight) || num(win && win.innerHeight) || 1));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (typeof ctx.setTransform === "function") ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      var count = (typeof opts.count === "number" && opts.count > 0) ? Math.floor(opts.count) : countFor(width, height);
      particles = createParticles(width, height, count, opts.rng);
    }

    measure();
    seed();

    var onResize = function () { measure(); seed(); };
    if (win && win.addEventListener) win.addEventListener("resize", onResize);

    var running = true;
    var raf = null;
    var last = null;

    function frame(ts) {
      if (!running) return;
      var now = num(ts);
      if (last === null) last = now;
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05; // a backgrounded tab must not teleport the swarm
      advance(particles, dt, width, height);
      draw(ctx, particles, width, height);
      raf = win.requestAnimationFrame(frame);
    }

    if (win && typeof win.requestAnimationFrame === "function") {
      raf = win.requestAnimationFrame(frame);
    }

    return {
      stop: function () {
        running = false;
        if (raf && win && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(raf);
        raf = null;
        if (win && win.removeEventListener) win.removeEventListener("resize", onResize);
        draw(ctx, [], width, height);
      }
    };
  }

  return {
    KINDS: KINDS,
    createParticles: createParticles,
    advance: advance,
    drawSprite: drawSprite,
    countFor: countFor,
    start: start
  };
});
