import type { Direction, FPIR, Op, RenderProgram, Theme } from './types.js';
import { Ctx } from './draw.js';
import { color, paint, unverifiedFields } from './theme.js';
import { backgroundOps, brandMarkOps, footerOps, titleOps, topMarkOps, watermarkOps } from './chrome.js';
import { RENDERERS } from './renderers.js';
import { categoryLegend } from './blocks.js';
import { checkDirection } from './direction.js';

/**
 * Compiles fp-ir/1 into fp-plan/1: absolute coordinates, resolved colours, wrapped text.
 * No backend is consulted, so every writer produces the same geometry from the same input.
 */
export function compile(ir: FPIR, theme: Theme, direction?: Direction): RenderProgram {
  const variant = theme.canvas.safe.variants?.find((v) => v.id === ir.visual.safeVariant);
  const safeX = variant?.x ?? theme.canvas.safe.x;
  const safeWidth = variant?.width ?? theme.canvas.safe.width;
  const chrome = theme.chrome ?? {};
  const width = theme.canvas.width;

  // Reserve the chrome, then hand the rest to the content so a single chart fills the
  // frame instead of floating in dead space above the footer.
  const reservedTop = chrome.contentTop ?? 260;
  const reservedBottom = Math.max(chrome.bottomBand ?? 0, (chrome.footer?.height ?? 0) + (chrome.footer?.bottomGap ?? 0) + 24);
  const budget = Math.max(360, theme.canvas.heights.min - reservedTop - reservedBottom);

  const ctx = new Ctx(theme, ir, safeX, safeWidth, budget);
  const title = titleOps(ctx, theme, ir, width);

  const contentTop = Math.max(title.bottom + (chrome.titleGap ?? 32), chrome.contentTop ?? 0);
  const renderer = RENDERERS[ir.visual.template];
  if (!renderer) throw new Error(`No renderer registered for template "${ir.visual.template}"`);
  const contentBottom = categoryLegend(ctx, renderer(ctx, contentTop));

  // Content shorter than its budget is centred in the reserved band rather than pinned
  // under the title, which is what produced the large dead margin at the bottom.
  const used = contentBottom - contentTop;
  const slack = budget - used;
  const shift = slack > 80 ? Math.round(slack / 2) : 0;
  if (shift) translate(ctx.ops, shift);

  const footerHeight = chrome.footer ? chrome.footer.height + chrome.footer.bottomGap : 0;
  const bottomBand = Math.max(chrome.bottomBand ?? 0, footerHeight + 24);
  const height = resolveHeight(theme, contentBottom + shift + bottomBand);

  // Chrome is composed after the height is known: the watermark and footer are
  // positioned from the frame edges, not from the content cursor.
  const ops: Op[] = [
    ...backgroundOps(theme, width, height, ir.visual.background),
    ...watermarkOps(ctx, theme, width, height),
    ...topMarkOps(theme, width),
    ...title.ops,
    ...ctx.ops,
    ...footerOps(ctx, theme, ir, width, height),
    ...brandMarkOps(ctx, theme, width, height, ir.visual.background),
  ];

  const check = checkDirection(direction, theme);
  if (!check.ok) throw new Error(`Invalid design direction:\n  - ${check.problems.join('\n  - ')}`);
  const warnings = [...check.warnings, ...ir.visual.colorWarnings, ...ctx.warnings];
  const maxDensity = theme.rules.maxDensity ?? 6;
  const splitSuggested = ir.visual.density > maxDensity;
  if (splitSuggested) warnings.push(`density ${ir.visual.density} exceeds pack maximum ${maxDensity}; split into overview and detail rather than shrinking type`);
  if (theme.canvas.heights.max && contentBottom + shift + bottomBand > theme.canvas.heights.max) {
    warnings.push(`content needs ${Math.round(contentBottom + bottomBand)}px but the pack caps frames at ${theme.canvas.heights.max}px; split the content`);
  }
  if (ir.visual.highlightIds.length && !Object.keys(ir.visual.accents).length) {
    warnings.push(`highlightIds were supplied but theme "${theme.id}" authorises no accent palette; emphasis stays typographic`);
  }
  const distinctHues = new Set(Object.values(ir.visual.accents)).size;
  const ceiling = theme.rules.categoricalCeiling ?? Infinity;
  if (ir.visual.colorMode === 'categorical' && distinctHues > ceiling) {
    warnings.push(`${distinctHues} competing hues exceed the pack ceiling of ${ceiling}`);
  }

  return {
    version: 'fp-plan/1',
    theme: {
      id: theme.id, version: theme.version, appearance: theme.appearance ?? 'dark',
      family: theme.typography.family, fallbacks: theme.typography.fallbacks ?? [],
      // Sheet furniture is part of the pack too; no backend may hold a hex of its own.
      labelColor: color(theme, theme.typography.roles.footer?.color ?? 'neutral.400'),
    },
    frame: {
      name: ir.document.title, width, height,
      background: paint(theme, ir.visual.background
        ? theme.canvas.backgroundVariants?.[ir.visual.background]?.background ?? theme.canvas.background
        : theme.canvas.background),
    },
    safe: { x: safeX, width: safeWidth },
    template: ir.visual.template,
    ops,
    meta: {
      density: ir.visual.density, checksum: ir.fidelity.checksum, rowCount: ir.fidelity.rowCount,
      warnings, encodedValues: [...ctx.encoded], unverifiedThemeFields: unverifiedFields(theme), splitSuggested,
      direction: direction ? { statement: check.statement, verifiedReferences: check.verifiedReferences, decisions: check.decisions.length } : undefined,
    },
  };
}

/** Moves already-positioned content without re-running a renderer. */
function translate(ops: Op[], dy: number): void {
  for (const op of ops) {
    switch (op.op) {
      case 'group': translate(op.children, dy); break;
      case 'rect': case 'text': case 'path': op.y += dy; break;
      case 'ellipse': case 'arc': op.cy += dy; break;
      case 'line': case 'polygon': for (const point of op.points) point[1] += dy; break;
    }
  }
}

function resolveHeight(theme: Theme, raw: number): number {
  const { mode, min, max, steps, roundTo } = theme.canvas.heights;
  if (mode === 'fixed') return steps?.[0] ?? min;
  if (mode === 'snap' && steps?.length) return steps.find((s) => s >= raw) ?? steps[steps.length - 1];
  const grid = roundTo ?? 1;
  return Math.min(max ?? Infinity, Math.max(min, Math.ceil(raw / grid) * grid));
}
