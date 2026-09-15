import { escapeHtml } from '../../util/html.js';

/**
 * Hand-drawn, dependency-free SVG chart components (FEAT-008, section 27/31).
 *
 * Every function is pure and returns an inline SVG string. There is NO chart
 * library and NO runtime dependency: the geometry is computed here and emitted
 * as SVG paths/rects. Charts are responsive via a viewBox (no fixed width) and
 * accessible via <title> + role="img" + aria-label. All text/labels are escaped
 * through escapeHtml.
 *
 * A shared palette keeps the visuals consistent with the app's design tokens.
 */

export interface ChartDatum {
  label: string;
  value: number;
}

const PALETTE = ['#4f7cff', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444', '#64748b'];

function color(i: number): string {
  return PALETTE[i % PALETTE.length];
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function money(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function emptyChart(title: string): string {
  return `<figure class="chart chart-empty" role="img" aria-label="${escapeHtml(title)}: no data">
  <figcaption class="chart-title">${escapeHtml(title)}</figcaption>
  <p class="chart-empty-note">No data yet.</p>
</figure>`;
}

export interface BarChartOptions {
  title: string;
  data: ChartDatum[];
  /** Format values as money (adds a $). Default false. */
  money?: boolean;
  /** Max bars to render (rest is dropped). Default 8. */
  maxBars?: number;
}

/**
 * A horizontal bar chart: one labeled bar per datum, width proportional to
 * value. Good for "best sets" / "best Pokemon" rankings.
 */
export function barChart(opts: BarChartOptions): string {
  const data = opts.data.slice(0, opts.maxBars ?? 8).filter((d) => Number.isFinite(d.value));
  if (data.length === 0) return emptyChart(opts.title);
  const fmtVal = opts.money ? money : (n: number) => fmt(n);

  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const rowH = 28;
  const gap = 10;
  const labelW = 120;
  const valueW = 64;
  const chartW = 460;
  const barsW = chartW - labelW - valueW;
  const height = data.length * (rowH + gap) + gap;

  const rows = data
    .map((d, i) => {
      const y = gap + i * (rowH + gap);
      const w = Math.max(2, (Math.abs(d.value) / max) * barsW);
      return `<g>
    <text x="0" y="${y + rowH / 2 + 4}" class="chart-axis-label">${escapeHtml(d.label)}</text>
    <rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" rx="4" fill="${color(i)}"></rect>
    <text x="${labelW + w + 6}" y="${y + rowH / 2 + 4}" class="chart-value-label">${escapeHtml(fmtVal(d.value))}</text>
  </g>`;
    })
    .join('\n');

  return `<figure class="chart" role="img" aria-label="${escapeHtml(opts.title)}">
  <figcaption class="chart-title">${escapeHtml(opts.title)}</figcaption>
  <svg viewBox="0 0 ${chartW} ${height}" preserveAspectRatio="xMinYMin meet" class="chart-svg">
    <title>${escapeHtml(opts.title)}</title>
${rows}
  </svg>
</figure>`;
}

export interface LineChartOptions {
  title: string;
  /** X-axis labels (one per point). */
  labels: string[];
  /** One or more named series sharing the same x-axis. */
  series: Array<{ name: string; values: number[] }>;
  money?: boolean;
  /** Fill under the first series (area chart). Default false. */
  area?: boolean;
}

/**
 * A multi-series line/area chart. Used for revenue + profit over time.
 */
export function lineChart(opts: LineChartOptions): string {
  const n = opts.labels.length;
  const hasData = n > 0 && opts.series.some((s) => s.values.some((v) => Number.isFinite(v)));
  if (!hasData) return emptyChart(opts.title);
  const fmtVal = opts.money ? money : (x: number) => fmt(x);

  const W = 480;
  const H = 220;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allValues = opts.series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);
  const min = Math.min(0, ...allValues);
  const range = max - min || 1;

  const xFor = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v: number) => padT + plotH - ((v - min) / range) * plotH;

  // Gridlines + y labels (0, mid, max).
  const gridVals = [min, min + range / 2, max];
  const grid = gridVals
    .map((gv) => {
      const y = yFor(gv);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="chart-grid"></line>
    <text x="${padL - 6}" y="${y.toFixed(1)}" class="chart-axis-label chart-axis-y">${escapeHtml(fmtVal(gv))}</text>`;
    })
    .join('\n');

  const xLabels = opts.labels
    .map((lbl, i) => {
      if (n > 6 && i % Math.ceil(n / 6) !== 0 && i !== n - 1) return '';
      return `<text x="${xFor(i).toFixed(1)}" y="${H - 10}" class="chart-axis-label chart-axis-x">${escapeHtml(lbl)}</text>`;
    })
    .join('\n');

  const seriesSvg = opts.series
    .map((s, si) => {
      const pts = s.values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`);
      const c = color(si);
      let areaPath = '';
      if (opts.area && si === 0 && pts.length > 0) {
        const baseY = yFor(min).toFixed(1);
        areaPath = `<polygon points="${xFor(0).toFixed(1)},${baseY} ${pts.join(' ')} ${xFor(n - 1).toFixed(1)},${baseY}" fill="${c}" fill-opacity="0.12"></polygon>`;
      }
      const dots = s.values
        .map((v, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="2.5" fill="${c}"></circle>`)
        .join('');
      const line =
        pts.length === 1
          ? `<circle cx="${xFor(0).toFixed(1)}" cy="${yFor(s.values[0]).toFixed(1)}" r="3" fill="${c}"></circle>`
          : `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
      return `${areaPath}${line}${dots}`;
    })
    .join('\n');

  const legend =
    opts.series.length > 1
      ? `<div class="chart-legend">${opts.series
          .map((s, si) => `<span class="chart-legend-item"><span class="chart-swatch" style="background:${color(si)}"></span>${escapeHtml(s.name)}</span>`)
          .join('')}</div>`
      : '';

  return `<figure class="chart" role="img" aria-label="${escapeHtml(opts.title)}">
  <figcaption class="chart-title">${escapeHtml(opts.title)}</figcaption>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" class="chart-svg">
    <title>${escapeHtml(opts.title)}</title>
${grid}
${seriesSvg}
${xLabels}
  </svg>
  ${legend}
</figure>`;
}

export interface DonutChartOptions {
  title: string;
  data: ChartDatum[];
  money?: boolean;
}

/**
 * A donut chart for a small categorical split (e.g. singles vs bulk revenue).
 * Falls back to an empty state when every value is zero.
 */
export function donutChart(opts: DonutChartOptions): string {
  const data = opts.data.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return emptyChart(opts.title);
  const fmtVal = opts.money ? money : (x: number) => fmt(x);

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;
  const inner = 44;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = data
    .map((d, i) => {
      const frac = d.value / total;
      const len = frac * circ;
      const dash = `${len.toFixed(2)} ${(circ - len).toFixed(2)}`;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color(i)}" stroke-width="${r - inner}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
      offset += len;
      return seg;
    })
    .join('\n');

  const legend = data
    .map((d, i) => {
      const pct = ((d.value / total) * 100).toFixed(0);
      return `<li class="chart-legend-item"><span class="chart-swatch" style="background:${color(i)}"></span>${escapeHtml(d.label)} — ${escapeHtml(fmtVal(d.value))} (${pct}%)</li>`;
    })
    .join('');

  return `<figure class="chart chart-donut" role="img" aria-label="${escapeHtml(opts.title)}">
  <figcaption class="chart-title">${escapeHtml(opts.title)}</figcaption>
  <div class="chart-donut-body">
    <svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" class="chart-svg chart-donut-svg">
      <title>${escapeHtml(opts.title)}</title>
${arcs}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="chart-donut-total">${escapeHtml(fmtVal(total))}</text>
    </svg>
    <ul class="chart-legend chart-legend-list">${legend}</ul>
  </div>
</figure>`;
}

export interface StackedBarOptions {
  title: string;
  data: ChartDatum[];
  money?: boolean;
}

/**
 * A single horizontal stacked bar splitting a total across categories. Used as
 * an alternative compact view for the inventory value breakdown.
 */
export function stackedBar(opts: StackedBarOptions): string {
  const data = opts.data.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return emptyChart(opts.title);
  const fmtVal = opts.money ? money : (x: number) => fmt(x);

  const W = 460;
  const barH = 34;
  let x = 0;
  const segs = data
    .map((d, i) => {
      const w = (d.value / total) * W;
      const seg = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${barH}" fill="${color(i)}"></rect>`;
      x += w;
      return seg;
    })
    .join('\n');

  const legend = data
    .map((d, i) => `<li class="chart-legend-item"><span class="chart-swatch" style="background:${color(i)}"></span>${escapeHtml(d.label)} — ${escapeHtml(fmtVal(d.value))}</li>`)
    .join('');

  return `<figure class="chart chart-stacked" role="img" aria-label="${escapeHtml(opts.title)}">
  <figcaption class="chart-title">${escapeHtml(opts.title)}</figcaption>
  <svg viewBox="0 0 ${W} ${barH}" preserveAspectRatio="none" class="chart-svg chart-stacked-svg">
    <title>${escapeHtml(opts.title)}</title>
${segs}
  </svg>
  <ul class="chart-legend chart-legend-list">${legend}</ul>
</figure>`;
}
