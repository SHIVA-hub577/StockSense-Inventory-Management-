/**
 * Chart.js theming: charts read the design tokens (CSS variables), and redraw
 * when the theme changes. Load after /vendor/chart.js/chart.umd.min.js.
 *   const c = StockSense.charts.colors();   // { ink, muted, line, ok, bad, ... }
 *   StockSense.charts.onTheme(draw);        // call draw() again on theme switch
 */
(function () {
  'use strict';

  const S = window.StockSense || (window.StockSense = {});
  const redraws = new Set();

  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

  function colors() {
    const c = {};
    ['ink', 'ink-2', 'muted', 'faint', 'line', 'line-2', 'surface', 'canvas', 'accent', 'accent-2', 'ok', 'warn', 'bad', 'info'].forEach((n) => {
      c[n.replace(/-(\w)/g, (m, ch) => ch.toUpperCase())] = token(n);
    });
    return c;
  }

  // Colour with alpha, as rgba() for the canvas: works for #hex and rgb() tokens
  function alpha(color, a) {
    let hex = color.replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, (ch) => ch + ch);
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      const n = parseInt(hex, 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (m) return `rgba(${m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).join(', ')}, ${a})`;
    return color;
  }

  function applyDefaults() {
    if (!window.Chart) return;
    const c = colors();
    const d = window.Chart.defaults;
    d.font.family = getComputedStyle(document.body).fontFamily;
    d.font.size = 12;
    d.color = c.muted;
    d.borderColor = c.line;
    d.plugins.legend.labels.boxWidth = 10;
    d.plugins.legend.labels.boxHeight = 10;
    d.plugins.legend.labels.usePointStyle = true;
    d.plugins.tooltip.backgroundColor = c.ink;
    d.plugins.tooltip.titleColor = c.canvas;
    d.plugins.tooltip.bodyColor = c.canvas;
    d.plugins.tooltip.padding = 10;
    d.plugins.tooltip.cornerRadius = 10;
    d.plugins.tooltip.displayColors = true;
    d.plugins.tooltip.boxPadding = 4;
    if (S.reducedMotion && S.reducedMotion()) d.animation = false;
  }

  function onTheme(fn) {
    redraws.add(fn);
  }

  applyDefaults();
  document.addEventListener('stocksense:theme', () => {
    applyDefaults();
    redraws.forEach((fn) => fn());
  });

  S.charts = { colors, alpha, onTheme, applyDefaults };
})();
