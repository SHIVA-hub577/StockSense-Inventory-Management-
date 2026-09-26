/**
 * Sign-in / sign-up helpers: status messages, 6-box OTP entry, password
 * strength meter and show / hide password buttons.
 *   StockSense.authAlert(box, message, 'error' | 'success' | 'info')
 *   StockSense.otpBoxes(container, hiddenInput, { onComplete })
 */
(function () {
  'use strict';

  const S = window.StockSense || (window.StockSense = {});

  /* ------------------------------ alerts ----------------------------- */

  const ALERT = {
    error: 'border-bad/30 bg-bad-soft text-bad',
    success: 'border-ok/30 bg-ok-soft text-ok',
    info: 'border-info/30 bg-info-soft text-info',
  };
  function authAlert(box, message, tone = 'error') {
    if (!box) return;
    box.className = `flex items-start gap-2.5 rounded-xl border p-3.5 text-sm font-medium ${ALERT[tone] || ALERT.info}`;
    box.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    box.textContent = message;
    if (tone === 'error') {
      box.classList.add('animate-shake');
      box.addEventListener('animationend', () => box.classList.remove('animate-shake'), { once: true });
    }
  }

  /* ---------------------------- OTP boxes ---------------------------- */

  function otpBoxes(container, hidden, { length = 6, onComplete } = {}) {
    container.replaceChildren();
    const boxes = [];
    const sync = () => {
      hidden.value = boxes.map((b) => b.value).join('');
      boxes.forEach((b) => b.classList.toggle('is-filled', Boolean(b.value)));
      if (hidden.value.length === length && onComplete) onComplete(hidden.value);
    };
    for (let i = 0; i < length; i++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = i === 0 ? 'one-time-code' : 'off';
      input.maxLength = 1;
      input.className = 'otp-box';
      input.setAttribute('aria-label', `Digit ${i + 1} of ${length}`);
      input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '');
        if (digits.length > 1) {
          // Autofill / paste landed in one box: spread it out
          digits.split('').slice(0, length - i).forEach((d, k) => (boxes[i + k].value = d));
          boxes[Math.min(length - 1, i + digits.length)].focus();
        } else {
          input.value = digits;
          if (digits && i < length - 1) boxes[i + 1].focus();
        }
        sync();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 0) {
          boxes[i - 1].value = '';
          boxes[i - 1].focus();
          sync();
          e.preventDefault();
        } else if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
        else if (e.key === 'ArrowRight' && i < length - 1) boxes[i + 1].focus();
      });
      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        e.preventDefault();
        text.split('').slice(0, length).forEach((d, k) => boxes[k] && (boxes[k].value = d));
        boxes[Math.min(length, text.length) - 1].focus();
        sync();
      });
      input.addEventListener('focus', () => input.select());
      boxes.push(input);
      container.appendChild(input);
    }
    return {
      focus: () => boxes[0].focus(),
      clear: () => {
        boxes.forEach((b) => (b.value = ''));
        sync();
        boxes[0].focus();
      },
      shake: () => {
        container.classList.remove('animate-shake');
        void container.offsetWidth;
        container.classList.add('animate-shake');
      },
    };
  }

  /* ------------------------ password strength ------------------------ */

  function strength(pw) {
    const checks = {
      length: pw.length >= 8,
      number: /\d/.test(pw),
      mixed: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
      symbol: /[^A-Za-z0-9]/.test(pw),
    };
    let score = Object.values(checks).filter(Boolean).length;
    if (pw.length < 6) score = Math.min(score, 1);
    return { score, checks };
  }

  const LEVELS = [
    { label: 'Too short', tone: 'bg-bad', text: 'text-bad' },
    { label: 'Weak', tone: 'bg-bad', text: 'text-bad' },
    { label: 'Fair', tone: 'bg-warn', text: 'text-warn' },
    { label: 'Good', tone: 'bg-info', text: 'text-info' },
    { label: 'Strong', tone: 'bg-ok', text: 'text-ok' },
  ];

  // (loaded before the page body, so wire meters up once the DOM exists)
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-strength]').forEach((input) => {
    const meter = document.getElementById(input.dataset.strength);
    if (!meter) return;
    const bars = meter.querySelectorAll('[data-bar]');
    const label = meter.querySelector('[data-label]');
    const hints = meter.querySelectorAll('[data-check]');
    const update = () => {
      const pw = input.value;
      const { score, checks } = strength(pw);
      const level = LEVELS[pw ? score : 0];
      bars.forEach((b, i) => {
        b.className = `h-1.5 flex-1 rounded-full transition-colors duration-300 ${pw && i < Math.max(score, 1) ? level.tone : 'bg-sunken'}`;
      });
      label.textContent = pw ? level.label : 'Use 8+ characters with a number';
      label.className = `text-xs font-semibold ${pw ? level.text : 'text-muted'}`;
      hints.forEach((h) => {
        const ok = checks[h.dataset.check];
        h.classList.toggle('text-ok', ok);
        h.classList.toggle('text-muted', !ok);
        h.querySelector('[data-mark]').textContent = ok ? '✓' : '·';
      });
    };
    input.addEventListener('input', update);
    update();
  }));

  /* -------------------------- show password -------------------------- */

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reveal-password]');
    if (!btn) return;
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.querySelector('[data-eye-open]').classList.toggle('hidden', show);
    btn.querySelector('[data-eye-closed]').classList.toggle('hidden', !show);
  });

  S.authAlert = authAlert;
  S.otpBoxes = otpBoxes;
  S.passwordStrength = strength;
})();
