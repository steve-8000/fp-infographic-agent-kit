import type { Theme } from './types.js';

/**
 * Deterministic offline text metrics.
 *
 * No font binary is loaded, so widths are an advance-width model per character class,
 * calibrated in the theme pack. It is intentionally slightly pessimistic: layout that
 * fits here also fits in a real font renderer. A backend that can measure natively
 * (Figma `loadFontAsync` + `getRangeBoundingBox`) should re-measure and shrink, never grow.
 */

const DEFAULT_METRICS = { latin: 0.52, digit: 0.56, space: 0.26, cjk: 1.0, punct: 0.34, lineHeightRatio: 1.45 };

function classOf(code: number): 'cjk' | 'digit' | 'space' | 'punct' | 'latin' {
  if (code === 32 || code === 9) return 'space';
  if (code >= 48 && code <= 57) return 'digit';
  // Hangul syllables/jamo, CJK ideographs, kana, fullwidth forms.
  if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0x3130 && code <= 0x318f) || (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xff00 && code <= 0xff60)) return 'cjk';
  if (code < 48 || (code > 57 && code < 65) || (code > 90 && code < 97) || (code > 122 && code < 192)) return 'punct';
  return 'latin';
}

export function measureWidth(theme: Theme, text: string, size: number): number {
  const m = { ...DEFAULT_METRICS, ...(theme.typography.metrics ?? {}) };
  let em = 0;
  for (const ch of text) em += m[classOf(ch.codePointAt(0) ?? 32)];
  return em * size;
}

/** Greedy wrap that breaks between CJK characters and on spaces, never mid-Latin-word unless forced. */
export function wrapText(theme: Theme, text: string, size: number, maxWidth: number, maxLines = Infinity): string[] {
  const paragraphs = String(text).split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    let line = '';
    const tokens = paragraph.match(/[\s]+|[^\s]+/g) ?? [];
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) line += ' ';
        continue;
      }
      // A CJK run may break anywhere, so feed it character by character.
      const atoms = /[\u1100-\u11ff\u3000-\u30ff\u3130-\u318f\u4e00-\u9fff\uac00-\ud7a3]/.test(token)
        ? [...token] : [token];
      for (const atom of atoms) {
        const candidate = line + atom;
        if (line && measureWidth(theme, candidate.trimEnd(), size) > maxWidth) {
          lines.push(line.trimEnd());
          line = atom.trimStart();
        } else {
          line = candidate;
        }
        // A single atom wider than the box: hard-break it so nothing silently overflows.
        while (measureWidth(theme, line, size) > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measureWidth(theme, line.slice(0, cut), size) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    lines.push(line.trimEnd());
  }

  const clean = lines.filter((l, i) => l !== '' || i === 0);
  if (clean.length <= maxLines) return clean;
  const kept = clean.slice(0, maxLines);
  const last = kept[maxLines - 1];
  let truncated = last;
  while (truncated.length > 1 && measureWidth(theme, truncated + '…', size) > maxWidth) truncated = truncated.slice(0, -1);
  kept[maxLines - 1] = truncated + '…';
  return kept;
}

export function lineHeightPx(theme: Theme, role: string): number {
  const spec = theme.typography.roles[role];
  if (!spec) throw new Error(`Theme "${theme.id}" has no text role "${role}"`);
  const ratio = spec.lineHeight ?? theme.typography.metrics?.lineHeightRatio ?? DEFAULT_METRICS.lineHeightRatio;
  return Math.round(spec.size * ratio);
}

export function blockHeight(theme: Theme, role: string, lineCount: number): number {
  return lineHeightPx(theme, role) * Math.max(1, lineCount);
}

/** Shortest label formatting that preserves the exact value. Never rounds. */
export function formatValue(value: unknown, locale: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return Number.isInteger(value) ? value.toLocaleString(locale) : String(value);
  }
  return String(value);
}
