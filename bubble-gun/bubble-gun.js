/*!
 * bubble-gun · 哒哒哒
 * Take a chat bubble apart letter by letter and machine-gun it at an avatar.
 * Every hit knocks the avatar back; the letters bounce off and pile up on the
 * floor, where you can drag them around until they fade.
 * Zero dependencies; if matter.js (window.Matter) is present the fallen
 * letters get real physics, otherwise they just bounce off and fade. MIT.
 *
 * Usage:
 *   BubbleGun.fire(bubbleEl, avatarEl).then((played) => {});
 *   BubbleGun.fire(bubbleEl, () => ({ x, y, r, el }));   // or a target getter, called every frame
 *   BubbleGun.tune.gapEnd = 30;                           // feel knobs, see README
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BubbleGun = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  /* first = shots fired one by one before the rest go in a single volley / gapStart→gapEnd = interval (ms), accelerating
     flyMs = bullet flight / scatter = spread over the target (× radius) / big = bullet scale
     kick = knock-back per hit (px) / kickMax = shake clamp / bounce = how hard letters ricochet / gravity
     linger = idle ms before the pile fades / maxBodies = letters kept as physics bodies / floor = element whose bottom is the floor */
  const tune = { first: 56, gapStart: 88, gapEnd: 38, flyMs: 170, scatter: 1.05, big: 1.2, kick: 5.7, kickMax: 13,
                 bounce: 1.25, gravity: 1.4, linger: 3000, maxBodies: 90, floor: null, haptics: true, zIndex: 60 };
  const STEP = 1000 / 60;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let busy = false, pile = null;
  const buzz = (ms) => { if (!tune.haptics) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };

  /* draw the bubble's outline (real corner radii) on g; returns its background colour */
  function bubbleShell(g, bubble, W, H) {
    const cs = getComputedStyle(bubble);
    const rad = (p) => Math.min(parseFloat(cs[p]) || 0, W / 2, H / 2);
    const tl = rad("borderTopLeftRadius"), tr = rad("borderTopRightRadius"), brr = rad("borderBottomRightRadius"), bl = rad("borderBottomLeftRadius");
    g.beginPath();
    g.moveTo(tl, 0); g.lineTo(W - tr, 0); g.quadraticCurveTo(W, 0, W, tr);
    g.lineTo(W, H - brr); g.quadraticCurveTo(W, H, W - brr, H);
    g.lineTo(bl, H); g.quadraticCurveTo(0, H, 0, H - bl);
    g.lineTo(0, tl); g.quadraticCurveTo(0, 0, tl, 0); g.closePath();
    const bg = cs.backgroundColor;
    return (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") ? "#f4f0e8" : bg;
  }
  /* every glyph's laid-out box inside the bubble (measured with Range), whitespace skipped, surrogate pairs = one glyph */
  function bubbleGlyphs(bubble, budget) {
    const out = [], br = bubble.getBoundingClientRect(), range = document.createRange();
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && out.length < budget) {
      const text = node.nodeValue; if (!text || !text.trim()) continue;
      const pcs = getComputedStyle(node.parentElement);
      const font = `${pcs.fontStyle} ${pcs.fontWeight} ${pcs.fontSize} ${pcs.fontFamily}`, color = pcs.color, fs = parseFloat(pcs.fontSize) || 15;
      for (let i = 0; i < text.length && out.length < budget; i++) {
        const ch = text[i]; if (/\s/.test(ch)) continue;
        const n = text.codePointAt(i) > 0xffff ? 2 : 1;
        range.setStart(node, i); range.setEnd(node, i + n);
        const r = range.getBoundingClientRect();
        if (r.width || r.height) out.push({ ch: text.slice(i, i + n), x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height, fs, font, color });
        i += n - 1;
      }
    }
    return out;
  }
  function targetGetter(target) {
    if (typeof target === "function") return target;
    return () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (!target || !target.isConnected) return { x: vw / 2, y: vh + 80, r: 20, el: null };
      const r = target.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || !r.width) return { x: r.left + r.width / 2, y: vh + 80, r: 20, el: null };   // off-screen: shoot into the void
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.min(r.width, r.height) / 2, el: target };
    };
  }

  /* the target takes hits: underdamped spring, every bullet adds an impulse, shake clamped to kickMax */
  function makeShaker() {
    let x = 0, y = 0, vx = 0, vy = 0, el = null, saved = "", squash = 0;
    function attach(t) {
      if (t.el === el) return;
      detach();
      el = t.el; if (el) saved = el.style.transform;
    }
    function detach() { if (el) el.style.transform = saved; el = null; }
    function hit(dx, dy) {
      const n = Math.hypot(dx, dy) || 1;
      vx += dx / n * tune.kick * 0.9; vy += dy / n * tune.kick * 0.9; squash = Math.min(0.16, squash + 0.05);
    }
    function step() {
      vx += -0.32 * x; vy += -0.32 * y; vx *= 0.72; vy *= 0.72;
      x += vx; y += vy; squash *= 0.86;
      const m = Math.hypot(x, y); if (m > tune.kickMax) { x *= tune.kickMax / m; y *= tune.kickMax / m; }
      if (el) el.style.transform = `${saved} translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${(1 - squash).toFixed(3)})`;
    }
    const still = () => Math.abs(x) + Math.abs(y) + Math.abs(vx) + Math.abs(vy) + squash < 0.05;
    return { attach, detach, hit, step, still };
  }

  /* letters on the floor: matter.js world, floor = bottom of tune.floor (or the viewport), walls = screen edges.
     Touching a letter drags it; every other touch goes through untouched. */
  function makePile(cv, ctx) {
    const M = typeof Matter !== "undefined" ? Matter : null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const fr = tune.floor && tune.floor.getBoundingClientRect();
    const floorY = Math.min(vh, (fr && fr.bottom) || vh);
    const items = [];
    let engine = null, drag = null, lastTouch = performance.now(), fadeAt = 0, dead = false;
    if (M) {
      engine = M.Engine.create();
      engine.gravity.y = tune.gravity;
      const wall = { isStatic: true, friction: 0.6 };
      M.Composite.add(engine.world, [
        M.Bodies.rectangle(vw / 2, floorY + 30, vw * 3, 60, wall),
        M.Bodies.rectangle(-30, vh / 2, 60, vh * 4, wall),
        M.Bodies.rectangle(vw + 30, vh / 2, 60, vh * 4, wall),
      ]);
    }
    const bodies = () => items.filter((it) => it.body).map((it) => it.body);
    function pointOf(e) { const t = e.touches ? e.touches[0] : e; return t ? { x: t.clientX, y: t.clientY } : null; }
    function onDown(e) {
      if (!engine || dead || fadeAt) return;
      const p = pointOf(e); if (!p) return;
      const hits = M.Query.point(bodies(), p);
      if (!hits.length) return;
      e.preventDefault(); e.stopPropagation();
      const b = hits[0];
      drag = M.Constraint.create({ pointA: p, bodyB: b, pointB: { x: p.x - b.position.x, y: p.y - b.position.y }, stiffness: 0.2, damping: 0.1, length: 0 });
      M.Composite.add(engine.world, drag);
      lastTouch = performance.now();
    }
    function onMove(e) {
      if (!drag) return;
      const p = pointOf(e); if (!p) return;
      e.preventDefault(); e.stopPropagation();
      drag.pointA = p; lastTouch = performance.now();
    }
    function onUp() { if (!drag) return; M.Composite.remove(engine.world, drag); drag = null; lastTouch = performance.now(); }
    const opt = { capture: true, passive: false };
    document.addEventListener("touchstart", onDown, opt);
    document.addEventListener("touchmove", onMove, opt);
    document.addEventListener("touchend", onUp, true);
    document.addEventListener("touchcancel", onUp, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);

    function add(g, x, y, dx, dy) {                   // a letter hit at (x,y), coming from direction dx/dy
      const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
      const vx = (-ux * (2.2 + Math.random() * 2.5) + (Math.random() - 0.5) * 4) * tune.bounce;
      const vy = (-uy * 2 - 3.5 - Math.random() * 4) * tune.bounce;
      const live = items.filter((it) => it.body).length;
      if (engine && live < tune.maxBodies) {
        const w = Math.max(6, g.w * tune.big * 0.92), h = Math.max(8, g.fs * tune.big * 1.02);
        const body = M.Bodies.rectangle(x, y, w, h, { restitution: 0.45, friction: 0.35, frictionAir: 0.012, chamfer: { radius: Math.min(w, h) * 0.18 } });
        M.Body.setVelocity(body, { x: vx, y: vy });
        M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.35);
        M.Composite.add(engine.world, body);
        items.push({ g, body, born: performance.now() });
      } else items.push({ g, x, y, vx, vy, a: 0, va: (Math.random() - 0.5) * 0.3, born: performance.now(), loose: true });
      lastTouch = performance.now();
    }
    function step(now, shooting) {
      if (engine) M.Engine.update(engine, STEP);
      for (const it of items) if (it.loose) { it.vy += 0.5 * tune.gravity; it.x += it.vx; it.y += it.vy; it.a += it.va; }
      if (!shooting && !drag && !fadeAt && now - lastTouch > tune.linger) fadeAt = now;
    }
    function fadeNow() { if (!fadeAt) fadeAt = performance.now(); }
    function draw(now) {
      const fa = fadeAt ? Math.max(0, 1 - (now - fadeAt) / 700) : 1;
      for (const it of items) {
        let x, y, a, al = fa;
        if (it.body) { x = it.body.position.x; y = it.body.position.y; a = it.body.angle; }
        else { x = it.x; y = it.y; a = it.a; al *= Math.max(0, 1 - (now - it.born) / 650); }
        if (al <= 0 || y > vh + 60) continue;
        ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(a); ctx.scale(tune.big, tune.big);
        ctx.font = it.g.font; ctx.fillStyle = it.g.color; ctx.fillText(it.g.ch, 0, 0);
        ctx.restore();
      }
      return !(fadeAt && fa <= 0);
    }
    function destroy() {
      dead = true;
      document.removeEventListener("touchstart", onDown, opt);
      document.removeEventListener("touchmove", onMove, opt);
      document.removeEventListener("touchend", onUp, true);
      document.removeEventListener("touchcancel", onUp, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      if (engine) { M.Composite.clear(engine.world, false); M.Engine.clear(engine); }
      cv.remove();
    }
    return { add, step, draw, fadeNow, destroy };
  }

  /* fire: bubble = live element to take apart, target = element or getter → {x,y,r,el}.
     Resolves (true) once the last bullet lands and the bubble pops back; the pile lingers on its own. */
  function fire(bubble, target) {
    return new Promise((resolve) => {
      if (busy || !bubble || reduced()) return resolve(false);
      const br = bubble.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      if (br.width < 4 || br.bottom < 0 || br.top > vh) return resolve(false);
      let glyphs;
      try { glyphs = bubbleGlyphs(bubble, 400); } catch (_) { glyphs = []; }
      if (!glyphs.length) return resolve(false);
      busy = true;
      if (pile) pile.fadeNow();                       // last volley still on the floor: let it go
      const targetOf = targetGetter(target);

      const W = br.width, H = br.height, dpr = Math.min(window.devicePixelRatio || 1, 3);
      const shell = document.createElement("canvas");  // empty shell = bubble shape; letters vanish from it as they're fired
      shell.width = Math.ceil(W * dpr); shell.height = Math.ceil(H * dpr);
      const sg = shell.getContext("2d"); sg.scale(dpr, dpr);
      sg.fillStyle = bubbleShell(sg, bubble, W, H); sg.fill();
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(vw * dpr); cv.height = Math.ceil(vh * dpr);
      cv.style.cssText = `position:fixed;left:0;top:0;width:${vw}px;height:${vh}px;pointer-events:none;z-index:${tune.zIndex}`;
      document.body.appendChild(cv);
      const ctx = cv.getContext("2d");
      const savedVis = bubble.style.visibility;
      bubble.style.visibility = "hidden";

      const myPile = makePile(cv, ctx); pile = myPile;
      const shaker = makeShaker();
      // schedule: the first `first` shots one by one (gapStart→gapEnd), the rest in one volley (0-90ms jitter)
      const nFirst = Math.min(glyphs.length, tune.first);
      const sched = []; let t = 0;
      for (let i = 0; i < glyphs.length; i++) {
        if (i < nFirst) {
          const p = nFirst > 1 ? i / (nFirst - 1) : 1;
          sched.push(t); t += tune.gapStart + (tune.gapEnd - tune.gapStart) * Math.sqrt(p);
        } else sched.push(t + 70 + Math.random() * 90);
      }
      const shots = glyphs.map((g, i) => ({ g, at: sched[i], fired: false, hit: false, sx: 0, sy: 0, aimX: (Math.random() - 0.5) * 2, aimY: (Math.random() - 0.5) * 2 }));
      const lastAt = Math.max(...sched);
      let tgt = targetOf(); shaker.attach(tgt);
      let bx = br.left, by = br.top, shellOut = false, resolved = false;
      const t0 = performance.now();
      function track() {
        if (bubble.isConnected) { const r = bubble.getBoundingClientRect(); if (r.width) { bx = r.left; by = r.top; } }
        tgt = targetOf(); shaker.attach(tgt);
      }
      function done() {
        if (resolved) return; resolved = true;
        bubble.style.visibility = savedVis;
        bubble.classList.add("bg-return"); setTimeout(() => bubble.classList.remove("bg-return"), 600);
        busy = false; resolve(true);
      }
      function tick(now) {
        const el = now - t0;
        track();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vw, vh);
        ctx.textBaseline = "middle"; ctx.textAlign = "center";
        // 1) the shell plus letters not fired yet; it shrinks away after the last shot
        if (!shellOut) {
          const fade = el > lastAt ? Math.max(0, 1 - (el - lastAt) / 160) : 1;
          if (fade <= 0) shellOut = true;
          ctx.save(); ctx.globalAlpha = fade;
          ctx.translate(bx + W / 2, by + H / 2); ctx.scale(0.85 + 0.15 * fade, 0.85 + 0.15 * fade); ctx.translate(-W / 2, -H / 2);
          ctx.drawImage(shell, 0, 0, W, H);
          for (const s of shots) if (!s.fired) { ctx.font = s.g.font; ctx.fillStyle = s.g.color; ctx.fillText(s.g.ch, s.g.x + s.g.w / 2, s.g.y + s.g.h / 2); }
          ctx.restore();
        }
        // 2) bullets: straight line, two ghost trails
        let flying = false;
        for (const s of shots) {
          if (s.hit) continue;
          if (!s.fired) {
            if (el < s.at) { flying = true; continue; }
            s.fired = true; s.sx = bx + s.g.x + s.g.w / 2; s.sy = by + s.g.y + s.g.h / 2;
          }
          const q = Math.min(1, (el - s.at) / tune.flyMs);
          const tx = tgt.x + s.aimX * tgt.r * tune.scatter, ty = tgt.y + s.aimY * tgt.r * tune.scatter;
          if (q >= 1) {
            s.hit = true;
            if (tgt.el) { shaker.hit(tx - s.sx, ty - s.sy); myPile.add(s.g, tx, ty, tx - s.sx, ty - s.sy); }
            if ((shots.indexOf(s) & 3) === 0) buzz(6);
            continue;
          }
          flying = true;
          ctx.font = s.g.font; ctx.fillStyle = s.g.color;
          for (let k = 2; k >= 0; k--) {
            const qq = Math.max(0, q - k * 0.07);
            const k1 = 1 + (tune.big - 1) * qq;
            ctx.save(); ctx.globalAlpha = k ? 0.18 / k : 1;
            ctx.translate(s.sx + (tx - s.sx) * qq, s.sy + (ty - s.sy) * qq); ctx.scale(k1, k1);
            ctx.fillText(s.g.ch, 0, 0); ctx.restore();
          }
        }
        if (!flying && !resolved) done();
        // 3) the pile + the target's spring
        myPile.step(now, flying);
        shaker.step();
        const alive = myPile.draw(now);
        if (!alive && resolved && shaker.still()) { shaker.detach(); myPile.destroy(); if (pile === myPile) pile = null; return; }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // bubble pop-back keyframes, injected once
  if (typeof document !== "undefined" && !document.getElementById("bg-style")) {
    const s = document.createElement("style"); s.id = "bg-style";
    s.textContent = `.bg-return{animation:bgReturn .5s cubic-bezier(.34,1.56,.5,1) both}@keyframes bgReturn{from{transform:scale(0);opacity:0}35%{opacity:1}to{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){.bg-return{animation:none}}`;
    document.head.appendChild(s);
  }
  return { fire, tune };
});
