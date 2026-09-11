import type { FPIR, GradientPaint, Op, Paint, Theme } from './types.js';
import { Ctx, round } from './draw.js';
import { color } from './theme.js';

/**
 * Frame chrome: background, top mark, title block, watermark and footer.
 *
 * Every number here comes from the pack, which in turn records where it was measured.
 * Nothing about the FOUR PILLARS frame is hardcoded, so another pack gets its own chrome
 * from the same code path.
 */

export function backgroundOps(theme: Theme, width: number, height: number, variant?: string): Op[] {
  const chosen = variant ? theme.canvas.backgroundVariants?.[variant] : undefined;
  const overlay = chosen ? chosen.overlay ?? undefined : theme.canvas.overlay;
  const ops: Op[] = [];
  if (overlay) {
    ops.push({ op: 'rect', name: 'Canvas overlay', zone: 'chrome', x: 0, y: 0, w: width, h: height, fill: resolveGradient(theme, overlay) });
  }
  const deco = chosen && chosen.decoration === false ? undefined : theme.chrome?.decoration;
  if (deco) {
    // The decoration layer is taller than the frame and vertically centred, so the four
    // quadrant blobs bleed off the top and bottom exactly as they do in the source file.
    const top = -(deco.layerHeight - height) / 2;
    const corners: Array<[number, number]> = [
      [deco.inset, top + deco.inset],
      [width - deco.blobSize - deco.inset, top + deco.inset],
      [deco.inset, top + deco.layerHeight - deco.blobSize - deco.inset],
      [width - deco.blobSize - deco.inset, top + deco.layerHeight - deco.blobSize - deco.inset],
    ];
    const base = resolveGradient(theme, deco.fill);
    corners.forEach(([x, y], i) => ops.push({
      op: 'ellipse', name: `Corner glow ${i + 1}`,
      cx: round(x + deco.blobSize / 2), cy: round(y + deco.blobSize / 2),
      rx: deco.blobSize / 2, ry: deco.blobSize / 2,
      fill: deco.angles ? { ...base, angle: deco.angles[i] } : base,
    }));
  }
  return ops.length ? [{ op: 'group', name: 'Background', zone: 'chrome', children: ops }] : [];
}

export function topMarkOps(theme: Theme, width: number): Op[] {
  const mark = theme.chrome?.topMark;
  if (!mark) return [];
  // The clip windows sit on whole pixels in the source file, so the centred
  // origin is rounded rather than left on a half pixel.
  const originX = Math.round((width - mark.width) / 2);
  const children: Op[] = [];
  mark.groupOffsets.forEach((groupDx, g) => {
    const opacity = mark.groupOpacity[g] ?? 1;
    // Each group is a clipped window in the source file, so the widest bar loses
    // the sliver that sits outside it. Clamping reproduces that without a clip node.
    const groupX = originX + groupDx;
    const limit = groupX + (mark.clipWidth ?? Infinity);
    mark.barOffsets.forEach((barDx, b) => {
      const bw = mark.barWidths[b] ?? 1;
      const left = Math.max(groupX, groupX + barDx - bw / 2);
      const right = Math.min(limit, groupX + barDx + bw / 2);
      if (right <= left) return;
      children.push({
        op: 'rect', name: `Mark ${g + 1}-${b + 1}`, zone: 'chrome',
        x: round(left), y: mark.y, w: round(right - left), h: mark.height,
        fill: { color: color(theme, mark.color), opacity },
      });
    });
  });
  return [{ op: 'group', name: 'Top mark', zone: 'chrome', children }];
}

export function titleOps(ctx: Ctx, theme: Theme, ir: FPIR, width: number): { ops: Op[]; bottom: number } {
  const block = theme.chrome?.titleBlock;
  const x = block?.x ?? ctx.safeX;
  const w = block?.width ?? ctx.safeWidth;
  const align = block?.align ?? 'left';
  const ops: Op[] = [];

  let y = block?.y ?? theme.chrome?.titleTop ?? 96;
  const h1 = ctx.text('h1', ir.document.title, x, y, w, { name: 'H1', align, zone: 'chrome' });
  ops.push(h1.op);
  y += h1.height;

  if (ir.document.subtitle) {
    y += block?.gap ?? 8;
    const h2 = ctx.text('h2', ir.document.subtitle, x, y, w, { name: 'H2', align, zone: 'chrome' });
    ops.push(h2.op);
    y += h2.height;
  }
  return { ops, bottom: y };
}

/** Places a pack vector asset inside a box, preserving its aspect ratio. */
function vectorOps(theme: Theme, ref: string, boxX: number, boxY: number, boxW: number, fill: Paint, name: string): Op[] | null {
  const asset = theme.assets?.[ref];
  if (!asset?.paths.length) return null;
  const scale = boxW / asset.w;
  return asset.paths.map((path, i) => ({
    op: 'path' as const, name: `${name} ${i + 1}`, zone: 'chrome' as const, d: path.d,
    x: round(boxX + path.dx * scale), y: round(boxY + path.dy * scale), scale, fill,
  }));
}

export function watermarkOps(ctx: Ctx, theme: Theme, width: number, height: number): Op[] {
  const mark = theme.chrome?.watermark;
  if (!mark?.required || !mark.text) return [];
  const boxW = mark.width ?? Math.round(width * 0.82);
  const boxH = mark.height ?? 149;
  const left = (width - boxW) / 2;
  // The source anchors the wordmark inside the oversized decoration layer, not to the
  // frame, so it sits slightly above the frame's own centre.
  const deco = theme.chrome?.decoration;
  const top = mark.anchor === 'decoration' && deco
    ? -(deco.layerHeight - height) / 2 + (mark.anchorOffsetY ?? 0)
    : (height - boxH) / 2;
  const solidFill = { color: color(theme, mark.color ?? 'neutral.800'), opacity: mark.opacity ?? 0.5 };
  // The source ramps each glyph across its own box; a text stand-in can only be solid.
  const fill: Paint = mark.gradient ? resolveGradient(theme, mark.gradient) : solidFill;

  if (mark.vector) {
    const drawn = vectorOps(theme, mark.vector, left, top, boxW, fill, 'Watermark');
    if (drawn) return [{ op: 'group', name: 'Watermark', zone: 'chrome', children: drawn }];
  }

  const children: Op[] = [];

  // The source wordmark is preceded by a 2x2 dot mark; both are part of the logo lockup.
  const dot = mark.markSize ?? 0;
  const pitch = mark.markPitch ?? dot * 1.67;
  const gap = mark.markGap ?? dot * 0.67;
  let textLeft = left;
  if (dot > 0) {
    for (const [dx, dy] of [[0, 0], [pitch, 0], [0, pitch], [pitch, pitch]] as Array<[number, number]>) {
      children.push({
        op: 'ellipse', name: 'Watermark dot',
        cx: round(left + dx + dot / 2), cy: round(top + (boxH - pitch - dot) / 2 + dy + dot / 2),
        rx: dot / 2, ry: dot / 2, fill,
      });
    }
    textLeft = left + pitch + dot + gap;
  }

  const textWidth = left + boxW - textLeft;
  const unit = ctx.measure('h1', mark.text, 1);
  const size = Math.floor(Math.min(boxH, unit > 0 ? textWidth / unit : boxH));
  const block = ctx.text('h1', mark.text, textLeft, top + (boxH - size * 1.12) / 2, textWidth, {
    name: mark.nodeName ?? 'Watermark', size, maxLines: 1, zone: 'chrome',
    letterSpacing: Math.round(Math.max(0, (textWidth - unit * size) / mark.text.length) * 100) / 100,
  });
  children.push({ ...block.op, color: solidFill });
  return [{ op: 'group', name: 'Watermark', zone: 'chrome', children }];
}

export function brandMarkOps(ctx: Ctx, theme: Theme, width: number, height: number, variant?: string): Op[] {
  const spec = theme.chrome?.brandMark;
  if (!spec) return [];
  const patch = variant ? theme.canvas.backgroundVariants?.[variant] : undefined;
  const align = patch?.brandMarkAlign ?? spec.align ?? 'right';
  const bottom = patch?.brandMarkBottom ?? spec.bottom;
  // A logo lands on whole pixels in the source file; a half-pixel centre would
  // smear every glyph edge by a fraction of a pixel.
  const left = Math.round(align === 'center' ? (width - spec.width) / 2 : width - spec.right - spec.width);
  const top = height - bottom - spec.height;
  const fill = { color: color(theme, spec.color) };

  if (spec.vector) {
    const drawn = vectorOps(theme, spec.vector, left, top, spec.width, fill, 'Brand mark');
    if (drawn) return [{ op: 'group', name: 'Brand mark', zone: 'chrome', children: drawn }];
  }

  const children: Op[] = [];
  for (const [dx, dy] of [[0, 0], [spec.dotPitch, 0], [0, spec.dotPitch], [spec.dotPitch, spec.dotPitch]] as Array<[number, number]>) {
    children.push({
      op: 'ellipse', name: 'Brand dot',
      cx: round(left + dx + spec.dotSize / 2), cy: round(top + (spec.height - spec.dotPitch - spec.dotSize) / 2 + dy + spec.dotSize / 2),
      rx: spec.dotSize / 2, ry: spec.dotSize / 2, fill,
    });
  }
  const textLeft = left + spec.dotPitch + spec.dotSize + spec.gap;
  const textWidth = left + spec.width - textLeft;
  const unit = ctx.measure('h1', spec.text, 1);
  const size = Math.floor(Math.min(spec.height, unit > 0 ? textWidth / unit : spec.height));
  const block = ctx.text('h1', spec.text, textLeft, top + (spec.height - size * 1.12) / 2, textWidth, {
    name: 'Brand mark', size, maxLines: 1, zone: 'chrome',
    letterSpacing: Math.round(Math.max(0, (textWidth - unit * size) / spec.text.length) * 100) / 100,
  });
  children.push({ ...block.op, color: fill });
  return [{ op: 'group', name: 'Brand mark', zone: 'chrome', children }];
}

export function footerOps(ctx: Ctx, theme: Theme, ir: FPIR, width: number, height: number): Op[] {
  const spec = theme.chrome?.footer;
  const items: Array<{ label: string; value: string }> = [];
  if (ir.document.note) items.push({ label: 'Note', value: ir.document.note });
  if (ir.document.source) items.push({ label: 'Source', value: ir.document.source });
  if (ir.document.dateAsOf) items.push({ label: 'Date as of', value: ir.document.dateAsOf });
  if (!spec || !items.length) return [];

  const top = height - spec.height - spec.bottomGap;
  const children: Op[] = [];
  let x = spec.x;
  // Label and value share a baseline; the value column follows the actual label width,
  // which is how the source file spaces "Source" and "Date as of" differently.
  const labelSize = theme.typography.roles[spec.labelRole].size;
  const valueSize = theme.typography.roles[spec.valueRole].size;
  const baselineShift = Math.round((valueSize - labelSize) * 0.78);
  for (const item of items) {
    const labelWidth = Math.ceil(ctx.measure(spec.labelRole, item.label)) + 4;
    const valueWidth = Math.ceil(ctx.measure(spec.valueRole, item.value)) + 8;
    const valueDx = Math.max(spec.valueDx, spec.labelDx + labelWidth + 24);
    children.push({
      op: 'rect', name: `Footer tick ${item.label}`, zone: 'chrome',
      x: round(x), y: round(top), w: spec.tickWidth, h: spec.height, fill: resolveGradient(theme, spec.tick),
    });
    children.push(ctx.text(spec.labelRole, item.label, x + spec.labelDx, top + baselineShift, labelWidth, { name: `Footer label ${item.label}`, maxLines: 1, zone: 'chrome' }).op);
    children.push(ctx.text(spec.valueRole, item.value, x + valueDx, top, valueWidth, { name: `Footer value ${item.label}`, maxLines: 1, zone: 'chrome' }).op);
    x += valueDx + valueWidth + spec.columnGap;
  }
  return [{ op: 'group', name: 'Footer', zone: 'chrome', children }];
}

/** Pack gradients name colour tokens; the program carries resolved hex only. */
export function resolveGradient(theme: Theme, spec: GradientPaint): GradientPaint {
  return { ...spec, stops: spec.stops.map((s) => ({ ...s, color: color(theme, s.color) })) };
}
