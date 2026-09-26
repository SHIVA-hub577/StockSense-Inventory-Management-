/**
 * StockSense shared browser helpers: API calls, toasts, confirm dialog,
 * busy buttons, theme, menus and the mobile sidebar. Exposed as window.StockSense.
 */
(function () {
  'use strict';

  const TOAST_KEY = 'stocksense:toast';
  const THEME_KEY = 'stocksense:theme';
  const MAX_TOASTS = 4;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------ icons ------------------------------ */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PATHS = {
    check: 'M4.5 12.75l6 6 9-13.5',
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
    info: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
    x: 'M6 18L18 6M6 6l12 12',
  };

  function svgIcon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', PATHS[name]);
    svg.appendChild(path);
    return svg;
  }

  /* ------------------------------- api ------------------------------- */

  /**
   * Call the JSON API. Resolves with the response body; rejects with an Error
   * whose message is the server's message (and .details / .status when present).
   */
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (networkError) {
      throw new Error('Network error - is the server running?');
    }

    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }

    if (res.status === 401) {
      window.location.href = '/auth/login?error=' + encodeURIComponent('Your session expired. Please log in again');
      throw new Error('Session expired');
    }
    if (!res.ok || data.success === false) {
      const error = new Error(data.message || `Request failed (${res.status})`);
      error.status = res.status;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  /* ------------------------------ toasts ----------------------------- */

  const TOAST_TONES = {
    success: { icon: 'check', box: 'bg-ok-soft text-ok', bar: 'bg-ok' },
    error: { icon: 'warning', box: 'bg-bad-soft text-bad', bar: 'bg-bad' },
    warning: { icon: 'warning', box: 'bg-warn-soft text-warn', bar: 'bg-warn' },
    info: { icon: 'info', box: 'bg-info-soft text-info', bar: 'bg-info' },
  };

  /** Show a toast; it pauses while hovered. Returns the element. */
  function toast(message, type = 'success', timeout = 5000) {
    const root = document.getElementById('toast-root');
    if (!root) return null;
    const tone = TOAST_TONES[type] || TOAST_TONES.info;

    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = `toast-icon ${tone.box}`;
    icon.appendChild(svgIcon(tone.icon, 'w-4 h-4'));

    const text = document.createElement('p');
    text.className = 'flex-1 min-w-0 pt-0.5 leading-snug break-words';
    text.textContent = message;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shrink-0 -mr-1 inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:text-ink hover:bg-sunken transition-colors';
    close.setAttribute('aria-label', 'Dismiss');
    close.appendChild(svgIcon('x', 'w-4 h-4'));

    el.append(icon, text, close);
    let bar = null;
    if (timeout) {
      bar = document.createElement('span');
      bar.className = `toast-bar ${tone.bar} opacity-50`;
      el.appendChild(bar);
    }
    root.appendChild(el);
    while (root.children.length > MAX_TOASTS) root.firstElementChild.remove();

    let timer = null;
    let remaining = timeout;
    let startedAt = 0;
    let barAnimation = null;

    const dismiss = () => {
      clearTimeout(timer);
      if (el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      const remove = () => el.remove();
      if (reducedMotion()) remove();
      else {
        el.addEventListener('animationend', remove, { once: true });
        setTimeout(remove, 400);
      }
    };
    const run = () => {
      startedAt = Date.now();
      timer = setTimeout(dismiss, Math.max(remaining, 0));
    };

    if (timeout) {
      if (bar.animate) {
        barAnimation = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: timeout, easing: 'linear', fill: 'forwards' });
      }
      run();
      el.addEventListener('mouseenter', () => {
        clearTimeout(timer);
        remaining -= Date.now() - startedAt;
        if (barAnimation) barAnimation.pause();
      });
      el.addEventListener('mouseleave', () => {
        if (barAnimation) barAnimation.play();
        run();
      });
    }
    close.addEventListener('click', dismiss);
    return el;
  }

  // Show a toast on the next page (after a redirect / reload)
  function toastAfterNavigation(message, type = 'success') {
    try {
      sessionStorage.setItem(TOAST_KEY, JSON.stringify({ message, type }));
    } catch (e) {
      /* storage blocked: skip the toast */
    }
  }

  function showPendingToast() {
    try {
      const raw = sessionStorage.getItem(TOAST_KEY);
      if (raw) {
        sessionStorage.removeItem(TOAST_KEY);
        const { message, type } = JSON.parse(raw);
        toast(message, type);
      }
    } catch (e) {
      /* ignore */
    }
  }

  /* -------------------------- confirm dialog ------------------------- */

  const DIALOG_TONES = {
    primary: { button: 'btn-primary', icon: 'info', tile: 'bg-sunken text-ink' },
    accent: { button: 'btn-accent', icon: 'info', tile: 'bg-accent-soft text-accent-text' },
    success: { button: 'btn-success', icon: 'check', tile: 'bg-ok-soft text-ok' },
    danger: { button: 'btn-danger', icon: 'warning', tile: 'bg-bad-soft text-bad' },
  };
  let dialogCount = 0;

  /** Keep keyboard focus inside `container` while it is open. */
  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.disabled && el.offsetParent !== null
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * In-page confirmation dialog (no blocking window.confirm).
   * @param {object} opts title, message, confirmLabel, cancelLabel,
   *   danger (bool) or tone ('primary' | 'accent' | 'success' | 'danger'),
   *   summary: [{ label, value }] rows shown before confirming
   * @returns {Promise<boolean>}
   */
  function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Go back', danger = false, tone, summary } = {}) {
    return new Promise((resolve) => {
      const kind = DIALOG_TONES[tone] || DIALOG_TONES[danger ? 'danger' : 'primary'];
      const previous = document.activeElement;
      const id = `confirm-${++dialogCount}`;

      const overlay = document.createElement('div');
      overlay.className = 'dialog-backdrop';
      overlay.dataset.confirmDialog = '';

      const box = document.createElement('div');
      box.className = 'dialog p-6';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', `${id}-title`);
      box.setAttribute('aria-describedby', `${id}-message`);

      const tile = document.createElement('span');
      tile.className = `dialog-icon ${kind.tile}`;
      tile.appendChild(svgIcon(kind.icon, 'w-5 h-5'));

      const h = document.createElement('h2');
      h.id = `${id}-title`;
      h.className = 'mt-4 text-lg font-bold leading-snug';
      h.textContent = title;
      const p = document.createElement('p');
      p.id = `${id}-message`;
      p.className = 'mt-1.5 text-sm text-muted leading-relaxed';
      p.textContent = message || '';
      box.append(tile, h, p);

      if (Array.isArray(summary) && summary.length) {
        const dl = document.createElement('dl');
        dl.className = 'mt-4 rounded-xl border border-line bg-surface-2 divide-y divide-line text-sm';
        summary.forEach((row) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between gap-4 px-3.5 py-2.5';
          const dt = document.createElement('dt');
          dt.className = 'text-muted';
          dt.textContent = row.label;
          const dd = document.createElement('dd');
          dd.className = 'font-semibold tabular text-right';
          dd.textContent = row.value;
          item.append(dt, dd);
          dl.appendChild(item);
        });
        box.appendChild(dl);
      }

      const actions = document.createElement('div');
      actions.className = 'mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-secondary';
      cancel.textContent = cancelLabel;
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = `btn ${kind.button}`;
      ok.textContent = confirmLabel;
      actions.append(cancel, ok);
      box.appendChild(actions);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      ok.focus();

      let closed = false;
      const close = (result) => {
        if (closed) return;
        closed = true;
        delete overlay.dataset.confirmDialog;
        document.removeEventListener('keydown', onKey, true);
        const remove = () => overlay.remove();
        if (reducedMotion()) remove();
        else {
          overlay.classList.add('is-leaving');
          overlay.addEventListener('animationend', remove, { once: true });
          setTimeout(remove, 300);
        }
        if (!result && previous && previous.isConnected) previous.focus({ preventScroll: true });
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        } else trapFocus(box, e);
      };
      cancel.addEventListener('click', () => close(false));
      ok.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey, true);
    });
  }

  /* --------------------------- busy buttons -------------------------- */

  // Disable a button and show a spinner + working label while a request runs
  function setBusy(button, busy, busyLabel = 'Working...') {
    if (!button) return;
    if (busy) {
      if (button.dataset.busy === '1') return;
      button.dataset.busy = '1';
      button.dataset.label = button.innerHTML;
      button.style.minWidth = `${button.offsetWidth}px`; // no layout jump
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = busyLabel;
      button.replaceChildren(spinner, label);
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.style.minWidth = '';
      delete button.dataset.busy;
      if (button.dataset.label !== undefined) button.innerHTML = button.dataset.label;
    }
  }

  /* ------------------------------- theme ----------------------------- */

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function themePreference() {
    try {
      return localStorage.getItem(THEME_KEY) || 'system';
    } catch (e) {
      return 'system';
    }
  }
  const resolveTheme = (pref) => (pref === 'dark' || (pref === 'system' && darkQuery.matches) ? 'dark' : 'light');

  function syncThemeControls() {
    const root = document.documentElement;
    const pref = root.dataset.themePref || 'system';
    document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === pref)));
    const toggle = document.getElementById('themeToggle');
    if (toggle) toggle.setAttribute('aria-label', root.dataset.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function applyTheme(pref) {
    const root = document.documentElement;
    root.dataset.theme = resolveTheme(pref);
    root.dataset.themePref = pref;
    syncThemeControls();
    document.dispatchEvent(new CustomEvent('stocksense:theme', { detail: { theme: root.dataset.theme, pref } }));
  }

  /** Change theme; with an origin element the new theme spreads out from it as a circle. */
  function setTheme(pref, origin) {
    try {
      if (pref === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
    } catch (e) {
      /* private mode: theme lasts for this page only */
    }
    const root = document.documentElement;
    const unchanged = resolveTheme(pref) === root.dataset.theme;
    if (unchanged || !origin || !document.startViewTransition || reducedMotion()) {
      applyTheme(pref);
      return;
    }
    const rect = origin.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.classList.add('theme-switching');
    const transition = document.startViewTransition(() => applyTheme(pref));
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      })
      .catch(() => {});
    transition.finished.finally(() => root.classList.remove('theme-switching'));
  }

  function initTheme() {
    syncThemeControls();
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', toggle));
    }
    document.addEventListener('click', (e) => {
      const choice = e.target.closest('[data-theme-choice]');
      if (choice) setTheme(choice.dataset.themeChoice, choice);
    });
    darkQuery.addEventListener('change', () => {
      if (themePreference() === 'system') applyTheme('system');
    });
  }

  /* ------------------------------- menus ----------------------------- */

  function initMenu(buttonId, menuId) {
    const button = document.getElementById(buttonId);
    const menu = document.getElementById(menuId);
    if (!button || !menu) return;
    const items = () => [...menu.querySelectorAll('[role=menuitem], [role=radio]')];
    const isOpen = () => !menu.classList.contains('hidden');
    const setOpen = (open, focusFirst) => {
      menu.classList.toggle('hidden', !open);
      button.setAttribute('aria-expanded', String(open));
      if (open && focusFirst && items()[0]) items()[0].focus();
    };

    button.addEventListener('click', () => setOpen(!isOpen()));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true, true);
      }
    });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const at = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
        list[next].focus();
      } else if (e.key === 'Escape') {
        setOpen(false);
        button.focus();
      } else if (e.key === 'Tab') {
        setOpen(false);
      }
    });
    document.addEventListener('click', (e) => {
      if (isOpen() && !menu.contains(e.target) && !button.contains(e.target)) setOpen(false);
    });
  }

  /* ------------------------------ sidebar ---------------------------- */

  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const openers = document.querySelectorAll('[data-sidebar-open]');
    if (!sidebar || !backdrop || openers.length === 0) return;

    let open = false;
    const setOpen = (value) => {
      open = value;
      sidebar.classList.toggle('-translate-x-full', !open);
      backdrop.classList.toggle('hidden', !open);
      document.body.classList.toggle('overflow-hidden', open);
      openers.forEach((b) => b.setAttribute('aria-expanded', String(open)));
      if (open) {
        const closeBtn = sidebar.querySelector('[data-sidebar-close]');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
      }
    };
    openers.forEach((b) => b.addEventListener('click', () => setOpen(true)));
    backdrop.addEventListener('click', () => setOpen(false));
    sidebar.querySelectorAll('[data-sidebar-close]').forEach((b) => b.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) setOpen(false);
    });
    // Growing to desktop width while the drawer is open: reset it
    window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
      if (e.matches && open) setOpen(false);
    });
  }

  /* ------------------------ page loading bar ------------------------ */

  function initNavProgress() {
    let bar = null;
    let timer = null;
    const stop = () => {
      clearTimeout(timer);
      if (bar) bar.remove();
      bar = null;
    };
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.endsWith('.csv')) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      stop();
      timer = setTimeout(() => {
        bar = document.createElement('div');
        bar.className = 'nav-progress';
        document.body.appendChild(bar);
      }, 150);
    });
    window.addEventListener('pageshow', stop);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initTheme();
    initMenu('userMenuButton', 'userMenu');
    initNavProgress();
    showPendingToast();
  });

  window.StockSense = {
    api,
    toast,
    toastAfterNavigation,
    confirmDialog,
    setBusy,
    setTheme,
    trapFocus,
    reducedMotion,
  };
})();
