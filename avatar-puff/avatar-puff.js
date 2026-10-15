/*!
 * avatar-puff · 河豚
 * Long-press your chat avatar and it puffs up like a pufferfish (blown in a few
 * breaths); long-press again and it deflates like a balloon, then pops back.
 * The library owns the gesture, state and animation; layout is yours — it only
 * writes a CSS variable and a couple of classes (see README for recipes).
 * Zero dependencies. Touch + mouse. MIT.
 *
 * Usage:
 *   const puff = AvatarPuff.attach({
 *     container: document.querySelector(".chat"),  // scroll container holding the rows
 *     side: "me",                                  // name → var --ap-me, classes .ap-me / .puffed-me
 *     row: ".msg.me",                              // rows on this side
 *     anyRow: ".msg",                              // every row (both sides) — gets .ap-me from the puff start on
 *     avatar: ".avatar",                           // avatar element inside a row
 *     onChange(on, byUser) {},
 *   });
 *   puff.on(); puff.off(); puff.toggle(); puff.isOn;
 *   puff.set(true);   // jump to a state without animating (restore after reload)
 *   puff.destroy();
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AvatarPuff = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DEFAULTS = {
    side: "me",
    row: ".msg.me",
    anyRow: ".msg",
    avatar: ".avatar",
    scale: 1.96,         // puffed size = normal × scale
    press: 400,          // long-press ms (fires while still holding)
    moveTolerance: 8,    // finger travel (px) that cancels the press
    gesture: true,       // false = programmatic only (e.g. the other side's avatar)
    latestOnly: true,    // only the newest avatar on this side responds
    breaths: 4,          // inflate in this many puffs, biggest first
    breathMs: 230,
    offMs: 620,          // balloon deflate duration
    gapMs: 420,          // gone → pop back
    haptics: true,
    onChange: null,
  };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function attach(userOpts) {
    const opts = Object.assign({}, DEFAULTS, userOpts || {});
    const container = opts.container || document.body;
    const VAR = "--ap-" + opts.side, ROW_CLS = "ap-" + opts.side, ON_CLS = "puffed-" + opts.side;
    let isOn = false, busy = false, press = null, blowTimer = 0, observer = null;
    const buzz = (p) => { if (!opts.haptics) return; try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
    const setK = (k) => container.style.setProperty(VAR, k.toFixed(3));

    const rows = () => Array.from(container.querySelectorAll(opts.row));
    function latestAvatar() {
      const rs = rows();
      for (let i = rs.length - 1; i >= 0; i--) {
        const a = rs[i].querySelector(opts.avatar);
        if (a && a.offsetParent !== null && getComputedStyle(a).visibility !== "hidden") return a;
      }
      return null;
    }
    // the stretch starts at the group holding the newest avatar: walk up over consecutive same-side rows
    function startRow() {
      const all = Array.from(container.querySelectorAll(opts.anyRow));
      let i = all.length - 1;
      while (i >= 0 && !all[i].matches(opts.row)) i--;
      if (i < 0) return null;
      while (i > 0 && all[i - 1].matches(opts.row)) i--;
      return all[i];
    }
    function markFrom(start) {
      let on = false;
      for (const r of container.querySelectorAll(opts.anyRow)) { if (r === start) on = true; if (on) r.classList.add(ROW_CLS); }
      // rows added while puffed join the stretch
      observer = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches(opts.anyRow)) n.classList.add(ROW_CLS);
          n.querySelectorAll && n.querySelectorAll(opts.anyRow).forEach((r) => r.classList.add(ROW_CLS));
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }
    function unmark() {
      if (observer) { observer.disconnect(); observer = null; }
      container.querySelectorAll("." + ROW_CLS).forEach((r) => r.classList.remove(ROW_CLS));
    }
    function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

    // inflate: the scale goes 1 → target in n puffs, each a bit smaller than the last, avatar squeezes on every puff
    function blow(av) {
      const n = Math.max(1, Math.round(opts.breaths)), target = opts.scale;
      container.style.setProperty("--ap-ms", opts.breathMs + "ms");
      let i = 0;
      const step = () => {
        i++;
        const t = 1 - Math.pow(1 - i / n, 1.6);
        setK(1 + (target - 1) * t);
        if (av) replay(av, "ap-breath");
        if (i < n) blowTimer = setTimeout(step, opts.breathMs);
        else blowTimer = setTimeout(() => { container.style.removeProperty("--ap-ms"); if (av) av.classList.remove("ap-breath"); busy = false; }, opts.breathMs);
      };
      step();
    }

    function on(byUser) {
      if (isOn || busy) return false;
      const start = startRow(); if (!start) return false;
      isOn = true;
      markFrom(start);
      container.classList.add(ON_CLS);
      if (reduced()) setK(opts.scale);
      else { busy = true; setK(1); requestAnimationFrame(() => blow(latestAvatar())); }   // next frame: transitions need a starting point
      if (typeof opts.onChange === "function") opts.onChange(true, !!byUser);
      return true;
    }
    function off(byUser) {
      if (!isOn || busy) return false;
      isOn = false;
      const settle = () => {
        unmark(); container.classList.remove(ON_CLS); container.style.removeProperty(VAR);
        if (typeof opts.onChange === "function") opts.onChange(false, !!byUser);   // after the balloon, so a status line lands once it's gone
      };
      const av = latestAvatar();
      if (!av || reduced()) { settle(); return true; }
      // deflate: wobble → zip around shrinking to a dot → layout gives the room back → pop back in place
      busy = true;
      av.style.setProperty("--ap-off-ms", opts.offMs + "ms");
      av.classList.remove("ap-pop", "ap-breath"); av.classList.add("ap-off");
      setTimeout(() => {
        settle();
        setTimeout(() => {
          av.classList.remove("ap-off"); av.classList.add("ap-pop");
          setTimeout(() => { av.classList.remove("ap-pop"); busy = false; }, 520);
        }, opts.gapMs);
      }, opts.offMs);
      return true;
    }
    const toggle = (byUser) => (isOn ? off(byUser) : on(byUser));
    // jump straight to a state, no animation, no onChange (e.g. restoring after a page reload)
    function set(v) {
      if (busy || !!v === isOn) return false;
      if (v) { const start = startRow(); if (!start) return false; isOn = true; markFrom(start); container.classList.add(ON_CLS); setK(opts.scale); }
      else { isOn = false; unmark(); container.classList.remove(ON_CLS); container.style.removeProperty(VAR); }
      return true;
    }

    // ---- long press ---------------------------------------------------------
    function cancel() { if (press) { clearTimeout(press.timer); press = null; } }
    function onDown(e) {
      if (e.button > 0) return;
      const av = e.target.closest && e.target.closest(opts.avatar);
      if (!av || !container.contains(av) || !av.closest(opts.row)) return;
      if (opts.latestOnly && av !== latestAvatar()) return;
      cancel();
      press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; buzz(isOn ? 12 : [10, 40, 10]); toggle(true); }, opts.press) };
    }
    function onMove(e) { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > opts.moveTolerance) cancel(); }
    function onMenu(e) { if (e.target.closest && e.target.closest(opts.avatar) && container.contains(e.target)) e.preventDefault(); }
    if (opts.gesture) {
      container.addEventListener("pointerdown", onDown);
      container.addEventListener("pointermove", onMove);
      container.addEventListener("pointerup", cancel);
      container.addEventListener("pointercancel", cancel);
      container.addEventListener("scroll", cancel, { passive: true });
      container.addEventListener("contextmenu", onMenu);
    }

    function destroy() {
      cancel(); clearTimeout(blowTimer);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", cancel);
      container.removeEventListener("pointercancel", cancel);
      container.removeEventListener("scroll", cancel);
      container.removeEventListener("contextmenu", onMenu);
      unmark(); container.classList.remove(ON_CLS); container.style.removeProperty(VAR);
    }
    return { on: () => on(false), off: () => off(false), toggle: () => toggle(false), set, get isOn() { return isOn; }, destroy };
  }

  // breath / deflate / pop-back keyframes, injected once. Transform-based so they stack on top of your sizing.
  if (typeof document !== "undefined" && !document.getElementById("ap-style")) {
    const s = document.createElement("style"); s.id = "ap-style";
    s.textContent = `.ap-breath{animation:apBreath var(--ap-ms,.23s) ease-out}
@keyframes apBreath{0%{transform:scale(1)}40%{transform:scale(1.07,.93)}100%{transform:scale(1)}}
.ap-off{animation:apOff var(--ap-off-ms,.62s) cubic-bezier(.4,.1,.6,1) both}
@keyframes apOff{0%{transform:scale(1) rotate(0)}14%{transform:scale(1.1,.9) rotate(-5deg)}30%{transform:scale(.88,1.08) rotate(5deg) translate(3px,-4px)}50%{transform:scale(.62) rotate(-14deg) translate(-9px,-12px)}70%{transform:scale(.34) rotate(12deg) translate(7px,-20px)}86%{transform:scale(.14) rotate(-8deg) translate(-3px,-26px)}100%{transform:scale(0) translate(1px,-30px);opacity:.6}}
.ap-pop{animation:apPop .5s cubic-bezier(.34,1.56,.5,1) both}
@keyframes apPop{from{transform:scale(0);opacity:0}35%{opacity:1}to{transform:scale(1);opacity:1}}
@media(prefers-reduced-motion:reduce){.ap-breath,.ap-off,.ap-pop{animation:none}}`;
    document.head.appendChild(s);
  }
  return { attach };
});
