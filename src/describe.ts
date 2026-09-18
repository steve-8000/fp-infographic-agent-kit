import type { Block, FPIR, Op, OpText, Paint, RenderProgram } from './types.js';

/**
 * What the renderer actually laid out, as text.
 *
 * The delivered SVG is outlined glyphs: no `<text>`, and every `<rect>` has become a path.
 * Reading it answers nothing and costs tens of thousands of tokens, so the frame describes
 * itself here instead - the colour each series was given, the strings the renderer derived
 * rather than copied, and anything it had to cut. An author's own copy is deliberately not
 * echoed back; it is already in the document.
 */
export interface LayoutReport {
  frame: {
    width: number; height: number;
    /** The composed frame's own template, and the colour mode that resolved. */
    template: string; colorMode: string;
    /** Light or dark, and the pack id that decided it. */
    appearance: 'dark' | 'light'; theme: string;
  };
  /** Which grammar and style each block resolved to - not the ones asked for. */
  blocks: Array<{ kind: string; template?: string; style?: string }>;
  /** Series/category name -> the colour it was drawn in, read off the legend swatches. */
  swatches: Array<{ label: string; color: string }>;
  /** Strings the renderer produced: printed values, axis ticks, computed shares. */
  derived: string[];
  /** Copy that did not fit. `shown` is what a reader sees. */
  clipped: Array<{ role: string; wanted: string; shown: string }>;
  warnings: string[];
}

function paintColor(paint: Paint | undefined): string | undefined {
  if (!paint) return undefined;
  return 'color' in paint ? paint.color : paint.stops[0]?.color;
}

function walk(ops: Op[], visit: (op: Op) => void): void {
  for (const op of ops) {
    visit(op);
    if (op.op === 'group') walk(op.children, visit);
  }
}

/** Every string and number an author wrote, so derived copy can be told from copied copy. */
function literals(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === 'string') { into.add(value.trim()); return; }
  if (typeof value === 'number' || typeof value === 'boolean') { into.add(String(value)); return; }
  if (Array.isArray(value)) { for (const item of value) literals(item, into, depth + 1); return; }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      literals(item, into, depth + 1);
    }
  }
}

const squash = (s: string): string => s.replace(/\s+/gu, '').replace(/\u2026/gu, '');

export function describeProgram(result: { ir: FPIR; program: RenderProgram }, input?: unknown): LayoutReport {
  const { ir, program } = result;
  const wrote = new Set<string>();
  if (input !== undefined) literals(input, wrote);
  const swatches: Array<{ label: string; color: string }> = [];
  const derived: string[] = [];
  const seen = new Set<string>();
  const clipped: Array<{ role: string; wanted: string; shown: string }> = [];

  walk(program.ops, (op) => {
    if (op.op === 'rect' && op.name?.startsWith('Legend ')) {
      const color = paintColor(op.fill);
      if (color) swatches.push({ label: op.name.slice(7), color });
      return;
    }
    if (op.op !== 'text') return;
    const text = op as OpText;
    const source = text.source.trim();
    const shown = text.lines.join(' ');
    // A frame that clips one cell usually clips several; a dozen is enough to act on.
    // `wanted` keeps its head and `shown` its tail, so where the copy stopped is visible.
    if (squash(shown) !== squash(source) && clipped.length < 12) {
      clipped.push({
        role: text.role, wanted: source.slice(0, 160),
        shown: shown.length > 160 ? `\u2026${shown.slice(shown.length - 159)}` : shown,
      });
    }
    // An author's own copy needs no readback. A value the renderer printed does: it is the
    // one thing a redraw gets wrong silently.
    if (source && !wrote.has(source) && !seen.has(source)) {
      seen.add(source);
      if (derived.length < 80) derived.push(source.slice(0, 160));
    }
  });

  const blocks: Array<{ kind: string; template?: string; style?: string }> = [];
  const collect = (list: Block[]): void => {
    for (const block of list) {
      const entry: { kind: string; template?: string; style?: string } = { kind: block.kind };
      if (block.kind === 'chart') { entry.template = block.template; entry.style = block.style; }
      blocks.push(entry);
      if (block.kind === 'columns') for (const col of block.columns) collect(col.blocks);
      if (block.kind === 'panel' || block.kind === 'section') collect(block.blocks);
    }
  };
  collect(ir.data.blocks ?? []);
  if (!blocks.length) blocks.push({ kind: ir.data.kind, template: ir.visual.template, style: ir.visual.style });

  return {
    frame: {
      width: program.frame.width, height: program.frame.height,
      template: program.template, colorMode: ir.visual.colorMode,
      // Which pack drew it: the user declares light or dark, and the frame confirms it.
      appearance: program.theme.appearance, theme: program.theme.id,
    },
    blocks, swatches, derived, clipped, warnings: program.meta.warnings,
  };
}
