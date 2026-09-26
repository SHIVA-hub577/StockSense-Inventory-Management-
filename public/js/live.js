/**
 * Live Warehouse (browser side).
 *  - listens to /api/live (Server-Sent Events)
 *  - toasts what teammates do, refreshes sidebar badges
 *  - refreshes page regions marked data-live-region="name" in place
 *  - shows who else is viewing the same operation (presence)
 *  - alert bell panel
 */
(function () {
  'use strict';

  const ctx = document.getElementById('stocksense-context');
  if (!ctx || !window.EventSource || !window.StockSense) return;
  const me = ctx.dataset.user;
  const view = ctx.dataset.view || '';
  const { api, toast } = window.StockSense;

  /* ------------------------- status + badges ------------------------- */

  const dot = document.querySelector('[data-live-dot]');
  const statusText = document.querySelector('[data-live-text]');
  const setStatus = (live, label) => {
    if (dot) {
      dot.className = `absolute inline-flex w-full h-full rounded-full ${live ? 'bg-emerald-400' : 'bg-amber-400'}`;
    }
    if (statusText) statusText.textContent = label;
  };

  let countsTimer = null;
  async function refreshCounts() {
    try {
      const res = await api('GET', '/api/nav-counts');
      Object.entries(res.data.counts).forEach(([key, n]) => {
        document.querySelectorAll(`[data-nav-badge="${key}"]`).forEach((el) => {
          el.textContent = n;
          el.classList.toggle('hidden', !n);
        });
      });
      setStatus(true, `Live · ${res.data.online.length} online`);
    } catch (e) {
      /* next event will retry */
    }
  }
  const scheduleCounts = () => {
    clearTimeout(countsTimer);
    countsTimer = setTimeout(refreshCounts, 300);
  };

  /* --------------------------- live regions -------------------------- */

  let regionTimer = null;
  let regionSeq = 0;
  let lastRefresh = 0;
  const MIN_REFRESH_GAP_MS = 1500; // at most one page refresh per 1.5 s, however busy the warehouse is
  const busy = () => {
    const active = document.activeElement;
    const typing = active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) && active.closest('[data-live-region]');
    // (only an open confirmation dialog counts - the alert panel is always in the page)
    return typing || document.querySelector('[data-confirm-dialog]');
  };

  async function refreshRegions() {
    if (busy()) {
      scheduleRegions(1500); // user is busy - try again shortly
      return;
    }
    const seq = ++regionSeq;
    lastRefresh = Date.now();
    try {
      const res = await fetch(window.location.href, { credentials: 'same-origin', headers: { 'X-Live-Refresh': '1' } });
      if (!res.ok || res.redirected) return;
      const html = await res.text();
      if (seq !== regionSeq) return; // a newer refresh started: never apply an older page over it
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let changed = false;
      document.querySelectorAll('[data-live-region]').forEach((region) => {
        const fresh = doc.querySelector(`[data-live-region="${region.dataset.liveRegion}"]`);
        if (!fresh) return;
        // Flags live on the region element itself (e.g. data-can-scan): copy them too
        for (const attr of fresh.attributes) {
          if (attr.name.startsWith('data-') && region.getAttribute(attr.name) !== attr.value) {
            region.setAttribute(attr.name, attr.value);
            changed = true;
          }
        }
        if (fresh.innerHTML !== region.innerHTML) {
          region.innerHTML = fresh.innerHTML;
          region.classList.add('ring-2', 'ring-blue-500/40');
          setTimeout(() => region.classList.remove('ring-2', 'ring-blue-500/40'), 1200);
          changed = true;
        }
      });
      if (changed) document.dispatchEvent(new CustomEvent('stocksense:regions-updated'));
    } catch (e) {
      /* offline for a moment */
    }
  }
  function scheduleRegions(delay = 600) {
    if (!document.querySelector('[data-live-region]')) return;
    clearTimeout(regionTimer);
    const wait = Math.max(delay, lastRefresh + MIN_REFRESH_GAP_MS - Date.now());
    regionTimer = setTimeout(refreshRegions, wait);
  }

  /* ----------------------------- presence ---------------------------- */

  function renderPresence(viewers) {
    const box = document.getElementById('presence');
    if (!box) return;
    const others = viewers.filter((v) => v.id !== me);
    box.replaceChildren();
    box.classList.toggle('hidden', others.length === 0);
    if (others.length === 0) return;
    const label = document.createElement('span');
    label.className = 'text-xs text-slate-400';
    label.textContent = 'Also here:';
    box.appendChild(label);
    others.forEach((v) => {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-300';
      const pulse = document.createElement('span');
      pulse.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
      const name = document.createElement('span');
      name.textContent = v.name;
      chip.append(pulse, name);
      box.appendChild(chip);
    });
  }

  /* ------------------------------- feed ------------------------------ */

  function prependFeed(item) {
    const feed = document.getElementById('activityFeed');
    if (!feed || item.action === 'scanned') return;
    const li = document.createElement('li');
    li.className = 'px-4 py-3 flex gap-3 bg-blue-500/5 transition-colors';
    const bullet = document.createElement('span');
    bullet.className = 'mt-1.5 w-2 h-2 shrink-0 rounded-full bg-blue-400';
    const body = document.createElement('div');
    body.className = 'min-w-0';
    const link = document.createElement('a');
    link.href = `/operations/${item.id}`;
    link.className = 'block text-sm text-slate-200 hover:text-white';
    link.textContent = item.message;
    const when = document.createElement('p');
    when.className = 'text-xs text-slate-500';
    when.textContent = 'just now';
    body.append(link, when);
    li.append(bullet, body);
    feed.prepend(li);
    setTimeout(() => li.classList.remove('bg-blue-500/5'), 2500);
    while (feed.children.length > 15) feed.lastElementChild.remove();
    const empty = document.getElementById('activityEmpty');
    if (empty) empty.remove();
  }

  /* ------------------------------ alerts ----------------------------- */

  const bell = document.getElementById('alertBell');
  const panel = document.getElementById('alertPanel');
  const list = document.getElementById('alertList');

  async function loadAlerts() {
    try {
      const res = await api('GET', '/api/alerts');
      list.replaceChildren();
      if (res.data.alerts.length === 0) {
        const li = document.createElement('li');
        li.className = 'px-4 py-6 text-center text-slate-400';
        li.textContent = 'No stock alerts in the last 30 days';
        list.appendChild(li);
        return;
      }
      res.data.alerts.forEach((a) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/products/${a.product}`;
        link.className = `block px-4 py-3 hover:bg-slate-800/60 ${a.read ? 'opacity-60' : ''}`;
        const msg = document.createElement('p');
        msg.className = a.kind === 'out_of_stock' ? 'text-red-300' : 'text-amber-300';
        msg.textContent = a.message;
        const meta = document.createElement('p');
        meta.className = 'text-xs text-slate-500 mt-0.5';
        meta.textContent = `${a.reference ? `after ${a.reference} · ` : ''}${new Date(a.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
        link.append(msg, meta);
        li.appendChild(link);
        list.appendChild(li);
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (bell && panel) {
    const setOpen = (open) => {
      panel.classList.toggle('hidden', !open);
      bell.setAttribute('aria-expanded', String(open));
      if (open) loadAlerts();
    };
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(panel.classList.contains('hidden'));
    });
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('hidden') && !panel.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
    document.getElementById('alertsReadAll').addEventListener('click', async () => {
      try {
        await api('POST', '/api/alerts/read-all');
        await loadAlerts();
        refreshCounts();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  /* ------------------------------ stream ----------------------------- */

  const source = new EventSource(`/api/live${view ? `?view=${encodeURIComponent(view)}` : ''}`);
  source.addEventListener('open', refreshCounts);
  source.addEventListener('error', () => setStatus(false, 'Reconnecting…'));

  source.addEventListener('operation', (e) => {
    const d = JSON.parse(e.data);
    const mine = d.actor && d.actor.id === me;
    const here = view === `operation:${d.id}`;
    // Scans only change the operation being scanned: other screens ignore them
    if (d.action === 'scanned' && !here) return;
    if (!mine && d.action !== 'scanned') toast(d.message, 'info', 6000);
    prependFeed(d);
    if (d.action !== 'scanned') scheduleCounts();
    scheduleRegions();
    document.dispatchEvent(new CustomEvent('stocksense:live', { detail: d }));
  });

  source.addEventListener('alert', (e) => {
    const d = JSON.parse(e.data);
    toast(`Stock alert: ${d.message}`, 'error', 9000);
    scheduleCounts();
    if (panel && !panel.classList.contains('hidden')) loadAlerts();
  });

  source.addEventListener('online', (e) => {
    const d = JSON.parse(e.data);
    setStatus(true, `Live · ${d.users.length} online`);
    if (statusText) statusText.title = d.users.map((u) => u.name).join(', ');
  });

  source.addEventListener('presence', (e) => {
    const d = JSON.parse(e.data);
    if (d.view === view) renderPresence(d.viewers);
  });

  window.addEventListener('beforeunload', () => source.close());
  window.StockSense.live = { refreshCounts, refreshRegions: () => scheduleRegions(0) };
})();
