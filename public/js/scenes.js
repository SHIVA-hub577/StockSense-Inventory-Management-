/**
 * Action scenes: a short animation after an operation step succeeds, before
 * the page moves on. A truck unloads at the dock (receipt), a box is picked
 * off the rack, taped shut, loaded and driven away (delivery), a forklift
 * moves a pallet (transfer), the count sheet gets ticked (count), purchase
 * orders fly to suppliers (replenishment), and a rubber stamp says what
 * happened. Click or press any key to skip. Skipped entirely for reduced motion.
 *
 *   await StockSense.scenes.play({ action, type, operation, count })
 */
(function () {
  'use strict';

  const S = window.StockSense || (window.StockSense = {});
  const gsap = window.gsap;
  const GROUND = 196;

  /* ----------------------------- drawings ---------------------------- */

  const defs = `
    <defs>
      <pattern id="scDots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" class="sc-dot"/></pattern>
      <pattern id="scHazard" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="12" fill="#ffb020"/><rect x="6" width="6" height="12" fill="#15171b"/></pattern>
    </defs>
    <rect width="440" height="240" fill="url(#scDots)"/>`;

  const ground = `<path d="M0 ${GROUND + 1} H440" class="sc-stroke-line" stroke-width="2"/>`;

  const wheel = (x, y, r = 12) => `
    <g transform="translate(${x} ${y})"><g class="sc-wheel">
      <circle r="${r}" class="sc-ink"/><circle r="${r * 0.38}" class="sc-surface"/><rect x="-1.2" y="${-r + 2}" width="2.4" height="${r * 0.45}" class="sc-surface"/>
    </g></g>`;

  // Box truck facing right; 160 wide, wheels touch y = 90
  const truck = () => `
    <rect class="sc-surface sc-stroke" x="0" y="8" width="108" height="62" rx="6"/>
    <rect class="sc-accent" x="1.5" y="46" width="105" height="8"/>
    <text x="12" y="33" class="sc-ink sc-mono" font-size="10" font-weight="600" letter-spacing="1.6">STOCKSENSE</text>
    <path class="sc-accent sc-stroke" d="M110 28 H138 L158 50 V72 H110 Z"/>
    <path class="sc-sunken sc-stroke" stroke-width="2" d="M117 35 H135 L148 50 H117 Z"/>
    <rect class="sc-ink" x="0" y="70" width="160" height="5" rx="2"/>
    <rect class="sc-ink" x="152" y="62" width="9" height="6" rx="1.5"/>
    ${wheel(30, 78)}${wheel(130, 78)}`;

  // Cardboard box, 30 x 24 at (0,0)
  const box = (cls = '') => `
    <g class="${cls}">
      <rect width="30" height="24" rx="2" fill="#d8a863" class="sc-stroke" stroke-width="2"/>
      <rect x="12" y="1" width="6" height="22" fill="#f3d9a4"/>
      <path d="M4 17 H9" stroke="#8a5d22" stroke-width="1.5" stroke-linecap="round"/>
    </g>`;

  const building = (x, w = 120) => `
    <path class="sc-sunken sc-stroke" d="M${x} ${GROUND} V96 L${x + w / 2} 66 L${x + w} 96 V${GROUND} Z"/>
    <rect class="sc-ink" x="${x + 22}" y="118" width="${w - 44}" height="${GROUND - 118}" rx="3"/>
    <rect class="sc-line2" x="${x + 22}" y="118" width="${w - 44}" height="18"/>
    <path d="M${x + 22} 124 H${x + w - 22} M${x + 22} 130 H${x + w - 22}" class="sc-stroke-muted" stroke-width="1.5"/>
    <rect x="${x + 16}" y="${GROUND - 6}" width="${w - 32}" height="6" fill="url(#scHazard)"/>`;

  const sheet = (lines = 4) => `
    <rect class="sc-surface sc-stroke" x="0" y="0" width="120" height="150" rx="8"/>
    <rect class="sc-accent" x="14" y="16" width="40" height="8" rx="4"/>
    ${Array.from({ length: lines }, (_, i) => `<rect class="sc-line" x="14" y="${40 + i * 22}" width="${i % 2 ? 70 : 92}" height="7" rx="3.5"/>`).join('')}`;

  const stamp = (text, tone) => `
    <g transform="translate(220 96)"><g id="scStamp" class="sc-stamp st-${tone}" opacity="0">
      <rect x="${-text.length * 12 - 22}" y="-28" width="${text.length * 24 + 44}" height="56" rx="9" fill="none" stroke-width="5"/>
      <rect x="${-text.length * 12 - 14}" y="-20" width="${text.length * 24 + 28}" height="40" rx="6" fill="none" stroke-width="2"/>
      <text text-anchor="middle" y="11" class="sc-display" font-size="31" font-weight="800" letter-spacing="3">${text}</text>
    </g></g>`;

  /* ------------------------------ scenes ----------------------------- */

  // Each scene returns { svg, build(tl, q) } where q(sel) finds elements in the scene
  const SCENES = {
    received: () => ({
      title: 'Stock received',
      svg: `${ground}${building(300)}
        <g id="scTruck"><g transform="translate(0 ${GROUND - 90})">${truck()}</g></g>
        <g transform="translate(168 146)">${box('sc-cargo')}</g>
        <g transform="translate(196 146)">${box('sc-cargo')}</g>
        <g transform="translate(182 124)">${box('sc-cargo')}</g>
        ${stamp('RECEIVED', 'ok')}`,
      build(tl, q) {
        tl.set(q('.sc-cargo'), { opacity: 0 })
          .fromTo(q('#scTruck'), { x: -200 }, { x: 118, duration: 0.95, ease: 'power3.out' })
          .fromTo(q('.sc-wheel'), { rotation: 0 }, { rotation: 900, duration: 0.95, ease: 'power3.out', transformOrigin: '50% 50%' }, '<')
          .set(q('.sc-cargo'), { opacity: 1, x: -18 })
          .to(q('.sc-cargo'), { keyframes: [{ x: 60, y: -14, duration: 0.22, ease: 'power1.out' }, { x: 165, y: 22, duration: 0.3, ease: 'power1.in' }, { opacity: 0, scale: 0.7, duration: 0.12 }], stagger: 0.14 });
      },
    }),

    shipped: () => ({
      title: 'Out for delivery',
      svg: `${ground}
        <g id="scRoad">${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 40 - 60}" y="${GROUND + 12}" width="22" height="4" rx="2" class="sc-line2"/>`).join('')}</g>
        ${building(10)}
        <g id="scTruck"><g transform="translate(150 ${GROUND - 90})">${truck()}</g></g>
        <g id="scPuffs">${[0, 1, 2].map((i) => `<circle cx="146" cy="${GROUND - 14}" r="${6 + i * 2}" class="sc-line2 sc-puff"/>`).join('')}</g>
        <g transform="translate(55 172)">${box('sc-parcel')}</g>
        ${stamp('SHIPPED', 'ink')}`,
      build(tl, q) {
        tl.set(q('.sc-puff'), { opacity: 0 })
          .to(q('.sc-parcel'), { keyframes: [{ x: 60, y: -52, duration: 0.3, ease: 'power2.out' }, { x: 132, y: -30, duration: 0.25, ease: 'power2.in' }, { opacity: 0, duration: 0.1 }] })
          .to(q('#scTruck'), { y: 3, duration: 0.08, yoyo: true, repeat: 1 })
          .to(q('.sc-puff'), { opacity: 0.8, x: -30, scale: 1.8, duration: 0.5, stagger: 0.08, ease: 'power1.out', transformOrigin: '50% 50%' })
          .to(q('.sc-puff'), { opacity: 0, duration: 0.3 }, '-=0.2')
          .to(q('#scTruck'), { x: 460, duration: 1.0, ease: 'power2.in' }, '-=0.55')
          .to(q('.sc-wheel'), { rotation: 1080, duration: 1.0, ease: 'power2.in', transformOrigin: '50% 50%' }, '<')
          .to(q('#scRoad'), { x: -120, duration: 1.0, ease: 'power2.in' }, '<');
      },
    }),

    picked: () => ({
      title: 'Picked from the rack',
      svg: `${ground}
        <path class="sc-stroke" d="M50 ${GROUND} V60 M270 ${GROUND} V60" stroke-width="5"/>
        <path class="sc-stroke" d="M50 108 H270 M50 156 H270" stroke-width="4"/>
        ${[0, 1, 2, 3].map((i) => `<g transform="translate(${66 + i * 50} 84)">${box()}</g>`).join('')}
        ${[0, 1, 3].map((i) => `<g transform="translate(${66 + i * 50} 132)">${box()}</g>`).join('')}
        <g transform="translate(166 132)"><g id="scTarget">${box()}</g></g>
        <path class="sc-surface sc-stroke" d="M320 150 H412 L402 188 H330 Z"/>
        ${wheel(338, 192, 6)}${wheel(394, 192, 6)}
        <g id="scGun" transform="translate(360 70)"><path class="sc-ink" d="M0 0 H42 V16 H18 L12 38 H2 L6 16 H0 Z"/><rect x="-4" y="4" width="6" height="8" rx="1" fill="#ff3b3b"/></g>
        <line id="scBeam" x1="356" y1="78" x2="196" y2="144" stroke="#ff3b3b" stroke-width="3" stroke-linecap="round" opacity="0"/>
        ${stamp('PICKED', 'accent')}`,
      build(tl, q) {
        tl.from(q('#scGun'), { x: 60, opacity: 0, duration: 0.35, ease: 'power2.out' })
          .to(q('#scBeam'), { opacity: 1, duration: 0.05, repeat: 5, yoyo: true })
          .to(q('#scTarget rect'), { stroke: '#ffb020', strokeWidth: 3, duration: 0.1 }, '<')
          .to(q('#scBeam'), { opacity: 0, duration: 0.1 })
          .to(q('#scTarget'), { keyframes: [{ y: -34, duration: 0.25, ease: 'power2.out' }, { x: 190, y: 10, duration: 0.45, ease: 'power2.inOut' }] });
      },
    }),

    packed: () => ({
      title: 'Packed and taped',
      svg: `${ground}
        <g id="scBox">
          <rect x="160" y="112" width="120" height="84" rx="4" fill="#d8a863" class="sc-stroke"/>
          <rect x="160" y="112" width="120" height="14" fill="#c8964e"/>
          <g transform="translate(160 112)"><g id="scFlapL"><rect x="0" y="-4" width="60" height="8" rx="2" fill="#e2b574" class="sc-stroke" stroke-width="2"/></g></g>
          <g transform="translate(280 112)"><g id="scFlapR"><rect x="-60" y="-4" width="60" height="8" rx="2" fill="#e2b574" class="sc-stroke" stroke-width="2"/></g></g>
          <line id="scTape" x1="150" y1="112" x2="290" y2="112" stroke="#f3d9a4" stroke-width="12" stroke-linecap="round" stroke-dasharray="140" stroke-dashoffset="140"/>
          <g transform="translate(196 142)"><g id="scLabel" opacity="0">
            <rect width="48" height="34" rx="3" class="sc-paper sc-stroke" stroke-width="1.5"/>
            ${[4, 8, 10, 14, 17, 21, 25, 27, 31, 35, 38, 42].map((x, i) => `<rect x="${x}" y="6" width="${i % 3 ? 1.5 : 2.5}" height="16" class="sc-ink-fixed"/>`).join('')}
            <rect x="4" y="26" width="26" height="3" rx="1.5" class="sc-ink-fixed"/>
          </g></g>
        </g>
        ${stamp('PACKED', 'accent')}`,
      build(tl, q) {
        tl.set(q('#scFlapL'), { rotation: -125, transformOrigin: '0% 50%' })
          .set(q('#scFlapR'), { rotation: 125, transformOrigin: '100% 50%' })
          .from(q('#scBox'), { y: 30, opacity: 0, duration: 0.3, ease: 'power2.out' })
          .to(q('#scFlapL'), { rotation: 0, duration: 0.3, ease: 'back.out(2)' })
          .to(q('#scFlapR'), { rotation: 0, duration: 0.3, ease: 'back.out(2)' }, '-=0.12')
          .to(q('#scTape'), { attr: { 'stroke-dashoffset': 0 }, duration: 0.4, ease: 'power2.inOut' })
          .fromTo(q('#scLabel'), { opacity: 0, scale: 1.8, rotation: -14, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, rotation: -4, duration: 0.22, ease: 'power3.in' })
          .to(q('#scBox'), { y: 2, duration: 0.06, yoyo: true, repeat: 1 });
      },
    }),

    moved: () => ({
      title: 'Moved between locations',
      svg: `${ground}
        <path class="sc-stroke" d="M30 ${GROUND} V80 M100 ${GROUND} V80 M30 132 H100" stroke-width="4"/>
        <path class="sc-stroke" d="M340 ${GROUND} V80 M410 ${GROUND} V80 M340 132 H410" stroke-width="4"/>
        <text x="65" y="72" text-anchor="middle" class="sc-muted sc-mono" font-size="11" font-weight="600">RACK A</text>
        <text x="375" y="72" text-anchor="middle" class="sc-muted sc-mono" font-size="11" font-weight="600">RACK B</text>
        <g id="scLift"><g transform="translate(96 ${GROUND - 70})">
          <rect x="40" y="26" width="60" height="30" rx="5" class="sc-accent sc-stroke"/>
          <path d="M52 26 V2 H86 V26" fill="none" class="sc-stroke" stroke-width="3"/>
          <rect x="30" y="-10" width="7" height="66" class="sc-ink"/>
          <g id="scForks"><rect x="-6" y="44" width="40" height="5" class="sc-ink"/>
            <rect x="-4" y="38" width="36" height="6" class="sc-line2 sc-stroke" stroke-width="1.5"/>
            <g transform="translate(0 14)">${box()}</g></g>
          ${wheel(52, 60, 10)}${wheel(90, 60, 10)}
        </g></g>
        ${stamp('MOVED', 'info')}`,
      build(tl, q) {
        tl.to(q('#scForks'), { y: -8, duration: 0.25, ease: 'power2.out' })
          .to(q('#scLift'), { x: 210, duration: 1.0, ease: 'power2.inOut' })
          .to(q('.sc-wheel'), { rotation: 540, duration: 1.0, ease: 'power2.inOut', transformOrigin: '50% 50%' }, '<')
          .to(q('#scForks'), { y: 0, duration: 0.25, ease: 'power2.in' });
      },
    }),

    applied: () => ({
      title: 'Count applied',
      svg: `<g transform="translate(160 42)"><g id="scSheet">
          ${sheet(0)}
          <rect x="44" y="-10" width="32" height="16" rx="4" class="sc-accent sc-stroke" stroke-width="2"/>
          ${[0, 1, 2, 3].map((i) => `<rect class="sc-line" x="40" y="${40 + i * 26}" width="${i % 2 ? 50 : 66}" height="7" rx="3.5"/>
            <rect x="14" y="${35 + i * 26}" width="16" height="16" rx="4" class="sc-surface sc-stroke" stroke-width="2"/>
            <path class="sc-tick" d="M17 ${43 + i * 26} l4 4 l7 -8" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="20" stroke-dashoffset="20"/>`).join('')}
        </g></g>
        ${stamp('APPLIED', 'ok')}`,
      build(tl, q) {
        tl.from(q('#scSheet'), { y: 20, opacity: 0, duration: 0.3, ease: 'power2.out' }).to(q('.sc-tick'), { attr: { 'stroke-dashoffset': 0 }, duration: 0.18, stagger: 0.16, ease: 'power1.out' });
      },
    }),

    ready: (d) => ({
      title: d.waiting ? 'Waiting for stock' : 'Ready to process',
      svg: `<g transform="translate(160 42)"><g id="scSheet">${sheet(4)}</g></g>
        ${d.waiting
          ? `<g transform="translate(300 60)"><g id="scGlass"><path class="sc-surface sc-stroke" d="M0 0 H40 L20 30 L40 60 H0 L20 30 Z"/><path class="sc-warnfill" d="M8 6 H32 L20 24 Z"/></g></g>`
          : `<circle cx="278" cy="160" r="26" class="sc-okfill"/><path id="scCheck" d="M266 160 l8 8 l15 -17" fill="none" class="sc-stroke-canvas" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="40" stroke-dashoffset="40"/>`}
        ${stamp(d.waiting ? 'WAITING' : 'READY', d.waiting ? 'warn' : 'info')}`,
      build(tl, q) {
        tl.from(q('#scSheet'), { y: 20, opacity: 0, duration: 0.3, ease: 'power2.out' });
        if (q('#scGlass').length) tl.to(q('#scGlass'), { rotation: 180, transformOrigin: '50% 50%', duration: 0.6, ease: 'back.inOut(2)' });
        else tl.from(q('circle.sc-okfill'), { scale: 0, transformOrigin: '50% 50%', duration: 0.3, ease: 'back.out(2)' }).to(q('#scCheck'), { attr: { 'stroke-dashoffset': 0 }, duration: 0.3 });
      },
    }),

    submitted: () => ({
      title: 'Sent to a manager for approval',
      svg: `<g transform="translate(90 60)"><g id="scEnvelope">
          <rect width="120" height="80" rx="8" class="sc-surface sc-stroke"/>
          <path d="M4 6 L60 46 L116 6" fill="none" class="sc-stroke"/>
        </g></g>
        <g transform="translate(330 70)"><circle r="26" class="sc-accent"/><text y="7" text-anchor="middle" class="sc-ink sc-mono" font-size="16" font-weight="700">MGR</text></g>
        ${stamp('SUBMITTED', 'info')}`,
      build(tl, q) {
        tl.from(q('#scEnvelope'), { opacity: 0, y: 20, duration: 0.25 }).to(q('#scEnvelope'), { keyframes: [{ x: 90, y: -40, rotation: -8, scale: 0.8, duration: 0.35, ease: 'power1.out' }, { x: 190, y: -20, rotation: 6, scale: 0.35, opacity: 0, duration: 0.35, ease: 'power1.in' }], transformOrigin: '50% 50%' });
      },
    }),

    void: () => ({
      title: 'Canceled - no stock changed',
      svg: `<g transform="translate(160 42)"><g id="scDoc">${sheet(4)}</g></g>${stamp('VOID', 'bad')}`,
      build(tl, q) {
        tl.from(q('#scDoc'), { y: 20, opacity: 0, duration: 0.25 });
      },
      after(tl, q) {
        tl.to(q('#scDoc'), { opacity: 0.5, duration: 0.3 });
      },
    }),

    draft: () => ({
      title: 'Back to draft',
      svg: `<g transform="translate(160 42)"><g id="scDoc">${sheet(4)}</g></g>
        <g transform="translate(300 40)"><g id="scPencil"><path class="sc-accent sc-stroke" d="M0 60 L50 10 L62 22 L12 72 Z"/><path class="sc-ink" d="M0 60 L12 72 L-4 76 Z"/></g></g>
        ${stamp('DRAFT', 'muted')}`,
      build(tl, q) {
        tl.from(q('#scDoc'), { y: 20, opacity: 0, duration: 0.25 }).from(q('#scPencil'), { x: 40, y: -30, opacity: 0, duration: 0.35, ease: 'back.out(2)' }).to(q('#scPencil'), { x: -12, y: 6, yoyo: true, repeat: 3, duration: 0.09 });
      },
    }),

    copy: () => ({
      title: 'Copy created as a new draft',
      svg: `<g transform="translate(150 46)"><g id="scBack">${sheet(4)}</g></g>
        <g transform="translate(150 46)"><g id="scFront">${sheet(4)}</g></g>
        ${stamp('COPY', 'info')}`,
      build(tl, q) {
        tl.from(q('#scBack'), { opacity: 0, duration: 0.2 }).to(q('#scFront'), { x: 36, y: 10, rotation: 6, duration: 0.45, ease: 'back.out(1.6)', transformOrigin: '50% 100%' });
      },
    }),

    ordered: (d) => {
      const n = Math.max(1, Math.min(5, d.count || 1));
      return {
        title: `${n === 1 ? 'Purchase order' : `${n} purchase orders`} sent`,
        svg: `${ground}
          <g transform="translate(40 60)">${sheet(3).replace('width="120" height="150"', 'width="96" height="126"')}</g>
          ${Array.from({ length: n }, (_, i) => `<g transform="translate(80 110)"><g class="sc-plane">
              <path class="sc-surface sc-stroke" stroke-width="2" d="M0 12 L44 0 L20 26 Z"/><path class="sc-line2 sc-stroke" stroke-width="2" d="M20 26 L22 14 L44 0"/>
            </g></g>`).join('')}
          <g transform="translate(270 ${GROUND - 90})"><g id="scTruck">${truck()}</g></g>
          ${stamp('ORDERED', 'accent')}`,
        build(tl, q) {
          tl.from(q('#scTruck'), { x: 200, duration: 0.6, ease: 'power3.out' })
            .from(q('.sc-wheel'), { rotation: -540, duration: 0.6, ease: 'power3.out', transformOrigin: '50% 50%' }, '<')
            .to(q('.sc-plane'), { keyframes: [{ x: 90, y: -70, rotation: -10, duration: 0.35, ease: 'power1.out' }, { x: 250, y: -20, rotation: 12, scale: 0.6, duration: 0.4, ease: 'power1.in' }, { opacity: 0, duration: 0.1 }], stagger: 0.12, transformOrigin: '50% 50%' }, '-=0.2');
        },
      };
    },
  };

  function pick({ action, type, operation, count }) {
    if (action === 'validate') return { receipt: 'received', delivery: 'shipped', internal: 'moved', adjustment: 'applied' }[type];
    if (action === 'confirm') return type === 'adjustment' ? 'submitted' : 'ready';
    return { pick: 'picked', pack: 'packed', cancel: 'void', reset: 'draft', duplicate: 'copy', replenish: 'ordered' }[action];
  }

  /* ------------------------------- stage ----------------------------- */

  let playing = null;

  function play(opts = {}) {
    const key = pick(opts);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!key || !gsap || reduced || playing) return Promise.resolve();
    const data = { waiting: opts.operation && opts.operation.status === 'waiting', count: opts.count };
    const scene = SCENES[key](data);

    return new Promise((resolve) => {
      const stage = document.createElement('div');
      stage.className = 'scene-stage';
      stage.setAttribute('role', 'status');
      stage.setAttribute('aria-live', 'assertive');
      stage.innerHTML = `
        <div class="scene-card">
          <svg viewBox="0 0 440 240" aria-hidden="true">${defs}${scene.svg}</svg>
          <div class="scene-caption">
            <div class="min-w-0">
              <p class="font-display text-lg font-bold leading-tight">${scene.title}</p>
              ${opts.operation && opts.operation.reference ? `<p class="font-mono text-xs text-muted mt-0.5">${String(opts.operation.reference).replace(/[<>&]/g, '')}</p>` : ''}
            </div>
            <span class="text-xs text-muted whitespace-nowrap">Click to skip</span>
          </div>
        </div>`;
      document.body.appendChild(stage);
      const card = stage.querySelector('.scene-card');
      const root = stage.querySelector('svg');
      const q = (sel) => gsap.utils.toArray(root.querySelectorAll(sel));

      const tl = gsap.timeline({ paused: true });
      tl.from(card, { y: 24, scale: 0.94, opacity: 0, duration: 0.35, ease: 'back.out(1.6)' });
      scene.build(tl, q);
      tl.fromTo(q('#scStamp'), { opacity: 0, scale: 2.6, rotation: 4, transformOrigin: '50% 50%' }, { opacity: 0.92, scale: 1, rotation: -10, duration: 0.24, ease: 'power4.in' }, '+=0.05')
        .to(card, { x: 5, duration: 0.045, yoyo: true, repeat: 5, ease: 'none' })
        .set(card, { x: 0 });
      if (scene.after) scene.after(tl, q);
      tl.to({}, { duration: 0.55 }); // hold so the stamp can be read

      playing = tl;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        playing = null;
        document.removeEventListener('keydown', skip, true);
        stage.classList.add('is-leaving');
        setTimeout(() => stage.remove(), 200);
        resolve();
      };
      const skip = () => {
        tl.progress(1);
        done();
      };
      tl.eventCallback('onComplete', done);
      stage.addEventListener('click', skip);
      document.addEventListener('keydown', skip, true);
      tl.play();
    });
  }

  S.scenes = { play, list: Object.keys(SCENES) };
})();
