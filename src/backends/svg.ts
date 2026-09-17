import type { Op, OpText, Paint, RenderProgram, SolidPaint } from '../types.js';
import { isGradient } from '../types.js';

/**
 * Reference backend. Same program, no design tool, fully diffable — this is what makes
 * the layout engine testable in CI and what a host without Figma access can still produce.
 */
export function toSvg(program: RenderProgram): string {
  const body: string[] = [];
  const defs: string[] = [];
  emit(program.ops, body, defs);
  const font = [program.theme.family, ...program.theme.fallbacks].map((f) => (/\s/.test(f) ? `'${f}'` : f)).join(', ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${program.frame.width}" height="${program.frame.height}" viewBox="0 0 ${program.frame.width} ${program.frame.height}">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    `<rect width="${program.frame.width}" height="${program.frame.height}" fill="${isGradient(program.frame.background) ? '#000000' : program.frame.background.color}"/>`,
    `<g font-family="${escapeAttr(font)}">`,
    ...body,
    '</g></svg>',
  ].join('\n');
}

let gradientSeq = 0;

/** SVG matrix(a b c d e f) for the inverse of a 2x3 design-tool gradient matrix. */
function invert2x3(t: [[number, number, number], [number, number, number]]): number[] {
  const [[a, b, tx], [c, d, ty]] = t;
  const det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ic, ib, id, -(ia * tx + ib * ty), -(ic * tx + id * ty)];
}

/** Gradients become `<defs>` entries; solids stay inline. */
function fill(p: Paint | undefined, defs: string[]): string {
  if (!p) return 'fill="none"';
  if (isGradient(p)) {
    const id = `grad${++gradientSeq}`;
    const stops = p.stops.map((s) => `<stop offset="${s.pos}" stop-color="${s.color}" stop-opacity="${s.alpha ?? 1}"/>`).join('');
    if (p.transform) {
      // The tool's matrix maps the unit gradient onto the shape; SVG wants its inverse as
      // the gradient transform, with the handle running (0,0) to (1,0).
      const m = invert2x3(p.transform);
      defs.push(`<linearGradient id="${id}" gradientUnits="objectBoundingBox" gradientTransform="matrix(${m.join(' ')})" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>`);
      return `fill="url(#${id})"${p.opacity !== undefined ? ` fill-opacity="${p.opacity}"` : ''}`;
    }
    const angle = ((p.angle ?? 0) * Math.PI) / 180;
    const x2 = (0.5 + Math.cos(angle) / 2).toFixed(4), y2 = (0.5 + Math.sin(angle) / 2).toFixed(4);
    const x1 = (0.5 - Math.cos(angle) / 2).toFixed(4), y1 = (0.5 - Math.sin(angle) / 2).toFixed(4);
    defs.push(p.gradient === 'radial'
      ? `<radialGradient id="${id}">${stops}</radialGradient>`
      : `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
    return `fill="url(#${id})"${p.opacity !== undefined ? ` fill-opacity="${p.opacity}"` : ''}`;
  }
  return `fill="${p.color}"${p.opacity !== undefined ? ` fill-opacity="${p.opacity}"` : ''}`;
}

function stroke(p: Paint | undefined, width: number | undefined): string {
  if (!p || isGradient(p)) return '';
  return ` stroke="${p.color}"${p.opacity !== undefined ? ` stroke-opacity="${p.opacity}"` : ''} stroke-width="${width ?? 1}"`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function textAnchor(op: OpText): { anchor: string; x: number } {
  if (op.align === 'center') return { anchor: 'middle', x: op.x + op.w / 2 };
  if (op.align === 'right') return { anchor: 'end', x: op.x + op.w };
  return { anchor: 'start', x: op.x };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  return `M ${p(rOuter, a0)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, a1)} L ${p(rInner, a1)} A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, a0)} Z`;
}

function arrowHead(points: Array<[number, number]>, size: number, atEnd: boolean): string {
  const [tip, prev] = atEnd
    ? [points[points.length - 1], points[points.length - 2]]
    : [points[0], points[1]];
  const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
  const wing = (d: number) => `${(tip[0] - Math.cos(angle + d) * size).toFixed(2)},${(tip[1] - Math.sin(angle + d) * size).toFixed(2)}`;
  return `${tip[0].toFixed(2)},${tip[1].toFixed(2)} ${wing(0.42)} ${wing(-0.42)}`;
}

function emit(ops: Op[], out: string[], defs: string[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'group':
        out.push(`<g data-name="${escapeAttr(op.name)}">`);
        emit(op.children, out, defs);
        out.push('</g>');
        break;
      case 'rect': {
        const r = op.radius ?? 0;
        // A band inside a rounded surface rounds only the side that meets the edge; the
        // other side must stay square or the row under it reads as a detached pill.
        if (r > 0 && op.corners && op.corners !== 'all') {
          const { x, y, w, h } = op;
          const d = op.corners === 'top'
            ? `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}H${x}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`
            : `M${x},${y}H${x + w}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}Z`;
          out.push(`<path data-name="${escapeAttr(op.name ?? '')}" d="${d}" ${fill(op.fill, defs)}${stroke(op.stroke, op.strokeWidth)}/>`);
          break;
        }
        out.push(`<rect data-name="${escapeAttr(op.name ?? '')}" x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}"${r ? ` rx="${r}"` : ''} ${fill(op.fill, defs)}${stroke(op.stroke, op.strokeWidth)}/>`);
        break;
      }
      case 'ellipse':
        out.push(`<ellipse data-name="${escapeAttr(op.name ?? '')}" cx="${op.cx}" cy="${op.cy}" rx="${op.rx}" ry="${op.ry}" ${fill(op.fill, defs)}${stroke(op.stroke, op.strokeWidth)}/>`);
        break;
      case 'polygon':
        out.push(`<polygon data-name="${escapeAttr(op.name ?? '')}" points="${op.points.map(([x, y]) => `${x},${y}`).join(' ')}" ${fill(op.fill, defs)}${stroke(op.stroke, op.strokeWidth)}/>`);
        break;
      case 'arc':
        out.push(`<path data-name="${escapeAttr(op.name ?? '')}" d="${arcPath(op.cx, op.cy, op.rOuter, op.rInner, op.startAngle, op.endAngle)}" ${fill(op.fill, defs)}/>`);
        break;
      case 'line': {
        const d = op.points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ');
        out.push(`<path data-name="${escapeAttr(op.name ?? '')}" d="${d}" fill="none" stroke="${op.stroke.color}"${op.stroke.opacity !== undefined ? ` stroke-opacity="${op.stroke.opacity}"` : ''} stroke-width="${op.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"${op.dash ? ` stroke-dasharray="${op.dash.join(' ')}"` : ''}/>`);
        const size = 10;
        if (op.arrowEnd) out.push(`<polygon points="${arrowHead(op.points, size, true)}" fill="${op.stroke.color}"/>`);
        if (op.arrowStart) out.push(`<polygon points="${arrowHead(op.points, size, false)}" fill="${op.stroke.color}"/>`);
        break;
      }
      case 'path':
        out.push(`<path data-name="${escapeAttr(op.name ?? '')}" transform="translate(${op.x} ${op.y}) scale(${op.scale})" d="${op.d}" ${fill(op.fill, defs)}${stroke(op.stroke, op.strokeWidth)}/>`);
        break;
      case 'text': {
        const { anchor, x } = textAnchor(op);
        const offsetY = op.valign === 'middle' ? (op.h - op.lineHeight * op.lines.length) / 2 : 0;
        const spans = op.lines.map((l, i) =>
          `<tspan x="${x}" y="${(op.y + offsetY + op.lineHeight * i + op.size * 0.8).toFixed(2)}">${escapeText(l)}</tspan>`).join('');
        const tracking = op.letterSpacing ? ` letter-spacing="${op.letterSpacing}"` : '';
        const spin = op.rotate ? ` transform="rotate(${op.rotate} ${x} ${op.y})"` : '';
        out.push(`<text data-name="${escapeAttr(op.name ?? '')}" font-size="${op.size}" font-weight="${op.weight}" text-anchor="${anchor}"${tracking}${spin} ${fill(op.color, defs)}>${spans}</text>`);
        break;
      }
    }
  }
}
