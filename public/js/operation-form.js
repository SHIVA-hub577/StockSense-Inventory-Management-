/**
 * Receipt / delivery / transfer form: dynamic product lines with live
 * availability at the source location, then save (and optionally confirm).
 */
(function () {
  'use strict';

  const config = JSON.parse(document.getElementById('operationFormData').textContent);
  const { api, toastAfterNavigation, setBusy } = window.StockSense;

  const form = document.getElementById('operationForm');
  const tbody = document.getElementById('lines');
  const errorBox = document.getElementById('formError');
  const sourceSelect = document.getElementById('sourceLocation');
  const destSelect = document.getElementById('destLocation');

  const productsById = new Map(config.products.map((p) => [p._id, p]));
  const byCategory = new Map();
  config.products.forEach((p) => {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  });

  // productId -> quantity at `availableLocation` (undefined = loading, null = unknown)
  let available = {};
  let availableLocation = null;
  let requestSeq = 0;
  const rows = () => Array.from(tbody.querySelectorAll('tr'));
  const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

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

  // Total requested per product across all rows (duplicates are merged on save)
  function requested(productId) {
    return rows()
      .filter((tr) => tr.select.value === productId)
      .reduce((sum, tr) => sum + (Number(tr.qty.value) || 0), 0);
  }

  function updateRow(tr) {
    const product = productsById.get(tr.select.value);
    tr.uom.textContent = product ? product.uom : '—';
    if (!config.needsSource) return;

    tr.avail.className = 'td whitespace-nowrap text-sm';
    tr.avail.removeAttribute('title');
    if (!product || !sourceSelect.value) {
      tr.avail.textContent = '—';
      tr.avail.classList.add('text-slate-500');
      return;
    }
    const have = available[product._id];
    if (have === undefined || have === null) {
      tr.avail.textContent = have === undefined ? '…' : '—';
      tr.avail.classList.add('text-slate-500');
      return;
    }
    const need = requested(product._id);
    tr.avail.textContent = `${fmt(have)} ${product.uom}`;
    if (need > have) {
      tr.avail.classList.add('text-red-400', 'font-semibold');
      tr.avail.title = `Short by ${fmt(need - have)} ${product.uom} - the operation will wait for stock`;
      tr.avail.textContent += ' ⚠';
    } else {
      tr.avail.classList.add('text-emerald-400');
    }
  }

  const updateAll = () => rows().forEach(updateRow);

  async function refreshAvailability() {
    if (!config.needsSource) return;
    const location = sourceSelect.value;
    if (location !== availableLocation) {
      // Never show one location's numbers under another
      available = {};
      availableLocation = location;
    }
    const ids = [...new Set(rows().map((tr) => tr.select.value).filter(Boolean))];
    if (!location || ids.length === 0) {
      updateAll();
      return;
    }

    const seq = ++requestSeq;
    try {
      const res = await api('GET', `/api/stock/available?location=${encodeURIComponent(location)}&products=${ids.join(',')}`);
      if (seq !== requestSeq || location !== sourceSelect.value) return; // a newer request superseded this one
      Object.assign(available, res.data.available);
    } catch (err) {
      if (seq !== requestSeq) return;
      ids.forEach((id) => {
        if (available[id] === undefined) available[id] = null; // availability is only a hint
      });
    }
    updateAll();
  }

  function addLine(line = {}) {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-800';

    tr.select = productSelect(line.product);
    tr.qty = document.createElement('input');
    tr.qty.type = 'number';
    tr.qty.min = '0';
    tr.qty.step = 'any';
    tr.qty.className = 'input tabular-nums';
    tr.qty.placeholder = '0';
    tr.qty.setAttribute('aria-label', 'Quantity');
    tr.qty.value = line.quantity !== undefined ? line.quantity : '';
    tr.uom = cell('td text-sm text-slate-400');

    const productCell = cell();
    productCell.appendChild(tr.select);
    const qtyCell = cell();
    qtyCell.appendChild(tr.qty);
    tr.append(productCell, qtyCell, tr.uom);

    if (config.needsSource) {
      tr.avail = cell();
      tr.appendChild(tr.avail);
    }

    const removeCell = cell('td text-right');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-secondary btn-sm';
    remove.setAttribute('aria-label', 'Remove line');
    remove.textContent = '✕';
    removeCell.appendChild(remove);
    tr.appendChild(removeCell);

    tr.select.addEventListener('change', () => {
      updateAll();
      refreshAvailability();
    });
    tr.qty.addEventListener('input', updateAll);
    remove.addEventListener('click', () => {
      tr.remove();
      if (rows().length === 0) addLine();
      updateAll();
    });

    tbody.appendChild(tr);
    updateRow(tr);
    return tr;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function collect() {
    const lines = rows()
      .filter((tr) => tr.select.value || tr.qty.value)
      .map((tr) => ({ product: tr.select.value, quantity: tr.qty.value }));

    if (lines.length === 0) return { error: 'Add at least one product.' };
    if (lines.some((l) => !l.product)) return { error: 'Choose a product on every line (or remove the empty line).' };
    if (lines.some((l) => !(Number(l.quantity) > 0))) return { error: 'Every quantity must be greater than zero.' };
    if (sourceSelect && !sourceSelect.value) return { error: 'Choose the location the stock comes from.' };
    if (destSelect && !destSelect.value) return { error: 'Choose the location the stock goes to.' };
    if (sourceSelect && destSelect && sourceSelect.value === destSelect.value) {
      return { error: 'Source and destination must be different locations.' };
    }
    const partner = form.partner.value.trim();
    if (config.type !== 'internal' && !partner) {
      return { error: config.type === 'receipt' ? 'Enter the supplier.' : 'Enter the customer.' };
    }

    const body = {
      partner,
      scheduledDate: form.scheduledDate.value,
      notes: form.notes.value,
      lines: lines.map((l) => ({ product: l.product, quantity: Number(l.quantity) })),
    };
    if (sourceSelect) body.sourceLocation = sourceSelect.value;
    if (destSelect) body.destLocation = destSelect.value;
    return { body };
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
        : await api('POST', '/api/operations', { ...body, type: config.type });
      operation = res.data.operation;
    } catch (err) {
      showError(err.message);
      buttons.forEach((b) => setBusy(b, false));
      return;
    }

    let message = `${operation.reference} saved as draft`;
    let type = 'success';
    if (mode === 'confirm') {
      try {
        const res = await api('POST', `/api/operations/${operation._id}/confirm`);
        message = res.message;
        type = res.data.operation.status === 'ready' ? 'success' : 'info';
      } catch (err) {
        message = `${operation.reference} saved, but could not be confirmed: ${err.message}`;
        type = 'error';
      }
    }
    toastAfterNavigation(message, type);
    window.location.href = `/operations/${operation._id}`;
  });

  document.getElementById('addLine').addEventListener('click', () => addLine().select.focus());
  if (sourceSelect) sourceSelect.addEventListener('change', refreshAvailability);

  (config.lines.length ? config.lines : [{}]).forEach((line) => addLine(line));
  refreshAvailability();
})();
