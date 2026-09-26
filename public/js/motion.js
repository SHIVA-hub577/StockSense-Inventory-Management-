/**
 * Page motion (GSAP): scroll reveals, number count-ups, 3D tilt cards,
 * magnetic buttons, click ripples and "dropping pallets" on floor plans.
 * Everything is skipped when the user prefers reduced motion, and nothing is
 * hidden unless this script runs (no invisible content if it fails to load).
 */
(function () {
  'use strict';

  const S = window.StockSense || {};
  const gsap = window.gsap;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ------------------------------ ripples ---------------------------- */

  // Works without GSAP: a CSS ripple from the click point on every button
  document.addEventListener('pointerdown', (e) => {
    if (reduced || e.button !== 0) return;
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  });

  if (reduced || !gsap) return;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

  /* --------------------------- count-ups ----------------------------- */

  function countUp(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    const target = Number(el.dataset.countTo);
    if (!Number.isFinite(target) || target === 0) return;
    const finalText = el.textContent;
    const decimals = (String(el.dataset.countTo).split('.')[1] || '').length;
    const state = { v: 0 };
    gsap.to(state, {
      v: target,
      duration: Math.min(1.4, 0.6 + Math.log10(Math.abs(target) + 1) * 0.25),
      ease: 'power3.out',
      onUpdate: () => {
        el.textContent = state.v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      },
      onComplete: () => {
        el.textContent = finalText; // exact server formatting at the end
      },
    });
  }

  /* ---------------------------- reveals ------------------------------ */

  const pending = [...document.querySelectorAll('[data-reveal]')];
  pending.forEach((el) => el.classList.add('reveal-pending'));

  function reveal(batch) {
    gsap.to(batch, {
      opacity: 1,
      y: 0,
      duration: 0.55,
      ease: 'power3.out',
      stagger: 0.045,
      overwrite: 'auto',
      onStart() {
        batch.forEach((el) => {
          el.classList.remove('reveal-pending');
          el.querySelectorAll('[data-count-to]').forEach(countUp);
          if (el.matches('[data-count-to]')) countUp(el);
        });
      },
      clearProps: 'transform,opacity',
    });
  }

  if ('IntersectionObserver' in window && pending.length) {
    gsap.set(pending, { opacity: 0, y: 14 });
    // Reveal in batches as blocks scroll in; anything already above the viewport shows at once.
    // (Blocks inside hidden panes reveal when the pane is shown.)
    const io = new IntersectionObserver(
      (entries) => {
        const batch = entries.filter((e) => e.isIntersecting || e.boundingClientRect.bottom < 0).map((e) => e.target);
        if (!batch.length) return;
        batch.forEach((el) => io.unobserve(el));
        reveal(batch);
      },
      { rootMargin: '0px 0px -6% 0px' }
    );
    pending.forEach((el) => io.observe(el));
  } else {
    pending.forEach((el) => el.classList.remove('reveal-pending'));
  }
  // Count-ups outside reveal blocks
  document.querySelectorAll('[data-count-to]').forEach((el) => {
    if (!el.closest('[data-reveal]')) countUp(el);
  });

  /* ------------------------------ tilt ------------------------------- */

  function tilt(el) {
    if (!finePointer || el.dataset.tiltBound) return;
    el.dataset.tiltBound = '1';
    el.style.transformStyle = 'preserve-3d';
    const glare = document.createElement('span');
    glare.className = 'tilt-glare';
    el.appendChild(glare);
    const rx = gsap.quickTo(el, 'rotationX', { duration: 0.4, ease: 'power3.out' });
    const ry = gsap.quickTo(el, 'rotationY', { duration: 0.4, ease: 'power3.out' });
    // (set on enter: the reveal animation clears transforms when it finishes)
    el.addEventListener('pointerenter', () => gsap.set(el, { transformPerspective: 700 }));
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx(-py * 7);
      ry(px * 9);
      glare.style.setProperty('--gx', `${(px + 0.5) * 100}%`);
      glare.style.setProperty('--gy', `${(py + 0.5) * 100}%`);
      glare.style.opacity = '1';
    });
    el.addEventListener('pointerleave', () => {
      rx(0);
      ry(0);
      glare.style.opacity = '0';
    });
  }
  document.querySelectorAll('[data-tilt]').forEach(tilt);

  /* ---------------------------- magnetic ----------------------------- */

  function magnetic(el) {
    if (!finePointer || el.dataset.magneticBound) return;
    el.dataset.magneticBound = '1';
    const x = gsap.quickTo(el, 'x', { duration: 0.35, ease: 'power3.out' });
    const y = gsap.quickTo(el, 'y', { duration: 0.35, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      x((e.clientX - (r.left + r.width / 2)) * 0.18);
      y((e.clientY - (r.top + r.height / 2)) * 0.3);
    });
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    });
  }
  document.querySelectorAll('[data-magnetic]').forEach(magnetic);

  /* ------------------------- floor plans ----------------------------- */

  // Pallet stacks drop onto the warehouse floor the first time they scroll in
  document.querySelectorAll('svg.iso').forEach((svg) => {
    const cells = svg.querySelectorAll('.iso-cell');
    gsap.set(cells, { opacity: 0, y: -40 });
    const run = () =>
      gsap.to(cells, { opacity: 1, y: 0, duration: 0.7, ease: 'bounce.out', stagger: { each: 0.05, from: 'start' }, clearProps: 'transform' });
    if (window.ScrollTrigger) ScrollTrigger.create({ trigger: svg, start: 'top 90%', once: true, onEnter: run });
    else run();
  });

  /* ------------------------ route vehicle ---------------------------- */

  // The truck on an operation page rolls to where the job is
  const vehicle = document.querySelector('[data-route-vehicle]');
  const fill = document.querySelector('[data-route-fill]');
  if (vehicle && fill) {
    const left = vehicle.style.left;
    const width = fill.style.width;
    gsap.fromTo(vehicle, { left: '6%' }, { left, duration: 1.1, ease: 'power2.inOut', delay: 0.15 });
    gsap.fromTo(fill, { width: '0%' }, { width, duration: 1.1, ease: 'power2.inOut', delay: 0.15 });
  }

  /* ------------------------- live updates ---------------------------- */

  // Content swapped in by live refresh / Time Machine: small fade so it doesn't just pop
  const soften = (root) => {
    if (!root) return;
    gsap.fromTo(root.children, { opacity: 0.35 }, { opacity: 1, duration: 0.35, ease: 'power1.out', stagger: 0.02 });
  };
  document.addEventListener('stocksense:content-updated', (e) => soften(e.detail && e.detail.root));
  // Live refresh swaps HTML in place: wire up tilt / magnetic on the new elements
  document.addEventListener('stocksense:regions-updated', () => {
    document.querySelectorAll('[data-tilt]').forEach(tilt);
    document.querySelectorAll('[data-magnetic]').forEach(magnetic);
  });

  S.motion = { countUp, reveal };
})();
