/**
 * Dependency-free SVG charts for the admin dashboard (professional graphics).
 * All charts are pure functions returning SVG strings — no external libraries,
 * no canvas, fully responsive via viewBox.
 */

const PALETTE = ['#00cec9', '#6c5ce7', '#fd79a8', '#fdcb6e', '#e17055', '#00b894', '#8b7cf7'];

const empty = (msg = 'No data yet — charts fill in as orders arrive.') =>
  `<p class="chart-empty">${msg}</p>`;

const fmt = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);

/** Area + line chart with grid, dots and axis labels. */
export function lineChart(values, labels = [], { height = 220 } = {}) {
  if (!values.length || values.every((v) => !v)) return empty();
  const w = 560;
  const h = height;
  const pad = { t: 14, r: 12, b: 26, l: 44 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(...values, 1) * 1.15;
  const step = values.length > 1 ? iw / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad.l + i * step, pad.t + ih - (v / max) * ih]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(pad.l + iw).toFixed(1)},${(pad.t + ih).toFixed(1)} L${pad.l},${(pad.t + ih).toFixed(1)} Z`;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = (pad.t + ih * f).toFixed(1);
    const val = fmt(max * (1 - f));
    return `<line x1="${pad.l}" y1="${y}" x2="${pad.l + iw}" y2="${y}" class="chart-grid" />
      <text x="${pad.l - 6}" y="${y}" dy="0.32em" text-anchor="end" class="chart-label">${val}</text>`;
  }).join('');

  const labelEvery = Math.ceil(labels.length / 7);
  const xLabels = labels.map((l, i) => (i % labelEvery === 0
    ? `<text x="${pts[i][0].toFixed(1)}" y="${h - 8}" text-anchor="middle" class="chart-label">${l}</text>`
    : '')).join('');

  const dots = values.length <= 31
    ? pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="chart-dot" />`).join('')
    : '';

  return `
    <svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Area chart">
      <defs>
        <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00cec9" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#00cec9" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#chart-area)" />
      <path d="${line}" fill="none" stroke="#00cec9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
      ${xLabels}
    </svg>`;
}

/** Vertical bar chart. */
export function barChart(values, labels = [], { height = 220 } = {}) {
  if (!values.length || values.every((v) => !v)) return empty();
  const w = 560;
  const h = height;
  const pad = { t: 14, r: 12, b: 26, l: 44 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(...values, 1) * 1.15;
  const slot = iw / values.length;
  const bw = Math.min(38, slot * 0.62);

  const bars = values.map((v, i) => {
    const bh = (v / max) * ih;
    const x = pad.l + i * slot + (slot - bw) / 2;
    const y = pad.t + ih - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, 1).toFixed(1)}" rx="6" fill="url(#chart-bar)" />`;
  }).join('');

  const grid = [0, 0.5, 1].map((f) => {
    const y = (pad.t + ih * f).toFixed(1);
    return `<line x1="${pad.l}" y1="${y}" x2="${pad.l + iw}" y2="${y}" class="chart-grid" />
      <text x="${pad.l - 6}" y="${y}" dy="0.32em" text-anchor="end" class="chart-label">${fmt(max * (1 - f))}</text>`;
  }).join('');

  const labelEvery = Math.ceil(labels.length / 7);
  const xLabels = labels.map((l, i) => (i % labelEvery === 0
    ? `<text x="${(pad.l + i * slot + slot / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="chart-label">${l}</text>`
    : '')).join('');

  return `
    <svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Bar chart">
      <defs>
        <linearGradient id="chart-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6c5ce7" />
          <stop offset="100%" stop-color="#00cec9" />
        </linearGradient>
      </defs>
      ${grid}
      ${bars}
      ${xLabels}
    </svg>`;
}

/** Donut chart with legend. segments: [{ label, value, color? }] */
export function donutChart(segments, { size = 190, thickness = 26 } = {}) {
  const data = (segments || []).filter((s) => s.value > 0);
  if (!data.length) return empty('No orders yet — the status breakdown appears with the first order.');
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const len = frac * c;
    const arc = `
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${d.color || PALETTE[i % PALETTE.length]}" stroke-width="${thickness}"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="butt" />`;
    offset += len;
    return arc;
  }).join('');

  const legend = data.map((d, i) => `
    <span class="chart-legend-item">
      <span class="dot" style="background:${d.color || PALETTE[i % PALETTE.length]}"></span>
      ${d.label} · ${d.value} (${Math.round((d.value / total) * 100)}%)
    </span>`).join('');

  return `
    <div class="donut-wrap">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Donut chart">
        ${arcs}
        <text x="${size / 2}" y="${size / 2 - 2}" text-anchor="middle" class="chart-total">${total}</text>
        <text x="${size / 2}" y="${size / 2 + 18}" text-anchor="middle" class="chart-label">orders</text>
      </svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}