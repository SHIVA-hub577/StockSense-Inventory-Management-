/**
 * Landing page: smooth scrolling (Lenis) wired to GSAP ScrollTrigger, the
 * hero headline reveal, a sticky nav that solidifies on scroll, the story
 * progress rail and the small live demos inside the feature cards.
 * The 3D warehouse itself lives in landing3d.js.
 */
(function () {
  'use strict';

  const gsap = window.gsap;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.getElementById('landingNav');

  /* ------------------------------- nav ------------------------------- */

  const solid = () => {
    const on = window.scrollY > 12;
    nav.classList.toggle('bg-canvas/85', on);
    nav.classList.toggle('backdrop-blur-md', on);
    nav.classList.toggle('border-line', on);
    nav.classList.toggle('shadow-card', on);
  };
  solid();
  window.addEventListener('scroll', solid, { passive: true });

  /* ----------------------------- smooth scroll ------------------------ */

  let lenis = null;
  if (!reduced && window.Lenis && gsap && window.ScrollTrigger) {
    gsap.registerPlugin(window.ScrollTrigger);
    lenis = new window.Lenis({ lerp: 0.11, wheelMultiplier: 1 });
    lenis.on('scroll', window.ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    document.documentElement.classList.add('lenis');
  }
  // In-page links glide instead of jumping
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: -64, duration: 1.2 });
    else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

  if (!gsap || reduced) return;

  /* ------------------------------ hero ------------------------------- */

  // Split the headline into words that rise into place
  document.querySelectorAll('[data-split]').forEach((el) => {
    const words = [];
    const wrap = (node) => {
      const outer = document.createElement('span');
      outer.className = 'inline-block overflow-hidden align-bottom pb-[0.08em] -mb-[0.08em]';
      const inner = document.createElement('span');
      inner.className = 'inline-block will-change-transform';
      inner.appendChild(node);
      outer.appendChild(inner);
      words.push(inner);
      return outer;
    };
    [...el.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          frag.appendChild(/^\s+$/.test(part) ? document.createTextNode(part) : wrap(document.createTextNode(part)));
        });
        node.replaceWith(frag);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // e.g. <em>: split its words too, keeping the element's styling
        const clone = node.cloneNode(false);
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          clone.appendChild(/^\s+$/.test(part) ? document.createTextNode(part) : wrap(document.createTextNode(part)));
        });
        node.replaceWith(clone);
      }
    });
    gsap.from(words, { yPercent: 110, rotation: 4, duration: 0.9, ease: 'power4.out', stagger: 0.06, delay: 0.1 });
  });
  gsap.from('[data-hero-in]', { y: 18, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.1, delay: 0.35 });

  /* ------------------------------ story ------------------------------ */

  const rail = document.getElementById('storyRail');
  if (rail && window.ScrollTrigger) {
    gsap.to(rail, {
      scaleY: 1,
      ease: 'none',
      scrollTrigger: { trigger: '#story', start: 'top center', end: 'bottom center', scrub: true },
    });
  }
  document.querySelectorAll('.story-step').forEach((step) => {
    gsap.from(step.children, {
      y: 30,
      opacity: 0,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.08,
      scrollTrigger: { trigger: step, start: 'top 70%', once: true },
    });
  });

  /* --------------------------- bento demos --------------------------- */

  // Live feed: new events slide in on top
  const feed = document.getElementById('bentoFeed');
  if (feed) {
    const events = [
      ['bg-ok', 'Maya validated', 'WH/IN/0043'],
      ['bg-accent', 'Sam picked', 'WH/OUT/0108'],
      ['bg-info', 'Priya moved 6 units to', 'WH/Rack A'],
      ['bg-bad', 'Low stock:', 'Packing Tape'],
      ['bg-ok', 'Sam shipped', 'WH/OUT/0107'],
    ];
    let i = 0;
    setInterval(() => {
      if (document.hidden) return;
      const [tone, text, ref] = events[i++ % events.length];
      const li = document.createElement('li');
      li.className = 'flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5';
      li.innerHTML = `<span class="w-2 h-2 rounded-full ${tone}"></span> <span class="flex-1">${text} <span class="font-mono font-semibold">${ref}</span></span><span class="text-xs text-muted">now</span>`;
      feed.prepend(li);
      gsap.from(li, { height: 0, opacity: 0, y: -10, paddingTop: 0, paddingBottom: 0, duration: 0.5, ease: 'power3.out' });
      [...feed.children].slice(1).forEach((el) => {
        const t = el.querySelector('.text-muted');
        if (t && t.textContent === 'now') t.textContent = '1m';
      });
      while (feed.children.length > 3) feed.lastElementChild.remove();
    }, 2600);
  }

  // Scanner: type a code, laser sweep, repeat
  const typing = document.getElementById('bentoTyping');
  if (typing) {
    const codes = ['STL-ROD', 'TAPE-PK', 'WH/Rack B', 'CHAIR-OFF'];
    const bar = typing.closest('.scan-bar');
    let c = 0;
    const typeNext = () => {
      const code = codes[c++ % codes.length];
      typing.textContent = '';
      let k = 0;
      const t = setInterval(() => {
        typing.textContent = code.slice(0, ++k);
        if (k >= code.length) {
          clearInterval(t);
          bar.classList.remove('is-scanning');
          void bar.offsetWidth;
          bar.classList.add('is-scanning');
          setTimeout(typeNext, 1800);
        }
      }, 90);
    };
    setTimeout(typeNext, 1200);
  }

  // Time machine: the playhead scrubs back and forth, bars follow it
  const hist = document.getElementById('bentoHistogram');
  if (hist) {
    const bars = [...hist.querySelectorAll('span.flex-1')];
    const head = hist.querySelector('.bento-playhead');
    const state = { p: 0.58 };
    gsap.to(state, {
      p: 0.95,
      duration: 2.6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        head.style.left = `calc(${(state.p * 100).toFixed(1)}% - 6px)`;
        const upto = Math.round(state.p * bars.length);
        bars.forEach((b, i) => {
          b.classList.toggle('bg-accent', i < upto);
          b.classList.toggle('bg-line-2', i >= upto);
        });
      },
    });
  }

  // Forecast line draws itself when it scrolls in
  document.querySelectorAll('.bento-line, .bento-dash').forEach((path) => {
    const len = path.getTotalLength();
    const dashed = path.classList.contains('bento-dash');
    if (!dashed) gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
    gsap.fromTo(path, { opacity: dashed ? 0 : 1 }, {
      strokeDashoffset: 0,
      opacity: 1,
      duration: dashed ? 0.6 : 1.2,
      delay: dashed ? 1.1 : 0,
      ease: 'power2.out',
      scrollTrigger: window.ScrollTrigger ? { trigger: path.closest('article'), start: 'top 80%', once: true } : undefined,
    });
  });

  // Purchase orders bob as if waiting to be sent
  gsap.to('.bento-po', { y: -6, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: { each: 0.25 } });
})();
