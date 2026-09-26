/**
 * Searchable combobox and quantity stepper that enhance native controls.
 *
 *   StockSense.combobox(select)  - type to filter a <select> (name, SKU...).
 *     The <select> stays the source of truth: picking an option sets its value
 *     and fires "change"; setting select.value from code + "change" updates
 *     the text box. Option text "Name (SKU)" shows the SKU as a chip.
 *   StockSense.stepper(input)    - wraps a number input with - / + buttons
 *     (hold to repeat); fires "input" like typing does.
 */
(function () {
  'use strict';

  const S = window.StockSense || (window.StockSense = {});
  let uid = 0;

  // "Steel Rods (STL-ROD)" -> { name: 'Steel Rods', code: 'STL-ROD' }
  const splitLabel = (text) => {
    const m = /^(.*)\s\(([^()]+)\)$/.exec(text);
    return m ? { name: m[1], code: m[2] } : { name: text, code: '' };
  };

  function combobox(select, { placeholder = 'Search…', emptyText = 'No matches' } = {}) {
    if (select.dataset.combobox) return select._combobox;
    select.dataset.combobox = '1';
    const id = `combo-${++uid}`;

    // Options as data (groups come from <optgroup>)
    const options = [...select.options]
      .filter((o) => o.value)
      .map((o) => ({ value: o.value, text: o.text, group: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '', ...splitLabel(o.text) }));

    const wrap = document.createElement('div');
    wrap.className = 'relative';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input pr-9';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${id}-list`);
    input.setAttribute('aria-label', select.getAttribute('aria-label') || 'Choose');
    const chevron = document.createElement('span');
    chevron.className = 'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-transform duration-200';
    chevron.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>';
    const list = document.createElement('ul');
    list.id = `${id}-list`;
    list.className = 'popover combo-list hidden';
    list.setAttribute('role', 'listbox');

    // The native select stays in the page (forms, tests, live code read it) but out of the way
    select.classList.add('sr-only');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.parentNode.insertBefore(wrap, select);
    wrap.append(input, chevron, list, select);

    let shown = [];
    let active = -1;
    const labelFor = (value) => {
      const o = options.find((x) => x.value === value);
      return o ? o.name : '';
    };
    const syncFromSelect = () => {
      input.value = labelFor(select.value);
      wrap.dataset.code = (options.find((x) => x.value === select.value) || {}).code || '';
    };

    function render(query) {
      const q = query.trim().toLowerCase();
      shown = options.filter((o) => !q || o.text.toLowerCase().includes(q));
      list.replaceChildren();
      let group = null;
      shown.forEach((o, i) => {
        if (o.group && o.group !== group) {
          group = o.group;
          const g = document.createElement('li');
          g.setAttribute('role', 'presentation');
          g.className = 'px-2.5 pt-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted';
          g.textContent = group;
          list.appendChild(g);
        }
        const li = document.createElement('li');
        li.id = `${id}-opt-${i}`;
        li.dataset.index = i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(o.value === select.value));
        li.className = 'menu-item cursor-pointer justify-between';
        const name = document.createElement('span');
        name.className = 'truncate font-medium text-ink';
        name.textContent = o.name;
        li.appendChild(name);
        if (o.code) {
          const chip = document.createElement('span');
          chip.className = 'sku shrink-0';
          chip.textContent = o.code;
          li.appendChild(chip);
        }
        list.appendChild(li);
      });
      if (shown.length === 0) {
        const none = document.createElement('li');
        none.setAttribute('role', 'presentation');
        none.className = 'px-3 py-4 text-sm text-center text-muted';
        none.textContent = emptyText;
        list.appendChild(none);
      }
      setActive(Math.max(0, shown.findIndex((o) => o.value === select.value)));
    }

    function setActive(i) {
      active = shown.length ? Math.min(Math.max(i, 0), shown.length - 1) : -1;
      list.querySelectorAll('[role=option]').forEach((li) => {
        const on = Number(li.dataset.index) === active;
        li.classList.toggle('!bg-sunken', on);
        if (on) {
          input.setAttribute('aria-activedescendant', li.id);
          li.scrollIntoView({ block: 'nearest' });
        }
      });
      if (active < 0) input.removeAttribute('aria-activedescendant');
    }

    const isOpen = () => !list.classList.contains('hidden');
    function open() {
      if (isOpen()) return;
      render(input.value === labelFor(select.value) ? '' : input.value);
      list.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      chevron.classList.add('rotate-180');
    }
    function close(revert = true) {
      list.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
      chevron.classList.remove('rotate-180');
      if (revert) syncFromSelect();
    }
    function choose(i) {
      const o = shown[i];
      if (!o) return;
      if (select.value !== o.value) {
        select.value = o.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncFromSelect();
      close(false);
      wrap.classList.remove('animate-pop');
      void wrap.offsetWidth;
      wrap.classList.add('animate-pop');
    }

    input.addEventListener('focus', () => input.select());
    input.addEventListener('click', open);
    input.addEventListener('input', () => {
      if (!isOpen()) open();
      render(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) open();
        else setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter') {
        if (isOpen()) {
          e.preventDefault();
          choose(active);
        }
      } else if (e.key === 'Escape') {
        if (isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      } else if (e.key === 'Tab' && isOpen()) {
        if (input.value && input.value !== labelFor(select.value) && shown[active]) choose(active);
        else close();
      }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[role=option]');
      if (li) choose(Number(li.dataset.index));
    });
    input.addEventListener('blur', () => setTimeout(() => close(), 120));
    select.addEventListener('change', syncFromSelect);
    syncFromSelect();

    select._combobox = { input, open, close, focus: () => input.focus() };
    return select._combobox;
  }

  /* ------------------------------ stepper ---------------------------- */

  function stepper(input, { step = 1, min = 0 } = {}) {
    if (input.dataset.stepper) return;
    input.dataset.stepper = '1';
    const box = document.createElement('div');
    box.className = 'stepper';
    const make = (label, delta, path) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1; // arrow keys / typing work in the field itself
      b.setAttribute('aria-label', label);
      b.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
      let hold = null;
      let repeat = null;
      const bump = () => {
        const next = Math.max(min, Math.round(((Number(input.value) || 0) + delta) * 1000) / 1000);
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const stop = () => {
        clearTimeout(hold);
        clearInterval(repeat);
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        bump();
        hold = setTimeout(() => (repeat = setInterval(bump, 70)), 380);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
      b.addEventListener('click', (e) => {
        if (e.detail === 0) bump(); // keyboard "click"
      });
      return b;
    };
    const minus = make('Decrease', -step, 'M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z');
    const plus = make('Increase', step, 'M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z');
    input.classList.remove('input');
    input.parentNode.insertBefore(box, input);
    box.append(minus, input, plus);
  }

  S.combobox = combobox;
  S.stepper = stepper;
})();
