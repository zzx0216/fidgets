/*!
 * avatar-fling · 弹弹乐
 * Grab a chat avatar, stretch it like jelly, let go — it snaps back or gets
 * slingshotted off-screen with bouncy ball physics, then pops back in place.
 * Zero dependencies. Touch + mouse. MIT.
 *
 * Usage:
 *   const fling = AvatarFling.attach({
 *     container: document.querySelector(".chat"),   // scroll container holding the rows
 *     row: ".msg.them",                              // rows whose avatar can be grabbed
 *     avatar: ".avatar",                             // avatar element inside a row (round-ish)
 *     bubble: ".bubble",                             // fallback element for flingAway() when a row has no avatar
 *     onPull(count) {},                              // stretched and let go without crossing the line
 *     onFly(count)  {},                              // crossed the line — slingshotted
 *   });
 *   fling.flingAway(row);   // programmatic: an invisible hand grabs this row's avatar (or bubble) and flings it
 *   fling.destroy();
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AvatarFling = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const DEFAULTS = {
    row: ".msg",
    avatar: ".avatar",
    bubble: ".bubble",
    flyAt: 150,          // raw finger travel (px) beyond which release = fling
    rubber: 150,         // rubber band: shown = R*(1-1/(1+d/R)), asymptote R
    batchMs: 1200,       // pulls/flings within this window are reported together
    dimMax: 0.62,        // darkest the page scrim gets while stretching
    fallbackFill: "#5b6f80",
    haptics: true,
    onPull: null,
    onFly: null,
  };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function attach(userOpts) {
    const opts = Object.assign({}, DEFAULTS, userOpts || {});
    const container = opts.container || document.body;
    const RB = opts.rubber, FLY_AT = opts.flyAt, DIM_MAX = opts.dimMax;
    let st = null;                       // active drag
    let pending = { pull: 0, fly: 0 }, flushTimer = null;
    const fillCache = new Map();
    const rubber = (d) => Math.sign(d) * RB * (1 - 1 / (1 + Math.abs(d) / RB));
    const buzz = (ms) => { if (!opts.haptics) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };

    function queue(kind) {
      pending[kind] += 1;
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        const n = pending; pending = { pull: 0, fly: 0 }; flushTimer = null;
        if (n.fly && typeof opts.onFly === "function") opts.onFly(n.fly);
        if (n.pull && typeof opts.onPull === "function") opts.onPull(n.pull);
      }, opts.batchMs);
    }

    // ---- avatar lookup -------------------------------------------------------
    function avatarOf(row) {
      return typeof opts.avatar === "function" ? opts.avatar(row) : row.querySelector(opts.avatar);
    }
    function avatarUrl(av) {
      if (!av) return "";
      if (av.tagName === "IMG") return av.currentSrc || av.src || "";
      const im = av.querySelector && av.querySelector("img");
      if (im) return im.currentSrc || im.src || "";
      const bg = getComputedStyle(av).backgroundImage || "";
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      return m ? m[1] : "";
    }
    function geom(av) {
      const r = av.getBoundingClientRect();
      const rad = Math.min(r.width, r.height) / 2;
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: rad };
    }
    // average colour of the avatar → jelly colour (same-origin or data URLs only; tainted canvas falls back)
    function avatarFill(url, cb) {
      if (!url) return cb(opts.fallbackFill);
      if (fillCache.has(url)) return cb(fillCache.get(url));
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = c.height = 16;
          const g = c.getContext("2d"); g.drawImage(im, 0, 0, 16, 16);
          const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
          const mix = (v) => Math.round((v / Math.max(n, 1)) * 0.72 + 255 * 0.28);   // lift a bit so the jelly isn't muddy
          const col = n ? `rgb(${mix(r)},${mix(gg)},${mix(b)})` : opts.fallbackFill;
          fillCache.set(url, col); cb(col);
        } catch (_) { fillCache.set(url, opts.fallbackFill); cb(opts.fallbackFill); }
      };
      im.onerror = () => { fillCache.set(url, opts.fallbackFill); cb(opts.fallbackFill); };
      im.src = url;
    }

    // ---- SVG overlay ---------------------------------------------------------
    const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    function pageBg() {
      if (opts.bg) return opts.bg;
      const b = getComputedStyle(document.body).backgroundColor;
      return b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent" ? b : "#fff";
    }
    function baseSvg() {
      const W = window.innerWidth, H = window.innerHeight;   // px, not vh: iOS 100vh ≠ innerHeight
      const svg = el("svg", { class: "af-goo", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
      svg.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:2147483000;overflow:visible`;
      return { svg, W, H };
    }
    let uid = 0;
    function buildOverlay(cx, cy, r, url) {
      const { svg, W, H } = baseSvg();
      const id = "af" + (++uid);
      const defs = el("defs", {});
      const f = el("filter", { id: id + "g", x: "-50%", y: "-50%", width: "200%", height: "200%", "color-interpolation-filters": "sRGB" });
      f.appendChild(el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: String(Math.max(4, r * 0.28)), result: "blur" }));
      f.appendChild(el("feColorMatrix", { in: "blur", mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7", result: "goo" }));
      defs.appendChild(f);
      const clip = el("clipPath", { id: id + "c" }); const cc = el("circle", { cx, cy, r }); clip.appendChild(cc); defs.appendChild(clip);
      svg.appendChild(defs);
      const mask = el("circle", { cx, cy, r: r + 1.5, fill: pageBg() });   // disc covering the real avatar's spot
      svg.appendChild(mask);
      const dim = el("rect", { x: 0, y: 0, width: W, height: H, fill: "#141a22", opacity: "0" });   // scrim, deepens with stretch
      svg.appendChild(dim);
      const goo = el("g", { filter: `url(#${id}g)`, fill: opts.fallbackFill });
      const base = el("circle", { cx, cy, r: r * 0.98 });
      const neck = el("path", { d: "" });         // body↔blob neck, pinched in the middle; the filter rounds the seams
      const blob = el("circle", { cx, cy, r: r * 0.5 });
      goo.appendChild(base); goo.appendChild(neck); goo.appendChild(blob); svg.appendChild(goo);
      const hl = el("ellipse", { cx, cy, rx: r * 0.26, ry: r * 0.16, fill: "#fff", opacity: "0" });   // jelly highlight
      svg.appendChild(hl);
      const img = el("image", { href: url, x: cx - r, y: cy - r, width: r * 2, height: r * 2, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${id}c)` });
      if (!url) img.setAttribute("opacity", "0");
      svg.appendChild(img);
      document.body.appendChild(svg);
      return { svg, goo, base, neck, blob, img, hl, mask, dim, clipCircle: cc, cx, cy, r };
    }
    // bx,by = blob offset from origin; body = body offset (default none); scale = body scale (shrinks while flying)
    function paint(o, bx, by, body, scale) {
      const { cx, cy, r } = o;
      const d = Math.hypot(bx, by), k = Math.min(d / RB, 1);
      if (!o.dimHold) o.dim.setAttribute("opacity", String(DIM_MAX * Math.pow(k, 0.8)));
      const br = r * (0.5 - 0.2 * k);
      o.blob.setAttribute("cx", cx + bx); o.blob.setAttribute("cy", cy + by); o.blob.setAttribute("r", Math.max(br, 2));
      const lx = body ? body.x : 0, ly = body ? body.y : 0;
      const sc = scale == null ? 1 : scale, rr = r * sc;
      const gx = bx - lx, gy = by - ly, gd = Math.hypot(gx, gy);
      if (gd > 1) {
        const ux = gx / gd, uy = gy / gd, nx = -uy, ny = ux;
        const ax = cx + lx, ay = cy + ly, ex = cx + bx, ey = cy + by;
        const wa = rr * 0.55 * (1 - 0.45 * k), wb = br * 0.62, wm = Math.min(wa, wb) * (0.55 - 0.42 * k);
        const mx = (ax + ex) / 2, my = (ay + ey) / 2;
        o.neck.setAttribute("d", `M${ax + nx * wa},${ay + ny * wa} Q${mx + nx * wm},${my + ny * wm} ${ex + nx * wb},${ey + ny * wb} L${ex - nx * wb},${ey - ny * wb} Q${mx - nx * wm},${my - ny * wm} ${ax - nx * wa},${ay - ny * wa} Z`);
      } else o.neck.setAttribute("d", "");
      o.base.setAttribute("cx", cx + lx); o.base.setAttribute("cy", cy + ly); o.base.setAttribute("r", rr * 0.98);
      o.img.setAttribute("x", cx - rr + lx); o.img.setAttribute("y", cy - rr + ly);
      o.img.setAttribute("width", rr * 2); o.img.setAttribute("height", rr * 2);
      o.clipCircle.setAttribute("cx", cx + lx); o.clipCircle.setAttribute("cy", cy + ly); o.clipCircle.setAttribute("r", rr);
      o.hl.setAttribute("cx", cx + bx - br * 0.3); o.hl.setAttribute("cy", cy + by - br * 0.35);
      o.hl.setAttribute("rx", br * 0.34); o.hl.setAttribute("ry", br * 0.2); o.hl.setAttribute("opacity", String(0.35 * Math.min(k * 2.5, 1)));
    }

    // ---- real avatar show/hide + pop back --------------------------------------
    function hideReal(av) { av.style.visibility = "hidden"; }
    function unhideReal(av) { av.style.visibility = ""; }
    function popBack(o) {
      try { o.svg.remove(); } catch (_) {}
      unhideReal(o.av);
      o.av.classList.add("af-return");
      const done = () => o.av.classList.remove("af-return");
      o.av.addEventListener("animationend", done, { once: true }); setTimeout(done, 800);
    }
    function teardown(o, keepDisc) {
      if (!keepDisc) { try { o.svg.remove(); } catch (_) {} unhideReal(o.av); return; }
      [o.goo, o.img, o.hl, o.dim].forEach((n) => { try { n.remove(); } catch (_) {} });   // disc stays to cover the spot
    }

    // ---- motion --------------------------------------------------------------
    function spring(from, to, { stiffness = 260, damping = 14, onFrame, onDone } = {}) {
      let x = from.x, y = from.y, vx = 0, vy = 0, last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.032); last = now;
        const ax = -stiffness * (x - to.x) - damping * vx, ay = -stiffness * (y - to.y) - damping * vy;
        vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
        onFrame(x, y);
        if (Math.hypot(x - to.x, y - to.y) < 0.4 && Math.hypot(vx, vy) < 8) { onFrame(to.x, to.y); onDone && onDone(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    // ball physics: top/bottom are walls (bounce + tiny buzz), left/right open (gone once out); gravity on.
    function bouncePath(start, r, ux, uy, onFrame, onDone) {
      const W = window.innerWidth, H = window.innerHeight, SPEED = 1500, G = 2600, REST = 0.72, MAX_MS = 3200, VX_MIN = 250, VX_MAX = 380;
      let vy = uy * SPEED;
      let vx = Math.min(Math.max(Math.abs(ux) * SPEED, VX_MIN), VX_MAX) * (start.x < W / 2 ? 1 : -1);   // always toward the far side
      let x = start.x, y = start.y, last = performance.now(); const t0 = last; let done = false;
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.032); last = now;
        vy += G * dt; x += vx * dt; y += vy * dt;
        if (y - r < 0 && vy < 0) { y = r; vy = -vy * REST; buzz(8); }
        if (y + r > H && vy > 0) { y = H - r; vy = -vy * REST; vx *= 0.96; buzz(8); }
        const prog = Math.min((now - t0) / 900, 1);
        onFrame(x, y, prog);
        if (x < -2 * r || x > W + 2 * r || now - t0 > MAX_MS) { if (!done) { done = true; onDone(); } return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    // slingshot: blob snaps back into the body, then the whole thing launches along (ux,uy); avatar pops back ~0.5s after it's gone
    function runFly(o, bx, by, ux, uy) {
      const t0 = performance.now(), CATCH_MS = 150;
      let ended = false;
      const finish = () => { if (ended) return; ended = true; teardown(o, true); setTimeout(() => popBack(o), 520); };
      const catchTick = (now) => {
        const c = Math.min((now - t0) / CATCH_MS, 1), c2 = c * c;
        o.dimHold = true;
        paint(o, bx * (1 - c2), by * (1 - c2));
        if (c < 1) { requestAnimationFrame(catchTick); return; }
        bouncePath({ x: o.cx, y: o.cy }, o.r, ux, uy, (x, y, prog) => {
          const ox = x - o.cx, oy = y - o.cy;
          paint(o, ox, oy, { x: ox, y: oy }, 1 - 0.15 * prog);
          o.dim.setAttribute("opacity", String(DIM_MAX * (1 - prog)));
          o.hl.setAttribute("opacity", "0");
        }, finish);
      };
      requestAnimationFrame(catchTick);
      setTimeout(finish, 3600);
    }
    function runSnap(o, bx, by) {
      let done = false;
      const end = () => { if (!done) { done = true; teardown(o); } };
      spring({ x: bx, y: by }, { x: 0, y: 0 }, { stiffness: 220, damping: 11, onFrame: (x, y) => paint(o, x, y), onDone: end });
      setTimeout(end, 1500);
    }

    // ---- pointer handling ----------------------------------------------------
    function rowAt(target) {
      const row = target.closest && target.closest(opts.row);
      return row && container.contains(row) ? row : null;
    }
    function onDown(e) {
      if (st || (e.pointerType === "mouse" && e.button !== 0)) return;
      const row = rowAt(e.target); if (!row) return;
      const av = avatarOf(row); if (!av || !(av === e.target || av.contains(e.target))) return;
      const g = geom(av);
      st = { row, av, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, o: null, ...g };
      try { av.setPointerCapture(e.pointerId); } catch (_) {}
      if (e.cancelable) e.preventDefault();
    }
    function onMove(e) {
      if (!st || e.pointerId !== st.id) return;
      st.dx = e.clientX - st.x0; st.dy = e.clientY - st.y0;
      if (!st.moved && Math.hypot(st.dx, st.dy) > 6) {
        st.moved = true;
        if (!reduced()) {
          const url = avatarUrl(st.av);
          hideReal(st.av);
          st.o = Object.assign(buildOverlay(st.cx, st.cy, st.r, url), { av: st.av });
          const o = st.o; avatarFill(url, (col) => { if (o.svg.isConnected) o.goo.setAttribute("fill", col); });
        }
      }
      if (!st.moved) return;
      if (e.cancelable) e.preventDefault();
      if (st.o) paint(st.o, rubber(st.dx), rubber(st.dy));
    }
    function release(e) {
      if (!st || (e && e.pointerId != null && e.pointerId !== st.id)) return;
      const { dx, dy, moved, o, av } = st; st = null;
      if (!moved) return;
      const dist = Math.hypot(dx, dy);
      const fly = dist >= FLY_AT;
      queue(fly ? "fly" : "pull");
      buzz(fly ? 30 : 12);
      if (!o) { unhideReal(av); return; }
      const bx = rubber(dx), by = rubber(dy);
      if (fly) runFly(o, bx, by, -dx / dist, -dy / dist);
      else runSnap(o, bx, by);
    }
    // iOS: a non-passive touchstart preventDefault on the avatar keeps the list from scrolling
    // (and keeps pointer events flowing) even when the element has no touch-action:none yet.
    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      const row = rowAt(e.target); if (!row) return;
      const av = avatarOf(row); if (!av || !(av === e.target || av.contains(e.target))) return;
      if (e.cancelable) e.preventDefault();
    }
    function onTouchMove(e) { if (st && st.moved && e.cancelable) e.preventDefault(); }

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", release);
    container.addEventListener("pointercancel", release);
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });

    // ---- programmatic fling (the other side flings you) -------------------------
    function flingAway(row) {
      if (reduced() || st) return false;
      if (!row) { const rows = container.querySelectorAll(opts.row); row = rows[rows.length - 1]; }
      if (!row) return false;
      const rc = row.getBoundingClientRect();
      if (rc.bottom < 0 || rc.top > window.innerHeight) return false;   // not on screen: don't play
      const av = avatarOf(row);
      const onRight = (av ? geom(av).cx : rc.left + rc.width / 2) > window.innerWidth / 2;
      const pull = { x: (onRight ? -1 : 1) * RB * 0.62, y: RB * 0.38 };   // the invisible hand pulls down and inward
      const pd = Math.hypot(pull.x, pull.y), fx = -pull.x / pd, fy = -pull.y / pd;
      buzz([14, 60, 14]);
      if (av) {
        const g = geom(av), url = avatarUrl(av);
        hideReal(av);
        const o = Object.assign(buildOverlay(g.cx, g.cy, g.r, url), { av });
        avatarFill(url, (col) => { if (o.svg.isConnected) o.goo.setAttribute("fill", col); });
        const t0 = performance.now(), PULL_MS = 620;
        const tick = (now) => {
          const k = Math.min((now - t0) / PULL_MS, 1), e = 1 - Math.pow(1 - k, 3);
          paint(o, pull.x * e, pull.y * e);
          if (k < 1) requestAnimationFrame(tick);
          else setTimeout(() => runFly(o, pull.x, pull.y, fx, fy), 140);   // hold a beat at full stretch, then let go
        };
        requestAnimationFrame(tick);
        return true;
      }
      // no avatar: grab the bubble instead (transform-based jelly stretch, then the same ball physics)
      const bubble = row.querySelector(opts.bubble);
      if (!bubble) return false;
      const { svg, W, H } = baseSvg();
      const dim = el("rect", { x: 0, y: 0, width: W, height: H, fill: "#141a22", opacity: "0" });
      svg.appendChild(dim); document.body.appendChild(svg);
      bubble.style.transformOrigin = onRight ? "100% 0%" : "0% 0%";
      bubble.style.position = "relative"; bubble.style.zIndex = "2147483001";
      const br = bubble.getBoundingClientRect();
      const bcx = br.left + br.width / 2, bcy = br.top + br.height / 2, brad = Math.max(br.width, br.height) / 2 * 0.7;
      const t0 = performance.now(), PULL_MS = 620, HOLD = 140;
      let phase = 0, t1 = 0, rot = 0;
      const setT = (x, y, sx, sy, r) => { bubble.style.transform = `translate(${x}px, ${y}px) scale(${sx}, ${sy}) rotate(${r}deg)`; };
      const finish = () => {
        try { svg.remove(); } catch (_) {}
        bubble.style.visibility = "hidden"; bubble.style.transform = "";
        setTimeout(() => {
          bubble.style.visibility = ""; bubble.style.position = ""; bubble.style.zIndex = ""; bubble.style.transformOrigin = "";
          bubble.classList.add("af-return");
          const done = () => bubble.classList.remove("af-return");
          bubble.addEventListener("animationend", done, { once: true }); setTimeout(done, 800);
        }, 520);
      };
      const tick = (now) => {
        if (phase === 0) {
          const k = Math.min((now - t0) / PULL_MS, 1), e = 1 - Math.pow(1 - k, 3);
          setT(pull.x * 0.35 * e, pull.y * 0.35 * e, 1 + 0.22 * e, 1 + 0.1 * e, (onRight ? -6 : 6) * e);
          dim.setAttribute("opacity", String(DIM_MAX * Math.pow(e, 0.8)));
          if (k >= 1) { phase = 1; t1 = now + HOLD; }
          requestAnimationFrame(tick); return;
        }
        if (phase === 1) {
          if (now < t1) { requestAnimationFrame(tick); return; }
          phase = 2;
          bubble.style.transformOrigin = "50% 50%";
          bouncePath({ x: bcx + pull.x * 0.35, y: bcy + pull.y * 0.35 }, brad, fx, fy, (x, y, prog) => {
            rot += 4;
            setT(x - bcx, y - bcy, 1 - 0.15 * prog, 1 - 0.15 * prog, rot);
            dim.setAttribute("opacity", String(DIM_MAX * (1 - prog)));
          }, finish);
        }
      };
      requestAnimationFrame(tick);
      return true;
    }

    function destroy() {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", release);
      container.removeEventListener("pointercancel", release);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      clearTimeout(flushTimer);
    }
    return { flingAway, destroy };
  }

  // pop-back keyframes, injected once
  if (typeof document !== "undefined" && !document.getElementById("af-style")) {
    const s = document.createElement("style"); s.id = "af-style";
    s.textContent = `.af-return{animation:afReturn .5s cubic-bezier(.34,1.56,.5,1) both}@keyframes afReturn{from{transform:scale(0);opacity:0}35%{opacity:1}to{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){.af-return{animation:none}}`;
    document.head.appendChild(s);
  }
  return { attach };
});
