/**
 * deck-fit.js — Shared scale-to-fit engine for the micro-captive slide deck.
 *
 * Replaces the per-slide inline fit() IIFE that was copy-pasted into every
 * page. All 6 bugs from the r9/r10 chassis are fixed here once:
 *
 *   Bug 1 — 100vh override:   removed from shared.css (only 100svh now).
 *   Bug 2 — no vV resize:     this file adds visualViewport.resize listener.
 *   Bug 3 — nav collapse:     fixed in shared.css (.deck-nav-mid min-width:0).
 *   Bug 4 — min-height 480:   MIN_H / min-height removed; no floor here.
 *   Bug 5 — child-sum hack:   gone; the canvas is a FIXED CSS size, not measured.
 *   Bug 6 — inert cqi:        noted; left-as-is (cosmetic, out of scope Phase 1).
 *
 * Usage: <script src="/deck-fit.js"></script>
 * No configuration needed. The script self-initialises on DOMContentLoaded
 * (or immediately if the DOM is already ready).
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────────── */
  /* The design canvas is FIXED at --slide-w x --slide-h (read from CSS). We do
     NOT measure content height at runtime anymore — the stage box is a fixed
     size in CSS, content is centered inside it, and we only compute the scale
     factor that fits that whole box into the pane. This is the reveal.js model. */
  var MIN_SCALE   = 0.05;  // absolute floor so the stage is never invisible
  var MAX_SCALE   = 4;     // generous ceiling: the deck is AUTHORED at 1280px but is meant to
                           // scale UP to FILL larger screens (the original fit() was uncapped).
                           // Capping at 1 left slides tiny + top-anchored on big displays; the
                           // content is vector (HTML/SVG) so upscaling stays crisp. 4 just guards
                           // against pathological viewports, it is never hit on a real screen.

  function canvasDim(prop, fallback) {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop));
    return (v && isFinite(v)) ? v : fallback;
  }

  /* ── Cached element references ────────────────────────────────────────── */
  var pane  = null;   // .slide-pane  (the constrained flex cell)
  var stage = null;   // .slide-stage (the 1280px canvas)

  /* ── rAF debounce state ───────────────────────────────────────────────── */
  var rafPending = false;

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  lockViewportHeight() — pin html/body to the REAL visible viewport       */
  /* ─────────────────────────────────────────────────────────────────────── */
  /* CSS uses 100svh (small viewport). But some browsers — notably third-party
   * iOS browsers (Chrome/Firefox/Edge on iOS) and in-app webviews — do NOT
   * subtract their own bottom toolbar from svh, so the bottom deck-nav row
   * renders BEHIND that chrome and disappears. visualViewport.height is the
   * only signal that reflects the actually-visible region in every browser, so
   * we write it onto html/body as an inline !important height. Inline
   * !important beats both the base and the @media `height:100svh !important`
   * rules, so the deck fills exactly the visible viewport and the nav is never
   * hidden. Progressive enhancement: if JS or visualViewport is absent, the CSS
   * svh value (with its @supports vh fallback) still applies. */
  function lockViewportHeight() {
    var docEl = document.documentElement;
    var body  = document.body;

    /* Only the no-scroll one-viewport decks (body overflow:hidden) get pinned.
     * Scroll pages keep their CSS height so they can grow and scroll normally. */
    if (getComputedStyle(body).overflowY !== 'hidden') {
      docEl.style.removeProperty('height');
      body.style.removeProperty('height');
      return;
    }

    /* Never fight the on-screen keyboard: when a form field is focused the
     * visual viewport shrinks to the area above the keyboard. Leave the last
     * locked height in place so a focused form field doesn't collapse. */
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;

    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    if (!vh) return;
    var px = Math.round(vh) + 'px';
    docEl.style.setProperty('height', px, 'important');
    body.style.setProperty('height', px, 'important');
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Core fit() — computes the fit scale for the fixed canvas, writes --scale */
  /* ─────────────────────────────────────────────────────────────────────── */
  function fit() {
    rafPending = false;

    if (!pane || !stage) return;

    /* Use the pane's CONTENT box (clientWidth/Height minus padding), not the
       padding box. Portrait phones now pad the pane bottom to clear the fixed
       nav strip, and landscape pads the sides for the arrow lane; scaling into
       the padded area would push a scaled slide behind those controls. */
    var pcs  = getComputedStyle(pane);
    var padX = (parseFloat(pcs.paddingLeft) || 0) + (parseFloat(pcs.paddingRight)  || 0);
    var padY = (parseFloat(pcs.paddingTop)  || 0) + (parseFloat(pcs.paddingBottom) || 0);
    var w = pane.clientWidth  - padX;
    var h = pane.clientHeight - padY;
    if (w <= 0 || h <= 0) return;

    /* Fixed design canvas (from CSS --slide-w/--slide-h). Scale = the factor
     * that fits the whole box into the pane on its tighter axis. The pane
     * centers the scaled box (align-items/justify-content: center). */
    var DW = canvasDim('--slide-w', 1280);
    var DH = canvasDim('--slide-h', 720);

    var s = Math.min(w / DW, h / DH);
    s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

    document.documentElement.style.setProperty('--scale', s.toFixed(4));
  }

  /* ── rAF-debounced scheduler ──────────────────────────────────────────── */
  function scheduleFit() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(fit);
  }

  /* ── Combined viewport-change handler ─────────────────────────────────── */
  /* Re-lock the visible height on EVERY deck page, then re-fit the scale.
   * scheduleFit()'s fit() no-ops on pages without the .slide-stage canvas, so
   * this is safe to wire on scroll-content pages (faq, case-studies) too. */
  function onViewportChange() {
    lockViewportHeight();
    scheduleFit();
  }

  /* ── Initialise ──────────────────────────────────────────────────────── */
  function init() {
    pane  = document.querySelector('.slide-pane');
    stage = document.querySelector('.slide-stage');

    /* The viewport-height lock applies to ALL one-viewport deck pages — the 13
     * scale-canvas pages AND the scroll-content pages (faq, case-studies) that
     * have a .slide-pane but NO .slide-stage. Run it + wire the listeners
     * UNCONDITIONALLY so the bottom nav stays visible everywhere; the scale
     * fit() is gated on the canvas separately below. (Previously the lock lived
     * inside fit(), which bails on no-canvas pages — so faq/case-studies never
     * got it and their nav slipped behind mobile browser chrome.) */
    lockViewportHeight();

    // --- Listener: window resize (desktop, most browsers) ---
    window.addEventListener('resize', onViewportChange, { passive: true });

    // --- Listener: visualViewport resize (iOS address-bar show/hide — Bug 2) ---
    // The visual viewport fires when the browser chrome appears/disappears; the
    // layout viewport (window.resize) does NOT. Guard for environments where
    // visualViewport is absent (old browsers, jsdom in tests).
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChange, { passive: true });
    }

    // --- Listener: orientationchange (still fired on some Android devices) ---
    window.addEventListener('orientationchange', onViewportChange, { passive: true });

    // --- Webfont ready: fonts change metrics, which changes natural height ---
    // Run a second pass once fonts are loaded so the first-paint approximation
    // is corrected if webfonts changed the computed line heights.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(onViewportChange);
    }

    // Scale-to-fit only on canvas pages (the 13 slides + cover). Run immediately
    // so the first paint uses the correct scale.
    if (pane && stage) {
      fit();
    }

    // --- Keyboard nav: ← / → / Space advance the deck -------------------------
    // Drives the new fixed side arrows (.deck-arrow-prev / .deck-arrow-next).
    // → and Space go next; ← goes prev. No-ops on pages without those anchors
    // (faq / case-studies / contact have only a prev arrow, so Space still
    // page-scrolls there), and never hijacks keys while a form field is focused
    // or a modifier is held (browser shortcuts and text-caret movement intact).
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;

      var sel = (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar') ? '.deck-arrow-next'
              : e.key === 'ArrowLeft'  ? '.deck-arrow-prev'
              : null;
      if (!sel) return;

      var link = document.querySelector(sel);
      if (link && link.getAttribute('href')) {
        e.preventDefault();
        window.location.href = link.href;
      }
    });
  }

  /* ── Boot ────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already parsed (script deferred or appended dynamically).
    init();
  }

})();
