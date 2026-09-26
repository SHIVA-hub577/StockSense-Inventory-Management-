/**
 * Command palette (Ctrl+K or /) and keyboard shortcuts (? for help, g + key
 * to jump). Searches pages, quick actions and - through /api/search -
 * products, operations and bins.
 */
(function () {
  'use strict';

  const S = window.StockSense;
  const ctx = document.getElementById('stocksense-context');
  if (!S || !ctx) return;
  const isManager = ctx.dataset.role === 'manager';
  const ICONS = window.StockSenseIcons || {};
  const RECENT_KEY = 'stocksense:recent';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const PAGES = [
    { label: 'Dashboard', href: '/dashboard', icon: 'dashboard', keys: 'home overview kpi', go: 'd' },
    { label: 'Scan & Pick', href: '/scan', icon: 'scan', keys: 'barcode camera pick', go: 's' },
    { label: 'Products', href: '/products', icon: 'products', keys: 'items sku stock', go: 'p' },
    { label: 'Products that need attention', href: '/products?status=attention', icon: 'warning', keys: 'low out of stock alert' },
    { label: 'Categories', href: '/categories', icon: 'categories', keys: 'groups' },
    { label: 'Replenishment', href: '/replenishment', icon: 'replenish', keys: 'reorder purchase forecast refill', go: 'f' },
    { label: 'Time Machine', href: '/insights/time-machine', icon: 'history', keys: 'past as of snapshot history', go: 'i' },
    { label: 'Receipts', href: '/receipts', icon: 'receipts', keys: 'incoming vendor supplier inbound', go: 'r' },
    { label: 'Delivery Orders', href: '/deliveries', icon: 'deliveries', keys: 'outgoing customer ship outbound', go: 'o' },
    { label: 'Internal Transfers', href: '/transfers', icon: 'transfers', keys: 'move rack bin', go: 't' },
    { label: 'Stock Counts', href: '/adjustments', icon: 'adjustments', keys: 'adjustment count audit cycle', go: 'c' },
    { label: 'Move History', href: '/moves', icon: 'timemachine', keys: 'ledger log moves', go: 'm' },
    { label: 'Warehouses', href: '/settings/warehouses', icon: 'warehouses', keys: 'settings locations bins racks', go: 'w' },
    { label: 'My profile', href: '/profile', icon: 'user', keys: 'account me' },
    { label: 'Design system', href: '/styleguide', icon: 'swatch', keys: 'style guide components colors' },
  ];

  const ACTIONS = [
    { label: 'New receipt', href: '/receipts/new', icon: 'plus', keys: 'create incoming vendor' },
    { label: 'New delivery order', href: '/deliveries/new', icon: 'plus', keys: 'create outgoing customer' },
    { label: 'New internal transfer', href: '/transfers/new', icon: 'plus', keys: 'create move' },
    { label: 'New stock count', href: '/adjustments/new', icon: 'plus', keys: 'create adjustment count' },
    ...(isManager ? [{ label: 'New product', href: '/products/new', icon: 'plus', keys: 'create item sku' }] : []),
    { label: 'Print all product labels', href: '/labels?products=all', icon: 'label', keys: 'barcode print', newTab: true },
    { label: 'Export move history (CSV)', href: '/moves/export.csv', icon: 'download', keys: 'csv excel download' },
    {
      label: 'Switch dark / light theme',
      icon: 'moon',
      keys: 'theme dark light mode',
      run: () => S.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    },
    { label: 'Keyboard shortcuts', icon: 'bolt', keys: 'help keys hotkeys', run: () => openShortcuts() },
    { label: 'Sign out', href: '/auth/logout', icon: 'logout', keys: 'logout log out exit' },
  ];

  const OP_LABEL = { receipt: 'Receipt', delivery: 'Delivery', internal: 'Transfer', adjustment: 'Stock count' };
  const STATUS_BADGE = { draft: 'badge-neutral', waiting: 'badge-warn', ready: 'badge-info', done: 'badge-ok', canceled: 'badge-bad' };

  /* ------------------------------ helpers ---------------------------- */

  function svgIcon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', ICONS[name] || '');
    svg.appendChild(path);
    return svg;
  }

  // Text with the matched part wrapped in <mark> (built from text nodes: safe)
  function highlight(text, query) {
    const frag = document.createDocumentFragment();
    const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (at < 0) {
      frag.append(text);
      return frag;
    }
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + query.length);
    frag.append(text.slice(0, at), mark, text.slice(at + query.length));
    return frag;
  }

  const matches = (item, q) => !q || `${item.label} ${item.keys || ''}`.toLowerCase().includes(q.toLowerCase());

  function readRecent() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(list) ? list.slice(0, 5) : [];
    } catch (e) {
      return [];
    }
  }
  function remember(item) {
    if (!item.href || item.remember === false) return;
    try {
      const list = readRecent().filter((r) => r.href !== item.href);
      list.unshift({ label: item.label, href: item.href, icon: item.icon, meta: item.meta || '' });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (e) {
      /* storage blocked */
    }
  }

  /* ------------------------------ palette ---------------------------- */

  let overlay = null;
  let input = null;
  let listbox = null;
  let status = null;
  let items = [];
  let active = 0;
  let previousFocus = null;
  let searchTimer = null;
  let searchSeq = 0;
  let remote = null; // last /api/search result for the current query

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop palette';
    overlay.hidden = true;

    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Search and commands');

    const head = document.createElement('div');
    head.className = 'flex items-center gap-3 px-4 border-b border-line';
    head.appendChild(svgIcon('search', 'w-5 h-5 shrink-0 text-muted'));
    input = document.createElement('input');
    input.type = 'text';
    input.id = 'paletteInput';
    input.className = 'flex-1 h-14 bg-transparent text-base text-ink placeholder:text-faint focus:outline-none';
    input.placeholder = 'Search products, references, bins or type a command…';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'paletteList');
    input.setAttribute('aria-autocomplete', 'list');
    input.autocomplete = 'off';
    input.spellcheck = false;
    const esc = document.createElement('kbd');
    esc.className = 'kbd';
    esc.textContent = 'Esc';
    head.append(input, esc);

    listbox = document.createElement('ul');
    listbox.id = 'paletteList';
    listbox.className = 'max-h-[min(60vh,26rem)] overflow-y-auto p-2';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Results');

    status = document.createElement('p');
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');

    const foot = document.createElement('div');
    foot.className = 'hidden sm:flex items-center gap-4 px-4 py-2.5 border-t border-line bg-surface-2 text-xs text-muted';
    [
      ['↑↓', 'navigate'],
      ['↵', 'open'],
      ['Esc', 'close'],
    ].forEach(([k, label]) => {
      const span = document.createElement('span');
      span.className = 'flex items-center gap-1.5';
      const kbd = document.createElement('kbd');
      kbd.className = 'kbd';
      kbd.textContent = k;
      span.append(kbd, label);
      foot.appendChild(span);
    });
    const brand = document.createElement('span');
    brand.className = 'ml-auto font-mono text-muted';
    brand.textContent = 'StockSense';
    foot.appendChild(brand);

    box.append(head, listbox, status, foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeys);
    overlay.addEventListener('keydown', (e) => S.trapFocus(box, e));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
    listbox.addEventListener('mousemove', (e) => {
      const li = e.target.closest('[role=option]');
      if (li && Number(li.dataset.index) !== active) setActive(Number(li.dataset.index), false);
    });
    listbox.addEventListener('click', (e) => {
      const li = e.target.closest('[role=option]');
      if (li) choose(items[Number(li.dataset.index)], e.ctrlKey || e.metaKey);
    });
  }

  function open(initial = '') {
    if (!overlay) build();
    if (!overlay.hidden) return;
    previousFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.remove('is-leaving');
    input.value = initial;
    remote = null;
    render();
    input.focus();
    document.body.classList.add('overflow-hidden');
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    clearTimeout(searchTimer);
    searchSeq++;
    document.body.classList.remove('overflow-hidden');
    const hide = () => {
      overlay.hidden = true;
      overlay.classList.remove('is-leaving');
    };
    if (S.reducedMotion()) hide();
    else {
      overlay.classList.add('is-leaving');
      setTimeout(hide, 160);
    }
    if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function onInput() {
    const q = input.value.trim();
    remote = null;
    render();
    clearTimeout(searchTimer);
    if (q.length < 2) return;
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const res = await S.api('GET', `/api/search?q=${encodeURIComponent(q)}`);
        if (seq !== searchSeq || input.value.trim() !== q) return; // a newer query is on its way
        remote = res.data;
        render();
      } catch (e) {
        /* offline: local results still work */
      }
    }, 140);
  }

  function onKeys(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const next = e.key === 'ArrowDown' ? (active + 1) % items.length : (active - 1 + items.length) % items.length;
      setActive(next, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) choose(items[active], e.ctrlKey || e.metaKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function setActive(index, scroll) {
    active = index;
    listbox.querySelectorAll('[role=option]').forEach((li) => {
      const on = Number(li.dataset.index) === active;
      li.setAttribute('aria-selected', String(on));
      if (on) {
        input.setAttribute('aria-activedescendant', li.id);
        if (scroll) li.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function choose(item, newTab) {
    if (!item) return;
    remember(item);
    if (item.run) {
      close();
      item.run();
      return;
    }
    if (newTab || item.newTab) {
      window.open(item.href, '_blank', 'noopener');
      close();
      return;
    }
    close();
    window.location.href = item.href;
  }

  // Build the grouped result list for the current query
  function groups() {
    const q = input.value.trim();
    const out = [];
    if (!q) {
      const recent = readRecent();
      if (recent.length) out.push({ title: 'Recent', items: recent });
      out.push({ title: 'Quick actions', items: ACTIONS.slice(0, isManager ? 5 : 4) });
      out.push({ title: 'Jump to', items: PAGES });
      return out;
    }
    if (remote) {
      if (remote.products.length) {
        out.push({
          title: 'Products',
          items: remote.products.map((p) => ({ label: p.name, meta: p.sku, href: `/products/${p._id}`, icon: 'products', chip: p.sku })),
        });
      }
      if (remote.operations.length) {
        out.push({
          title: 'Operations',
          items: remote.operations.map((o) => ({
            label: o.reference,
            meta: [OP_LABEL[o.type], o.partner].filter(Boolean).join(' · '),
            href: `/operations/${o._id}`,
            icon: o.type === 'receipt' ? 'receipts' : o.type === 'delivery' ? 'deliveries' : o.type === 'internal' ? 'transfers' : 'adjustments',
            status: o.status,
            mono: true,
          })),
        });
      }
      if (remote.locations.length) {
        out.push({
          title: 'Bins & locations',
          items: remote.locations.map((l) => ({ label: l.fullName, href: `/locations/${l._id}`, icon: 'map', mono: true })),
        });
      }
    }
    const pages = PAGES.filter((p) => matches(p, q));
    const actions = ACTIONS.filter((a) => matches(a, q));
    if (actions.length) out.push({ title: 'Actions', items: actions });
    if (pages.length) out.push({ title: 'Pages', items: pages });
    return out;
  }

  function render() {
    const q = input.value.trim();
    const list = groups();
    items = [];
    listbox.replaceChildren();

    list.forEach((group) => {
      const title = document.createElement('li');
      title.className = 'px-2.5 pt-2.5 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted';
      title.setAttribute('role', 'presentation');
      title.textContent = group.title;
      listbox.appendChild(title);

      group.items.forEach((item) => {
        const index = items.length;
        items.push(item);
        const li = document.createElement('li');
        li.id = `palette-opt-${index}`;
        li.dataset.index = index;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.className = 'palette-item menu-item cursor-pointer';

        const tile = document.createElement('span');
        tile.className = 'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg border border-line bg-surface text-muted';
        tile.appendChild(svgIcon(item.icon || 'chevronRight', 'w-4 h-4'));

        const text = document.createElement('span');
        text.className = 'flex-1 min-w-0';
        const label = document.createElement('span');
        label.className = `block truncate text-ink ${item.mono ? 'font-mono text-[0.8125rem] font-semibold' : 'font-medium'}`;
        label.appendChild(highlight(item.label, q));
        text.appendChild(label);
        if (item.meta && !item.chip) {
          const meta = document.createElement('span');
          meta.className = 'block truncate text-xs text-muted';
          meta.appendChild(highlight(item.meta, q));
          text.appendChild(meta);
        }
        li.append(tile, text);

        if (item.chip) {
          const chip = document.createElement('span');
          chip.className = 'sku';
          chip.appendChild(highlight(item.chip, q));
          li.appendChild(chip);
        }
        if (item.status && STATUS_BADGE[item.status]) {
          const badge = document.createElement('span');
          badge.className = `badge ${STATUS_BADGE[item.status]}`;
          badge.textContent = item.status[0].toUpperCase() + item.status.slice(1);
          li.appendChild(badge);
        }
        if (item.go) {
          const hint = document.createElement('span');
          hint.className = 'hidden sm:flex gap-1';
          ['G', item.go.toUpperCase()].forEach((k) => {
            const kbd = document.createElement('kbd');
            kbd.className = 'kbd';
            kbd.textContent = k;
            hint.appendChild(kbd);
          });
          li.appendChild(hint);
        }
        const enter = document.createElement('span');
        enter.className = 'palette-enter text-xs text-muted';
        enter.textContent = '↵';
        li.appendChild(enter);
        listbox.appendChild(li);
      });
    });

    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'px-4 py-10 text-center text-sm text-muted';
      empty.setAttribute('role', 'presentation');
      empty.textContent = q.length >= 2 && !remote ? 'Searching…' : `Nothing matches “${q}”`;
      listbox.appendChild(empty);
    }
    status.textContent = items.length ? `${items.length} results` : 'No results';
    setActive(0, true);
  }

  /* ----------------------------- shortcuts --------------------------- */

  let shortcutsBox = null;

  function openShortcuts() {
    if (shortcutsBox) return;
    const previous = document.activeElement;
    shortcutsBox = document.createElement('div');
    shortcutsBox.className = 'dialog-backdrop';
    const box = document.createElement('div');
    box.className = 'dialog p-6 max-w-lg';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'shortcutsTitle');

    const head = document.createElement('div');
    head.className = 'flex items-center justify-between gap-4';
    const h = document.createElement('h2');
    h.id = 'shortcutsTitle';
    h.className = 'text-lg font-bold';
    h.textContent = 'Keyboard shortcuts';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn btn-ghost btn-icon btn-sm';
    x.setAttribute('aria-label', 'Close');
    x.appendChild(svgIcon('x', 'w-4 h-4'));
    head.append(h, x);

    const rows = [
      [['Ctrl', 'K'], 'Search & commands'],
      [['/'], 'Search & commands'],
      [['?'], 'This help'],
      ...PAGES.filter((p) => p.go).map((p) => [['G', p.go.toUpperCase()], p.label]),
    ];
    const grid = document.createElement('dl');
    grid.className = 'mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm';
    rows.forEach(([keys, label]) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3';
      const dt = document.createElement('dt');
      dt.className = 'text-ink-2';
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.className = 'flex gap-1';
      keys.forEach((k) => {
        const kbd = document.createElement('kbd');
        kbd.className = 'kbd';
        kbd.textContent = k;
        dd.appendChild(kbd);
      });
      row.append(dt, dd);
      grid.appendChild(row);
    });
    box.append(head, grid);
    shortcutsBox.appendChild(box);
    document.body.appendChild(shortcutsBox);
    x.focus();

    const shut = () => {
      if (!shortcutsBox) return;
      const el = shortcutsBox;
      shortcutsBox = null;
      document.removeEventListener('keydown', onKey, true);
      if (S.reducedMotion()) el.remove();
      else {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 160);
      }
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        shut();
      } else S.trapFocus(box, e);
    };
    x.addEventListener('click', shut);
    shortcutsBox.addEventListener('mousedown', (e) => {
      if (e.target === shortcutsBox) shut();
    });
    document.addEventListener('keydown', onKey, true);
  }

  const isTyping = (el) => el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
  const dialogOpen = () => document.querySelector('[data-confirm-dialog]') || shortcutsBox || (overlay && !overlay.hidden);

  let goPending = false;
  let goTimer = null;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (overlay && !overlay.hidden) close();
      else if (!document.querySelector('[data-confirm-dialog]')) open();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || dialogOpen()) return;

    if (goPending) {
      goPending = false;
      clearTimeout(goTimer);
      const page = PAGES.find((p) => p.go === e.key.toLowerCase());
      if (page) {
        e.preventDefault();
        window.location.href = page.href;
      }
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      open();
    } else if (e.key === '?') {
      e.preventDefault();
      openShortcuts();
    } else if (e.key === 'g' && !document.getElementById('scanInput')) {
      // (not on scanning screens: a barcode gun "types" fast and could trigger jumps)
      goPending = true;
      goTimer = setTimeout(() => (goPending = false), 1200);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#paletteOpen, [data-open-palette]')) open();
    else if (e.target.closest('[data-open-shortcuts]')) openShortcuts();
  });

  S.palette = { open, close, openShortcuts };
})();
