/**
 * Live Warehouse (browser side).
 *  - listens to /api/live (Server-Sent Events)
 *  - toasts what teammates do, refreshes sidebar badges and who is online
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
      dot.className = `absolute inline-flex w-full h-full rounded-full ${live ? 'bg-ok animate-pulse-dot' : 'bg-warn'}`;
    }
    if (statusText) statusText.textContent = label;
  };

  let countsTimer = null;
  async function refreshCounts() {
    try {
      const res = await api('GET', '/api/nav-counts');
      Object.entries(res.data.counts).forEach(([key, n]) => {
        document.querySelectorAll(`[data-nav-badge="${key}"]`).forEach((el) => {
          const changed = el.textContent.trim() !== String(n);
          el.textContent = n;
          el.classList.toggle('hidden', !n);
          if (changed && n) bump(el);
        });
      });
      setStatus(true, `Live · ${res.data.online.length} online`);
      renderOnline(res.data.online);
    } catch (e) {
      /* next event will retry */
    }
  }
  // Replay a one-shot CSS animation on an element
  function bump(el, cls = 'animate-pop') {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
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
    const regions = document.querySelectorAll('[data-live-region]');
    regions.forEach((r) => r.classList.add('is-refreshing'));
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
          region.classList.add('live-flash');
          setTimeout(() => region.classList.remove('live-flash'), 1200);
          changed = true;
        }
      });
      if (changed) document.dispatchEvent(new CustomEvent('stocksense:regions-updated'));
    } catch (e) {
      /* offline for a moment */
    } finally {
      if (seq === regionSeq) regions.forEach((r) => r.classList.remove('is-refreshing'));
    }
  }
  function scheduleRegions(delay = 600) {
    if (!document.querySelector('[data-live-region]')) return;
    clearTimeout(regionTimer);
    const wait = Math.max(delay, lastRefresh + MIN_REFRESH_GAP_MS - Date.now());
    regionTimer = setTimeout(refreshRegions, wait);
  }

  /* ----------------------------- presence ---------------------------- */

  const initialsOf = (name) =>
    String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');

  // Avatar stack in the top bar: everyone with the app open right now
  function renderOnline(users) {
    const box = document.getElementById('onlineAvatars');
    if (!box || !Array.isArray(users)) return;
    const MAX = 4;
    box.replaceChildren();
    users.slice(0, MAX).forEach((u) => {
      const a = document.createElement('span');
      a.className = `avatar avatar-sm avatar-ring ${u.role === 'manager' ? 'avatar-manager' : 'avatar-staff'}`;
      a.textContent = initialsOf(u.name);
      a.title = u.id === me ? `${u.name} (you)` : u.name;
      box.appendChild(a);
    });
    if (users.length > MAX) {
      const more = document.createElement('span');
      more.className = 'avatar avatar-sm avatar-ring bg-sunken text-ink-2';
      more.textContent = `+${users.length - MAX}`;
      more.title = users.slice(MAX).map((u) => u.name).join(', ');
      box.appendChild(more);
    }
    box.setAttribute('aria-label', `${users.length} online: ${users.map((u) => u.name).join(', ')}`);
  }

  function renderPresence(viewers) {
    const box = document.getElementById('presence');
    if (!box) return;
    const others = viewers.filter((v) => v.id !== me);
    box.replaceChildren();
    box.classList.toggle('hidden', others.length === 0);
    if (others.length === 0) return;
    const label = document.createElement('span');
    label.className = 'text-xs text-muted';
    label.textContent = 'Also here:';
    box.appendChild(label);
    others.forEach((v) => {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-semibold text-ok animate-pop';
      const pulse = document.createElement('span');
      pulse.className = 'w-1.5 h-1.5 rounded-full bg-ok animate-pulse-dot';
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
    li.className = 'px-4 py-3 flex gap-3 bg-accent-soft transition-colors duration-1000 animate-fade-up';
    const bullet = document.createElement('span');
    bullet.className = 'mt-1.5 w-2 h-2 shrink-0 rounded-full bg-accent';
    const body = document.createElement('div');
    body.className = 'min-w-0';
    const link = document.createElement('a');
    link.href = `/operations/${item.id}`;
    link.className = 'block text-sm text-ink hover:text-accent-text';
    link.textContent = item.message;
    const when = document.createElement('p');
    when.className = 'text-xs text-muted';
    when.textContent = 'just now';
    body.append(link, when);
    li.append(bullet, body);
    feed.prepend(li);
    setTimeout(() => li.classList.remove('bg-accent-soft'), 2500);
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
        li.className = 'px-4 py-8 text-center text-muted';
        li.textContent = 'No stock alerts in the last 30 days';
        list.appendChild(li);
        return;
      }
      res.data.alerts.forEach((a) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/products/${a.product}`;
        link.className = `flex gap-3 px-4 py-3 transition-colors hover:bg-sunken ${a.read ? 'opacity-60' : ''}`;
        const dotEl = document.createElement('span');
        dotEl.className = `mt-1.5 w-2 h-2 shrink-0 rounded-full ${a.kind === 'out_of_stock' ? 'bg-bad' : 'bg-warn'}`;
        const body = document.createElement('span');
        body.className = 'min-w-0';
        const msg = document.createElement('p');
        msg.className = `font-medium ${a.kind === 'out_of_stock' ? 'text-bad' : 'text-warn'}`;
        msg.textContent = a.message;
        const meta = document.createElement('p');
        meta.className = 'text-xs text-muted mt-0.5';
        meta.textContent = `${a.reference ? `after ${a.reference} · ` : ''}${new Date(a.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
        body.append(msg, meta);
        link.append(dotEl, body);
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
    bell.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !bell.contains(e.target)) setOpen(false);
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
    const bellIcon = document.querySelector('[data-bell-icon]');
    if (bellIcon) bump(bellIcon, 'animate-ring');
    scheduleCounts();
    if (panel && !panel.classList.contains('hidden')) loadAlerts();
  });

  source.addEventListener('online', (e) => {
    const d = JSON.parse(e.data);
    setStatus(true, `Live · ${d.users.length} online`);
    if (statusText) statusText.title = d.users.map((u) => u.name).join(', ');
    renderOnline(d.users);
  });

  source.addEventListener('presence', (e) => {
    const d = JSON.parse(e.data);
    if (d.view === view) renderPresence(d.viewers);
  });

  window.addEventListener('beforeunload', () => source.close());
  window.StockSense.live = { refreshCounts, refreshRegions: () => scheduleRegions(0) };
})();
