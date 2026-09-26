/**
 * StockSense shared browser helpers: API calls, toasts, confirm dialog,
 * busy buttons and the mobile sidebar. Exposed as window.StockSense.
 */
(function () {
  'use strict';

  const TOAST_KEY = 'stocksense:toast';

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

  const TOAST_STYLES = {
    success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200',
    error: 'border-red-500/40 bg-red-950/90 text-red-200',
    info: 'border-blue-500/40 bg-slate-900/95 text-slate-200',
  };

  function toast(message, type = 'success', timeout = 5000) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.className =
      'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur transition-all duration-300 ' +
      (TOAST_STYLES[type] || TOAST_STYLES.info);

    const text = document.createElement('p');
    text.className = 'flex-1 leading-snug';
    text.textContent = message;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'opacity-60 hover:opacity-100';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', () => el.remove());

    el.append(text, close);
    root.appendChild(el);
    if (timeout) {
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
      }, timeout);
    }
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

  /**
   * In-page confirmation dialog (no blocking window.confirm).
   * @returns {Promise<boolean>}
   */
  function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.dataset.confirmDialog = '';

      const box = document.createElement('div');
      box.className = 'w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4';

      const h = document.createElement('h2');
      h.className = 'text-lg font-bold text-white';
      h.textContent = title;
      const p = document.createElement('p');
      p.className = 'text-sm text-slate-300';
      p.textContent = message;

      const actions = document.createElement('div');
      actions.className = 'flex justify-end gap-3 pt-2';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-secondary';
      cancel.textContent = 'Go back';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      ok.textContent = confirmLabel;
      actions.append(cancel, ok);

      box.append(h, p, actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      ok.focus();

      const close = (result) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
      };
      cancel.addEventListener('click', () => close(false));
      ok.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey);
    });
  }

  // Disable a button and show a working label while a request runs
  function setBusy(button, busy, busyLabel = 'Working...') {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.textContent = busyLabel;
    } else {
      button.disabled = false;
      if (button.dataset.label) button.innerHTML = button.dataset.label;
    }
  }

  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const openBtn = document.getElementById('sidebar-open');
    if (!sidebar || !openBtn) return;

    const setOpen = (open) => {
      sidebar.classList.toggle('-translate-x-full', !open);
      backdrop.classList.toggle('hidden', !open);
      openBtn.setAttribute('aria-expanded', String(open));
    };
    openBtn.addEventListener('click', () => setOpen(true));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    showPendingToast();
  });

  window.StockSense = { api, toast, toastAfterNavigation, confirmDialog, setBusy };
})();
