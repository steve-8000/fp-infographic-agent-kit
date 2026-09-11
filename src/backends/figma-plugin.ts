import type { RenderProgram } from '../types.js';

export interface FigmaTarget {
  /** Overrides the pack's section-label colour on a sheet. */
  labelColor?: string;
  /** Document names that must never be mutated. The script aborts before any write. */
  readOnlyDocuments?: string[];
  /** Page to create for this run. Omitted keeps the current page. */
  pageName?: string;
  /** Reuse an existing page with this exact name instead of creating one. */
  reusePage?: boolean;
  /** When reusing a page, remove its existing content first so a rerun replaces rather than stacks. */
  clearPage?: boolean;
  /** Canvas offset so repeated runs on one page do not overlap. */
  originX?: number;
  originY?: number;
}

const WEIGHT_STYLE: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

/**
 * Emits an async function body for any host that can run Figma Plugin API code
 * (the OMP figma-bridge `figma_exec`, a dev plugin console, or an equivalent bridge).
 * The program travels as data and is interpreted, so the script stays small and
 * every backend renders the identical geometry.
 */
export function toFigmaScript(program: RenderProgram, target: FigmaTarget = {}): string {
  return toFigmaSheet([{ program, x: target.originX ?? 0, y: target.originY ?? 0 }], target);
}

export interface SheetItem { program: RenderProgram; x: number; y: number; label?: string }

/**
 * One page, many frames — the way a published report page is actually laid out. A single
 * script writes the whole sheet so a partial failure cannot leave half a page behind.
 */
export function toFigmaSheet(items: SheetItem[], target: FigmaTarget = {}): string {
  const fonts = collectFonts(items.map((i) => i.program));
  const payload = JSON.stringify({ items, target, fonts });
  return `
const PAYLOAD = ${payload};
const { items, target, fonts } = PAYLOAD;
const family = items[0].program.theme.family;
const fallbacks = items[0].program.theme.fallbacks;

const guarded = (target.readOnlyDocuments || []).find((n) => figma.root.name === n);
if (guarded) throw new Error('Refusing to write: "' + guarded + '" is a read-only source document');

const loaded = [];
for (const f of fonts) {
  try { await figma.loadFontAsync(f); loaded.push(f); }
  catch (e) { /* recorded below as a substitution */ }
}
if (!loaded.length) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  loaded.push({ family: 'Inter', style: 'Regular' });
}
const fontFor = (family, style) =>
  loaded.find((f) => f.family === family && f.style === style)
  || loaded.find((f) => f.family === family)
  || loaded[0];
const substitutions = [];

let page = figma.currentPage;
if (target.pageName) {
  const existing = figma.root.children.find((p) => p.name === target.pageName);
  if (existing && target.reusePage) {
    page = existing;
    if (target.clearPage) { await page.loadAsync(); for (const child of [...page.children]) child.remove(); }
  } else { page = figma.createPage(); page.name = target.pageName; }
  if (typeof figma.setCurrentPageAsync === 'function') await figma.setCurrentPageAsync(page);
  else figma.currentPage = page;
}

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
});
const rad = (deg) => ((deg || 0) * Math.PI) / 180;
// Figma gradients are defined by a transform; a rotation about the centre reproduces the angle.
const gradientTransform = (deg) => {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0.5 - (c * 0.5) + (s * 0.5)], [s, c, 0.5 - (s * 0.5) - (c * 0.5)]];
};
const toPaint = (p) => p.gradient
  ? { type: p.gradient === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
      gradientTransform: p.transform || gradientTransform(p.angle),
      gradientStops: p.stops.map((st) => ({ position: st.pos, color: Object.assign({}, hexToRgb(st.color), { a: st.alpha === undefined ? 1 : st.alpha }) })),
      opacity: p.opacity === undefined ? 1 : p.opacity }
  : { type: 'SOLID', color: hexToRgb(p.color), opacity: p.opacity === undefined ? 1 : p.opacity };
const solid = (p) => [toPaint(p)];

let sheetWidth = 0;
/**
 * createNodeFromSvg always returns a frame the size of the SVG viewport. Left in place
 * that frame becomes a full-size transparent layer stacked over everything else, so the
 * layer list reads as one pile and the real geometry is buried. The wrapper is unwrapped
 * here: the vectors keep the absolute coordinates the program gave them and each layer
 * ends up its own size.
 */
const svgShape = (inner, fill) => {
  const wrapper = figma.createNodeFromSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + sheetWidth + '" height="' + sheetWidth + '">' + inner + '</svg>');
  const kids = wrapper.children.slice();
  // A gradient cannot be expressed as an SVG attribute here, so it is applied to the
  // produced vectors directly; without this the shape is created with no fill at all.
  // The importer may nest the path inside groups, so every leaf is painted, not the top.
  if (fill && fill.gradient) {
    const paintLeaves = (n) => {
      if (n.children) { for (const c of n.children) paintLeaves(c); return; }
      if ('fills' in n) n.fills = solid(fill);
    };
    for (const k of kids) paintLeaves(k);
  }
  let node;
  if (kids.length === 1) {
    node = kids[0];
    const x = node.x; const y = node.y;
    wrapper.parent.appendChild(node);
    node.x = x; node.y = y;
  } else {
    const boxes = kids.map((k) => ({ x: k.x, y: k.y }));
    for (let i = 0; i < kids.length; i++) { wrapper.parent.appendChild(kids[i]); kids[i].x = boxes[i].x; kids[i].y = boxes[i].y; }
    node = figma.group(kids, wrapper.parent);
  }
  wrapper.remove();
  node.expanded = false;
  return node;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paintAttr = (p, key) => (p && !p.gradient) ? (key + '="' + p.color + '" ' + key + '-opacity="' + (p.opacity === undefined ? 1 : p.opacity) + '"') : (key === 'fill' ? 'fill="none"' : '');

const arrowHead = (points, size, atEnd) => {
  const tip = atEnd ? points[points.length - 1] : points[0];
  const prev = atEnd ? points[points.length - 2] : points[1];
  const a = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
  const wing = (d) => (tip[0] - Math.cos(a + d) * size) + ',' + (tip[1] - Math.sin(a + d) * size);
  return tip[0] + ',' + tip[1] + ' ' + wing(0.42) + ' ' + wing(-0.42);
};
const arcPath = (o) => {
  const large = o.endAngle - o.startAngle > Math.PI ? 1 : 0;
  const pt = (r, a) => (o.cx + Math.cos(a) * r).toFixed(2) + ' ' + (o.cy + Math.sin(a) * r).toFixed(2);
  return 'M ' + pt(o.rOuter, o.startAngle) + ' A ' + o.rOuter + ' ' + o.rOuter + ' 0 ' + large + ' 1 ' + pt(o.rOuter, o.endAngle)
    + ' L ' + pt(o.rInner, o.endAngle) + ' A ' + o.rInner + ' ' + o.rInner + ' 0 ' + large + ' 0 ' + pt(o.rInner, o.startAngle) + ' Z';
};

const created = [];

async function draw(op, parent) {
  if (op.op === 'group') {
    const kids = [];
    for (const child of op.children) { const n = await draw(child, parent); if (n) kids.push(n); }
    if (!kids.length) return null;
    const g = figma.group(kids, parent);
    g.name = op.name;
    g.expanded = false;
    return g;
  }
  if (op.op === 'rect') {
    const n = figma.createRectangle();
    n.name = op.name || 'Rect';
    n.x = op.x; n.y = op.y;
    n.resizeWithoutConstraints(Math.max(0.01, op.w), Math.max(0.01, op.h));
    n.fills = op.fill ? solid(op.fill) : [];
    n.strokes = op.stroke ? solid(op.stroke) : [];
    if (op.strokeWidth) n.strokeWeight = op.strokeWidth;
    if (op.radius) n.cornerRadius = op.radius;
    parent.appendChild(n);
    return n;
  }
  if (op.op === 'ellipse') {
    const n = figma.createEllipse();
    n.name = op.name || 'Ellipse';
    n.x = op.cx - op.rx; n.y = op.cy - op.ry;
    n.resizeWithoutConstraints(op.rx * 2, op.ry * 2);
    n.fills = op.fill ? solid(op.fill) : [];
    n.strokes = op.stroke ? solid(op.stroke) : [];
    if (op.strokeWidth) n.strokeWeight = op.strokeWidth;
    parent.appendChild(n);
    return n;
  }
  if (op.op === 'text') {
    const font = fontFor(family, ${JSON.stringify(WEIGHT_STYLE)}[op.weight] || 'Regular');
    if (font.family !== family) substitutions.push(family + ' -> ' + font.family + ' ' + font.style);
    const n = figma.createText();
    n.fontName = font;
    n.name = op.name || 'Text';
    n.characters = op.text;
    n.fontSize = op.size;
    n.lineHeight = { unit: 'PIXELS', value: op.lineHeight };
    if (op.letterSpacing) n.letterSpacing = { unit: 'PIXELS', value: op.letterSpacing };
    n.textAlignHorizontal = (op.align || 'left').toUpperCase();
    n.textAutoResize = 'NONE';
    n.x = op.x; n.y = op.y;
    n.resizeWithoutConstraints(Math.max(1, op.w), Math.max(op.lineHeight, op.h));
    n.fills = solid(op.color);
    if (op.rotate) n.rotation = -op.rotate;   // Figma rotates counter-clockwise
    parent.appendChild(n);
    return n;
  }
  // Everything else is a true vector: strokes stay strokes, never rotated rectangles.
  let inner = '';
  if (op.op === 'line') {
    const d = op.points.map((p, i) => (i ? 'L' : 'M') + ' ' + p[0] + ' ' + p[1]).join(' ');
    inner += '<path d="' + d + '" fill="none" stroke="' + op.stroke.color + '" stroke-opacity="'
      + (op.stroke.opacity === undefined ? 1 : op.stroke.opacity) + '" stroke-width="' + op.strokeWidth
      + '" stroke-linejoin="round" stroke-linecap="round"' + (op.dash ? ' stroke-dasharray="' + op.dash.join(' ') + '"' : '') + '/>';
    if (op.arrowEnd) inner += '<polygon points="' + arrowHead(op.points, 10, true) + '" fill="' + op.stroke.color + '"/>';
    if (op.arrowStart) inner += '<polygon points="' + arrowHead(op.points, 10, false) + '" fill="' + op.stroke.color + '"/>';
  } else if (op.op === 'polygon') {
    inner = '<polygon points="' + op.points.map((p) => p[0] + ',' + p[1]).join(' ') + '" ' + paintAttr(op.fill, 'fill') + ' ' + paintAttr(op.stroke, 'stroke') + '/>';
  } else if (op.op === 'path') {
    inner = '<g transform="translate(' + op.x + ' ' + op.y + ') scale(' + op.scale + ')"><path d="' + op.d + '" ' + paintAttr(op.fill, 'fill') + '/></g>';
  } else if (op.op === 'arc') {
    inner = '<path d="' + arcPath(op) + '" ' + paintAttr(op.fill, 'fill') + '/>';
  } else {
    return null;
  }
  const node = svgShape(inner, op.fill);
  node.name = op.name || op.op;
  parent.appendChild(node);
  return node;
}

const frames = [];
const warnings = [];
for (const item of items) {
  const program = item.program;
  sheetWidth = Math.max(program.frame.width, program.frame.height);

  if (item.label) {
    const font = fontFor(family, 'Bold') || loaded[0];
    const heading = figma.createText();
    heading.fontName = font;
    heading.characters = item.label;
    heading.fontSize = 72;
    heading.name = 'Section ' + item.label;
    heading.x = item.x;
    heading.y = item.y - 140;
    heading.fills = [{ type: 'SOLID', color: hexToRgb(target.labelColor || items[0].program.theme.labelColor) }];
    page.appendChild(heading);
  }

  const frame = figma.createFrame();
  frame.name = program.frame.name;
  frame.resizeWithoutConstraints(program.frame.width, program.frame.height);
  frame.x = item.x;
  frame.y = item.y;
  frame.fills = solid(program.frame.background);
  frame.clipsContent = true;
  page.appendChild(frame);

  for (const op of program.ops) { const n = await draw(op, frame); if (n) created.push(n.id); }
  frames.push({ id: frame.id, name: frame.name, x: item.x, y: item.y });
  for (const w of program.meta.warnings) warnings.push(frame.name + ': ' + w);
}

// Selection and viewport only apply to the page that is actually current.
const roots = page.children.filter((c) => c.type === 'FRAME');
page.selection = roots;
if (figma.currentPage.id === page.id && roots.length) figma.viewport.scrollAndZoomIntoView(roots);

return {
  frames: frames.length,
  frameIds: frames.map((f) => f.id),
  pageId: page.id,
  pageName: page.name,
  document: figma.root.name,
  nodes: created.length,
  fontSubstitutions: Array.from(new Set(substitutions)),
  warnings,
};
`.trim();
}

function collectFonts(programs: RenderProgram[]): Array<{ family: string; style: string }> {
  const weights = new Set<number>([700]);
  const walk = (ops: RenderProgram['ops']) => {
    for (const op of ops) {
      if (op.op === 'group') walk(op.children);
      else if (op.op === 'text') weights.add(op.weight);
    }
  };
  for (const program of programs) walk(program.ops);
  const families = [programs[0].theme.family, ...programs[0].theme.fallbacks];
  const out: Array<{ family: string; style: string }> = [];
  for (const family of families) {
    for (const w of [...weights].sort()) out.push({ family, style: WEIGHT_STYLE[w] ?? 'Regular' });
  }
  return out;
}
