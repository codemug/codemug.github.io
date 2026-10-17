/* Runtime for the talk-deck figures (<DeckFig />), inlined once per page by <DeckRuntime />.
 *
 * The slides are the talk's own markup and scripts (lifted by scripts/extract-deck.mjs), so
 * this provides the API they were written against: window.Deck from deck.html's engine.
 * Each <figure class="dk"> is a small player over one or more slides, whose build steps are
 * flattened into states. Where this differs from the talk's single-slide engine:
 *   - state is per figure; a tween or loop belongs to the slide whose hook started it and is
 *     cancelled when that figure changes slide;
 *   - a figure autoplays only while at least half visible, stops at its last state, and never
 *     autoplays under prefers-reduced-motion;
 *   - an off-screen figure is idle: running tweens jump to their end, loops pause, and any
 *     embedded document (the sampling board) is unloaded until the figure is back in view.
 */
(function () {
  'use strict';
  if (window.Deck) return;

  var FRAME_W = 1280, FRAME_H = 720, MIN_W = 640;
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hooks = {};
  var players = [];
  var active = null; // the slide record whose hook, tween or loop callback is running

  // ---- the talk engine's helpers, unchanged ----
  var ease = {
    linear: function (t) { return t; },
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };
  function lerp(a, b, t) {
    if (Array.isArray(a)) return a.map(function (v, i) { return v + (b[i] - v) * t; });
    return a + (b - a) * t;
  }
  function mul(m, v) { return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]]; }
  function vmul(v, m) { return [v[0] * m[0] + v[1] * m[2], v[0] * m[1] + v[1] * m[3]]; }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function cam3(o) {
    o = o || {};
    var ox = o.ox || 0, oy = o.oy || 0, u = o.u || 1, az = o.az || 0, el = o.el || 0;
    return {
      set: function (a, e) { az = a; el = e; },
      P: function (x, y, z) {
        var ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
        var x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
        var y2 = y * ce - z1 * se, z2 = y * se + z1 * ce;
        return [ox + u * x1, oy - u * y2, z2];
      }
    };
  }
  function plane(o) {
    o = o || {};
    var ox = o.ox || 0, oy = o.oy || 0, u = o.u || 1;
    return {
      X: function (x) { return ox + x * u; },
      Y: function (y) { return oy - y * u; },
      P: function (x, y) { return [ox + x * u, oy - y * u]; },
      M: function (m) { return 'matrix(' + [m[0], -m[2], -m[1], m[3], 0, 0].join(' ') + ')'; },
      Mr: function (m) { return 'matrix(' + [m[0], -m[1], -m[2], m[3], 0, 0].join(' ') + ')'; }
    };
  }

  function within(rec, fn) {
    var prev = active;
    active = rec;
    try { return fn(); } finally { active = prev; }
  }

  /* Time-based tween over [0,1], owned by the slide whose code started it. */
  function tween(ms, fn, o) {
    o = o || {};
    var rec = active;
    if (reduce || ms <= 0) { fn(1); if (o.done) o.done(); return function () {}; }
    var e = o.ease || ease.inOut, t0 = null, dead = false;
    var h = { cancel: function () { dead = true; } };
    if (rec) rec.tweens.push(h);
    function frame(now) {
      if (dead) return;
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / ms);
      within(rec, function () { fn(e(k)); });
      if (k < 1) requestAnimationFrame(frame);
      else { dead = true; if (o.done) within(rec, o.done); }
    }
    requestAnimationFrame(frame);
    return h.cancel;
  }

  /* Continuous animation fn(seconds) while its figure is visible; paused (no frames) otherwise. */
  function loop(fn) {
    var rec = active;
    if (reduce) { within(rec, function () { fn(0); }); return function () {}; }
    var dead = false, paused = false, t0 = null, secs = 0, raf = 0;
    var h = {
      cancel: function () { dead = true; cancelAnimationFrame(raf); },
      pause: function () { if (!paused && !dead) { paused = true; cancelAnimationFrame(raf); } },
      resume: function () { if (paused && !dead) { paused = false; t0 = null; raf = requestAnimationFrame(frame); } }
    };
    if (rec) rec.tweens.push(h);
    function frame(now) {
      if (dead || paused) return;
      if (t0 === null) t0 = now - secs * 1000;
      secs = (now - t0) / 1000;
      within(rec, function () { fn(secs); });
      raf = requestAnimationFrame(frame);
    }
    if (rec && rec.player && !rec.player.visible) paused = true;
    else raf = requestAnimationFrame(frame);
    return h.cancel;
  }

  /* [r, g, b] of a site colour token (e.g. '--color-accent'), kept current: on a theme change
     the array is updated in place, so slides that interpolate colours in script follow it. */
  var liveColors = [], probe = null;
  function readRgb(name) {
    if (!probe) { probe = document.createElement('span'); probe.style.display = 'none'; (document.body || document.documentElement).appendChild(probe); }
    probe.style.color = 'var(' + name + ')';
    var m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  }
  function rgb(name) {
    var a = readRgb(name);
    liveColors.push({ name: name, rgb: a });
    return a;
  }
  function refreshColors() {
    liveColors.forEach(function (c) { var v = readRgb(c.name); c.rgb[0] = v[0]; c.rgb[1] = v[1]; c.rgb[2] = v[2]; });
  }

  /* Current frame scale of the figure containing el (slides that measure layout divide by it). */
  function scale(el) {
    var f = el && el.closest ? el.closest('.dk') : null;
    return f ? parseFloat(getComputedStyle(f).getPropertyValue('--dk-scale')) || 1 : 1;
  }

  function siteTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  /* An embedded document follows the site theme. Its body goes transparent so the slide's own
     background shows through, and its root color-scheme matches the iframe's: when the two
     differ, browsers paint an opaque backdrop behind the document. */
  function themeFrame(f) {
    var t = siteTheme();
    f.style.colorScheme = t;
    try {
      var d = f.contentDocument;
      if (!d || !d.body) return;
      d.documentElement.style.colorScheme = t;
      d.body.setAttribute('data-theme', t);
      d.body.style.background = 'transparent';
    } catch (e) { /* not ours */ }
  }

  // ---- one player per figure ----
  function Player(fig) {
    var self = this;
    this.fig = fig;
    this.scroller = fig.querySelector('.dk-scroll');
    this.capEl = fig.querySelector('.dk-cap');
    this.playBtn = fig.querySelector('.dk-play');
    this.expandBtn = fig.querySelector('.dk-expand');
    this.frames = [].slice.call(fig.querySelectorAll('iframe[data-dk-srcdoc]'));
    this.interactive = this.frames.length > 0; // the reader drives embedded documents: no autoplay
    try { this.captions = JSON.parse(fig.getAttribute('data-captions') || '{}'); } catch (e) { this.captions = {}; }
    this.dwell = +fig.getAttribute('data-dwell') || 2800;
    this.visible = false; this.playing = false; this.touched = false; this.finished = false; this.timer = 0;
    this.recs = [].map.call(fig.querySelectorAll('.dk-frame > .slide'), function (el) {
      var picked = el.getAttribute('data-dk-steps'); // a figure may show only some of a slide's steps
      return { el: el, id: el.id, steps: +el.getAttribute('data-steps') || 0, picks: picked ? picked.split(',').map(Number) : null,
        hooks: hooks[el.id] || {}, tweens: [], player: self };
    });
    this.states = [];
    this.recs.forEach(function (r, i) {
      if (r.picks) r.picks.forEach(function (n) { self.states.push([i, n]); });
      else for (var n = 0; n <= r.steps; n++) self.states.push([i, n]);
    });
    var pipsEl = fig.querySelector('.dk-pips');
    this.pips = this.states.map(function () { var i = document.createElement('i'); pipsEl.appendChild(i); return i; });
    this.cur = -1; this.curStep = 0; this.state = 0;

    fig.querySelector('.dk-prev').addEventListener('click', function () { self.user(); self.go(self.state - 1); });
    fig.querySelector('.dk-next').addEventListener('click', function () { self.user(); self.go(self.state + 1); });
    this.playBtn.addEventListener('click', function () { self.touched = true; if (self.playing) self.pause(); else self.play(); });
    this.expandBtn.addEventListener('click', function () { self.expand(!fig.classList.contains('is-expanded')); });
    fig.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); self.user(); self.go(self.state + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); self.user(); self.go(self.state - 1); }
      else if (e.key === ' ') { e.preventDefault(); self.touched = true; if (self.playing) self.pause(); else self.play(); }
    });
    this.frames.forEach(function (f) {
      f.addEventListener('load', function () {
        themeFrame(f);
        // touching the embedded document hands control to the reader
        try {
          ['pointerdown', 'keydown', 'wheel'].forEach(function (t) {
            f.contentWindow.addEventListener(t, function () { self.user(); }, { passive: true });
          });
        } catch (e) { /* not ours */ }
      });
    });

    // a stage wider than its figure (narrow screens) starts centred, until the reader scrolls it
    this.autoLeft = -1; this.userScrolled = false;
    this.scroller.addEventListener('scroll', function () {
      if (Math.abs(self.scroller.scrollLeft - self.autoLeft) > 1) self.userScrolled = true;
    }, { passive: true });

    this.go(0, { instant: true });
    this.resize();
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(this.scroller);
  }

  Player.prototype.ctx = function (rec, instant) {
    return {
      el: rec.el, id: rec.id, steps: rec.steps, instant: !!instant,
      qs: function (s) { return rec.el.querySelector(s); },
      qsa: function (s) { return [].slice.call(rec.el.querySelectorAll(s)); }
    };
  };

  Player.prototype.hook = function (rec, name, args) {
    var fn = rec.hooks[name];
    if (fn) within(rec, function () { fn.apply(rec.hooks, args); });
  };

  Player.prototype.cancel = function (rec) {
    rec.tweens.forEach(function (t) { t.cancel(); });
    rec.tweens = [];
  };

  Player.prototype.applyStep = function (rec, n, prev, instant) {
    rec.el.setAttribute('data-cur', n);
    [].forEach.call(rec.el.querySelectorAll('[data-from]'), function (e) {
      var from = +e.getAttribute('data-from');
      var until = e.hasAttribute('data-until') ? +e.getAttribute('data-until') : Infinity;
      e.classList.toggle('on', n >= from && n < until);
    });
    this.hook(rec, 'step', [n, prev, this.ctx(rec, instant)]);
  };

  /* Same semantics as the talk's go(i, n): entering a slide jumps to the step instantly,
     moving within a slide animates. */
  Player.prototype.go = function (s, opts) {
    s = Math.max(0, Math.min(this.states.length - 1, s));
    var i = this.states[s][0], n = this.states[s][1], rec = this.recs[i];
    if (i !== this.cur) {
      if (this.cur >= 0) {
        var old = this.recs[this.cur];
        this.cancel(old);
        old.el.classList.remove('visible');
        this.hook(old, 'leave', [this.ctx(old)]);
      }
      this.cur = i; this.curStep = 0;
      rec.el.classList.add('visible');
      this.hook(rec, 'enter', [this.ctx(rec)]);
      this.applyStep(rec, 0, -1, true);
      if (n > 0) { this.curStep = n; this.applyStep(rec, n, 0, true); }
    } else if (n !== this.curStep) {
      var p = this.curStep;
      this.curStep = n;
      this.applyStep(rec, n, p, !!(opts && opts.instant));
    }
    this.state = s;
    this.chrome();
  };

  Player.prototype.chrome = function () {
    var s = this.state;
    this.pips.forEach(function (p, k) { p.className = k < s ? 'done' : k === s ? 'now' : ''; });
    this.fig.setAttribute('data-state', s);
    var cap = this.captions[this.recs[this.cur].id] || '';
    if (this.capEl && this.capEl.textContent !== cap) this.capEl.textContent = cap;
    this.syncPlay();
  };

  Player.prototype.syncPlay = function () {
    var end = this.state >= this.states.length - 1;
    var label = this.playing ? 'Pause' : end ? 'Replay' : 'Play';
    this.playBtn.textContent = this.playing ? '⏸' : end ? '↺' : '▶';
    this.playBtn.setAttribute('aria-label', label);
    this.playBtn.disabled = this.states.length < 2;
  };

  Player.prototype.play = function () {
    if (this.states.length < 2) return;
    if (this.state >= this.states.length - 1) { this.finished = false; this.go(0); }
    this.playing = true;
    this.syncPlay();
    this.schedule();
  };

  Player.prototype.schedule = function () {
    var self = this;
    clearTimeout(this.timer);
    if (!this.playing) return;
    this.timer = setTimeout(function () {
      if (!self.playing || !self.visible) return;
      if (self.state >= self.states.length - 1) { self.finished = true; self.pause(); return; }
      self.go(self.state + 1);
      self.schedule();
    }, this.dwell);
  };

  Player.prototype.pause = function () {
    this.playing = false;
    clearTimeout(this.timer);
    this.syncPlay();
  };

  Player.prototype.user = function () { this.touched = true; this.pause(); };

  Player.prototype.setVisible = function (half, any) {
    var rec = this.recs[this.cur];
    if (any && !this.mounted) this.mount(true);
    if (half && !this.visible) {
      this.visible = true;
      rec.tweens.forEach(function (t) { if (t.resume) t.resume(); });
      if (!this.touched && !reduce && !this.finished && !this.interactive) this.play();
    } else if (!any && this.visible) {
      this.visible = false;
      this.playing = false;
      clearTimeout(this.timer);
      this.syncPlay();
      // settle: running tweens jump to their end state, loops pause
      var loops = rec.tweens.filter(function (t) { return t.pause; });
      rec.tweens.forEach(function (t) { if (!t.pause) t.cancel(); });
      rec.tweens = loops;
      loops.forEach(function (t) { t.pause(); });
      this.applyStep(rec, this.curStep, this.curStep, true);
      this.mount(false);
    }
  };

  /* Embedded documents (srcdoc iframes) load while the figure is near the viewport only. */
  Player.prototype.mount = function (on) {
    this.mounted = on;
    this.frames.forEach(function (f) {
      if (on) { if (!f.hasAttribute('srcdoc')) f.setAttribute('srcdoc', f.getAttribute('data-dk-srcdoc')); }
      else if (f.hasAttribute('srcdoc')) { f.removeAttribute('srcdoc'); f.src = 'about:blank'; }
    });
  };

  Player.prototype.resize = function () {
    var k, floor = MIN_W / FRAME_W;
    if (this.fig.classList.contains('is-expanded')) {
      var chrome = this.fig.querySelector('.dk-bar').offsetHeight + (this.capEl ? this.capEl.offsetHeight : 0) + 24;
      // fit the screen, but never below the inline scale: on a phone the reader pans instead
      k = Math.max(floor, Math.min((window.innerWidth - 16) / FRAME_W, (window.innerHeight - chrome) / FRAME_H));
    } else {
      k = Math.max(MIN_W, this.scroller.clientWidth) / FRAME_W;
    }
    this.fig.style.setProperty('--dk-scale', k.toFixed(4));
    var s = this.scroller, overX = s.scrollWidth - s.clientWidth, overY = s.scrollHeight - s.clientHeight;
    if (!this.userScrolled) {
      if (overX > 0) { this.autoLeft = Math.round(overX / 2); s.scrollLeft = this.autoLeft; }
      if (overY > 0) s.scrollTop = Math.round(overY / 2);
    }
  };

  /* Expanded, the figure goes into the browser's top layer (a manual popover): that escapes any
     transformed ancestor (the article's entrance animation makes one) and the site header,
     without moving the node, so an embedded document does not reload. */
  Player.prototype.expand = function (on) {
    var f = this.fig;
    if (on) {
      if (f.showPopover) { f.setAttribute('popover', 'manual'); try { f.showPopover(); } catch (e) { /* stays inline */ } }
      f.classList.add('is-expanded');
    } else {
      f.classList.remove('is-expanded');
      if (f.hasAttribute('popover')) { try { f.hidePopover(); } catch (e) { /* already hidden */ } f.removeAttribute('popover'); }
    }
    document.documentElement.classList.toggle('dk-noscroll', on);
    this.expandBtn.textContent = on ? '✕' : '⤢';
    this.expandBtn.setAttribute('aria-label', on ? 'Close the expanded figure' : 'Expand figure');
    this.userScrolled = false;
    this.resize();
    if (on) f.focus({ preventScroll: true });
  };

  /* Re-enter the current slide at its current step, instantly (after a theme change, so colours
     computed in script are redrawn). */
  Player.prototype.redraw = function () {
    var rec = this.recs[this.cur], n = this.curStep;
    this.cancel(rec);
    this.hook(rec, 'enter', [this.ctx(rec)]);
    this.applyStep(rec, 0, -1, true);
    if (n > 0) this.applyStep(rec, n, 0, true);
  };

  // ---- page wiring ----
  var io = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var p = en.target.__dk;
      if (p) p.setVisible(en.isIntersecting && en.intersectionRatio >= 0.5, en.isIntersecting);
    });
  }, { threshold: [0, 0.5] }) : null;

  function init() {
    [].forEach.call(document.querySelectorAll('figure.dk'), function (fig) {
      if (fig.__dk) return;
      var p = new Player(fig);
      fig.__dk = p;
      players.push(p);
      if (io) io.observe(fig); else p.setVisible(true, true);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    players.forEach(function (p) { if (p.fig.classList.contains('is-expanded')) p.expand(false); });
  });
  window.addEventListener('resize', function () {
    players.forEach(function (p) { if (p.fig.classList.contains('is-expanded')) p.resize(); });
  });
  new MutationObserver(function () {
    refreshColors();
    players.forEach(function (p) {
      p.redraw();
      p.frames.forEach(function (f) { if (f.hasAttribute('srcdoc')) themeFrame(f); });
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.Deck = {
    slide: function (id, h) { hooks[id] = h || {}; },
    tween: tween, loop: loop, ease: ease, lerp: lerp, mul: mul, vmul: vmul, dot: dot,
    plane: plane, cam3: cam3, reduced: reduce, scale: scale, rgb: rgb,
    shaders: function () { return Promise.resolve(null); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
