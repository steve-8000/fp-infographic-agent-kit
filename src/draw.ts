import type { FPIR, Op, OpText, SolidPaint, Theme } from './types.js';
import { paint } from './theme.js';
import { lineHeightPx, measureWidth, wrapText } from './text.js';

/** Shared drawing surface handed to every renderer. Renderers append ops; they never position the frame. */
export class Ctx {
  readonly ops: Op[] = [];
  readonly warnings: string[] = [];
  /**
   * Values a renderer encoded as geometry rather than as copy. A bar's height carries its
   * datum just as truthfully as a printed label, and the fidelity audit must accept both —
   * otherwise every positional chart looks like dropped data.
   */
  readonly encoded = new Set<string>();

  constructor(
    readonly theme: Theme,
    readonly ir: FPIR,
    readonly safeX: number,
    readonly safeWidth: number,
    /** Vertical room the content may fill before the frame has to grow. */
    readonly budget = 620,
  ) {}

  get locale(): string { return this.ir.document.locale; }

  /**
   * Accent for a diagram node.
   *
   * Hue encodes a declared distinction, so it is looked up by the node's group, then its
   * kind, then the node itself. A diagram whose nodes declare no difference stays on the
   * pack's slate base: there is nothing for colour to mean.
   */
  nodeAccent(node: { id: string; group?: string; kind?: string }): SolidPaint | undefined {
    return this.accent(node.group) ?? this.accent(node.kind) ?? this.accent(node.id);
  }

  /** Accent resolved for a data key, or undefined when nothing authorises one. */
  accent(key: string | undefined): SolidPaint | undefined {
    if (!key) return undefined;
    const ref = this.ir.visual.accents[key];
    return ref ? paint(this.theme, ref) : undefined;
  }

  /**
   * Colour for a series that carries no semantic accent of its own.
   *
   * It reads the pack's ordered vocabulary, never the accents assigned to other data.
   * Borrowing another datum's hue would silently claim the two mean the same thing.
   */
  seriesPaint(index: number, fallback = 'neutral.300'): SolidPaint {
    const order = this.theme.color.accentOrder ?? Object.keys(this.theme.color.accent);
    if (!order.length) return paint(this.theme, fallback);
    return paint(this.theme, `accent.${order[index % order.length]}`);
  }

  encode(...values: unknown[]): void {
    for (const v of values) if (v !== null && v !== undefined) this.encoded.add(String(v));
  }

  push(...ops: Op[]): void { this.ops.push(...ops); }

  group(name: string, build: (into: Op[]) => void): void {
    const children: Op[] = [];
    build(children);
    if (children.length) this.ops.push({ op: 'group', name, children });
  }

  rect(name: string, x: number, y: number, w: number, h: number, opts: {
    fill?: string; fillOpacity?: number; stroke?: string; strokeWidth?: number; radius?: number;
  } = {}): Op {
    return {
      op: 'rect', name, x: round(x), y: round(y), w: round(w), h: round(h),
      fill: opts.fill ? paint(this.theme, opts.fill, opts.fillOpacity) : undefined,
      stroke: opts.stroke ? paint(this.theme, opts.stroke) : undefined,
      strokeWidth: opts.stroke ? (opts.strokeWidth ?? 1) : undefined,
      radius: opts.radius,
    };
  }

  line(name: string, points: Array<[number, number]>, opts: {
    color?: string; width?: number; opacity?: number; dash?: number[];
    arrowEnd?: boolean; arrowStart?: boolean; cornerRadius?: number;
  } = {}): Op {
    return {
      op: 'line', name,
      points: points.map(([x, y]) => [round(x), round(y)] as [number, number]),
      stroke: paint(this.theme, opts.color ?? this.theme.chart.connector.color, opts.opacity),
      strokeWidth: opts.width ?? this.theme.chart.connector.width,
      dash: opts.dash, arrowEnd: opts.arrowEnd, arrowStart: opts.arrowStart,
      cornerRadius: opts.cornerRadius,
    };
  }

  /** Lays out a text block and returns both the op and the height it consumed. */
  text(role: string, content: string, x: number, y: number, w: number, opts: {
    align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom';
    maxLines?: number; color?: string; name?: string; size?: number; zone?: 'content' | 'chrome';
    letterSpacing?: number; rotate?: number;
  } = {}): { op: OpText; height: number } {
    const spec = this.theme.typography.roles[role];
    if (!spec) throw new Error(`Theme "${this.theme.id}" has no text role "${role}"`);
    const size = opts.size ?? spec.size;
    if (size < this.theme.typography.minSize) {
      this.warnings.push(`text "${content.slice(0, 24)}" requested ${size}px, below pack minimum ${this.theme.typography.minSize}px`);
    }
    // Every renderer computes x from geometry; clamping here is the single place that
    // guarantees the safe-zone invariant instead of repeating the check per call site.
    // A rotated label's box is a measuring device, not its painted extent, so clamping it
    // would only shove crowded ticks on top of each other.
    const boxX = opts.zone !== 'chrome' && !opts.rotate && w <= this.safeWidth
      ? Math.min(Math.max(x, this.safeX), this.safeX + this.safeWidth - w) : x;
    const lines = wrapText(this.theme, content, size, w, opts.maxLines);
    const lh = Math.round(size * (spec.lineHeight ?? this.theme.typography.metrics?.lineHeightRatio ?? 1.45));
    const height = lh * lines.length;
    const op: OpText = {
      op: 'text', name: opts.name ?? `${role}:${content.slice(0, 32)}`, zone: opts.zone,
      x: round(boxX), y: round(y), w: round(w), h: height,
      text: lines.join('\n'), role, size, weight: spec.weight,
      color: paint(this.theme, opts.color ?? spec.color),
      align: opts.align ?? 'left', valign: opts.valign ?? 'top',
      lineHeight: lh, letterSpacing: opts.letterSpacing, rotate: opts.rotate, maxLines: opts.maxLines, lines, source: content,
    };
    return { op, height };
  }

  /** Intrinsic width of one unwrapped line, used for column sizing and node boxes. */
  measure(role: string, content: string, size?: number): number {
    const spec = this.theme.typography.roles[role];
    return measureWidth(this.theme, content, size ?? spec.size);
  }

  lineHeight(role: string): number { return lineHeightPx(this.theme, role); }
}

export function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Nice axis bounds that always contain the data and never distort it. */
export function niceScale(min: number, max: number, ticks = 5): { min: number; max: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1 };
  const lo = Math.min(0, min), hi = Math.max(0, max);
  if (lo === hi) return { min: lo, max: lo + 1, step: 1 };
  const raw = (hi - lo) / Math.max(1, ticks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

export function sourceFooter(ir: FPIR): string[] {
  const parts: string[] = [];
  if (ir.document.source) parts.push(`Source: ${ir.document.source}`);
  if (ir.document.dateAsOf) parts.push(`As of ${ir.document.dateAsOf}`);
  if (ir.document.note) parts.push(ir.document.note);
  return parts;
}
