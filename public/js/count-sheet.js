/**
 * Stock count sheet: counted vs recorded quantities per product at one
 * location, with live difference / value and a reason per line. Works like a
 * spreadsheet: Enter / arrow keys move between the "Counted" cells, rows are
 * marked matching / over / short, and a progress bar tracks what is counted.
 */
(function () {
  'use strict';

  const config = JSON.parse(document.getElementById('countFormData').textContent);
  const { api, toast, toastAfterNavigation, setBusy, combobox } = window.StockSense;
  const progressText = document.getElementById('countProgress');
  const progressBar = document.getElementById('countProgressBar');

  const form = document.getElementById('countForm');
  const tbody = document.getElementById('lines');
  const errorBox = document.getElementById('formError');
  const locationSelect = document.getElementById('location');
  const blindBox = document.getElementById('blindCount');
  const totalValue = document.getElementById('totalValue');

  const productsById = new Map(config.products.map((p) => [p._id, p]));
  const byCategory = new Map();
  config.products.forEach((p) => {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  });

  let recorded = {}; // productId -> quantity at the selected location
  let recordedFor = null;
  const rows = () => Array.from(tbody.querySelectorAll('tr'));
  const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  const money = (n) => Number(n || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  const hideRecorded = () => blindBox.checked && !config.isManager;

  const cell = (className = 'td') => {
    const td = document.createElement('td');
    td.className = className;
    return td;
  };

  function productSelect(selected) {
    const select = document.createElement('select');
    select.className = 'input';
    select.setAttribute('aria-label', 'Product');
    select.add(new Option('Choose a product', ''));
    byCategory.forEach((items, category) => {
      const group = document.createElement('optgroup');
      group.label = category;
      items.forEach((p) => {
        const option = new Option(`${p.name} (${p.sku})`, p._id);
        option.selected = p._id === selected;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
    return select;
  }

  function reasonSelect(selected) {
    const select = document.createElement('select');
    select.className = 'input';
    select.setAttribute('aria-label', 'Reason');
    Object.entries(config.reasons).forEach(([value, label]) => {
      const option = new Option(label, value);
      option.selected = value === (selected || 'count');
      select.appendChild(option);
    });
    return select;
  }

  function updateRow(tr) {
    const product = productsById.get(tr.product.value);
    const counted = tr.counted.value === '' ? null : Number(tr.counted.value);
    const have = product && recordedFor ? recorded[product._id] || 0 : null;

    tr.recordedCell.textContent = have === null ? '—' : `${fmt(have)} ${product.uom}`;
    tr.diffCell.className = 'td text-right font-mono tabular whitespace-nowrap';
    tr.valueCell.className = 'td text-right font-mono tabular whitespace-nowrap';
    if (have === null || counted === null || !Number.isFinite(counted)) {
      tr.diffCell.textContent = '—';
      tr.valueCell.textContent = '—';
      tr.dataset.value = '0';
      tr.dataset.state = counted === null ? '' : 'counted';
      return;
    }
    const diff = Math.round((counted - have) * 1000) / 1000;
    const value = diff * (product.unitCost || 0);
    tr.diffCell.textContent = diff === 0 ? '0' : `${diff > 0 ? '+' : ''}${fmt(diff)}`;
    tr.valueCell.textContent = diff === 0 ? '—' : money(value);
    const tone = diff > 0 ? 'text-ok' : diff < 0 ? 'text-bad' : 'text-muted';
    tr.diffCell.classList.add(tone, 'font-semibold');
    tr.valueCell.classList.add(tone);
    tr.dataset.value = String(value);
    tr.dataset.state = diff === 0 ? 'match' : diff > 0 ? 'over' : 'under';
  }

  function updateAll() {
    rows().forEach(updateRow);
    const total = rows().reduce((sum, tr) => sum + Number(tr.dataset.value || 0), 0);
    totalValue.textContent = money(total);
    totalValue.className = `td text-right font-mono font-semibold tabular whitespace-nowrap border-t border-line-2 ${total < 0 ? 'text-bad' : total > 0 ? 'text-ok' : ''}`;
    // Progress: lines with a product and a counted quantity
    const withProduct = rows().filter((tr) => tr.product.value);
    const done = withProduct.filter((tr) => tr.counted.value !== '').length;
    if (progressText) progressText.textContent = withProduct.length ? `${done} of ${withProduct.length} counted` : 'Nothing on the sheet yet';
    if (progressBar) progressBar.style.width = `${withProduct.length ? (done / withProduct.length) * 100 : 0}%`;
    const hide = hideRecorded();
    document.querySelectorAll('[data-recorded-only]').forEach((el) => el.classList.toggle('hidden', hide));
  }

  function addLine(line = {}) {
    const tr = document.createElement('tr');
    tr.className = 'animate-fade-up';
    tr.product = productSelect(line.product);
    tr.counted = document.createElement('input');
    Object.assign(tr.counted, { type: 'number', min: '0', step: 'any', className: 'sheet-input', placeholder: 'Count' });
    tr.counted.dataset.sheetCell = '';
    tr.counted.setAttribute('aria-label', 'Counted quantity');
    tr.counted.value = line.quantity !== undefined && line.quantity !== null ? line.quantity : '';
    tr.reason = reasonSelect(line.reason);
    tr.recordedCell = cell('td text-right font-mono tabular text-muted whitespace-nowrap');
    tr.recordedCell.dataset.recordedOnly = '';
    tr.diffCell = cell('td text-right font-mono tabular');
    tr.diffCell.dataset.recordedOnly = '';
    tr.valueCell = cell('td text-right font-mono tabular');
    tr.valueCell.dataset.recordedOnly = '';

    const productCell = cell();
    productCell.appendChild(tr.product);
    const countedCell = cell();
    countedCell.appendChild(tr.counted);
    const reasonCell = cell();
    reasonCell.appendChild(tr.reason);
    const removeCell = cell('td text-right');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost btn-icon btn-sm text-muted hover:!text-bad';
    remove.setAttribute('aria-label', 'Remove line');
    remove.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
    removeCell.appendChild(remove);

    tr.append(productCell, tr.recordedCell, countedCell, tr.diffCell, tr.valueCell, reasonCell, removeCell);
    tr.product.addEventListener('change', updateAll);
    tr.counted.addEventListener('input', updateAll);
    remove.addEventListener('click', () => {
      tr.remove();
      if (rows().length === 0) addLine();
      updateAll();
    });
    tbody.appendChild(tr);
    tr.combo = combobox(tr.product, { placeholder: 'Search product or SKU…', emptyText: 'No product matches' });
    updateAll();
    return tr;
  }

  async function loadRecorded() {
    const location = locationSelect.value;
    if (!location) {
      recorded = {};
      recordedFor = null;
      updateAll();
      return [];
    }
    try {
      const res = await api('GET', `/api/stock/at-location?location=${encodeURIComponent(location)}`);
      if (location !== locationSelect.value) return []; // changed meanwhile
      // Blind count: the counter only learns which products to count, never how many are recorded
      recorded = hideRecorded() ? {} : Object.fromEntries(res.data.stock.map((s) => [String(s.product), s.quantity]));
      recordedFor = hideRecorded() ? null : location;
      updateAll();
      return res.data.stock;
    } catch (err) {
      toast(err.message, 'error');
      return [];
    }
  }

  // Add a line for every product recorded at the location (keeps existing lines)
  async function loadExpected() {
    if (!locationSelect.value) {
      toast('Choose the location you are counting first', 'error');
      return;
    }
    const stocked = await loadRecorded();
    const present = new Set(rows().map((tr) => tr.product.value).filter(Boolean));
    rows().filter((tr) => !tr.product.value && tr.counted.value === '').forEach((tr) => tr.remove());
    stocked.forEach((s) => {
      if (!present.has(String(s.product)) && productsById.has(String(s.product))) addLine({ product: String(s.product) });
    });
    if (rows().length === 0) addLine();
    toast(stocked.length ? `${stocked.length} product(s) recorded at this location` : 'Nothing is recorded at this location yet', 'info', 3000);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden', 'animate-shake');
    void errorBox.offsetWidth;
    errorBox.classList.add('animate-shake');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function collect() {
    if (!locationSelect.value) return { error: 'Choose the location you counted.' };
    const lines = rows()
      .filter((tr) => tr.product.value || tr.counted.value !== '')
      .map((tr) => ({ product: tr.product.value, quantity: tr.counted.value, reason: tr.reason.value }));
    if (lines.length === 0) return { error: 'Add at least one product to the count.' };
    if (lines.some((l) => !l.product)) return { error: 'Choose a product on every line (or remove the empty line).' };
    if (lines.some((l) => l.quantity === '' || !(Number(l.quantity) >= 0))) {
      return { error: 'Enter a counted quantity on every line (0 if there are none).' };
    }
    const seen = new Set();
    for (const l of lines) {
      if (seen.has(l.product)) return { error: `${productsById.get(l.product).name} is on the sheet twice.` };
      seen.add(l.product);
    }
    return {
      body: {
        location: locationSelect.value,
        scheduledDate: form.scheduledDate.value,
        notes: form.notes.value,
        blindCount: blindBox.checked,
        lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
      },
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    const mode = (e.submitter && e.submitter.dataset.submit) || 'draft';
    const { body, error } = collect();
    if (error) return showError(error);

    const buttons = form.querySelectorAll('button[type=submit]');
    buttons.forEach((b) => setBusy(b, true, 'Saving...'));
    let operation;
    try {
      const res = config.operationId
        ? await api('PATCH', `/api/operations/${config.operationId}`, body)
        : await api('POST', '/api/operations', { ...body, type: 'adjustment' });
      operation = res.data.operation;
    } catch (err) {
      showError(err.message);
      buttons.forEach((b) => setBusy(b, false));
      return;
    }

    let message = `${operation.reference} saved as draft`;
    let tone = 'success';
    if (mode === 'confirm') {
      try {
        await api('POST', `/api/operations/${operation._id}/confirm`);
        message = `${operation.reference} submitted - an Inventory Manager can now apply it`;
      } catch (err) {
        message = `${operation.reference} saved, but could not be submitted: ${err.message}`;
        tone = 'error';
      }
    }
    toastAfterNavigation(message, tone);
    window.location.href = `/operations/${operation._id}`;
  });

  document.getElementById('addLine').addEventListener('click', () => addLine().combo.focus());

  // Spreadsheet keys: Enter / Down = next row, Shift+Enter / Up = previous row
  tbody.addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-sheet-cell]')) return;
    const cells = [...tbody.querySelectorAll('[data-sheet-cell]')];
    const at = cells.indexOf(e.target);
    let next = null;
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown') next = at + 1;
    else if ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp') next = at - 1;
    if (next === null) return;
    e.preventDefault();
    if (next >= cells.length && e.key === 'Enter') {
      addLine().combo.focus(); // Enter on the last row starts a new line
      return;
    }
    const target = cells[Math.max(0, Math.min(cells.length - 1, next))];
    target.focus();
    target.select();
  });
  document.getElementById('loadExpected').addEventListener('click', loadExpected);
  document.getElementById('copyRecorded').addEventListener('click', () => {
    rows().forEach((tr) => {
      if (tr.product.value) tr.counted.value = recorded[tr.product.value] || 0;
    });
    updateAll();
  });
  document.getElementById('zeroAll').addEventListener('click', () => {
    rows().forEach((tr) => {
      if (tr.product.value) tr.counted.value = 0;
    });
    updateAll();
  });
  blindBox.addEventListener('change', updateAll);
  locationSelect.addEventListener('change', async () => {
    const empty = rows().every((tr) => !tr.product.value);
    if (empty) await loadExpected();
    else await loadRecorded();
  });

  // Initial state
  (async () => {
    config.lines.forEach((line) => addLine(line));
    if (config.operationId) {
      await loadRecorded();
    } else if (locationSelect.value) {
      await loadExpected();
    }
    if (config.prefillProduct && !rows().some((tr) => tr.product.value === config.prefillProduct)) {
      rows().filter((tr) => !tr.product.value).forEach((tr) => tr.remove());
      addLine({ product: config.prefillProduct }).counted.focus();
    }
    if (rows().length === 0) addLine();
    updateAll();
  })();
})();
