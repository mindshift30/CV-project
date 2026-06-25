/* ============================================================
   AI Fighting Deforestation — script.js
   Intersection Observer · Comparison Slider · Stat Counters
   Navbar scroll effect · Mobile nav toggle
   ============================================================ */

(function () {
  'use strict';

  /* ── Helpers ──────────────────────────────────────────── */
  const qs  = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ── 1. Navbar Scroll Effect ──────────────────────────── */
  const navbar = qs('#navbar');

  function handleNavScroll () {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }

  window.addEventListener('scroll', handleNavScroll, { passive: true });
  handleNavScroll(); // run once on load

  /* ── 2. Mobile Nav Toggle ─────────────────────────────── */
  const navToggle = qs('#nav-toggle');

  navToggle.addEventListener('click', () => {
    const isOpen = navbar.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close mobile nav when a link is clicked
  qsa('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
      navbar.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ── 3. Scroll Reveal (Intersection Observer) ─────────── */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target); // trigger once
        }
      });
    },
    { threshold: 0.12 }
  );

  qsa('.reveal').forEach(el => revealObserver.observe(el));

  /* ── 4. Stat Counters ─────────────────────────────────── */

  /**
   * Format a number for display:
   *  - >= 1 billion  → "15B"
   *  - >= 1 million  → "90M"
   *  - >= 1 thousand → "15K"
   *  - otherwise     → toLocaleString
   */
  function formatNumber (n) {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(0) + 'B';
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(0) + 'M';
    if (n >= 1_000)         return (n / 1_000).toFixed(0) + 'K';
    return n.toLocaleString();
  }

  /** Ease-out cubic */
  function easeOut (t) { return 1 - Math.pow(1 - t, 3); }

  function animateCounter (el, target, suffix, duration) {
    const start = performance.now();

    function step (now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const value = Math.round(easeOut(progress) * target);
      el.textContent = formatNumber(value) + suffix;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = formatNumber(target) + suffix;
        el.classList.remove('counting');
      }
    }

    el.classList.add('counting');
    requestAnimationFrame(step);
  }

  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.target, 10);
        const suffix = el.dataset.suffix || '';
        animateCounter(el, target, suffix, 2200);
        counterObserver.unobserve(el); // count only once
      });
    },
    { threshold: 0.4 }
  );

  qsa('.stat-number').forEach(el => counterObserver.observe(el));

  /* ── 5. Comparison Slider ─────────────────────────────── */
  const sliderWrapper = qs('#comparison-slider');
  const afterPanel    = qs('#after-panel');
  const handle        = qs('#slider-handle');

  if (sliderWrapper && afterPanel && handle) {
    let isDragging = false;

    /** Clamp x percentage [2, 98] and apply to after-panel */
    function setSliderPosition (clientX) {
      const rect = sliderWrapper.getBoundingClientRect();
      const raw  = (clientX - rect.left) / rect.width * 100;
      const pct  = Math.min(98, Math.max(2, raw));

      // Clip the after-panel so only [0 .. pct] is visible
      afterPanel.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;

      // Move the handle line
      handle.style.left = `${pct}%`;

      // Update ARIA
      handle.setAttribute('aria-valuenow', Math.round(pct));
    }

    // Initialise at 50%
    setSliderPosition(
      sliderWrapper.getBoundingClientRect().left +
      sliderWrapper.getBoundingClientRect().width / 2
    );

    /* Mouse events */
    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      handle.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      setSliderPosition(e.clientX);
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      handle.classList.remove('dragging');
    });

    /* Touch events */
    handle.addEventListener('touchstart', (e) => {
      isDragging = true;
      handle.classList.add('dragging');
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      setSliderPosition(e.touches[0].clientX);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      isDragging = false;
      handle.classList.remove('dragging');
    });

    /* Keyboard accessibility — arrow keys move ±5% */
    handle.addEventListener('keydown', (e) => {
      const current = parseFloat(handle.getAttribute('aria-valuenow')) || 50;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        const rect = sliderWrapper.getBoundingClientRect();
        setSliderPosition(rect.left + rect.width * ((current - 5) / 100));
        e.preventDefault();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        const rect = sliderWrapper.getBoundingClientRect();
        setSliderPosition(rect.left + rect.width * ((current + 5) / 100));
        e.preventDefault();
      }
    });

    /* Re-initialise on window resize (rect changes) */
    window.addEventListener('resize', () => {
      const current = parseFloat(handle.getAttribute('aria-valuenow')) || 50;
      const rect = sliderWrapper.getBoundingClientRect();
      setSliderPosition(rect.left + rect.width * (current / 100));
    }, { passive: true });
  }

})();
