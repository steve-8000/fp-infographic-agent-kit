import type { Diagram, DiagramNode, Op, Row, SolidPaint, TemplateId } from './types.js';
import { Ctx, niceScale, round } from './draw.js';
import { paint } from './theme.js';
import { inkOn, tint } from './palette.js';
import { formatValue } from './text.js';
import { bindTemplateRenderer, composeBlocks } from './blocks.js';

export type Renderer = (ctx: Ctx, top: number) => number;

const MAX_BAR_WIDTH = 168;

/* -------------------------------------------------------------- field helpers */

function fields(ctx: Ctx) {
  const hint = ctx.ir.visual.fields;
  const { columns, numericColumns } = ctx.ir.data;
  const category = hint?.category ?? columns.find((c) => c !== 'id' && !numericColumns.includes(c)) ?? columns[0] ?? 'id';
  const numeric = hint?.value ? [hint.value, ...numericColumns.filter((c) => c !== hint.value)] : numericColumns;
  return { category, value: numeric[0], numeric };
}

function labelOf(ctx: Ctx, row: Row, key: string): string {
  return formatValue(row[key], ctx.locale);
}

function graphOf(ctx: Ctx): Diagram {
  const g = ctx.ir.data.graph;
  if (!g?.nodes?.length) throw new Error(`Template "${ctx.ir.visual.template}" needs diagram.nodes`);
  return g;
}

/* ---------------------------------------------------------------------- table */

const table: Renderer = (ctx, top) => {
  const { theme } = ctx;
  const rows = ctx.ir.data.rows;
  const columns = ctx.ir.data.columns.filter((c) => c !== 'id');
  if (!columns.length) return top;

  const pad = theme.surface.panel.padding;
  const headerH = ctx.lineHeight('label') + pad;
  const bodyLh = ctx.lineHeight('body');

  // Column widths follow intrinsic content, then absorb the remainder proportionally.
  const intrinsic = columns.map((c) =>
    Math.max(ctx.measure('label', c), ...rows.map((r) => ctx.measure('body', labelOf(ctx, r, c)))) + pad * 2);
  const total = intrinsic.reduce((a, b) => a + b, 0);
  const widths = total <= ctx.safeWidth
    ? intrinsic.map((w) => w + (ctx.safeWidth - total) * (w / total))
    : intrinsic.map((w) => (w / total) * ctx.safeWidth);

  const cellLines = rows.map((r) => Math.max(
    ...columns.map((c, i) => ctx.text('body', labelOf(ctx, r, c), 0, 0, widths[i] - pad * 2).op.lines.length)));
  const rowHeights = cellLines.map((n) => n * bodyLh + pad);
  const height = headerH + rowHeights.reduce((a, b) => a + b, 0);

  ctx.group('Table', (into) => {
    into.push(ctx.rect('Table container', ctx.safeX, top, ctx.safeWidth, height, {
      fill: theme.surface.panel.fill, fillOpacity: theme.surface.panel.fillOpacity,
      stroke: theme.surface.panel.stroke, strokeWidth: theme.surface.panel.strokeWidth,
      radius: theme.surface.panel.radius,
    }));
    if (theme.surface.header) {
      into.push(ctx.rect('Header row', ctx.safeX, top, ctx.safeWidth, headerH, {
        fill: theme.surface.header.fill, fillOpacity: theme.surface.header.fillOpacity, radius: theme.surface.panel.radius,
      }));
    }
    let x = ctx.safeX;
    columns.forEach((c, i) => {
      into.push(ctx.text('label', c, x + pad, top + pad / 2, widths[i] - pad * 2).op);
      x += widths[i];
    });

    let y = top + headerH;
    rows.forEach((row, ri) => {
      const accent = ctx.accent(String(row.id ?? ''));
      if (accent) {
        into.push({ op: 'rect', name: `Highlight ${ri}`, x: round(ctx.safeX), y: round(y), w: round(ctx.safeWidth), h: round(rowHeights[ri]), fill: { ...accent, opacity: 0.08 } });
      }
      if (ri > 0) {
        into.push(ctx.line(`Row divider ${ri}`, [[ctx.safeX, y], [ctx.safeX + ctx.safeWidth, y]], {
          color: theme.surface.divider.color, width: theme.surface.divider.width, opacity: theme.surface.divider.opacity,
        }));
      }
      let cx = ctx.safeX;
      columns.forEach((c, i) => {
        const numeric = ctx.ir.data.numericColumns.includes(c);
        into.push(ctx.text('body', labelOf(ctx, row, c), cx + pad, y + pad / 2, widths[i] - pad * 2, {
          align: numeric ? 'right' : 'left', color: accent ? accent.color : undefined,
        }).op);
        cx += widths[i];
      });
      y += rowHeights[ri];
    });
  });
  return top + height;
};

/* ------------------------------------------------------------------ cartesian */

/** Legend inside the plot, top-right. Line series get a bar swatch, everything else a chip. */
function legend(ctx: Ctx, into: Op[], box: { x: number; y: number; w: number; h: number },
  entries: Array<{ label: string; paint: SolidPaint; line?: boolean }>): void {
  if (entries.length < 2) return;
  const lh = ctx.lineHeight('label');
  const width = Math.max(...entries.map((e) => ctx.measure('label', e.label))) + 56;
  const x = box.x + box.w - width;
  let y = box.y + 8;
  for (const entry of entries) {
    into.push(entry.line
      ? { op: 'rect', name: `Legend ${entry.label}`, x: round(x), y: round(y + lh / 2 - 2), w: 28, h: 4, fill: entry.paint, radius: 2 }
      : { op: 'rect', name: `Legend ${entry.label}`, x: round(x), y: round(y + lh / 2 - 9), w: 18, h: 18, fill: entry.paint, radius: 4 });
    into.push(ctx.text('label', entry.label, x + 40, y, width - 40, { maxLines: 1 }).op);
    y += lh + 10;
  }
}

/**
 * Category labels rotate and thin out; they never shrink below the pack minimum and the
 * series is never resampled. A daily series stays daily — the axis adapts, not the data.
 */
function categoryAxis(ctx: Ctx, into: Op[], box: { x: number; y: number; w: number; h: number },
  labels: string[], slot: number, offset: number): number {
  const widest = Math.max(...labels.map((l) => ctx.measure('detail', l)));
  // A point axis (offset 0) places ticks on the bounds, so its endpoints own only half a
  // slot. Aligning them outward is what keeps them off their neighbours.
  const pointAxis = offset === 0;
  const rotate = widest > slot - 8;
  // Two parallel 45-degree labels clear each other at about 1.7 line heights of pitch.
  const perLabel = rotate ? ctx.lineHeight('detail') * 1.7 : widest + 16;
  const step = Math.max(1, Math.ceil((labels.length * perLabel) / box.w));
  const lh = ctx.lineHeight('detail');
  labels.forEach((label, i) => {
    // Position on the axis carries the category whether or not its tick is printed, so a
    // thinned axis is encoding, not dropped data.
    ctx.encode(label);
    // Keep the first and last tick, then every step-th between them.
    if (step > 1 && i % step !== 0 && i !== labels.length - 1) return;
    const cx = box.x + slot * i + offset;
    if (rotate) {
      into.push(ctx.text('detail', label, cx, box.y + box.h + 16, widest + 8, { maxLines: 1, rotate: -45 }).op);
      return;
    }
    const first = pointAxis && i === 0;
    const last = pointAxis && i === labels.length - 1;
    const align = first ? 'left' : last ? 'right' : 'center';
    // Clamp to the plot, not the frame: a block inside a column must not borrow its
    // neighbour's width, which is how the last tick ends up sitting on the previous one.
    const boxX = first ? box.x
      : last ? box.x + box.w - slot
      : Math.min(Math.max(cx - slot / 2, box.x), box.x + box.w - slot);
    into.push(ctx.text('detail', label, boxX, box.y + box.h + 12, slot, { align, maxLines: 2 }).op);
  });
  return rotate ? Math.ceil(widest * 0.71) + 24 : lh * 2;
}

function plotBox(ctx: Ctx, top: number, height: number, gutter: number) {
  return { x: ctx.safeX + gutter, y: top, w: ctx.safeWidth - gutter, h: height };
}

function axes(ctx: Ctx, into: Op[], box: { x: number; y: number; w: number; h: number }, scale: { min: number; max: number; step: number }, gutter: number) {
  const { chart } = ctx.theme;
  for (let v = scale.min; v <= scale.max + 1e-9; v += scale.step) {
    const y = box.y + box.h - ((v - scale.min) / (scale.max - scale.min)) * box.h;
    into.push(ctx.line(`Gridline ${v}`, [[box.x, y], [box.x + box.w, y]], {
      color: chart.gridline.color, width: chart.gridline.width, opacity: chart.gridline.opacity,
    }));
    into.push(ctx.text('detail', formatValue(v, ctx.locale), box.x - gutter, y - ctx.lineHeight('detail') / 2, gutter - 12, { align: 'right' }).op);
  }
  into.push(ctx.line('Y axis', [[box.x, box.y], [box.x, box.y + box.h]], { color: chart.axis.color, width: chart.axis.width, opacity: chart.axis.opacity }));
  into.push(ctx.line('X axis', [[box.x, box.y + box.h], [box.x + box.w, box.y + box.h]], { color: chart.axis.color, width: chart.axis.width, opacity: chart.axis.opacity }));
}

/**
 * Editorial horizontal bar: label, bar, value. No axis and no gridlines, because the
 * number is printed beside every bar and a grid would only repeat it less precisely.
 * Use it when the reader wants a ranking read top to bottom, not a measurement.
 */
const editorialBar: Renderer = (ctx, top) => {
  const spec = ctx.theme.chart.editorialBar;
  if (!spec) throw new Error('the pack declares no editorial bar treatment');
  const { category, value } = fields(ctx);
  if (!value) throw new Error('bar needs at least one numeric column');
  const rows = ctx.ir.data.rows;
  const hint = ctx.ir.visual.fields;
  const secondary = hint?.line && hint.line !== value ? hint.line : undefined;
  const values = rows.map((r) => Number(r[value] ?? 0));
  const max = Math.max(...values, 0);

  const labels = rows.map((r) => labelOf(ctx, r, category));
  const labelW = Math.max(...labels.map((l) => ctx.measure(spec.labelRole, l)));
  const plotX = ctx.safeX + labelW + spec.labelGutter;
  const leadW = Math.max(...values.map((v) => ctx.measure(spec.valueRole, formatValue(v, ctx.locale)))) + 12;
  // The offline metric is deliberately pessimistic; a whole pixel of slack keeps a
  // value that exactly fills its box from being reported as truncated.
  const valueW = leadW + (secondary ? Math.max(...rows.map((r) => ctx.measure(spec.secondaryRole, labelOf(ctx, r, secondary)))) + 2 : 0);
  const plotW = ctx.safeX + ctx.safeWidth - plotX - spec.valueGap - valueW;
  if (plotW < 120) throw new Error('labels leave no room for the bars; shorten them or split the frame');

  ctx.group('Bar rows', (into) => {
    rows.forEach((row, i) => {
      const y = top + spec.rowPitch * i;
      const mid = y + (spec.barHeight - ctx.lineHeight(spec.labelRole)) / 2;
      const w = max > 0 ? Math.max(2, (values[i] / max) * plotW) : 2;
      const key = String(row.id ?? labels[i]);
      into.push(ctx.text(spec.labelRole, labels[i], ctx.safeX, mid, labelW, {
        align: 'right', maxLines: 1, color: paint(ctx.theme, spec.labelColor).color,
      }).op);
      into.push({
        op: 'rect', name: `Bar ${labels[i]}`, x: round(plotX), y: round(y), w: round(w), h: spec.barHeight,
        fill: ctx.accent(key) ?? ctx.seriesPaint(0), radius: spec.radius,
      });
      ctx.encode(values[i]);
      // The reservation above already keeps this clear of the bar. Nothing sits to the
      // right of it, so the box takes the rest of the safe zone: a live font slightly
      // wider than the offline metric then still sets on one line.
      const valueX = plotX + w + spec.valueGap;
      const rest = ctx.safeX + ctx.safeWidth - valueX;
      into.push(ctx.text(spec.valueRole, formatValue(values[i], ctx.locale), valueX, mid, rest, { maxLines: 1 }).op);
      if (secondary) {
        into.push(ctx.text(spec.secondaryRole, labelOf(ctx, row, secondary),
          valueX + leadW, mid, rest - leadW,
          { maxLines: 1, color: paint(ctx.theme, spec.secondaryColor).color }).op);
      }
    });
  });
  return top + spec.rowPitch * rows.length;
};

/**
 * Share rows: one constant-width bar per row, split into segments that sum to the whole.
 *
 * It answers "what is this made of" for several subjects at once, which a pie cannot do
 * and a grouped bar answers badly. Segment labels are printed inside the segment when
 * they fit, because a legend forces the reader to look away from the thing being read.
 */
const shareRows: Renderer = (ctx, top) => {
  const spec = ctx.theme.chart.editorialBar;
  if (!spec) throw new Error('the pack declares no editorial bar treatment');
  const { category } = fields(ctx);
  const hint = ctx.ir.visual.fields;
  const rows = ctx.ir.data.rows;
  const segments = hint?.columns?.length ? hint.columns : ctx.ir.data.numericColumns;
  if (segments.length < 2) throw new Error('share rows need at least two segment columns');
  const note = hint?.line;

  const labels = rows.map((r) => labelOf(ctx, r, category));
  const labelW = Math.max(...labels.map((l) => ctx.measure(spec.labelRole, l)));
  const noteW = note ? Math.max(...rows.map((r) => ctx.measure(spec.secondaryRole, labelOf(ctx, r, note)))) + 2 : 0;
  const plotX = ctx.safeX + labelW + spec.labelGutter;
  const plotW = ctx.safeX + ctx.safeWidth - plotX - (note ? spec.valueGap + noteW : 0);
  if (plotW < 200) throw new Error('labels and notes leave no room for the bars; shorten them or split the frame');
  const tail = ctx.theme.color.tail;

  ctx.group('Share rows', (into) => {
    rows.forEach((row, ri) => {
      const y = top + spec.rowPitch * ri;
      const mid = y + (spec.barHeight - ctx.lineHeight(spec.labelRole)) / 2;
      into.push(ctx.text(spec.labelRole, labels[ri], ctx.safeX, mid, labelW, {
        align: 'right', maxLines: 1, color: paint(ctx.theme, spec.labelColor).color,
      }).op);
      const values = segments.map((c) => Number(row[c] ?? 0));
      const total = values.reduce((a, b) => a + b, 0);
      if (total <= 0) throw new Error(`row "${labels[ri]}" has no share to divide`);
      let x = plotX;
      segments.forEach((col, si) => {
        if (values[si] <= 0) return;
        const w = (values[si] / total) * (plotW - spec.segmentGap * (segments.length - 1));
        // The last named column is the ungrouped remainder, and a remainder is not a
        // category, so it takes the pack's neutral tail instead of spending a hue.
        const isTail = si === segments.length - 1 && tail !== undefined && segments.length > 2;
        into.push({
          op: 'rect', name: `${labels[ri]} ${col}`, x: round(x), y: round(y), w: round(w), h: spec.barHeight,
          fill: ctx.accent(col) ?? (isTail ? { color: tail! } : ctx.seriesPaint(si)),
          radius: spec.radius,
        });
        ctx.encode(values[si]);
        const printed = `${formatValue(values[si], ctx.locale)} · ${Math.round((values[si] / total) * 100)}%`;
        if (ctx.measure(spec.labelRole, printed) + 20 <= w) {
          into.push(ctx.text(spec.labelRole, printed, x, mid, w, {
            align: 'center', maxLines: 1, color: ctx.theme.canvas.background,
          }).op);
        }
        x += w + spec.segmentGap;
      });
      if (note) {
        const noteX = plotX + plotW + spec.valueGap;
        into.push(ctx.text(spec.secondaryRole, labelOf(ctx, row, note), noteX, mid, ctx.safeX + ctx.safeWidth - noteX, {
          maxLines: 1, color: paint(ctx.theme, spec.secondaryColor).color,
        }).op);
      }
    });
  });
  return top + spec.rowPitch * rows.length;
};

/** The number behind a printed value: `839.8M` is 839,800,000 and `$0.58` is 0.58. */
function magnitude(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const text = String(raw ?? '').replace(/[\s,\u00a0\u2009]/g, '');
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return 0;
  const suffix = /^([KMBT])/i.exec(text.slice(match.index + match[0].length));
  const scale: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return Number(match[0]) * (suffix ? scale[suffix[1].toUpperCase()] : 1);
}

/**
 * Paired rows: one row per measure, two or three bars inside it, each printed with its
 * own value.
 *
 * Rows of different units cannot share a scale, so by default each row is normalised to
 * its own largest series and the printed numbers carry what the bars cannot: the pair
 * says "this halved", the numbers say from what to what. A block whose rows really do
 * share a unit asks for `scale: 'shared'` and gets one scale for the whole block.
 *
 * Values may be given as numbers or as the source's own strings (`839.8M`, `$0.58`):
 * the string is printed verbatim and its magnitude drives the bar, which is what a
 * redraw of someone else's chart needs.
 */
const pairedRows: Renderer = (ctx, top) => {
  const spec = ctx.theme.chart.pairedBar;
  if (!spec) throw new Error('the pack declares no paired bar treatment');
  const hint = ctx.ir.visual.fields;
  const { category } = fields(ctx);
  const rows = ctx.ir.data.rows;
  if (!rows.length) throw new Error('paired rows need at least one row');
  const series = (hint?.columns?.length ? hint.columns : ctx.ir.data.numericColumns).slice(0, 3);
  if (series.length < 2) {
    throw new Error('paired rows need two or three series columns, named in fields.columns');
  }
  const shared = ctx.ir.visual.scale === 'shared';
  const printed = rows.map((row) => series.map((col) => labelOf(ctx, row, col)));
  const sizes = rows.map((row) => series.map((col) => magnitude(row[col])));
  const globalMax = Math.max(...sizes.flat(), 0);

  const labels = rows.map((r) => labelOf(ctx, r, category));
  const units = hint?.unit ? rows.map((r) => labelOf(ctx, r, hint.unit!)) : undefined;
  const deltas = hint?.delta ? rows.map((r) => labelOf(ctx, r, hint.delta!)) : undefined;
  const groups = hint?.group ? rows.map((r) => labelOf(ctx, r, hint.group!)) : undefined;

  const labelW = Math.max(
    ...labels.map((l) => ctx.measure(spec.labelRole, l)),
    ...(units ? units.map((u) => ctx.measure(spec.unitRole, u)) : [0]),
  );
  const valueW = Math.max(...printed.flat().map((t, i) => ctx.measure(
    i % series.length === series.length - 1 ? spec.valueRole : spec.leadRole, t)));
  const deltaW = deltas ? Math.max(...deltas.map((d) => ctx.measure(spec.deltaRole, d))) : 0;
  const plotX = ctx.safeX + labelW + spec.labelGutter;
  const right = ctx.safeX + ctx.safeWidth;
  const plotW = right - plotX - spec.valueGap - valueW - (deltas ? spec.deltaGap + deltaW : 0);
  if (plotW < 200) throw new Error('labels, values and changes leave no room for the bars; shorten them or split the frame');

  const pairH = series.length * spec.barHeight + (series.length - 1) * spec.seriesGap;
  const labelH = ctx.lineHeight(spec.labelRole) + (units ? ctx.lineHeight(spec.unitRole) : 0);
  const rowH = Math.max(spec.rowPitch, pairH + spec.rowGap, labelH + spec.rowGap);
  let cursor = top;

  ctx.group('Paired rows', (into) => {
    // The legend names the series, because a bar pair with no names is two colours.
    let swatchX = ctx.safeX;
    const legendMid = cursor + Math.max(0, (spec.swatch - ctx.lineHeight(spec.legendRole)) / 2);
    series.forEach((col, si) => {
      into.push({
        op: 'rect', name: `Legend ${col}`, x: round(swatchX), y: round(cursor), w: spec.swatch, h: spec.swatch,
        fill: ctx.accent(col) ?? ctx.seriesPaint(si), radius: 2,
      });
      const text = ctx.text(spec.legendRole, col, swatchX + spec.swatch + 12, legendMid, plotW, {
        maxLines: 1, color: paint(ctx.theme, spec.legendColor).color,
      });
      into.push(text.op);
      swatchX += spec.swatch + 12 + ctx.measure(spec.legendRole, col) + 40;
    });
    cursor += Math.max(spec.swatch, ctx.lineHeight(spec.legendRole)) + spec.legendGap;

    rows.forEach((row, ri) => {
      if (groups && groups[ri] && (ri === 0 || groups[ri] !== groups[ri - 1])) {
        if (ri > 0) cursor += spec.groupLead;
        into.push(ctx.text(spec.groupRole, groups[ri], ctx.safeX, cursor, ctx.safeWidth, {
          maxLines: 1, color: paint(ctx.theme, spec.groupColor).color,
        }).op);
        cursor += ctx.lineHeight(spec.groupRole) + spec.groupGap;
      }
      const pairY = cursor + (rowH - spec.rowGap - pairH) / 2;
      const labelY = pairY + (pairH - labelH) / 2;
      into.push(ctx.text(spec.labelRole, labels[ri], ctx.safeX, labelY, labelW, {
        maxLines: 1, color: paint(ctx.theme, spec.labelColor).color,
      }).op);
      if (units && units[ri]) {
        into.push(ctx.text(spec.unitRole, units[ri], ctx.safeX, labelY + ctx.lineHeight(spec.labelRole), labelW, {
          maxLines: 1, color: paint(ctx.theme, spec.unitColor).color,
        }).op);
      }
      const rowMax = shared ? globalMax : Math.max(...sizes[ri], 0);
      series.forEach((col, si) => {
        const barY = pairY + si * (spec.barHeight + spec.seriesGap);
        const w = rowMax > 0 ? Math.max(2, (Math.max(0, sizes[ri][si]) / rowMax) * plotW) : 2;
        into.push({
          op: 'rect', name: `Bar ${labels[ri]} ${col}`,
          x: round(plotX), y: round(barY), w: round(w), h: spec.barHeight,
          fill: ctx.accent(col) ?? ctx.seriesPaint(si), radius: spec.radius,
        });
        ctx.encode(row[col]);
        const lead = si === series.length - 1;
        into.push(ctx.text(lead ? spec.valueRole : spec.leadRole, printed[ri][si],
          plotX + plotW + spec.valueGap,
          barY + (spec.barHeight - ctx.lineHeight(lead ? spec.valueRole : spec.leadRole)) / 2,
          valueW, { maxLines: 1, color: lead ? undefined : paint(ctx.theme, spec.leadColor).color }).op);
      });
      if (deltas && deltas[ri]) {
        into.push(ctx.text(spec.deltaRole, deltas[ri], right - deltaW,
          pairY + (pairH - ctx.lineHeight(spec.deltaRole)) / 2, deltaW,
          { align: 'right', maxLines: 1, color: paint(ctx.theme, spec.deltaColor).color }).op);
      }
      cursor += rowH;
    });
  });
  return cursor;
};

const bar: Renderer = (ctx, top) => {
  const { category, value } = fields(ctx);
  if (!value) throw new Error('bar needs at least one numeric column');
  const rows = ctx.ir.data.rows;
  const values = rows.map((r) => Number(r[value] ?? 0));
  const scale = niceScale(Math.min(...values), Math.max(...values), ctx.theme.chart.gridline.count ?? 5);
  const gutter = Math.max(...[scale.min, scale.max].map((v) => ctx.measure('detail', formatValue(v, ctx.locale)))) + 24;
  const height = ctx.budget;
  const box = plotBox(ctx, top, height - ctx.lineHeight('detail') * 2, gutter);
  let axisH = 0;

  ctx.group('Bar chart', (into) => {
    axes(ctx, into, box, scale, gutter);
    const slot = box.w / rows.length;
    // Gap scales with the slot so a daily series renders as a dense comb rather than
    // collapsing; only the upper bound is fixed.
    const gap = Math.min(ctx.theme.chart.barGap, slot * 0.28);
    const barW = Math.min(MAX_BAR_WIDTH, Math.max(1, slot - gap));
    rows.forEach((row, i) => {
      const v = values[i];
      const h = ((v - scale.min) / (scale.max - scale.min)) * box.h;
      const x = box.x + slot * i + (slot - barW) / 2;
      const key = String(row.id ?? labelOf(ctx, row, category));
      const accent = ctx.accent(key);
      const highlighted = Boolean(accent) && ctx.ir.visual.highlightIds.includes(key);
      const hue = (accent ?? ctx.seriesPaint(0, 'neutral.500')).color;
      const { chart } = ctx.theme;
      const from = highlighted ? chart.barHighlightFrom ?? 0.34 : chart.barFillFrom ?? 0.4;
      const to = highlighted ? chart.barHighlightTo ?? 0.09 : chart.barFillTo ?? 0.05;
      into.push({
        op: 'rect', name: `Bar ${labelOf(ctx, row, category)}`,
        x: round(x), y: round(box.y + box.h - h), w: round(barW), h: round(h),
        // The pack fills a bar with a vertical fade of its hue, not a flat block.
        fill: { gradient: 'linear', angle: 90, stops: [{ pos: 0, color: hue, alpha: from }, { pos: 1, color: hue, alpha: to }] },
        stroke: { color: hue, opacity: highlighted ? 1 : chart.barStrokeOpacity ?? 0.5 },
        strokeWidth: highlighted ? chart.barHighlightStroke ?? 1.5 : 1,
        radius: chart.barRadius,
      });
      into.push(ctx.text('label', formatValue(v, ctx.locale), x, box.y + box.h - h - ctx.lineHeight('label') - 8, barW, {
        align: 'center', color: accent ? tint(hue, ctx.theme.chart.labelTint ?? 0.62) : undefined,
      }).op);
    });
    axisH = categoryAxis(ctx, into, box, rows.map((r) => labelOf(ctx, r, category)), slot, slot / 2);
  });
  return box.y + box.h + axisH;
};

const line: Renderer = (ctx, top) => {
  const { category, numeric } = fields(ctx);
  if (!numeric.length) throw new Error('line needs at least one numeric column');
  const rows = ctx.ir.data.rows;
  const all = numeric.flatMap((c) => rows.map((r) => Number(r[c] ?? 0)));
  const scale = niceScale(Math.min(...all), Math.max(...all), ctx.theme.chart.gridline.count ?? 5);
  const gutter = Math.max(...[scale.min, scale.max].map((v) => ctx.measure('detail', formatValue(v, ctx.locale)))) + 24;
  const height = ctx.budget;
  const box = plotBox(ctx, top, height - ctx.lineHeight('detail') * 2, gutter);
  let axisH = 0;

  ctx.group('Line chart', (into) => {
    axes(ctx, into, box, scale, gutter);
    const stepX = rows.length > 1 ? box.w / (rows.length - 1) : 0;
    numeric.forEach((col, si) => {
      const stroke = ctx.accent(col) ?? ctx.seriesPaint(si, 'neutral.300');
      const points = rows.map((r, i) => {
        ctx.encode(r[col]);
        return [
          box.x + stepX * i,
          box.y + box.h - ((Number(r[col] ?? 0) - scale.min) / (scale.max - scale.min)) * box.h,
        ] as [number, number];
      });
      into.push({ op: 'line', name: `Series ${col}`, points: points.map(([x, y]) => [round(x), round(y)] as [number, number]), stroke, strokeWidth: ctx.theme.chart.strokeWidth });
      const halo = ctx.theme.chart.pointHalo;
      points.forEach(([x, y], i) => into.push({
        op: 'ellipse', name: `${col} ${i}`, cx: round(x), cy: round(y),
        rx: ctx.theme.chart.pointRadius ?? 5, ry: ctx.theme.chart.pointRadius ?? 5, fill: stroke,
        // A canvas-coloured halo keeps a point readable where two series cross.
        stroke: halo ? paint(ctx.theme, halo.color) : undefined, strokeWidth: halo?.width,
      }));
    });
    axisH = categoryAxis(ctx, into, box, rows.map((r) => labelOf(ctx, r, category)), stepX, 0);
  });
  return box.y + box.h + axisH;
};

const scatter: Renderer = (ctx, top) => {
  const { numeric, category } = fields(ctx);
  if (numeric.length < 2) throw new Error('scatter needs two numeric columns');
  const [xk, yk] = numeric;
  const rows = ctx.ir.data.rows;
  const xs = niceScale(Math.min(...rows.map((r) => Number(r[xk]))), Math.max(...rows.map((r) => Number(r[xk]))));
  const ys = niceScale(Math.min(...rows.map((r) => Number(r[yk]))), Math.max(...rows.map((r) => Number(r[yk]))));
  const gutter = ctx.measure('detail', formatValue(ys.max, ctx.locale)) + 24;
  const height = ctx.budget;
  const box = plotBox(ctx, top, height - ctx.lineHeight('label') * 2, gutter);

  ctx.group('Scatter plot', (into) => {
    axes(ctx, into, box, ys, gutter);
    rows.forEach((r) => {
      ctx.encode(r[xk], r[yk]);
      const px = box.x + ((Number(r[xk]) - xs.min) / (xs.max - xs.min)) * box.w;
      const py = box.y + box.h - ((Number(r[yk]) - ys.min) / (ys.max - ys.min)) * box.h;
      const fill = ctx.accent(String(r.id ?? '')) ?? ctx.seriesPaint(0, 'neutral.500');
      into.push({ op: 'ellipse', name: `Point ${labelOf(ctx, r, category)}`, cx: round(px), cy: round(py), rx: (ctx.theme.chart.pointRadius ?? 6) + 2, ry: (ctx.theme.chart.pointRadius ?? 6) + 2, fill });
      into.push(ctx.text('detail', labelOf(ctx, r, category), px + 14, py - ctx.lineHeight('detail') / 2, 220).op);
    });
    into.push(ctx.text('label', xk, box.x, box.y + box.h + 16, box.w, { align: 'center' }).op);
  });
  return top + height;
};

const waterfall: Renderer = (ctx, top) => {
  const { category, value } = fields(ctx);
  if (!value) throw new Error('waterfall needs a numeric column');
  const rows = ctx.ir.data.rows;
  let running = 0;
  const spans = rows.map((r) => {
    const delta = Number(r[value] ?? 0);
    const from = running; running += delta;
    return { from, to: running, delta, row: r };
  });
  const scale = niceScale(Math.min(0, ...spans.map((s) => Math.min(s.from, s.to))), Math.max(...spans.map((s) => Math.max(s.from, s.to))));
  const gutter = ctx.measure('detail', formatValue(scale.max, ctx.locale)) + 24;
  const height = ctx.budget;
  const box = plotBox(ctx, top, height - ctx.lineHeight('detail') * 2, gutter);
  const yOf = (v: number) => box.y + box.h - ((v - scale.min) / (scale.max - scale.min)) * box.h;
  let axisH = 0;

  ctx.group('Waterfall', (into) => {
    axes(ctx, into, box, scale, gutter);
    const slot = box.w / spans.length;
    const barW = Math.min(MAX_BAR_WIDTH, Math.max(8, slot - ctx.theme.chart.barGap));
    spans.forEach((s, i) => {
      const x = box.x + slot * i + (slot - barW) / 2;
      const yTop = yOf(Math.max(s.from, s.to));
      const h = Math.abs(yOf(s.from) - yOf(s.to));
      into.push({
        op: 'rect', name: `Step ${labelOf(ctx, s.row, category)}`, x: round(x), y: round(yTop), w: round(barW), h: round(Math.max(2, h)),
        fill: ctx.accent(String(s.row.id ?? '')) ?? ctx.seriesPaint(s.delta >= 0 ? 0 : 1, 'neutral.500'),
        radius: ctx.theme.chart.barRadius,
      });
      if (i < spans.length - 1) {
        into.push(ctx.line(`Connector ${i}`, [[x + barW, yOf(s.to)], [x + slot, yOf(s.to)]], { color: ctx.theme.chart.connector.color, width: 1, dash: [4, 4] }));
      }
      into.push(ctx.text('label', (s.delta >= 0 ? '+' : '') + formatValue(s.delta, ctx.locale), x, yTop - ctx.lineHeight('label') - 8, barW, { align: 'center' }).op);
    });
    axisH = categoryAxis(ctx, into, box, spans.map((s) => labelOf(ctx, s.row, category)), slot, slot / 2);
  });
  return box.y + box.h + axisH;
};

/* --------------------------------------------------------------------- radial */

const donut: Renderer = (ctx, top) => {
  const { category, value } = fields(ctx);
  if (!value) throw new Error('donut needs a numeric column');
  const rows = ctx.ir.data.rows;
  const total = rows.reduce((a, r) => a + Number(r[value] ?? 0), 0);
  if (total <= 0) throw new Error('donut needs a positive total');
  const size = Math.min(560, ctx.budget);
  const cx = ctx.safeX + size / 2;
  const cy = top + size / 2;
  const rOuter = size / 2;
  const rInner = rOuter * (1 - (ctx.theme.chart.donutThicknessRatio ?? 0.34));

  ctx.group('Donut', (into) => {
    let angle = -Math.PI / 2;
    rows.forEach((r, i) => {
      const share = Number(r[value] ?? 0) / total;
      const end = angle + share * Math.PI * 2;
      into.push({
        op: 'arc', name: `Slice ${labelOf(ctx, r, category)}`,
        cx: round(cx), cy: round(cy), rOuter: round(rOuter), rInner: round(rInner),
        startAngle: round(angle), endAngle: round(end),
        fill: ctx.accent(String(r.id ?? '')) ?? ctx.seriesPaint(i, 'neutral.500'),
      });
      angle = end;
    });
    // Legend carries the exact values; the ring carries proportion only.
    const lx = ctx.safeX + size + 80;
    let ly = top + 8;
    rows.forEach((r, i) => {
      const swatch = ctx.accent(String(r.id ?? '')) ?? ctx.seriesPaint(i, 'neutral.500');
      into.push({ op: 'rect', name: `Legend swatch ${i}`, x: round(lx), y: round(ly + 6), w: 16, h: 16, fill: swatch, radius: 3 });
      const label = ctx.text('body', `${labelOf(ctx, r, category)}  ${labelOf(ctx, r, value)}`, lx + 30, ly, ctx.safeWidth - size - 110);
      into.push(label.op);
      ly += label.height + 12;
    });
  });
  return top + size;
};

const loop: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const size = Math.min(660, ctx.budget);
  const cx = ctx.safeX + ctx.safeWidth / 2;
  const cy = top + size / 2;
  const radius = size / 2 - 120;
  const boxW = 280;

  ctx.group('Loop', (into) => {
    const pos = nodes.map((_, i) => {
      const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
      return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, a };
    });
    nodes.forEach((n, i) => {
      const lines = ctx.text('body', n.label, 0, 0, boxW - 48).op.lines.length;
      const h = lines * ctx.lineHeight('body') + 40;
      into.push(...nodeBox(ctx, n, pos[i].x - boxW / 2, pos[i].y - h / 2, boxW, h));
    });
    pos.forEach((p, i) => {
      const q = pos[(i + 1) % pos.length];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const bulge = { x: cx + (mid.x - cx) * 1.18, y: cy + (mid.y - cy) * 1.18 };
      into.push(ctx.line(`Loop edge ${i}`, [[p.x, p.y], [bulge.x, bulge.y], [q.x, q.y]], { arrowEnd: true, cornerRadius: 64 }));
    });
  });
  return top + size;
};

/* ----------------------------------------------------------------- sequential */

const timeline: Renderer = (ctx, top) => {
  const { category } = fields(ctx);
  const rows = ctx.ir.data.rows;
  const detailKey = ctx.ir.data.columns.find((c) => c !== category && c !== 'id');
  const axisY = top + 120;
  const slot = ctx.safeWidth / Math.max(1, rows.length);
  let maxBottom = axisY;

  ctx.group('Timeline', (into) => {
    into.push(ctx.line('Timeline axis', [[ctx.safeX, axisY], [ctx.safeX + ctx.safeWidth, axisY]], {
      color: ctx.theme.chart.axis.color, width: ctx.theme.chart.axis.width,
    }));
    rows.forEach((r, i) => {
      const x = ctx.safeX + slot * i + slot / 2;
      const accent = ctx.accent(String(r.id ?? ''));
      into.push({ op: 'ellipse', name: `Marker ${i}`, cx: round(x), cy: round(axisY), rx: 9, ry: 9, fill: accent ?? ctx.seriesPaint(0, 'neutral.300') });
      const above = i % 2 === 0;
      const head = ctx.text('h2', labelOf(ctx, r, category), x - slot / 2 + 12, above ? axisY - 52 - ctx.lineHeight('h2') : axisY + 40, slot - 24, { align: 'center' });
      into.push(head.op);
      into.push(ctx.line(`Leader ${i}`, [[x, axisY], [x, above ? axisY - 44 : axisY + 34]], { width: 1 }));
      if (detailKey) {
        const body = ctx.text('detail', labelOf(ctx, r, detailKey), x - slot / 2 + 12, (above ? head.op.y - 8 - head.height : head.op.y + head.height + 8), slot - 24, { align: 'center', maxLines: 3 });
        into.push(body.op);
        maxBottom = Math.max(maxBottom, body.op.y + body.height);
      }
      maxBottom = Math.max(maxBottom, head.op.y + head.height);
    });
  });
  return Math.max(maxBottom + 24, axisY + 200);
};

function nodeBox(ctx: Ctx, node: DiagramNode, x: number, y: number, w: number, h: number): Op[] {
  const style = ctx.theme.surface.node ?? {
    fill: ctx.theme.surface.panel.fill, fillOpacity: ctx.theme.surface.panel.fillOpacity,
    stroke: ctx.theme.surface.panel.stroke, strokeWidth: ctx.theme.surface.panel.strokeWidth,
    radius: 8, paddingX: 32, paddingY: 20, gapX: 56, gapY: 36, minWidth: 180,
  };
  const accent = ctx.nodeAccent(node);
  // A tinted node is FILLED by its category instead of washed by it, which is how the
  // delivered light frames read a category: the surface carries the colour and the label
  // is ink against that surface, not against the canvas behind it.
  const tinted = ctx.ir.visual.style === 'tinted' && accent ? style.tinted : undefined;
  const fillHex = tinted ? tint(accent!.color, tinted.tint) : undefined;
  const ink = fillHex ? inkOn(ctx.theme, fillHex) : undefined;
  // Measured rule: 12% fill, stroke at 38% for a base node and 100% for a point colour.
  const ops: Op[] = [{
    op: 'rect', name: `Node ${node.id}`, x: round(x), y: round(y), w: round(w), h: round(h),
    fill: fillHex ? { color: fillHex }
      : accent ? { ...accent, opacity: style.fillOpacity ?? 0.12 }
      : paint(ctx.theme, style.fill, style.fillOpacity),
    stroke: tinted ? { ...accent!, opacity: tinted.strokeOpacity }
      : accent ?? paint(ctx.theme, style.stroke, ctx.theme.surface.nodeStrokeOpacity),
    strokeWidth: style.strokeWidth, radius: style.radius,
  }];
  const label = ctx.text('body', node.label, x + style.paddingX, y + style.paddingY, w - style.paddingX * 2, {
    align: 'center', color: ink ?? (accent ? tint(accent.color, ctx.theme.chart.labelTint ?? 0.62) : undefined),
  });
  ops.push(label.op);
  if (node.note) {
    ops.push(ctx.text('detail', node.note, x + style.paddingX, y + style.paddingY + label.height + 4, w - style.paddingX * 2,
      { align: 'center', maxLines: 2, color: ink }).op);
  }
  return ops;
}

/* -------------------------------------------------------------- layered graph */

/**
 * Longest-path ranking over the acyclic part of the graph.
 *
 * Feedback edges are detected by DFS and excluded from ranking; they are still drawn.
 * Ranking a cycle directly would push every node in the loop to the rank cap and destroy
 * the layout, which is what a naive relaxation loop does.
 */
function rank(nodes: DiagramNode[], edges: Array<{ from: string; to: string }>): Map<string, number> {
  const forward = new Map<string, string[]>();
  for (const e of edges) forward.set(e.from, [...(forward.get(e.from) ?? []), e.to]);

  const state = new Map<string, 0 | 1 | 2>(); // unseen | on-stack | done
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of forward.get(id) ?? []) {
      const s = state.get(next);
      if (s === 1) back.add(`${id}\u0000${next}`);
      else if (s === undefined) visit(next);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  const dag = edges.filter((e) => !back.has(`${e.from}\u0000${e.to}`));
  const ranks = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass <= nodes.length; pass++) {
    let moved = false;
    for (const e of dag) {
      const next = (ranks.get(e.from) ?? 0) + 1;
      if (next > (ranks.get(e.to) ?? 0)) { ranks.set(e.to, next); moved = true; }
    }
    if (!moved) break;
  }
  return ranks;
}

function layeredGraph(ctx: Ctx, top: number, opts: { orientation: 'vertical' | 'horizontal'; name: string; dashed?: (e: { style?: string }) => boolean }): number {
  const g = graphOf(ctx);
  const nodes = g.nodes!, edges = g.edges ?? [];
  const style = ctx.theme.surface.node!;
  const ranks = rank(nodes, edges);
  const layers: DiagramNode[][] = [];
  for (const n of nodes) {
    const r = ranks.get(n.id) ?? 0;
    (layers[r] ??= []).push(n);
  }
  const used = layers.filter(Boolean);

  const boxW = opts.orientation === 'vertical'
    ? Math.min(420, Math.max(style.minWidth, (ctx.safeWidth - style.gapX * (Math.max(...used.map((l) => l.length)) - 1)) / Math.max(...used.map((l) => l.length))))
    : Math.min(360, (ctx.safeWidth - style.gapX * (used.length - 1)) / used.length);

  const boxHeights = new Map<string, number>();
  for (const n of nodes) {
    const lines = ctx.text('body', n.label, 0, 0, boxW - style.paddingX * 2).op.lines.length;
    const noteLines = n.note ? ctx.text('detail', n.note, 0, 0, boxW - style.paddingX * 2, { maxLines: 2 }).op.lines.length : 0;
    boxHeights.set(n.id, lines * ctx.lineHeight('body') + noteLines * ctx.lineHeight('detail') + style.paddingY * 2);
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (opts.orientation === 'vertical') {
    let y = top;
    used.forEach((layer) => {
      const rowH = Math.max(...layer.map((n) => boxHeights.get(n.id)!));
      const totalW = layer.length * boxW + (layer.length - 1) * style.gapX;
      let x = ctx.safeX + (ctx.safeWidth - totalW) / 2;
      for (const n of layer) { pos.set(n.id, { x, y, w: boxW, h: rowH }); x += boxW + style.gapX; }
      y += rowH + style.gapY;
    });
  } else {
    let x = ctx.safeX;
    used.forEach((layer) => {
      const colH = layer.reduce((a, n) => a + boxHeights.get(n.id)! + style.gapY, -style.gapY);
      let y = top + Math.max(0, (600 - colH) / 2);
      for (const n of layer) { const h = boxHeights.get(n.id)!; pos.set(n.id, { x, y, w: boxW, h }); y += h + style.gapY; }
      x += boxW + style.gapX;
    });
  }

  let bottom = top;
  let channelIndex = 0;
  ctx.group(opts.name, (into) => {
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) { ctx.warnings.push(`edge ${e.from}->${e.to} references a missing node`); continue; }
      // An edge spanning more than one rank would otherwise run straight through the
      // nodes between it, so it takes a side channel and stays traceable.
      const span = Math.abs((ranks.get(e.to) ?? 0) - (ranks.get(e.from) ?? 0));
      const channel = ctx.safeX + ctx.safeWidth - 32 - (channelIndex++ % 3) * 28;
      const points: Array<[number, number]> = opts.orientation === 'vertical'
        ? span > 1 || b.y <= a.y
          ? [[a.x + a.w, a.y + a.h / 2], [channel, a.y + a.h / 2], [channel, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]]
          : [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, (a.y + a.h + b.y) / 2], [b.x + b.w / 2, (a.y + a.h + b.y) / 2], [b.x + b.w / 2, b.y]]
        : [[a.x + a.w, a.y + a.h / 2], [(a.x + a.w + b.x) / 2, a.y + a.h / 2], [(a.x + a.w + b.x) / 2, b.y + b.h / 2], [b.x, b.y + b.h / 2]];
      into.push(ctx.line(`Edge ${e.from}->${e.to}`, points, {
        arrowEnd: true, arrowStart: e.style === 'bidirectional',
        dash: (opts.dashed?.(e) ?? e.style === 'dashed') ? [8, 6] : undefined,
        cornerRadius: ctx.theme.chart.connector.cornerRadius,
      }));
      if (e.label) {
        // A straight run has no jog to label, so the text sits beside the stroke instead of on it.
        const jog = Math.abs(points[1][0] - points[2][0]) + Math.abs(points[1][1] - points[2][1]);
        const mx = (points[1][0] + points[2][0]) / 2, my = (points[1][1] + points[2][1]) / 2;
        into.push(jog > 8
          ? ctx.text('detail', e.label, mx - 110, my - ctx.lineHeight('detail') - 6, 220, { align: 'center', maxLines: 1 }).op
          : ctx.text('detail', e.label, mx + 10, my - ctx.lineHeight('detail') / 2, 200, { align: 'left', maxLines: 1 }).op);
      }
    }
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      into.push(...nodeBox(ctx, n, p.x, p.y, p.w, p.h));
      bottom = Math.max(bottom, p.y + p.h);
    }
  });
  return bottom;
}

/* ----------------------------------------------------------------- lane-based */

function laneLayout(ctx: Ctx, top: number, name: string): number {
  const g = graphOf(ctx);
  const nodes = g.nodes!, edges = g.edges ?? [];
  const style = ctx.theme.surface.node!;
  const lanes = [...new Set(nodes.map((n) => n.lane ?? n.group ?? 'Lane'))];
  const ranks = rank(nodes, edges);
  const steps = Math.max(1, Math.max(...nodes.map((n) => (ranks.get(n.id) ?? 0))) + 1);

  const laneLabelW = Math.max(...lanes.map((l) => ctx.measure('label', l))) + 48;
  const colW = (ctx.safeWidth - laneLabelW) / steps;
  const boxW = colW - style.gapX / 2;
  const laneH = 180;

  ctx.group(name, (into) => {
    lanes.forEach((lane, li) => {
      const y = top + li * laneH;
      into.push(ctx.rect(`Lane ${lane}`, ctx.safeX, y, ctx.safeWidth, laneH, {
        fill: ctx.theme.surface.panel.fill, fillOpacity: li % 2 === 0 ? ctx.theme.surface.panel.fillOpacity : ctx.theme.surface.panel.fillOpacity * 0.5,
        stroke: ctx.theme.surface.divider.color, strokeWidth: ctx.theme.surface.divider.width,
      }));
      into.push(ctx.text('label', lane, ctx.safeX + 24, y + laneH / 2 - ctx.lineHeight('label') / 2, laneLabelW - 48).op);
    });
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const n of nodes) {
      const li = lanes.indexOf(n.lane ?? n.group ?? 'Lane');
      const step = ranks.get(n.id) ?? 0;
      const lines = ctx.text('body', n.label, 0, 0, boxW - style.paddingX * 2).op.lines.length;
      const h = lines * ctx.lineHeight('body') + style.paddingY * 2;
      pos.set(n.id, { x: ctx.safeX + laneLabelW + step * colW + (colW - boxW) / 2, y: top + li * laneH + (laneH - h) / 2, w: boxW, h });
    }
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) { ctx.warnings.push(`edge ${e.from}->${e.to} references a missing node`); continue; }
      const sameLane = Math.abs(a.y - b.y) < 1;
      const points: Array<[number, number]> = sameLane
        ? [[a.x + a.w, a.y + a.h / 2], [b.x, b.y + b.h / 2]]
        : [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, (a.y + a.h + b.y) / 2], [b.x + b.w / 2, (a.y + a.h + b.y) / 2], [b.x + b.w / 2, b.y]];
      into.push(ctx.line(`Edge ${e.from}->${e.to}`, points, { arrowEnd: true, dash: e.style === 'dashed' ? [8, 6] : undefined, cornerRadius: ctx.theme.chart.connector.cornerRadius }));
      if (e.label) into.push(ctx.text('detail', e.label, (points[0][0] + points[points.length - 1][0]) / 2 - 100, Math.min(points[0][1], points[points.length - 1][1]) - ctx.lineHeight('detail') - 4, 200, { align: 'center', maxLines: 1 }).op);
    }
    for (const n of nodes) { const p = pos.get(n.id)!; into.push(...nodeBox(ctx, n, p.x, p.y, p.w, p.h)); }
  });
  return top + lanes.length * laneH;
}

/* ---------------------------------------------------------------- stack, grid */

const layers: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const style = ctx.theme.surface.node!;
  const rowH = 120;
  ctx.group('Layer stack', (into) => {
    nodes.forEach((n, i) => {
      const y = top + i * (rowH + 12);
      const accent = ctx.accent(n.id);
      into.push(ctx.rect(`Layer ${n.id}`, ctx.safeX, y, ctx.safeWidth, rowH, {
        fill: ctx.theme.surface.panel.fill, fillOpacity: ctx.theme.surface.panel.fillOpacity,
        stroke: ctx.theme.surface.panel.stroke, strokeWidth: style.strokeWidth, radius: style.radius,
      }));
      if (accent) into.push({ op: 'rect', name: `Layer accent ${n.id}`, x: round(ctx.safeX), y: round(y), w: 6, h: rowH, fill: accent, radius: 3 });
      into.push(ctx.text('h2', n.label, ctx.safeX + style.paddingX, y + 24, ctx.safeWidth / 2).op);
      if (n.note) into.push(ctx.text('detail', n.note, ctx.safeX + ctx.safeWidth / 2, y + 28, ctx.safeWidth / 2 - style.paddingX, { align: 'right', maxLines: 2 }).op);
    });
  });
  return top + nodes.length * (rowH + 12);
};

const quadrant: Renderer = (ctx, top) => {
  const { numeric, category } = fields(ctx);
  if (numeric.length < 2) throw new Error('quadrant needs two numeric columns');
  const [xk, yk] = numeric;
  const rows = ctx.ir.data.rows;
  const size = Math.min(700, ctx.budget - ctx.lineHeight('label') * 2);
  const box = { x: ctx.safeX + 120, y: top, w: Math.min(ctx.safeWidth - 240, size * 1.6), h: size };
  const xs = niceScale(Math.min(...rows.map((r) => Number(r[xk]))), Math.max(...rows.map((r) => Number(r[xk]))));
  const ys = niceScale(Math.min(...rows.map((r) => Number(r[yk]))), Math.max(...rows.map((r) => Number(r[yk]))));

  ctx.group('Quadrant', (into) => {
    into.push(ctx.rect('Quadrant field', box.x, box.y, box.w, box.h, {
      fill: ctx.theme.surface.panel.fill, fillOpacity: ctx.theme.surface.panel.fillOpacity,
      stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius,
    }));
    into.push(ctx.line('Vertical divider', [[box.x + box.w / 2, box.y], [box.x + box.w / 2, box.y + box.h]], { color: ctx.theme.chart.axis.color, width: ctx.theme.chart.axis.width }));
    into.push(ctx.line('Horizontal divider', [[box.x, box.y + box.h / 2], [box.x + box.w, box.y + box.h / 2]], { color: ctx.theme.chart.axis.color, width: ctx.theme.chart.axis.width }));
    rows.forEach((r) => {
      ctx.encode(r[xk], r[yk]);
      const px = box.x + ((Number(r[xk]) - xs.min) / (xs.max - xs.min)) * box.w;
      const py = box.y + box.h - ((Number(r[yk]) - ys.min) / (ys.max - ys.min)) * box.h;
      const fill = ctx.accent(String(r.id ?? '')) ?? ctx.seriesPaint(0, 'neutral.300');
      into.push({ op: 'ellipse', name: `Item ${labelOf(ctx, r, category)}`, cx: round(px), cy: round(py), rx: 10, ry: 10, fill });
      into.push(ctx.text('detail', labelOf(ctx, r, category), px + 16, py - ctx.lineHeight('detail') / 2, 240).op);
    });
    into.push(ctx.text('label', xk, box.x, box.y + box.h + 16, box.w, { align: 'center' }).op);
    into.push(ctx.text('label', yk, ctx.safeX, box.y - ctx.lineHeight('label') - 8, 300).op);
  });
  return top + size + ctx.lineHeight('label') * 2;
};

/* --------------------------------------------------------------------- sankey */

const SANKEY_LABEL_GUTTER = 300;

/** Cubic ribbon sampled as a polygon: no path primitive is needed and every backend renders it identically. */
function ribbon(x1: number, y1: number, x2: number, y2: number, w: number, steps = 24): Array<[number, number]> {
  const cx1 = x1 + (x2 - x1) * 0.5, cx2 = x2 - (x2 - x1) * 0.5;
  const at = (t: number, a: number, b: number) => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * (a + (cx1 - x1)) + 3 * u * t * t * (b - (x2 - cx2)) + t * t * t * b;
  };
  const curve = (ya: number, yb: number) => Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    const x = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2;
    const y = u * u * u * ya + 3 * u * u * t * ya + 3 * u * t * t * yb + t * t * t * yb;
    return [round(x), round(y)] as [number, number];
  });
  void at;
  return [...curve(y1, y2), ...curve(y1 + w, y2 + w).reverse()];
}

const sankey: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const nodes = g.nodes!, edges = (g.edges ?? []).filter((e) => typeof e.value === 'number');
  if (!edges.length) throw new Error('sankey needs edges carrying numeric `value`');
  const ranks = rank(nodes, edges);
  const stages: DiagramNode[][] = [];
  for (const n of nodes) (stages[ranks.get(n.id) ?? 0] ??= []).push(n);
  const used = stages.filter(Boolean);

  const height = ctx.budget;
  const nodeW = 20;
  const gap = 28;
  // Terminal stages are labelled outside the flow field so copy never sits on a ribbon.
  const fieldX = ctx.safeX + SANKEY_LABEL_GUTTER;
  const fieldW = ctx.safeWidth - SANKEY_LABEL_GUTTER * 2;
  const stepX = used.length > 1 ? (fieldW - nodeW) / (used.length - 1) : 0;

  const throughput = new Map<string, number>();
  for (const n of nodes) {
    const out = edges.filter((e) => e.from === n.id).reduce((a, e) => a + (e.value ?? 0), 0);
    const inn = edges.filter((e) => e.to === n.id).reduce((a, e) => a + (e.value ?? 0), 0);
    throughput.set(n.id, Math.max(out, inn));
  }
  const stageMax = Math.max(...used.map((s) => s.reduce((a, n) => a + throughput.get(n.id)!, 0)));
  const maxGaps = Math.max(...used.map((s) => s.length - 1), 0) * gap;
  const pxPerUnit = (height - maxGaps) / stageMax;

  const pos = new Map<string, { x: number; y: number; h: number; stage: number }>();
  used.forEach((stage, si) => {
    const stageH = stage.reduce((a, n) => a + throughput.get(n.id)! * pxPerUnit, 0) + (stage.length - 1) * gap;
    let y = top + (height - stageH) / 2;
    for (const n of stage) {
      const h = Math.max(4, throughput.get(n.id)! * pxPerUnit);
      pos.set(n.id, { x: fieldX + si * stepX, y, h, stage: si });
      y += h + gap;
    }
  });

  ctx.group('Sankey', (into) => {
    const outCursor = new Map<string, number>(), inCursor = new Map<string, number>();
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) { ctx.warnings.push(`sankey edge ${e.from}->${e.to} references a missing node`); continue; }
      ctx.encode(e.value);
      const w = (e.value ?? 0) * pxPerUnit;
      const ay = a.y + (outCursor.get(e.from) ?? 0); outCursor.set(e.from, (outCursor.get(e.from) ?? 0) + w);
      const by = b.y + (inCursor.get(e.to) ?? 0); inCursor.set(e.to, (inCursor.get(e.to) ?? 0) + w);
      into.push({
        op: 'polygon', name: `Flow ${e.from} to ${e.to} (${e.value})`,
        points: ribbon(a.x + nodeW, ay, b.x, by, w),
        fill: { ...(ctx.accent(e.from) ?? ctx.seriesPaint(0, 'neutral.600')), opacity: 0.55 },
      });
    }
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      into.push({ op: 'rect', name: `Node ${n.id}`, x: round(p.x), y: round(p.y), w: nodeW, h: round(p.h), fill: ctx.accent(n.id) ?? ctx.seriesPaint(0, 'neutral.300'), radius: 2 });
      const label = `${n.label}  ${formatValue(throughput.get(n.id), ctx.locale)}`;
      const first = p.stage === 0, last = p.stage === used.length - 1;
      const block = ctx.text('detail', label, 0, 0, SANKEY_LABEL_GUTTER - 24, { maxLines: 2 });
      const y = p.y + p.h / 2 - block.height / 2;
      into.push(first
        ? ctx.text('detail', label, ctx.safeX, y, SANKEY_LABEL_GUTTER - 24, { maxLines: 2, align: 'right' }).op
        : last
          ? ctx.text('detail', label, p.x + nodeW + 24, y, SANKEY_LABEL_GUTTER - 24, { maxLines: 2 }).op
          : ctx.text('detail', label, p.x - 100, p.y - ctx.lineHeight('detail') - 8, 200 + nodeW, { maxLines: 1, align: 'center' }).op);
    }
  });
  return top + height;
};

/* ------------------------------------------------- stacked area and combo */

function stackedSeries(ctx: Ctx, columns: string[], rows: Row[]) {
  const totals = rows.map((r) => columns.reduce((a, c) => a + Number(r[c] ?? 0), 0));
  return { totals, max: Math.max(...totals, 0) };
}

const area: Renderer = (ctx, top) => {
  const { category, numeric } = fields(ctx);
  if (!numeric.length) throw new Error('area needs at least one numeric column');
  const rows = ctx.ir.data.rows;
  const { max } = stackedSeries(ctx, numeric, rows);
  const scale = niceScale(0, max, ctx.theme.chart.gridline.count ?? 5);
  const gutter = ctx.measure('detail', formatValue(scale.max, ctx.locale)) + 24;
  const height = ctx.budget;
  const box = plotBox(ctx, top, height - ctx.lineHeight('detail') * 2, gutter);
  const stepX = rows.length > 1 ? box.w / (rows.length - 1) : 0;
  const yOf = (v: number) => box.y + box.h - ((v - scale.min) / (scale.max - scale.min)) * box.h;

  let axisH = 0;
  ctx.group('Stacked area', (into) => {
    axes(ctx, into, box, scale, gutter);
    const base = rows.map(() => 0);
    const entries: Array<{ label: string; paint: SolidPaint }> = [];
    // Drawn bottom-up so each band sits on the running total, which is what makes it stacked.
    numeric.forEach((col, si) => {
      const fill = ctx.accent(col) ?? ctx.seriesPaint(si, 'neutral.500');
      entries.push({ label: col, paint: fill });
      const tops = rows.map((r, i) => { ctx.encode(r[col]); return base[i] + Number(r[col] ?? 0); });
      const points: Array<[number, number]> = [
        ...tops.map((v, i) => [box.x + stepX * i, yOf(v)] as [number, number]),
        ...base.map((v, i) => [box.x + stepX * i, yOf(v)] as [number, number]).reverse(),
      ];
      into.push({ op: 'polygon', name: `Band ${col}`, points: points.map(([x, y]) => [round(x), round(y)] as [number, number]),
        fill: { ...fill, opacity: ctx.theme.chart.areaOpacity ?? 0.16 } });
      into.push({ op: 'line', name: `Edge ${col}`,
        points: tops.map((v, i) => [round(box.x + stepX * i), round(yOf(v))] as [number, number]),
        stroke: fill, strokeWidth: 2 });
      tops.forEach((v, i) => { base[i] = v; });
    });
    axisH = categoryAxis(ctx, into, box, rows.map((r) => labelOf(ctx, r, category)), stepX, 0);
    legend(ctx, into, box, entries);
  });
  return box.y + box.h + axisH;
};

const combo: Renderer = (ctx, top) => {
  const { category, numeric } = fields(ctx);
  const lineKey = ctx.ir.visual.fields?.line;
  const barCols = numeric.filter((c) => c !== lineKey);
  if (!barCols.length) throw new Error('combo needs at least one numeric column to stack as bars');
  const rows = ctx.ir.data.rows;
  const lineValues = lineKey ? rows.map((r) => Number(r[lineKey] ?? 0)) : [];
  const { max } = stackedSeries(ctx, barCols, rows);
  const scale = niceScale(0, Math.max(max, ...lineValues), ctx.theme.chart.gridline.count ?? 5);
  const gutter = ctx.measure('detail', formatValue(scale.max, ctx.locale)) + 24;
  const height = ctx.budget;
  const box = plotBox(ctx, top, height - ctx.lineHeight('detail') * 2, gutter);
  const slot = box.w / rows.length;
  // A combo bar carries a stack, so it stays narrower when there is room and closes up
  // into a comb when there is not.
  const barW = Math.min(MAX_BAR_WIDTH, Math.max(1, slot * (slot < 24 ? 0.86 : 0.52)));
  const yOf = (v: number) => box.y + box.h - ((v - scale.min) / (scale.max - scale.min)) * box.h;

  let axisH = 0;
  ctx.group('Combo chart', (into) => {
    axes(ctx, into, box, scale, gutter);
    const entries: Array<{ label: string; paint: SolidPaint; line?: boolean }> = [];
    const base = rows.map(() => 0);
    barCols.forEach((col, si) => {
      const fill = ctx.accent(col) ?? ctx.seriesPaint(si, 'neutral.500');
      entries.push({ label: col, paint: fill });
      rows.forEach((r, i) => {
        const v = Number(r[col] ?? 0);
        ctx.encode(r[col]);
        const y0 = yOf(base[i]), y1 = yOf(base[i] + v);
        into.push({ op: 'rect', name: `Bar ${col} ${i}`,
          x: round(box.x + slot * i + (slot - barW) / 2), y: round(y1), w: round(barW), h: round(Math.max(1, y0 - y1)),
          fill: { ...fill, opacity: 0.85 } });
        base[i] += v;
      });
    });
    if (lineKey) {
      const stroke = ctx.accent(lineKey) ?? ctx.seriesPaint(barCols.length, 'accent.amber');
      entries.unshift({ label: lineKey, paint: stroke, line: true });
      lineValues.forEach((v) => ctx.encode(v));
      into.push({ op: 'line', name: `Series ${lineKey}`,
        points: lineValues.map((v, i) => [round(box.x + slot * i + slot / 2), round(yOf(v))] as [number, number]),
        stroke, strokeWidth: ctx.theme.chart.strokeWidth });
    }
    axisH = categoryAxis(ctx, into, box, rows.map((r) => labelOf(ctx, r, category)), slot, slot / 2);
    legend(ctx, into, box, entries);
  });
  return box.y + box.h + axisH;
};


/* ------------------------------------------- editorial grammars (part two) */

/** Entity card: a titled box whose body is a list of typed fields. */
function entityBox(ctx: Ctx, node: DiagramNode, x: number, y: number, w: number): number {
  const style = ctx.theme.surface.node!;
  const accent = ctx.nodeAccent(node);
  const rowH = ctx.lineHeight('detail') + 14;
  const head = ctx.lineHeight('h2') + 20;
  const h = head + (node.fields?.length ?? 0) * rowH + 12;
  ctx.group(`Entity ${node.id}`, (into) => {
    into.push({
      op: 'rect', name: `Entity ${node.id}`, x: round(x), y: round(y), w: round(w), h: round(h),
      fill: paint(ctx.theme, style.fill, style.fillOpacity),
      stroke: accent ?? paint(ctx.theme, style.stroke, ctx.theme.surface.nodeStrokeOpacity),
      strokeWidth: style.strokeWidth, radius: style.radius,
    });
    into.push({
      op: 'rect', name: 'Entity head', x: round(x), y: round(y), w: round(w), h: round(head),
      fill: accent ? { ...accent, opacity: 0.14 } : paint(ctx.theme, 'neutral.700', 0.25),
      radius: style.radius,
    });
    into.push(ctx.text('h2', node.label, x + 18, y + 10, w - 36, { maxLines: 1 }).op);
    (node.fields ?? []).forEach((field, i) => {
      const fy = y + head + 6 + i * rowH;
      if (i) into.push(ctx.line(`Entity rule ${i}`, [[x + 12, fy - 4], [x + w - 12, fy - 4]], { color: 'neutral.800', width: 1 }));
      into.push(ctx.text('detail', field.key ? `${field.key} ${field.name}` : field.name, x + 18, fy, w * 0.6).op);
      if (field.type) into.push(ctx.text('detail', field.type, x + w * 0.6, fy, w * 0.4 - 18, { align: 'right', color: 'neutral.500' }).op);
      ctx.encode(field.name, field.type, field.key);
    });
  });
  return h;
}

/** Entity grammars differ in vocabulary, not in geometry: a grid of field lists plus relations. */
function entityGrid(ctx: Ctx, top: number, name: string): number {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const cols = Math.min(nodes.length, nodes.length > 4 ? 3 : 2);
  const gap = 56;
  const w = (ctx.safeWidth - gap * (cols - 1)) / cols;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();

  let rowTop = top;
  let bottom = top;
  for (let start = 0; start < nodes.length; start += cols) {
    const row = nodes.slice(start, start + cols);
    let rowH = 0;
    row.forEach((node, i) => {
      const x = ctx.safeX + i * (w + gap);
      const h = entityBox(ctx, node, x, rowTop, w);
      pos.set(node.id, { x, y: rowTop, w, h });
      rowH = Math.max(rowH, h);
    });
    rowTop += rowH + gap;
    bottom = rowTop - gap;
  }

  ctx.group(`${name} relations`, (into) => {
    for (const edge of g.edges ?? []) {
      const a = pos.get(edge.from), b = pos.get(edge.to);
      if (!a || !b) { ctx.warnings.push(`relation ${edge.from}->${edge.to} references a missing entity`); continue; }
      const sameRow = Math.abs(a.y - b.y) < 1;
      const points: Array<[number, number]> = sameRow
        ? [[a.x + a.w, a.y + 40], [b.x, b.y + 40]]
        : [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, (a.y + a.h + b.y) / 2], [b.x + b.w / 2, (a.y + a.h + b.y) / 2], [b.x + b.w / 2, b.y]];
      into.push(ctx.line(`Relation ${edge.from}-${edge.to}`, points, { arrowEnd: true, dash: edge.style === 'dashed' ? [8, 6] : undefined }));
      if (edge.label) {
        into.push(ctx.text('detail', edge.label, (points[0][0] + points[points.length - 1][0]) / 2 - 90, Math.min(points[0][1], points[points.length - 1][1]) - 24, 180, { align: 'center', maxLines: 1 }).op);
      }
    }
  });
  return bottom;
}

/** Bands: groups become horizontal tiers, which is how a stack or a landscape reads. */
function bandedGraph(ctx: Ctx, top: number, name: string, opts: { showStatus?: boolean; emphasise?: number } = {}): number {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const style = ctx.theme.surface.node!;
  const bands = g.groups?.length
    ? g.groups.map((gr) => ({ id: gr.id, label: gr.label }))
    : [...new Set(nodes.map((n) => n.group ?? 'Layer'))].map((id) => ({ id, label: id }));

  const labelW = Math.max(...bands.map((b) => ctx.measure('label', b.label))) + 56;
  const gap = 20;
  const bandH = Math.max(120, (ctx.budget - gap * (bands.length - 1)) / bands.length);

  ctx.group(name, (into) => {
    bands.forEach((band, bi) => {
      const y = top + bi * (bandH + gap);
      const members = nodes.filter((n) => (n.group ?? 'Layer') === band.id);
      const emphasised = opts.emphasise === bi;
      into.push(ctx.rect(`Band ${band.label}`, ctx.safeX, y, ctx.safeWidth, bandH, {
        fill: ctx.theme.surface.panel.fill,
        fillOpacity: (ctx.theme.surface.panel.fillOpacity ?? 1) * (emphasised ? 1 : 0.6),
        stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius,
      }));
      into.push(ctx.text('label', band.label, ctx.safeX + 24, y + bandH / 2 - ctx.lineHeight('label') / 2, labelW - 48).op);
      if (!members.length) return;
      const cw = (ctx.safeWidth - labelW - 32 - 20 * (members.length - 1)) / members.length;
      members.forEach((node, i) => {
        const x = ctx.safeX + labelW + i * (cw + 20);
        const accent = ctx.nodeAccent(node);
        const ch = bandH - 48;
        into.push({
          op: 'rect', name: `Node ${node.id}`, x: round(x), y: round(y + 24), w: round(cw), h: round(ch),
          fill: accent ? { ...accent, opacity: 0.12 } : paint(ctx.theme, 'neutral.800', 0.7),
          stroke: accent ?? paint(ctx.theme, style.stroke, ctx.theme.surface.nodeStrokeOpacity),
          strokeWidth: style.strokeWidth, radius: style.radius,
        });
        into.push(ctx.text('body', node.label, x + 20, y + 40, cw - 40, { align: 'center', maxLines: 2 }).op);
        if (node.note) into.push(ctx.text('detail', node.note, x + 20, y + 40 + ctx.lineHeight('body') * 2, cw - 40, { align: 'center', maxLines: 2 }).op);
        if (opts.showStatus && node.status) {
          const tag = ctx.text('detail', node.status, x + 20, y + 24 + ch - ctx.lineHeight('detail') - 12, cw - 40, { align: 'center', maxLines: 1, color: accent ? accent.color : 'neutral.400' });
          into.push(tag.op);
          ctx.encode(node.status);
        }
      });
    });
  });
  return top + bands.length * (bandH + gap) - gap;
}

/** Columns of cards: the board grammars differ only in what a column means. */
function boardColumns(ctx: Ctx, top: number, name: string, backboneLabel?: string): number {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const columns = g.groups?.length
    ? g.groups.map((gr) => ({ id: gr.id, label: gr.label }))
    : [...new Set(nodes.map((n) => n.group ?? n.lane ?? 'Column'))].map((id) => ({ id, label: id }));
  const gap = 24;
  const w = (ctx.safeWidth - gap * (columns.length - 1)) / columns.length;
  const style = ctx.theme.surface.node!;
  const cardH = ctx.lineHeight('body') + 36;
  let bottom = top;

  ctx.group(name, (into) => {
    columns.forEach((column, ci) => {
      const x = ctx.safeX + ci * (w + gap);
      const members = nodes.filter((n) => (n.group ?? n.lane ?? 'Column') === column.id);
      const header = ctx.text('label', column.label, x, top, w, { align: 'center' });
      into.push(header.op);
      let y = top + header.height + 16;
      if (backboneLabel && members[0]) {
        const spine = ctx.rect(`Backbone ${column.label}`, x, y, w, cardH, {
          fill: 'neutral.700', fillOpacity: 0.35, stroke: style.stroke, strokeWidth: 1, radius: style.radius,
        });
        into.push(spine);
        into.push(ctx.text('body', members[0].label, x + 16, y + 18, w - 32, { align: 'center', maxLines: 1 }).op);
        y += cardH + 20;
      }
      const rest = backboneLabel ? members.slice(1) : members;
      for (const node of rest) {
        const accent = ctx.nodeAccent(node);
        const lines = ctx.text('body', node.label, 0, 0, w - 32).op.lines.length;
        const h = lines * ctx.lineHeight('body') + 32 + (node.note ? ctx.lineHeight('detail') + 6 : 0);
        into.push({
          op: 'rect', name: `Card ${node.id}`, x: round(x), y: round(y), w: round(w), h: round(h),
          fill: accent ? { ...accent, opacity: 0.12 } : paint(ctx.theme, style.fill, style.fillOpacity),
          stroke: accent ?? paint(ctx.theme, style.stroke, ctx.theme.surface.nodeStrokeOpacity),
          strokeWidth: style.strokeWidth, radius: style.radius,
        });
        into.push(ctx.text('body', node.label, x + 16, y + 16, w - 32, { maxLines: 2 }).op);
        if (node.note) into.push(ctx.text('detail', node.note, x + 16, y + 16 + lines * ctx.lineHeight('body'), w - 32, { maxLines: 1, color: 'neutral.500' }).op);
        y += h + 14;
      }
      bottom = Math.max(bottom, y);
    });
  });
  return bottom;
}


/* ------------------------------------------ shape, set and measure grammars */

const venn: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const sets = g.nodes!.slice(0, 3);
  const size = Math.min(ctx.budget - 120, 720);
  const r = size / (sets.length === 3 ? 3.1 : 2.7);
  const cx = ctx.safeX + ctx.safeWidth / 2;
  const cy = top + size / 2;
  const layout = sets.length === 3
    ? [[-r * 0.62, -r * 0.36], [r * 0.62, -r * 0.36], [0, r * 0.7]]
    : [[-r * 0.55, 0], [r * 0.55, 0]];

  ctx.group('Venn', (into) => {
    sets.forEach((node, i) => {
      const fill = ctx.nodeAccent(node) ?? ctx.seriesPaint(i, 'neutral.400');
      const [dx, dy] = layout[i] ?? [0, 0];
      into.push({ op: 'ellipse', name: `Set ${node.id}`, cx: round(cx + dx), cy: round(cy + dy), rx: r, ry: r,
        fill: { ...fill, opacity: 0.22 }, stroke: fill, strokeWidth: 2 });
      const lx = cx + dx * 1.65 - 150;
      const ly = cy + dy * 1.7 - ctx.lineHeight('h2') / 2;
      into.push(ctx.text('h2', node.label, lx, ly, 300, { align: 'center', maxLines: 2 }).op);
      if (node.note) into.push(ctx.text('detail', node.note, lx, ly + ctx.lineHeight('h2'), 300, { align: 'center', maxLines: 2 }).op);
    });
    for (const edge of g.edges ?? []) {
      if (!edge.label) continue;
      into.push(ctx.text('detail', edge.label, cx - 150, cy - ctx.lineHeight('detail') / 2, 300, { align: 'center', maxLines: 2 }).op);
    }
  });
  return top + size;
};

/** Pyramid and funnel share a trapezoid stack; only the direction of narrowing differs. */
function trapezoidStack(ctx: Ctx, top: number, name: string, invert: boolean): number {
  const g = graphOf(ctx);
  const tiers = g.nodes!;
  const gap = 10;
  const h = Math.min(ctx.budget, 120 * tiers.length) / tiers.length - gap;
  const maxW = Math.min(ctx.safeWidth * 0.66, 1000);
  const cx = ctx.safeX + ctx.safeWidth / 2;

  ctx.group(name, (into) => {
    tiers.forEach((tier, i) => {
      const t0 = i / tiers.length, t1 = (i + 1) / tiers.length;
      const wTop = maxW * (invert ? 1 - t0 : t0 + 1 / tiers.length);
      const wBottom = maxW * (invert ? 1 - t1 : t1 + 1 / tiers.length);
      const y = top + i * (h + gap);
      const fill = ctx.accent(tier.id) ?? ctx.seriesPaint(i, 'neutral.500');
      into.push({
        op: 'polygon', name: `Tier ${tier.id}`,
        points: [[cx - wTop / 2, y], [cx + wTop / 2, y], [cx + wBottom / 2, y + h], [cx - wBottom / 2, y + h]]
          .map(([x, yy]) => [round(x), round(yy)] as [number, number]),
        fill: { ...fill, opacity: 0.24 }, stroke: fill, strokeWidth: 1.5,
      });
      into.push(ctx.text('h2', tier.label, cx - maxW / 2, y + h / 2 - ctx.lineHeight('h2') / 2, maxW, { align: 'center', maxLines: 1 }).op);
      if (typeof tier.value === 'number') {
        ctx.encode(tier.value);
        into.push(ctx.text('detail', formatValue(tier.value, ctx.locale), cx + maxW / 2 + 24, y + h / 2 - ctx.lineHeight('detail') / 2, 240, { maxLines: 1 }).op);
      }
      if (tier.note) into.push(ctx.text('detail', tier.note, ctx.safeX, y + h / 2 - ctx.lineHeight('detail') / 2, (ctx.safeWidth - maxW) / 2 - 24, { align: 'right', maxLines: 2, color: 'neutral.500' }).op);
    });
  });
  return top + tiers.length * (h + gap) - gap;
}

/** Squarified-ish treemap: area encodes the quantity, so the split alternates axes. */
const treemap: Renderer = (ctx, top) => {
  const { category, value } = fields(ctx);
  const rows = ctx.ir.data.rows;
  if (!value) throw new Error('treemap needs a numeric column');
  const items = rows.map((r) => ({ row: r, v: Math.max(0, Number(r[value] ?? 0)) })).sort((a, b) => b.v - a.v);
  const total = items.reduce((a, b) => a + b.v, 0);
  if (total <= 0) throw new Error('treemap needs a positive total');
  const height = ctx.budget;

  ctx.group('Treemap', (into) => {
    let rect = { x: ctx.safeX, y: top, w: ctx.safeWidth, h: height };
    let remaining = total;
    items.forEach((item, i) => {
      const last = i === items.length - 1;
      const share = item.v / remaining;
      const horizontal = rect.w >= rect.h;
      const cut = last ? (horizontal ? rect.w : rect.h) : (horizontal ? rect.w : rect.h) * share;
      const cell = horizontal ? { x: rect.x, y: rect.y, w: cut, h: rect.h } : { x: rect.x, y: rect.y, w: rect.w, h: cut };
      rect = horizontal
        ? { x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }
        : { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut };
      remaining -= item.v;

      const fill = ctx.accent(String(item.row.id ?? '')) ?? ctx.seriesPaint(i, 'neutral.500');
      ctx.encode(item.v);
      into.push({ op: 'rect', name: `Cell ${labelOf(ctx, item.row, category)}`,
        x: round(cell.x + 3), y: round(cell.y + 3), w: round(cell.w - 6), h: round(cell.h - 6),
        fill: { ...fill, opacity: ctx.ir.visual.colorMode === 'none' ? 1 : 0.22 },
        stroke: fill, strokeWidth: 1, radius: 8 });
      if (cell.w > 120 && cell.h > 70) {
        into.push(ctx.text('body', labelOf(ctx, item.row, category), cell.x + 20, cell.y + 18, cell.w - 40, { maxLines: 2 }).op);
        into.push(ctx.text('detail', formatValue(item.v, ctx.locale), cell.x + 20, cell.y + 18 + ctx.lineHeight('body'), cell.w - 40, { maxLines: 1, color: 'neutral.500' }).op);
      }
    });
  });
  return top + height;
};

/** Gantt: one row per task, bars placed on a shared numeric or index time axis. */
const gantt: Renderer = (ctx, top) => {
  const rows = ctx.ir.data.rows;
  const cols = ctx.ir.data.columns;
  const nameKey = ctx.ir.visual.fields?.category ?? cols.find((c) => c !== 'id' && !ctx.ir.data.numericColumns.includes(c)) ?? 'id';
  const [startKey, endKey] = ctx.ir.data.numericColumns;
  if (!startKey || !endKey) throw new Error('gantt needs numeric start and end columns');
  const min = Math.min(...rows.map((r) => Number(r[startKey])));
  const max = Math.max(...rows.map((r) => Number(r[endKey])));
  const labelW = Math.max(...rows.map((r) => ctx.measure('body', labelOf(ctx, r, nameKey)))) + 40;
  const box = { x: ctx.safeX + labelW, y: top, w: ctx.safeWidth - labelW, h: ctx.budget - 60 };
  const rowH = Math.min(72, box.h / Math.max(1, rows.length));
  const xOf = (v: number) => box.x + ((v - min) / (max - min || 1)) * box.w;

  ctx.group('Gantt', (into) => {
    const ticks = niceScale(min, max, 6);
    for (let v = ticks.min; v <= ticks.max + 1e-9; v += ticks.step) {
      if (v < min || v > max) continue;
      into.push(ctx.line(`Gridline ${v}`, [[xOf(v), box.y], [xOf(v), box.y + rows.length * rowH]], {
        color: ctx.theme.chart.gridline.color, width: ctx.theme.chart.gridline.width, opacity: ctx.theme.chart.gridline.opacity }));
      into.push(ctx.text('detail', formatValue(v, ctx.locale), xOf(v) - 60, box.y + rows.length * rowH + 12, 120, { align: 'center', maxLines: 1 }).op);
    }
    rows.forEach((r, i) => {
      const y = box.y + i * rowH;
      const fill = ctx.accent(String(r.id ?? '')) ?? ctx.seriesPaint(i, 'neutral.500');
      ctx.encode(r[startKey], r[endKey]);
      into.push(ctx.text('body', labelOf(ctx, r, nameKey), ctx.safeX, y + rowH / 2 - ctx.lineHeight('body') / 2, labelW - 24, { maxLines: 1 }).op);
      into.push({ op: 'rect', name: `Task ${labelOf(ctx, r, nameKey)}`,
        x: round(xOf(Number(r[startKey]))), y: round(y + rowH * 0.22),
        w: round(Math.max(4, xOf(Number(r[endKey])) - xOf(Number(r[startKey])))), h: round(rowH * 0.56),
        fill: { ...fill, opacity: 0.34 }, stroke: fill, strokeWidth: 1, radius: 6 });
    });
  });
  return box.y + rows.length * rowH + ctx.lineHeight('detail') + 20;
};

/** Radar and polar share a radial frame; radar closes a polygon, polar draws wedges. */
function radial(ctx: Ctx, top: number, name: string, mode: 'radar' | 'polar'): number {
  const { category, numeric } = fields(ctx);
  const rows = ctx.ir.data.rows;
  if (!numeric.length) throw new Error(`${name} needs at least one numeric column`);
  const size = Math.min(ctx.budget, 660);
  const cx = ctx.safeX + ctx.safeWidth / 2;
  const cy = top + size / 2;
  const r = size / 2 - 80;
  const max = Math.max(...numeric.flatMap((c) => rows.map((x) => Number(x[c] ?? 0))));
  const angle = (i: number) => -Math.PI / 2 + (i / rows.length) * Math.PI * 2;

  ctx.group(name, (into) => {
    for (let ring = 1; ring <= 4; ring++) {
      const rr = (r * ring) / 4;
      into.push({ op: 'polygon', name: `Ring ${ring}`,
        points: rows.map((_, i) => [round(cx + Math.cos(angle(i)) * rr), round(cy + Math.sin(angle(i)) * rr)] as [number, number]),
        stroke: paint(ctx.theme, ctx.theme.chart.gridline.color, ctx.theme.chart.gridline.opacity), strokeWidth: 1 });
    }
    rows.forEach((row, i) => {
      into.push(ctx.line(`Axis ${i}`, [[cx, cy], [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r]], {
        color: ctx.theme.chart.axis.color, width: 1 }));
      const lx = cx + Math.cos(angle(i)) * (r + 34) - 110;
      into.push(ctx.text('detail', labelOf(ctx, row, category), lx, cy + Math.sin(angle(i)) * (r + 34) - ctx.lineHeight('detail') / 2, 220, { align: 'center', maxLines: 2 }).op);
    });
    numeric.forEach((col, si) => {
      const fill = ctx.accent(col) ?? ctx.seriesPaint(si, 'neutral.400');
      if (mode === 'radar') {
        const points = rows.map((row, i) => {
          ctx.encode(row[col]);
          const rr = (Number(row[col] ?? 0) / (max || 1)) * r;
          return [round(cx + Math.cos(angle(i)) * rr), round(cy + Math.sin(angle(i)) * rr)] as [number, number];
        });
        into.push({ op: 'polygon', name: `Series ${col}`, points, fill: { ...fill, opacity: 0.2 }, stroke: fill, strokeWidth: 2 });
      } else {
        const span = (Math.PI * 2) / rows.length;
        rows.forEach((row, i) => {
          ctx.encode(row[col]);
          const rr = (Number(row[col] ?? 0) / (max || 1)) * r;
          into.push({ op: 'arc', name: `Wedge ${col} ${i}`, cx: round(cx), cy: round(cy),
            rOuter: round(rr), rInner: 0, startAngle: round(angle(i) - span / 2 + 0.02), endAngle: round(angle(i) + span / 2 - 0.02),
            fill: { ...fill, opacity: 0.4 } });
        });
      }
    });
    legend(ctx, into, { x: ctx.safeX, y: top, w: ctx.safeWidth, h: size },
      numeric.map((c, i) => ({ label: c, paint: ctx.accent(c) ?? ctx.seriesPaint(i, 'neutral.400') })));
  });
  return top + size;
}

/** Fishbone: grouped causes angle into one spine that ends at the effect. */
const fishbone: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const effect = nodes.find((n) => n.kind === 'effect') ?? nodes[nodes.length - 1];
  const causes = nodes.filter((n) => n !== effect);
  const groups = [...new Set(causes.map((c) => c.group ?? c.label))];
  const height = Math.min(ctx.budget, 720);
  const spineY = top + height / 2;
  const headW = Math.max(260, ctx.measure('h2', effect.label) + 80);
  const spineEnd = ctx.safeX + ctx.safeWidth - headW - 24;
  // Bones are spread across the whole spine, paired above and below.
  const pairs = Math.max(1, Math.ceil(groups.length / 2));
  const span = spineEnd - ctx.safeX - 160;

  ctx.group('Fishbone', (into) => {
    into.push(ctx.line('Spine', [[ctx.safeX, spineY], [spineEnd, spineY]], {
      color: ctx.theme.chart.axis.color, width: ctx.theme.chart.axis.width, arrowEnd: true }));
    into.push(ctx.rect('Effect', spineEnd + 24, spineY - 48, headW, 96, {
      fill: ctx.theme.surface.panel.fill, fillOpacity: ctx.theme.surface.panel.fillOpacity,
      stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius }));
    into.push(ctx.text('h2', effect.label, spineEnd + 44, spineY - ctx.lineHeight('h2') / 2, headW - 40, { align: 'center', maxLines: 2 }).op);

    groups.forEach((group, gi) => {
      const above = gi % 2 === 0;
      const x = ctx.safeX + 120 + ((Math.floor(gi / 2) + 0.5) * span) / pairs;
      const tipY = above ? spineY - height * 0.36 : spineY + height * 0.36;
      const tipX = x - (above ? 90 : -90) * -1;
      into.push(ctx.line(`Bone ${group}`, [[tipX, tipY], [x, spineY]], { color: 'neutral.600', width: 1.5 }));
      into.push(ctx.text('label', group, tipX - 130, tipY - (above ? ctx.lineHeight('label') + 8 : -12), 260, { align: 'center', maxLines: 1 }).op);
      const members = causes.filter((c) => (c.group ?? c.label) === group);
      members.forEach((cause, mi) => {
        const t = (mi + 1) / (members.length + 1);
        const px = tipX + (x - tipX) * t;
        const py = tipY + (spineY - tipY) * t;
        into.push(ctx.text('detail', cause.label, px + 14, py - ctx.lineHeight('detail') / 2, 240, { maxLines: 1, color: 'neutral.400' }).op);
      });
    });
  });
  return top + height;
};

/** Wardley map: value chain on y, evolution on x. Positions are supplied, never inferred. */
const wardley: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const height = Math.min(ctx.budget - 60, 760);
  const box = { x: ctx.safeX + 120, y: top, w: ctx.safeWidth - 140, h: height };
  const stages = ['Genesis', 'Custom', 'Product', 'Commodity'];

  ctx.group('Wardley map', (into) => {
    into.push(ctx.rect('Map field', box.x, box.y, box.w, box.h, {
      fill: ctx.theme.surface.panel.fill, fillOpacity: (ctx.theme.surface.panel.fillOpacity ?? 1) * 0.6,
      stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius }));
    stages.forEach((stage, i) => {
      const x = box.x + (box.w * i) / stages.length;
      if (i) into.push(ctx.line(`Evolution ${stage}`, [[x, box.y], [x, box.y + box.h]], { color: 'neutral.700', width: 1, dash: [6, 6] }));
      into.push(ctx.text('detail', stage, x + 12, box.y + box.h + 12, box.w / stages.length - 24, { maxLines: 1 }).op);
    });
    into.push({ ...ctx.text('label', 'Value chain', ctx.safeX, box.y + box.h / 2, 220, { maxLines: 1, rotate: -90 }).op });

    const pos = new Map<string, [number, number]>();
    nodes.forEach((node) => {
      const px = box.x + (node.x ?? 0.5) * box.w;
      const py = box.y + (1 - (node.y ?? 0.5)) * box.h;
      pos.set(node.id, [px, py]);
    });
    for (const edge of g.edges ?? []) {
      const a = pos.get(edge.from), b = pos.get(edge.to);
      if (a && b) into.push(ctx.line(`Chain ${edge.from}-${edge.to}`, [a, b], { color: 'neutral.600', width: 1.5 }));
    }
    nodes.forEach((node, i) => {
      const [px, py] = pos.get(node.id)!;
      const fill = ctx.nodeAccent(node) ?? ctx.seriesPaint(i, 'neutral.300');
      into.push({ op: 'ellipse', name: `Component ${node.id}`, cx: round(px), cy: round(py), rx: 10, ry: 10,
        fill: paint(ctx.theme, 'neutral.950'), stroke: fill, strokeWidth: 2.5 });
      into.push(ctx.text('detail', node.label, px + 18, py - ctx.lineHeight('detail') / 2, 260, { maxLines: 1 }).op);
    });
  });
  return box.y + box.h + ctx.lineHeight('detail') + 16;
};

/** User journey: stages across the top, actions beneath, sentiment as a line. */
const journey: Renderer = (ctx, top) => {
  const rows = ctx.ir.data.rows;
  const cols = ctx.ir.data.columns;
  const stageKey = ctx.ir.visual.fields?.category ?? cols.find((c) => c !== 'id' && !ctx.ir.data.numericColumns.includes(c)) ?? 'id';
  const actionKey = cols.find((c) => c !== 'id' && c !== stageKey && !ctx.ir.data.numericColumns.includes(c));
  const sentimentKey = ctx.ir.data.numericColumns[0];
  const gap = 20;
  const w = (ctx.safeWidth - gap * (rows.length - 1)) / rows.length;
  const cardH = 168;
  const lineH = sentimentKey ? 220 : 0;

  ctx.group('User journey', (into) => {
    rows.forEach((row, i) => {
      const x = ctx.safeX + i * (w + gap);
      const accent = ctx.accent(String(row.id ?? ''));
      into.push(ctx.rect(`Stage ${labelOf(ctx, row, stageKey)}`, x, top, w, cardH, {
        fill: ctx.theme.surface.panel.fill, fillOpacity: ctx.theme.surface.panel.fillOpacity,
        stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius }));
      if (accent) into.push({ op: 'rect', name: 'Stage accent', x: round(x), y: round(top), w: round(w), h: 4, fill: accent, radius: 2 });
      into.push(ctx.text('h2', labelOf(ctx, row, stageKey), x + 20, top + 22, w - 40, { maxLines: 2 }).op);
      if (actionKey) into.push(ctx.text('detail', labelOf(ctx, row, actionKey), x + 20, top + 22 + ctx.lineHeight('h2'), w - 40, { maxLines: 3, color: 'neutral.400' }).op);
    });
    if (!sentimentKey) return;
    const values = rows.map((r) => Number(r[sentimentKey] ?? 0));
    const scale = niceScale(Math.min(...values), Math.max(...values), 3);
    const lineTop = top + cardH + 48;
    const yOf = (v: number) => lineTop + lineH - ((v - scale.min) / (scale.max - scale.min || 1)) * lineH;
    const stroke = ctx.seriesPaint(0, 'neutral.300');
    const points = rows.map((r, i) => { ctx.encode(r[sentimentKey]); return [round(ctx.safeX + i * (w + gap) + w / 2), round(yOf(Number(r[sentimentKey] ?? 0)))] as [number, number]; });
    into.push(ctx.line('Sentiment baseline', [[ctx.safeX, lineTop + lineH], [ctx.safeX + ctx.safeWidth, lineTop + lineH]], {
      color: ctx.theme.chart.axis.color, width: 1 }));
    into.push({ op: 'line', name: `Sentiment ${sentimentKey}`, points, stroke, strokeWidth: ctx.theme.chart.strokeWidth });
    points.forEach(([px, py], i) => into.push({ op: 'ellipse', name: `Sentiment ${i}`, cx: px, cy: py, rx: 7, ry: 7,
      fill: ctx.accent(String(rows[i].id ?? '')) ?? stroke,
      stroke: paint(ctx.theme, ctx.theme.canvas.background), strokeWidth: 3 }));
    into.push(ctx.text('label', sentimentKey, ctx.safeX, lineTop - ctx.lineHeight('label') - 8, 400, { maxLines: 1 }).op);
  });
  return top + cardH + (sentimentKey ? 48 + lineH + 24 : 0);
};

/** Permission matrix: roles down, resources across, the cell value read as-is. */
const matrix: Renderer = (ctx, top) => {
  const rows = ctx.ir.data.rows;
  const cols = ctx.ir.data.columns.filter((c) => c !== 'id');
  if (cols.length < 2) throw new Error('matrix needs a row label column and at least one resource column');
  const [head, ...resources] = cols;
  const labelW = Math.max(ctx.measure('label', head), ...rows.map((r) => ctx.measure('body', labelOf(ctx, r, head)))) + 48;
  const cellW = (ctx.safeWidth - labelW) / resources.length;
  const headH = ctx.lineHeight('label') + 28;
  const rowH = ctx.lineHeight('body') + 28;

  ctx.group('Matrix', (into) => {
    into.push(ctx.rect('Matrix container', ctx.safeX, top, ctx.safeWidth, headH + rows.length * rowH, {
      fill: ctx.theme.surface.panel.fill, fillOpacity: ctx.theme.surface.panel.fillOpacity,
      stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius }));
    into.push(ctx.rect('Matrix header', ctx.safeX, top, ctx.safeWidth, headH, {
      fill: ctx.theme.surface.header?.fill ?? 'neutral.700', fillOpacity: ctx.theme.surface.header?.fillOpacity, radius: ctx.theme.surface.panel.radius }));
    into.push(ctx.text('label', head, ctx.safeX + 24, top + 14, labelW - 48, { maxLines: 1 }).op);
    resources.forEach((resource, ci) => {
      into.push(ctx.text('label', resource, ctx.safeX + labelW + ci * cellW, top + 14, cellW, { align: 'center', maxLines: 1 }).op);
      if (ci) into.push(ctx.line(`Column rule ${ci}`, [[ctx.safeX + labelW + ci * cellW, top], [ctx.safeX + labelW + ci * cellW, top + headH + rows.length * rowH]], {
        color: ctx.theme.surface.divider.color, width: 1, opacity: 0.5 }));
    });
    rows.forEach((row, ri) => {
      const y = top + headH + ri * rowH;
      if (ri) into.push(ctx.line(`Row rule ${ri}`, [[ctx.safeX, y], [ctx.safeX + ctx.safeWidth, y]], {
        color: ctx.theme.surface.divider.color, width: 1 }));
      const accent = ctx.accent(String(row.id ?? ''));
      into.push(ctx.text('body', labelOf(ctx, row, head), ctx.safeX + 24, y + 14, labelW - 48, { maxLines: 1, color: accent?.color }).op);
      resources.forEach((resource, ci) => {
        const value = labelOf(ctx, row, resource);
        if (!value) return;
        into.push(ctx.text('body', value, ctx.safeX + labelW + ci * cellW, y + 14, cellW, {
          align: 'center', maxLines: 1, color: ctx.accent(`${row.id}:${resource}`)?.color }).op);
      });
    });
  });
  return top + headH + rows.length * rowH;
};

/** Nested containment: a group is drawn as the box its members sit inside. */
const nested: Renderer = (ctx, top) => {
  const g = graphOf(ctx);
  const nodes = g.nodes!;
  const shells = g.groups?.length
    ? g.groups.map((gr) => ({ id: gr.id, label: gr.label }))
    : [...new Set(nodes.map((n) => n.group ?? 'Outer'))].map((id) => ({ id, label: id }));
  const inset = 56;
  const headroom = ctx.lineHeight('label') + 18;
  const height = Math.min(ctx.budget, 720);

  ctx.group('Nested', (into) => {
    shells.forEach((shell, i) => {
      const x = ctx.safeX + i * inset;
      const y = top + i * (headroom + 8);
      const w = ctx.safeWidth - i * inset * 2;
      const h = height - i * (headroom + 8) * 2;
      const accent = ctx.accent(shell.id);
      into.push(ctx.rect(`Shell ${shell.label}`, x, y, w, h, {
        fill: ctx.theme.surface.panel.fill, fillOpacity: (ctx.theme.surface.panel.fillOpacity ?? 1) * (0.4 + i * 0.2),
        stroke: ctx.theme.surface.panel.stroke, strokeWidth: 1, radius: ctx.theme.surface.panel.radius }));
      if (accent) into.push({ op: 'rect', name: 'Shell accent', x: round(x), y: round(y), w: 4, h: round(h), fill: accent, radius: 2 });
      into.push(ctx.text('label', shell.label, x + 24, y + 14, w - 48, { maxLines: 1 }).op);
    });
    const innermost = shells.length - 1;
    const members = nodes.filter((n) => (n.group ?? 'Outer') === shells[innermost]?.id);
    const x0 = ctx.safeX + innermost * inset + 32;
    const y0 = top + innermost * (headroom + 8) + headroom + 20;
    const w0 = ctx.safeWidth - innermost * inset * 2 - 64;
    const cw = members.length ? (w0 - 20 * (members.length - 1)) / members.length : w0;
    members.forEach((node, i) => {
      const accent = ctx.nodeAccent(node);
      into.push({ op: 'rect', name: `Node ${node.id}`, x: round(x0 + i * (cw + 20)), y: round(y0), w: round(cw), h: 110,
        fill: accent ? { ...accent, opacity: 0.12 } : paint(ctx.theme, 'neutral.800', 0.8),
        stroke: accent ?? paint(ctx.theme, 'neutral.600'), strokeWidth: 1, radius: 10 });
      into.push(ctx.text('body', node.label, x0 + i * (cw + 20) + 16, y0 + 34, cw - 32, { align: 'center', maxLines: 2 }).op);
    });
  });
  return top + height;
};

/* ------------------------------------------------------------------- registry */

const compose: Renderer = (ctx, top) =>
  composeBlocks(ctx, ctx.ir.data.blocks ?? [], { x: ctx.safeX, y: top, w: ctx.safeWidth });

export const RENDERERS: Record<TemplateId, Renderer> = {
  compose,
  // One grammar, two readings: a measurement against an axis, or a printed ranking.
  bar: (ctx, top) => {
    const style = ctx.ir.visual.style;
    if (style === 'editorial') return editorialBar(ctx, top);
    if (style === 'share') return shareRows(ctx, top);
    if (style === 'paired') return pairedRows(ctx, top);
    return bar(ctx, top);
  },
  table, line, scatter, waterfall, donut, loop, timeline, quadrant, layers, sankey, area, combo,
  process: (ctx, top) => layeredGraph(ctx, top, { orientation: 'horizontal', name: 'Process' }),
  flowchart: (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'Flowchart' }),
  architecture: (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'Architecture' }),
  'data-flow': (ctx, top) => layeredGraph(ctx, top, { orientation: 'horizontal', name: 'Data flow' }),
  deployment: (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'Deployment' }),
  dependency: (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'Dependency graph' }),
  tree: (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'Tree' }),
  sequence: (ctx, top) => laneLayout(ctx, top, 'Sequence'),
  swimlane: (ctx, top) => laneLayout(ctx, top, 'Swimlane'),

  venn, treemap, gantt, fishbone, wardley, journey, matrix, nested,
  state: (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'State machine' }),
  'org-chart': (ctx, top) => layeredGraph(ctx, top, { orientation: 'vertical', name: 'Org chart' }),
  er: (ctx, top) => entityGrid(ctx, top, 'ER'),
  'uml-class': (ctx, top) => entityGrid(ctx, top, 'UML class'),
  'db-schema': (ctx, top) => entityGrid(ctx, top, 'Database schema'),
  pyramid: (ctx, top) => trapezoidStack(ctx, top, 'Pyramid', false),
  funnel: (ctx, top) => trapezoidStack(ctx, top, 'Funnel', true),
  radar: (ctx, top) => radial(ctx, top, 'Radar', 'radar'),
  polar: (ctx, top) => radial(ctx, top, 'Polar', 'polar'),
  kanban: (ctx, top) => boardColumns(ctx, top, 'Kanban'),
  'story-map': (ctx, top) => boardColumns(ctx, top, 'Story map', 'backbone'),
  'high-level': (ctx, top) => bandedGraph(ctx, top, 'High level'),
  medallion: (ctx, top) => bandedGraph(ctx, top, 'Medallion', { emphasise: 2 }),
  'dp-integration': (ctx, top) => bandedGraph(ctx, top, 'Data platform integration', { emphasise: 1 }),
  'it-state': (ctx, top) => bandedGraph(ctx, top, 'IT current state', { showStatus: true }),
};


bindTemplateRenderer((ctx, template, top) => RENDERERS[template](ctx, top));
