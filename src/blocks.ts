import type { AccentPlacement, Block, Card, Op, Row, SolidPaint, Stage, SurfaceVariant, TemplateId, Theme } from './types.js';
import { Ctx, round } from './draw.js';
import { paint } from './theme.js';
import { resolveGradient } from './chrome.js';
import { formatValue } from './text.js';
import { tint } from './palette.js';

/**
 * Free composition.
 *
 * The twenty grammars answer "which chart"; they cannot answer "a 2x2 card grid, then a
 * summary panel". Real FOUR PILLARS frames are mostly the latter, so blocks are the open
 * half of the system: an agent composes whatever the story needs and the pack still owns
 * colour, type, spacing and chrome. Nothing here decides content.
 */

export interface Area { x: number; y: number; w: number }

type Compose = (ctx: Ctx, blocks: Block[], area: Area) => number;

const DEFAULT_GAP = 40;
// A table cell wraps up to four lines. Past that the cell is not a cell any more, and the
// audit's truncation finding is then a real editorial problem instead of a layout bug.
const MAX_CELL_LINES = 4;

export const composeBlocks: Compose = (ctx, blocks, area) => {
  let y = area.y;
  for (const block of blocks) {
    if (y > area.y) y += block.gapBefore ?? DEFAULT_GAP;
    y = renderBlock(ctx, block, { ...area, y });
  }
  return y;
};

function renderBlock(ctx: Ctx, block: Block, area: Area): number {
  // Exhaustive over Block; the default keeps the compiler honest if a kind is added.
  switch (block.kind) {
    case 'text': return textBlock(ctx, block, area);
    case 'columns': return columnsBlock(ctx, block, area);
    case 'cards': return cardsBlock(ctx, block, area);
    case 'panel': return panelBlock(ctx, block, area);
    case 'kpi': return kpiBlock(ctx, block, area);
    case 'steps': return stepsBlock(ctx, block, area);
    case 'chart': return chartBlock(ctx, block, area);
    case 'stages': return stagesBlock(ctx, block, area);
    case 'section': return sectionBlock(ctx, block, area);
    case 'table': return tableBlock(ctx, block, area);
    case 'divider': {
      ctx.push(ctx.line('Divider', [[area.x, area.y], [area.x + area.w, area.y]], {
        color: ctx.theme.surface.divider.color, width: ctx.theme.surface.divider.width,
        opacity: ctx.theme.surface.divider.opacity,
      }));
      return area.y;
    }
    case 'spacer': return area.y + block.height;
    default: return area.y;
  }
}

function textBlock(ctx: Ctx, block: Extract<Block, { kind: 'text' }>, area: Area): number {
  const out = ctx.text(block.role ?? 'body', block.text, area.x, area.y, area.w, {
    align: block.align, color: block.color, size: block.size, name: block.name,
  });
  ctx.push(out.op);
  return area.y + out.height;
}

function columnsBlock(ctx: Ctx, block: Extract<Block, { kind: 'columns' }>, area: Area): number {
  const gap = block.gap ?? 32;
  const spans = block.columns.map((c) => c.span ?? 1);
  const total = spans.reduce((a, b) => a + b, 0);
  const usable = area.w - gap * (block.columns.length - 1);
  let x = area.x;
  let bottom = area.y;
  block.columns.forEach((column, i) => {
    const w = (usable * spans[i]) / total;
    bottom = Math.max(bottom, composeBlocks(ctx, column.blocks, { x, y: area.y, w }));
    x += w + gap;
  });
  return bottom;
}

/** Measures a card without emitting it, so a row can share one height. */
function cardHeight(ctx: Ctx, card: Card, w: number, variant?: SurfaceVariant): number {
  const c = ctx.theme.surface.card;
  const roles = variant?.roles ?? c?.roles ?? { eyebrow: 'detail', title: 'h2', body: 'body', note: 'detail' };
  const gaps = variant?.gaps ?? c?.gaps ?? { eyebrow: 12, title: 12, note: 16 };
  const padY = variant?.padding ?? c?.paddingY ?? ctx.theme.surface.panel.padding;
  const padB = variant?.paddingBottom ?? c?.paddingBottom ?? padY;
  const inner = w - (variant?.padding ?? c?.paddingX ?? ctx.theme.surface.panel.padding) * 2;
  let h = padY;
  if (card.eyebrow) h += ctx.text(roles.eyebrow, card.eyebrow, 0, 0, inner).height + gaps.eyebrow;
  h += ctx.text(roles.title, card.title, 0, 0, inner).height;
  if (card.body) h += gaps.title + ctx.text(roles.body, card.body, 0, 0, inner).height;
  if (card.note) h += gaps.note + ctx.text(roles.note, card.note, 0, 0, inner).height;
  return h + padB;
}

function cardsBlock(ctx: Ctx, block: Extract<Block, { kind: 'cards' }>, area: Area): number {
  const c = ctx.theme.surface.card;
  const surface = ctx.theme.surface.panel;
  const variant = block.variant ? surfaceOf(ctx.theme, block.variant, {}) : undefined;
  const roles = variant?.roles ?? c?.roles ?? { eyebrow: 'detail', title: 'h2', body: 'body', note: 'detail' };
  const gaps = variant?.gaps ?? c?.gaps ?? { eyebrow: 12, title: 12, note: 16 };
  const upper = variant ? variant.uppercaseEyebrow !== false : true;
  const vpad = variant?.padding;
  const padX = block.padding ?? vpad ?? c?.paddingX ?? surface.padding;
  const padY = block.padding ?? vpad ?? c?.paddingY ?? surface.padding;
  const padB = variant?.paddingBottom ?? c?.paddingBottom ?? padY;
  const cols = block.columns ?? Math.min(block.items.length, 2);
  const gap = block.gap ?? c?.gap ?? 28;
  const w = (area.w - gap * (cols - 1)) / cols;
  const rule = c?.accentRule ?? { width: block.accentRule ?? 4, radius: 2, offsetX: 0, overhangY: 0 };

  let y = area.y;
  for (let start = 0; start < block.items.length; start += cols) {
    const row = block.items.slice(start, start + cols);
    const h = Math.max(...row.map((card) => cardHeight(ctx, card, w)));
    row.forEach((card, i) => {
      const x = area.x + i * (w + gap);
      const accent = ctx.accent(card.accent ?? card.id ?? card.title);
      ctx.group(`Card ${card.title.slice(0, 28)}`, (into) => {
        // The rule is a rounded tab behind the card's left edge, so it is drawn first.
        const placement = block.accentPlacement ?? 'edge';
        if (accent && placement === 'edge' && rule.width > 0 && !block.variant) {
          into.push({
            op: 'rect', name: 'Card accent',
            x: round(x + rule.offsetX), y: round(y - rule.overhangY),
            w: rule.width, h: round(h + rule.overhangY * 2),
            fill: accent, radius: rule.radius,
          });
        }
        if (block.variant) {
          into.push(surfaceOps(ctx, 'Card surface', surfaceOf(ctx.theme, block.variant, surface), x, y, w, h));
          into.push(...accentOps(ctx, placement, accent, x, y, w, h));
        } else into.push(c
          ? {
              op: 'rect', name: 'Card surface', x: round(x), y: round(y), w: round(w), h: round(h),
              fill: typeof c.fill === 'string' ? paint(ctx.theme, c.fill, c.fillOpacity) : resolveGradient(ctx.theme, c.fill),
              stroke: { color: colorOf(ctx, c.stroke), opacity: c.strokeOpacity },
              strokeWidth: c.strokeWidth, radius: c.radius,
            }
          : ctx.rect('Card surface', x, y, w, h, {
              fill: surface.fill, fillOpacity: surface.fillOpacity,
              stroke: surface.stroke, strokeWidth: surface.strokeWidth, radius: surface.radius,
            }));

        let ty = y + padY;
        const inner = w - padX * 2;
        if (card.eyebrow) {
          const eyebrow = ctx.text(roles.eyebrow, upper ? card.eyebrow.toUpperCase() : card.eyebrow, x + padX, ty, inner, {
            color: accent ? tint(accent.color, 0.28) : undefined,
          });
          // Keep the authored casing as the fidelity source; the uppercase is presentation.
          into.push({ ...eyebrow.op, source: card.eyebrow });
          ty += eyebrow.height + gaps.eyebrow;
        }
        const title = ctx.text(roles.title, card.title, x + padX, ty, inner);
        into.push(title.op);
        ty += title.height;
        if (card.body) {
          const body = ctx.text(roles.body, card.body, x + padX, ty + gaps.title, inner);
          into.push(body.op);
          ty += gaps.title + body.height;
        }
        if (card.note) {
          into.push(ctx.text(roles.note, card.note, x + padX, ty + gaps.note, inner, {
            color: accent ? tint(accent.color, 0.22) : undefined,
          }).op);
        }
      });
    });
    y += h + gap;
  }
  return y - gap;
}

function colorOf(ctx: Ctx, ref: string): string {
  return paint(ctx.theme, ref).color;
}

function panelBlock(ctx: Ctx, block: Extract<Block, { kind: 'panel' }>, area: Area): number {
  const surface = ctx.theme.surface.panel;
  const pad = block.padding ?? ctx.theme.surface.variants?.[block.variant ?? '']?.padding ?? surface.padding;
  const accent = ctx.accent(block.accent);

  // The panel is measured by composing into a throwaway context, then drawn behind its
  // own content so the background can never be sized from a guess.
  const probe = new Ctx(ctx.theme, ctx.ir, ctx.safeX, ctx.safeWidth);
  const inner = { x: area.x + pad, y: area.y + pad, w: area.w - pad * 2 };
  const height = composeBlocks(probe, block.blocks, inner) - area.y + pad;

  const v = surfaceOf(ctx.theme, block.variant, surface);
  ctx.push(surfaceOps(ctx, block.name ?? 'Panel', {
    ...v, fillOpacity: block.tone === 'quiet' ? (v.fillOpacity ?? 1) * 0.6 : v.fillOpacity,
  }, area.x, area.y, area.w, height));
  ctx.push(...accentOps(ctx, block.accentPlacement ?? (accent ? 'edge' : 'none'), accent, area.x, area.y, area.w, height));
  return composeBlocks(ctx, block.blocks, inner) + pad;
}

function kpiBlock(ctx: Ctx, block: Extract<Block, { kind: 'kpi' }>, area: Area): number {
  const gap = block.gap ?? 32;
  const w = (area.w - gap * (block.items.length - 1)) / block.items.length;
  let bottom = area.y;
  block.items.forEach((item, i) => {
    const x = area.x + i * (w + gap);
    const accent = ctx.accent(item.accent ?? item.label);
    ctx.group(`KPI ${item.label}`, (into) => {
      let y = area.y;
      const value = ctx.text('hero', item.value, x, y, w, { color: accent ? tint(accent.color, 0.3) : undefined });
      into.push(value.op);
      y += value.height + 8;
      const label = ctx.text('label', item.label, x, y, w);
      into.push(label.op);
      y += label.height;
      if (item.note) {
        const note = ctx.text('detail', item.note, x, y + 8, w);
        into.push(note.op);
        y += 8 + note.height;
      }
      bottom = Math.max(bottom, y);
    });
  });
  return bottom;
}

function stepsBlock(ctx: Ctx, block: Extract<Block, { kind: 'steps' }>, area: Area): number {
  const horizontal = block.direction === 'horizontal';
  const gap = block.gap ?? (horizontal ? 24 : 20);
  const pad = ctx.theme.surface.node?.paddingX ?? 24;
  const surface = ctx.theme.surface.panel;
  const arrow = ctx.theme.chart.connector;

  if (horizontal) {
    const arrowW = 48;
    const w = (area.w - (gap + arrowW) * (block.items.length - 1)) / block.items.length;
    const heights = block.items.map((s) =>
      pad * 2 + ctx.text('h2', s.title, 0, 0, w - pad * 2).height + (s.body ? 8 + ctx.text('detail', s.body, 0, 0, w - pad * 2).height : 0));
    const h = Math.max(...heights);
    block.items.forEach((step, i) => {
      const x = area.x + i * (w + gap + arrowW);
      drawStep(ctx, step, x, area.y, w, h, pad, surface);
      if (i < block.items.length - 1) {
        ctx.push(ctx.line(`Step arrow ${i}`, [[x + w + gap / 2, area.y + h / 2], [x + w + gap / 2 + arrowW, area.y + h / 2]], {
          color: arrow.color, width: arrow.width, arrowEnd: true,
        }));
      }
    });
    return area.y + h;
  }

  let y = area.y;
  block.items.forEach((step, i) => {
    const h = pad * 2 + ctx.text('h2', step.title, 0, 0, area.w - pad * 2).height
      + (step.body ? 8 + ctx.text('detail', step.body, 0, 0, area.w - pad * 2).height : 0);
    drawStep(ctx, step, area.x, y, area.w, h, pad, surface);
    y += h;
    if (i < block.items.length - 1) {
      ctx.push(ctx.line(`Step arrow ${i}`, [[area.x + 40, y], [area.x + 40, y + gap]], {
        color: arrow.color, width: arrow.width, arrowEnd: true,
      }));
      y += gap;
    }
  });
  return y;
}

function drawStep(ctx: Ctx, step: { eyebrow?: string; title: string; body?: string; accent?: string },
  x: number, y: number, w: number, h: number, pad: number, surface: Ctx['theme']['surface']['panel']): void {
  const accent = ctx.accent(step.accent ?? step.title);
  ctx.group(`Step ${step.title.slice(0, 24)}`, (into) => {
    into.push(ctx.rect('Step surface', x, y, w, h, {
      fill: surface.fill, fillOpacity: surface.fillOpacity,
      stroke: surface.stroke, strokeWidth: surface.strokeWidth, radius: surface.radius,
    }));
    if (accent) into.push({ op: 'rect', name: 'Step accent', x: round(x), y: round(y), w: 4, h: round(h), fill: accent, radius: 2 });
    let ty = y + pad;
    if (step.eyebrow) {
      const eyebrow = ctx.text('detail', step.eyebrow.toUpperCase(), x + pad, ty, w - pad * 2, { letterSpacing: 1.6, color: 'neutral.500' });
      into.push({ ...eyebrow.op, source: step.eyebrow });
      ty += eyebrow.height + 8;
    }
    const title = ctx.text('h2', step.title, x + pad, ty, w - pad * 2);
    into.push(title.op);
    ty += title.height;
    if (step.body) into.push(ctx.text('detail', step.body, x + pad, ty + 8, w - pad * 2, { color: 'neutral.400' }).op);
  });
}

const STAGE_ROW_H = 44;
const STAGE_BADGE = 34;

function stageHeight(ctx: Ctx, stage: Stage, w: number, pad: number): number {
  const inner = w - pad * 2;
  let h = pad + ctx.text('h2', stage.title, 0, 0, inner).height;
  if (stage.subtitle) h += 6 + ctx.text('body', stage.subtitle, 0, 0, inner).height;
  for (const group of stage.groups) {
    h += 24;
    if (group.label) h += ctx.text('dataTitle', group.label, 0, 0, inner).height + 10;
    if (group.rows) h += group.rows.length * (STAGE_ROW_H + 8);
    for (const line of group.text ?? []) h += ctx.text('detail', line, 0, 0, inner).height + 4;
  }
  return h + pad;
}

/**
 * Actors in a handoff, each carrying its own field rows, with numbered connectors and a
 * numbered legend underneath. A plain node box cannot hold a signature table; this can.
 */
function stagesBlock(ctx: Ctx, block: Extract<Block, { kind: 'stages' }>, area: Area): number {
  const pad = ctx.theme.surface.card?.paddingX ?? 32;
  const surface = ctx.theme.surface.panel;
  const gap = block.gap ?? 110;
  const w = (area.w - gap * (block.items.length - 1)) / block.items.length;
  const h = Math.max(...block.items.map((stage) => stageHeight(ctx, stage, w, pad)));

  ctx.group('Stages', (into) => {
    block.items.forEach((stage, index) => {
      const x = area.x + index * (w + gap);
      const accent = ctx.accent(stage.accent ?? stage.id ?? stage.title);
      into.push({
        op: 'rect', name: `Stage ${stage.title}`, x: round(x), y: round(area.y), w: round(w), h: round(h),
        fill: paint(ctx.theme, surface.fill, surface.fillOpacity),
        stroke: accent ? { ...accent, opacity: 0.75 } : paint(ctx.theme, surface.stroke),
        strokeWidth: surface.strokeWidth, radius: ctx.theme.surface.card?.radius ?? surface.radius,
      });

      let y = area.y + pad;
      const inner = w - pad * 2;
      const title = ctx.text('h2', stage.title, x + pad, y, inner);
      into.push(title.op);
      y += title.height;
      if (stage.subtitle) {
        const sub = ctx.text('body', stage.subtitle, x + pad, y + 6, inner, {
          color: accent ? tint(accent.color, 0.2) : 'neutral.400',
        });
        into.push(sub.op);
        y += 6 + sub.height;
      }

      for (const group of stage.groups) {
        y += 24;
        if (group.label) {
          const label = ctx.text('dataTitle', group.label, x + pad, y, inner);
          into.push(label.op);
          y += label.height + 10;
        }
        for (const row of group.rows ?? []) {
          const rowAccent = ctx.accent(row.accent) ?? accent;
          into.push({
            op: 'rect', name: `Row ${row.label}`, x: round(x + pad), y: round(y), w: round(inner), h: STAGE_ROW_H,
            fill: paint(ctx.theme, 'neutral.900', 0.6),
            stroke: rowAccent ? { ...rowAccent, opacity: 0.55 } : paint(ctx.theme, 'neutral.700'),
            strokeWidth: 1, radius: 8,
          });
          const textY = y + (STAGE_ROW_H - ctx.lineHeight('detail')) / 2;
          into.push(ctx.text('detail', row.label, x + pad + 14, textY, inner / 2, { maxLines: 1 }).op);
          if (row.value) {
            into.push(ctx.text('detail', row.value, x + pad + inner / 2 - 14, textY, inner / 2, {
              align: 'right', maxLines: 1, color: 'neutral.500',
            }).op);
          }
          y += STAGE_ROW_H + 8;
        }
        for (const line of group.text ?? []) {
          const text = ctx.text('detail', line, x + pad, y, inner, { color: 'neutral.400' });
          into.push(text.op);
          y += text.height + 4;
        }
      }
    });

    // Numbered connectors sit in the gutter between stages.
    (block.connectors ?? []).forEach((connector, i) => {
      const from = area.x + i * (w + gap) + w;
      const cy = area.y + h * 0.45;
      const badgeX = from + gap / 2 - STAGE_BADGE / 2;
      into.push(ctx.line(`Handoff ${connector.badge}`, [[from + 16, cy], [from + gap - 16, cy]], { arrowEnd: true }));
      into.push(...badge(ctx, connector.badge, badgeX, cy - STAGE_BADGE / 2));
    });
  });

  let bottom = area.y + h;
  const legend = (block.connectors ?? []).filter((c) => c.title || c.note);
  if (legend.length) {
    const colW = (area.w - 40 * (legend.length - 1)) / legend.length;
    let deepest = bottom;
    legend.forEach((connector, i) => {
      const x = area.x + i * (colW + 40);
      let y = bottom + 48;
      ctx.push(...badge(ctx, connector.badge, x, y));
      if (connector.title) {
        const title = ctx.text('h2', connector.title, x + STAGE_BADGE + 18, y - 2, colW - STAGE_BADGE - 18);
        ctx.push(title.op);
        y += title.height;
      }
      if (connector.note) {
        const note = ctx.text('detail', connector.note, x + STAGE_BADGE + 18, y + 4, colW - STAGE_BADGE - 18, { color: 'neutral.400' });
        ctx.push(note.op);
        y += 4 + note.height;
      }
      deepest = Math.max(deepest, y);
    });
    bottom = deepest;
  }
  return bottom;
}

function badge(ctx: Ctx, label: string, x: number, y: number): Op[] {
  const fill = ctx.accent(`badge:${label}`) ?? ctx.seriesPaint(0, 'accent.amber');
  return [
    { op: 'ellipse', name: `Badge ${label}`, cx: round(x + STAGE_BADGE / 2), cy: round(y + STAGE_BADGE / 2), rx: STAGE_BADGE / 2, ry: STAGE_BADGE / 2, fill },
    { ...ctx.text('detail', label, x, y + (STAGE_BADGE - ctx.lineHeight('detail')) / 2, STAGE_BADGE, { align: 'center', maxLines: 1, color: 'neutral.1000' }).op },
  ];
}

/** A chart block reuses the grammar renderers inside a free composition. */
function chartBlock(ctx: Ctx, block: Extract<Block, { kind: 'chart' }>, area: Area): number {
  let top = area.y;
  if (block.title) {
    const title = ctx.text('h2', block.title, area.x, top, area.w);
    ctx.push(title.op);
    top += title.height + 24;
  }
  const nested = new Ctx(ctx.theme, {
    ...ctx.ir,
    data: {
      kind: block.diagram ? 'graph' : 'rows',
      rows: block.rows ?? [], columns: columnsOf(block.rows ?? []),
      numericColumns: numericOf(block.rows ?? []), graph: block.diagram,
    },
    visual: {
      ...ctx.ir.visual, template: block.template, style: block.style ?? ctx.ir.visual.style,
      fields: block.fields, scale: block.scale,
      legend: block.legend ?? (block.diagram ? ctx.ir.visual.legend : false),
    },
  }, area.x, area.w, block.height ?? Math.max(360, ctx.budget - (top - area.y)));

  const bottom = categoryLegend(nested, renderTemplate(nested, block.template, top));
  ctx.push(...nested.ops);
  ctx.warnings.push(...nested.warnings);
  for (const v of nested.encoded) ctx.encode(v);
  return bottom;
}

/**
 * Category chips under a diagram, centred.
 *
 * A coloured node group with no name is a colour the reader has to guess; a legend that
 * appears uninvited takes the eye off the graphic. So the author asks for it and the pack
 * decides how it looks. Order is first appearance in the graph, never alphabetical.
 */
export function categoryLegend(ctx: Ctx, top: number): number {
  const spec = ctx.theme.chart.legend;
  const nodes = ctx.ir.data.graph?.nodes;
  if (!spec || !ctx.ir.visual.legend || !nodes?.length) return top;
  const entries: Array<{ label: string; color: string }> = [];
  for (const node of nodes) {
    const key = node.group ?? node.kind;
    if (!key || entries.some((e) => e.label === key)) continue;
    const accent = ctx.nodeAccent(node);
    if (accent) entries.push({ label: key, color: accent.color });
  }
  if (entries.length < 2) return top;
  const widths = entries.map((e) => spec.swatch + spec.gap + ctx.measure(spec.role, e.label));
  const total = widths.reduce((a, b) => a + b, 0) + spec.columnGap * (entries.length - 1);
  const lh = ctx.lineHeight(spec.role);
  const y = top + spec.top;
  let x = ctx.safeX + Math.max(0, (ctx.safeWidth - total) / 2);
  ctx.group('Legend', (into) => {
    entries.forEach((entry, i) => {
      into.push({
        op: 'rect', name: `Legend ${entry.label}`, x: round(x), y: round(y + (lh - spec.swatch) / 2),
        w: spec.swatch, h: spec.swatch, fill: { color: entry.color }, radius: spec.radius,
      });
      into.push(ctx.text(spec.role, entry.label, x + spec.swatch + spec.gap, y, widths[i], { maxLines: 1 }).op);
      x += widths[i] + spec.columnGap;
    });
  });
  return y + lh;
}

function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!out.includes(k)) out.push(k);
  return out;
}

function numericOf(rows: Array<Record<string, unknown>>): string[] {
  return columnsOf(rows).filter((c) => rows.some((r) => typeof r[c] === 'number')
    && rows.every((r) => r[c] === undefined || r[c] === null || typeof r[c] === 'number'));
}

// Bound late to avoid a cycle: renderers imports blocks for the `compose` template.
let renderTemplate: (ctx: Ctx, template: TemplateId, top: number) => number;

/**
 * A surface is chosen by name from the pack, never described inline. That is what keeps
 * a composed frame inside the design language while still letting the composition vary.
 */
export function surfaceOf(theme: Theme, name: string | undefined, fallback: SurfaceVariant): SurfaceVariant {
  if (!name) return fallback;
  const variant = theme.surface.variants?.[name];
  if (!variant) throw new Error(`Unknown surface variant "${name}"; the pack ships ${Object.keys(theme.surface.variants ?? {}).join(', ') || 'none'}`);
  return variant;
}

function surfaceOps(ctx: Ctx, name: string, v: SurfaceVariant, x: number, y: number, w: number, h: number): Op {
  return {
    op: 'rect', name, x: round(x), y: round(y), w: round(w), h: round(h),
    fill: typeof v.fill === 'string' ? paint(ctx.theme, v.fill, v.fillOpacity)
      : v.fill ? resolveGradient(ctx.theme, v.fill) : undefined,
    stroke: v.stroke ? { color: paint(ctx.theme, v.stroke).color, opacity: v.strokeOpacity } : undefined,
    strokeWidth: v.strokeWidth, radius: v.radius,
  };
}

/**
 * An accent never decorates. `placement` says which single channel carries it, so the
 * same authorised hue cannot be spent twice on one surface.
 */
function accentOps(
  ctx: Ctx, placement: AccentPlacement, accent: SolidPaint | undefined,
  x: number, y: number, w: number, h: number,
): Op[] {
  if (!accent || placement === 'none' || placement === 'text') return [];
  const spec = ctx.theme.surface.accentPlacement;
  if (placement === 'edge') {
    const edge = spec?.edge ?? { width: 4, radius: 2, inset: 0 };
    return [{ op: 'rect', name: 'Accent edge', x: round(x + edge.inset), y: round(y), w: edge.width, h: round(h), fill: accent, radius: edge.radius }];
  }
  if (placement === 'tint') {
    return [{ op: 'rect', name: 'Accent tint', x: round(x), y: round(y), w: round(w), h: round(h), fill: { ...accent, opacity: spec?.tint.opacity ?? 0.08 } }];
  }
  return [{ op: 'rect', name: 'Accent fill', x: round(x), y: round(y), w: round(w), h: round(h), fill: accent }];
}

/**
 * A heading that introduces one grammar. Sections are how a single frame carries an
 * overview and its detail without either being demoted to a caption.
 */
function sectionBlock(ctx: Ctx, block: Extract<Block, { kind: 'section' }>, area: Area): number {
  const spec = ctx.theme.surface.section;
  if (!spec) throw new Error('the pack declares no section rhythm');
  if (!block.heading.trim()) throw new Error('a section must be introduced by a heading');
  let y = area.y;
  const head = ctx.text('sectionHead', block.heading, area.x, y, area.w);
  ctx.push(head.op);
  y += spec.headingToSubtitle;
  if (block.subtitle) {
    const sub = ctx.text('sectionSub', block.subtitle, area.x, y, area.w);
    ctx.push(sub.op);
    y += spec.toContent;
  } else {
    y = area.y + head.height + Math.round(spec.toContent * 0.6);
  }
  return composeBlocks(ctx, block.blocks, { ...area, y }) + spec.betweenSections - DEFAULT_GAP;
}

/** Widest run the wrapper cannot break: a whole Latin word, or one CJK character. */
function atomWidth(ctx: Ctx, role: string, text: string): number {
  const CJK = /[\u1100-\u11ff\u3000-\u30ff\u3130-\u318f\u4e00-\u9fff\uac00-\ud7a3]/;
  let widest = 0;
  for (const token of String(text).split(/\s+/)) {
    if (!token) continue;
    for (const atom of CJK.test(token) ? [...token] : [token]) {
      widest = Math.max(widest, ctx.measure(role, atom));
    }
  }
  return widest;
}

/**
 * Editorial table: one surface, a tinted header band, a horizontal rule under the header
 * and between rows, and rows as tall as their content needs. No vertical rules — the
 * column gutters separate them, and a full grid reads as a spreadsheet.
 */
function tableBlock(ctx: Ctx, block: Extract<Block, { kind: 'table' }>, area: Area): number {
  const t = ctx.theme.surface.table;
  if (!t) throw new Error('the pack declares no table treatment');
  const rows = block.rows;
  if (!rows.length) throw new Error('a table with no rows is a decoration; drop the block');
  const columns = block.columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== 'id');
  if (!columns.length) throw new Error('a table needs at least one column');
  const key = block.keyColumn ?? columns[0];
  const placement = block.accentPlacement ?? 'text';
  const v = surfaceOf(ctx.theme, block.variant ?? t.variant, ctx.theme.surface.panel);
  const pad = v.padding ?? t.padding;
  // `rowPitch` is the MINIMUM row height, never a fixed step. A sentence that needs two
  // lines gets two lines: clipping it to one with an ellipsis throws away the data the
  // table exists to carry, and raising the pitch to "make room" only stretches the frame.
  const pitch = block.rowPitch ?? t.rowPitch;
  const roleOf = (c: string) => (c === key ? t.keyColumnRole : t.bodyRole);
  const intrinsic = columns.map((c) => Math.max(
    ctx.measure(t.headerRole, c),
    ...rows.map((r) => ctx.measure(roleOf(c), formatValue(r[c], ctx.locale)))) + pad);
  // A column never shrinks below its longest unbreakable atom: a share narrower than one
  // word makes the wrapper hard-break inside it ("recordkeepin / g").
  const floors = columns.map((c, i) => Math.max(
    atomWidth(ctx, t.headerRole, c),
    ...rows.map((r) => atomWidth(ctx, roleOf(c), formatValue(r[c], ctx.locale)))) + pad);
  const avail = area.w - pad * 2;
  const total = intrinsic.reduce((a, b) => a + b, 0);
  // Over-wide tables are capped largest-first, not shrunk in proportion: a short column
  // keeps the width its own content needs and the deficit comes out of the long prose
  // column, which is the one that can afford to wrap. Proportional shrinking squeezed
  // "Custody & recordkeeping" onto two lines to buy width a status sentence did not need.
  const capped = (limit: number) => intrinsic.map((w, i) =>
    Math.max(Math.min(w, limit), Math.min(floors[i], w)));
  let widths: number[];
  if (total <= avail) {
    widths = intrinsic.map((w) => w + (avail - total) * (w / total));
  } else {
    let lo = 0;
    let hi = Math.max(...intrinsic);
    for (let pass = 0; pass < 40; pass += 1) {
      const mid = (lo + hi) / 2;
      if (capped(mid).reduce((a, b) => a + b, 0) > avail) hi = mid; else lo = mid;
    }
    widths = capped(lo);
    // Floors alone can exceed the surface; then every column gives up the same fraction
    // and the wrapper hard-breaks, which is honest about content that does not fit.
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > avail) widths = widths.map((w) => w * (avail / sum));
  }
  // One pad of gutter stays between columns, so wrapped lines never touch the next cell.
  const cellW = (i: number) => Math.max(48, widths[i] - pad);
  // Wrap once; the wrapped line count is what drives row height and vertical centring.
  const wrapped = rows.map((r) => columns.map((c, i) => ctx.text(
    roleOf(c), formatValue(r[c], ctx.locale), 0, 0, cellW(i), { maxLines: MAX_CELL_LINES },
  ).op.lines));
  const rowHeights = wrapped.map((cells) => Math.max(pitch,
    ...cells.map((lines, i) => lines.length * ctx.lineHeight(roleOf(columns[i])) + pad)));
  // The head is never shorter than its own line: a document that lowers `rowPitch` used to
  // collapse the band and push the column labels out above the surface edge.
  const headerH = Math.max(pitch, ctx.lineHeight(t.headerRole) + pad);
  const height = headerH + rowHeights.reduce((a, b) => a + b, 0);

  ctx.group(block.name ?? 'Table', (into) => {
    into.push(surfaceOps(ctx, 'Table surface', v, area.x, area.y, area.w, height));
    // The band rounds only where it meets the surface's top corners. Rounding its bottom
    // too leaves a pill floating above the first row instead of a table head.
    into.push({
      op: 'rect', name: 'Header band', x: round(area.x), y: round(area.y), w: round(area.w), h: headerH,
      fill: { ...paint(ctx.theme, t.headerFill), opacity: t.headerOpacity },
      radius: v.radius, corners: 'top',
    });
    let x = area.x + pad;
    columns.forEach((c, i) => {
      into.push(ctx.text(t.headerRole, c, x, area.y + (headerH - ctx.lineHeight(t.headerRole)) / 2, cellW(i), {
        align: block.align?.[c] ?? 'left', maxLines: 1,
      }).op);
      x += widths[i];
    });
    let top = area.y + headerH;
    rows.forEach((row, ri) => {
      const rowH = rowHeights[ri];
      const accent = ctx.accent(block.accents?.[String(row.id ?? '')] ?? '');
      into.push(...accentOps(ctx, placement, accent, area.x, top, area.w, rowH));
      // A horizontal rule under the header and between every pair of rows, spanning the
      // whole surface so the table reads as one grid. No vertical rules: the column
      // gutters already separate them and a full grid fights the frame.
      if (t.rowRules) {
        into.push(ctx.rect(`Row rule ${ri}`, area.x, top, area.w, ctx.theme.surface.divider.width, {
          fill: ctx.theme.surface.divider.color, fillOpacity: ctx.theme.surface.divider.opacity,
        }));
      }
      let cx = area.x + pad;
      columns.forEach((c, i) => {
        const role = roleOf(c);
        const lines = wrapped[ri][i].length;
        into.push(ctx.text(role, formatValue(row[c], ctx.locale), cx,
          top + (rowH - lines * ctx.lineHeight(role)) / 2, cellW(i), {
            align: block.align?.[c] ?? 'left', maxLines: MAX_CELL_LINES,
            color: placement === 'text' && accent && c !== key ? accent.color : undefined,
          }).op);
        cx += widths[i];
      });
      top += rowH;
    });
  });
  return area.y + height;
}

export function bindTemplateRenderer(fn: typeof renderTemplate): void {
  renderTemplate = fn;
}

export function collectAccentKeys(blocks: Block[], out: string[] = []): string[] {
  for (const block of blocks) {
    switch (block.kind) {
      case 'cards': for (const c of block.items) out.push(c.accent ?? c.id ?? c.title); break;
      case 'kpi': for (const k of block.items) out.push(k.accent ?? k.label); break;
      case 'steps': for (const s of block.items) out.push(s.accent ?? s.title); break;
      case 'stages':
        for (const st of block.items) out.push(st.accent ?? st.id ?? st.title);
        for (const c of block.connectors ?? []) out.push(`badge:${c.badge}`);
        break;
      case 'panel': if (block.accent) out.push(block.accent); collectAccentKeys(block.blocks, out); break;
      case 'section': collectAccentKeys(block.blocks, out); break;
      // A composed diagram declares its distinctions on the nodes, exactly as a top-level
      // one does. Without this a category-coloured block came out uniformly slate.
      case 'chart':
        for (const node of block.diagram?.nodes ?? []) {
          const key = node.group ?? node.kind;
          if (key) out.push(key);
        }
        break;
      case 'table': for (const key of Object.values(block.accents ?? {})) out.push(key); break;
      case 'columns': for (const c of block.columns) collectAccentKeys(c.blocks, out); break;
      default: break;
    }
  }
  return [...new Set(out)];
}

/** Text a block will actually render, used so composed copy still satisfies the fidelity audit. */
export function collectText(blocks: Block[], out: string[] = []): string[] {
  for (const block of blocks) {
    switch (block.kind) {
      case 'text': out.push(block.text); break;
      case 'cards': for (const c of block.items) out.push(c.eyebrow ?? '', c.title, c.body ?? '', c.note ?? ''); break;
      case 'kpi': for (const k of block.items) out.push(k.value, k.label, k.note ?? ''); break;
      case 'steps': for (const s of block.items) out.push(s.eyebrow ?? '', s.title, s.body ?? ''); break;
      case 'stages':
        for (const st of block.items) {
          out.push(st.title, st.subtitle ?? '');
          for (const g of st.groups) {
            out.push(g.label ?? '');
            for (const r of g.rows ?? []) out.push(r.label, r.value ?? '');
            out.push(...(g.text ?? []));
          }
        }
        for (const c of block.connectors ?? []) out.push(c.title ?? '', c.note ?? '');
        break;
      case 'panel': collectText(block.blocks, out); break;
      case 'section': out.push(block.heading, block.subtitle ?? ''); collectText(block.blocks, out); break;
      case 'table':
        for (const row of block.rows) for (const [k, v] of Object.entries(row)) if (k !== 'id') out.push(formatValue(v, 'en-US'));
        break;
      case 'columns': for (const c of block.columns) collectText(c.blocks, out); break;
      default: break;
    }
  }
  return out.filter(Boolean);
}
