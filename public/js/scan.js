/**
 * Scan & Pick input: USB/Bluetooth barcode scanners (they type + Enter),
 * manual entry, or the device camera (html5-qrcode, loaded on demand).
 * Gives instant feedback: beep / buzz, vibration, coloured flash, scan log.
 *
 *   window.StockSenseScanner.attach({ form, input, quantity?, log, cameraButton, cameraBox,
 *                                     onCode: async (code, qty) => ({ message, done? }) })
 */
(function () {
  'use strict';

  const CAMERA_LIB = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
  let audioCtx = null;

  function tone(ok) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = ok ? 'sine' : 'sawtooth';
      osc.frequency.value = ok ? 1046 : 160;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (ok ? 0.12 : 0.35));
    } catch (e) {
      /* audio not available */
    }
    if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]);
  }

  function loadCameraLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CAMERA_LIB;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the camera scanner'));
      document.head.appendChild(s);
    });
  }

  function attach(opts) {
    const { form, input, quantity, log, cameraButton, cameraBox, onCode } = opts;
    const panel = form.closest('section') || form;
    let queue = Promise.resolve();
    let lastCode = null;
    let lastAt = 0;
    let camera = null;

    const addLog = (ok, text) => {
      const li = document.createElement('li');
      li.className = `flex items-start gap-2 ${ok ? 'text-emerald-300' : 'text-red-300'}`;
      const mark = document.createElement('span');
      mark.className = 'font-bold';
      mark.textContent = ok ? '✓' : '✕';
      const msg = document.createElement('span');
      msg.textContent = text;
      li.append(mark, msg);
      log.prepend(li);
      while (log.children.length > 6) log.lastElementChild.remove();
    };

    const flash = (ok) => {
      panel.classList.remove('ring-2', 'ring-emerald-500/60', 'ring-red-500/60');
      void panel.offsetWidth; // restart the transition
      panel.classList.add('ring-2', ok ? 'ring-emerald-500/60' : 'ring-red-500/60');
      setTimeout(() => panel.classList.remove('ring-2', 'ring-emerald-500/60', 'ring-red-500/60'), 700);
    };

    function handle(rawCode, { fromCamera = false } = {}) {
      const code = String(rawCode || '').trim();
      if (!code) return;
      // Cameras report the same code many times per second; USB scanners and typing
      // are deliberate, so every one of those counts (e.g. five identical chairs)
      const now = Date.now();
      if (fromCamera && code === lastCode && now - lastAt < 1500) return;
      lastCode = code;
      lastAt = now;
      const qty = quantity && quantity.value !== '' ? Number(quantity.value) : 1;

      // One scan at a time, in order
      queue = queue.then(async () => {
        try {
          const result = await onCode(code, qty);
          tone(true);
          flash(true);
          addLog(true, result && result.message ? result.message : code);
        } catch (err) {
          tone(false);
          flash(false);
          addLog(false, err.message || `Could not use "${code}"`);
        }
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handle(input.value);
      input.value = '';
      input.focus({ preventScroll: true });
    });

    async function startCamera() {
      try {
        await loadCameraLib();
        if (!cameraBox.id) cameraBox.id = `scan-camera-${Math.random().toString(36).slice(2)}`;
        cameraBox.classList.remove('hidden');
        const formats = window.Html5QrcodeSupportedFormats;
        camera = new window.Html5Qrcode(cameraBox.id, {
          formatsToSupport: [formats.CODE_128, formats.QR_CODE, formats.EAN_13, formats.CODE_39, formats.UPC_A],
          verbose: false,
        });
        await camera.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 280, height: 140 } }, (text) => handle(text, { fromCamera: true }));
        cameraButton.textContent = 'Stop camera';
      } catch (err) {
        camera = null;
        cameraBox.classList.add('hidden');
        const insecure = !window.isSecureContext;
        addLog(false, insecure ? 'Camera needs HTTPS (or localhost). Use a USB scanner or type the code.' : `Camera unavailable: ${err.message || err}`);
      }
    }

    async function stopCamera() {
      if (!camera) return;
      try {
        await camera.stop();
        camera.clear();
      } catch (e) {
        /* already stopped */
      }
      camera = null;
      cameraBox.classList.add('hidden');
      cameraButton.textContent = 'Use camera';
    }

    if (cameraButton) {
      cameraButton.addEventListener('click', () => (camera ? stopCamera() : startCamera()));
    }
    window.addEventListener('beforeunload', stopCamera);
    input.focus({ preventScroll: true });

    return { handle, stopCamera };
  }

  window.StockSenseScanner = { attach };
})();
