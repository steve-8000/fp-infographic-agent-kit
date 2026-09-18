#!/usr/bin/env node
/**
 * Derive `themes/fp-v1-light.json` from `themes/fp-v1.json`.
 *
 * The light pack is a DIFFERENCE, not a second copy: `loadTheme` merges it over the dark
 * pack, so every field neither rule nor measurement changes stays single-sourced. Two full
 * copies of 560 fields drift, and the drift is invisible until it renders.
 *
 * Two rules and one table produce it:
 *
 *  - The neutral ramp is mirrored BY RANK. Every step keeps a measured brand grey; the
 *    lightest and darkest trade places, so `neutral.1000` (the canvas) becomes paper and
 *    `neutral.100` (hero text) becomes ink WITHOUT any role reference changing.
 *  - Chromatic colour is mirrored BY LIGHTNESS (HSL L -> 1-L, clamped). Hue and saturation
 *    are the brand; lightness is what the background decides. A sequential ramp therefore
 *    runs light-to-dark on paper, so "more" still reads as "heavier".
 *  - MEASURED overrides win over both, and each names the Figma node it was read from.
 *    Where the light template merely copied a dark value (the footer tick), the mirror is
 *    used deliberately instead - a copy is not a measurement.
 *
 * `npm test` re-derives and compares, so the committed pack cannot drift from this file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const themes = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes');

/** Read from the light templates and works in `FP Infographic Studio` / Patrick works. */
const MEASURED = {
  neutral: {
    1000: ['#E5E5E5', 'Template WhiteH:1080px 28:92 frame fill'],
    100: ['#151618', 'Template WhiteH:1080px 28:176 title fill'],
    150: ['#191919', 'Template WhiteH:1080px 28:174 title fill'],
    910: ['#DFDFDF', 'FP logo 28:98 watermark gradient, first stop'],
    790: ['#D4D4D4', 'FP logo 28:98 watermark gradient, last stop'],
    780: ['#CCCECE', 'Background Image 28:94 decoration gradient, last stop'],
  },
  // The top mark is ink on paper and paper on ink: the light pack changes the REFERENCE,
  // so no token has to carry two meanings. Measured from Four Pillars image 28:116.
  topMarkColor: ['neutral.100', 'Four Pillars image 28:116 strokes #151618'],
};

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0').toUpperCase()).join('');

function luminance(h) {
  const [r, g, b] = hex2rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgb2hsl(h) {
  const [r, g, b] = hex2rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, s, l];
}

function hsl2hex(hue, s, l) {
  if (s === 0) return rgb2hex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgb2hex([channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]);
}

/** Contrast of a colour against the light canvas. */
const CANVAS = MEASURED.neutral[1000][0];
const contrast = (h) => (luminance(CANVAS) + 0.05) / (luminance(h) + 0.05);

/**
 * Hue is the brand; the background decides lightness, and paper decides how much chroma a
 * colour may spend. Darken only until the colour clears the 3:1 floor WCAG sets for a
 * graphical object, never further: a straight L -> 1-L mirror turns #9A86FF violet into
 * near-black navy and #FF7A6B coral into blood red, which is a different brand rather than
 * the same brand on paper. The saturation cap is the measured character of the ACTIVE
 * `report` set, whose four hues sit at S 0.45-0.58; without it the eleven-hue `guide` set
 * lands on neon at full saturation.
 */
const CHROMA_CAP = 0.65;

function forLight(h, floor = 3.2) {
  const [hue, s, l] = rgb2hsl(h);
  const sat = Math.min(s, CHROMA_CAP);
  for (let cand = Math.min(l, 0.58); cand >= 0.12; cand -= 0.005) {
    const out = hsl2hex(hue, sat, cand);
    if (contrast(out) >= floor) return out;
  }
  return hsl2hex(hue, sat, 0.12);
}

/**
 * A ramp is read as an ORDER, so lightness carries the order and the hue of each measured
 * stop is kept. On paper the sequence runs light to dark, so "more" still reads as heavier;
 * a diverging ramp puts its neutral middle nearest the paper and darkens towards both ends.
 */
function forLightRamp(stops, shape) {
  const n = stops.length;
  const source = shape === 'sequential' ? [...stops].reverse() : stops;
  return source.map((stop, i) => {
    const [hue, s] = rgb2hsl(stop);
    const sat = Math.min(s, CHROMA_CAP);
    const t = n === 1 ? 0 : i / (n - 1);
    const level = shape === 'sequential' ? 0.70 - 0.40 * t : 0.32 + 0.38 * (1 - Math.abs(2 * t - 1));
    return hsl2hex(hue, sat, level);
  });
}

/** Every step keeps a measured brand grey; the ends trade places. */
function mirrorRamp(neutral) {
  const steps = Object.keys(neutral).sort((a, b) => Number(a) - Number(b));
  const byLum = [...steps].sort((a, b) => luminance(neutral[a]) - luminance(neutral[b]));
  const out = {};
  for (const step of steps) {
    const rank = byLum.indexOf(step);
    out[step] = neutral[byLum[byLum.length - 1 - rank]];
  }
  return out;
}

export function deriveLight(dark) {
  const neutral = mirrorRamp(dark.color.neutral);
  for (const [step, [value]] of Object.entries(MEASURED.neutral)) neutral[step] = value;

  const accentSets = {};
  for (const [name, set] of Object.entries(dark.color.accentSets ?? {})) {
    accentSets[name] = { hues: Object.fromEntries(Object.entries(set.hues).map(([k, v]) => [k, forLight(v)])) };
  }
  const ramps = { sequential: {}, diverging: {} };
  for (const [name, stops] of Object.entries(dark.color.ramps?.sequential ?? {})) {
    ramps.sequential[name] = forLightRamp(stops, 'sequential');
  }
  for (const [name, stops] of Object.entries(dark.color.ramps?.diverging ?? {})) {
    ramps.diverging[name] = forLightRamp(stops, 'diverging');
  }

  const cite = (note) => ({ status: 'measured', source: 'fp-light-templates', note });
  return {
    $schema: dark.$schema,
    id: 'fp-v1-light',
    extends: dark.id,
    version: dark.version,
    label: (dark.label ?? dark.id) + ' · light',
    appearance: 'light',
    provenance: {
      sources: [
        { id: 'fp-light-templates', kind: 'figma-file', ref: 'FP Infographic Studio / Patrick works 28:3 — Template WhiteH:1080px 28:92 and 28:177, and the six #E5E5E5 works' },
      ],
      fields: {
        'color.neutral': cite(
          'the dark ramp mirrored by rank, so every step keeps a measured brand grey and the ends trade places; '
          + Object.entries(MEASURED.neutral).map(([step, [value, ref]]) => `${step} = ${value} (${ref})`).join('; '),
        ),
        'color.accent': {
          status: 'declared',
          source: 'fp-light-templates',
          note: 'hue and saturation are the dark pack\'s measured hues; lightness is lowered only until the colour clears '
            + '3:1 against the paper, which is the floor WCAG sets for a graphical object. The light works use no '
            + 'consistent accent vocabulary - #4E81EE, #E28F62, #5470C6, #F2A01E, #1A3487 and #5C9BD6 appear across six '
            + 'frames - so there was nothing to measure',
        },
        'canvas.overlay': cite(
          'the light template 28:92 and all six light works are a flat fill plus the corner blobs: no edge gradient. '
          + 'The dark overlay is measured from published report frames, and mirroring it puts a grey wash over paper, '
          + 'so the light pack deletes it rather than inventing a pale one',
        ),
        'chrome.decoration.fill': cite(
          'Background Image 28:94: the corner blobs run from paper white, so the light pack points the first stop at '
          + 'neutral.1050 instead of neutral.0, which is ink here',
        ),
        'chrome.topMark.color': cite(MEASURED.topMarkColor[1]),
        'chart.barFillFrom': cite(
          'the light works fill a bar with a solid accent: 2_01 32:652, 1_02 32:1247 and 3_03 32:1364 carry no bar '
          + 'gradient. The dark ramp fades a bar from 40% to 5% accent, which reads as a glow above ink and as a bar '
          + 'dissolving into the page on paper, so emphasis here rides the stroke instead',
        ),
      },
    },
    canvas: { overlay: null },
    color: { neutral, accentSets, ramps, base: Object.fromEntries(Object.entries(dark.color.base ?? {}).map(([k, v]) => [k, forLight(v)])), tail: forLight(dark.color.tail) },
    chrome: {
      topMark: { color: MEASURED.topMarkColor[0] },
      decoration: { fill: { ...dark.chrome.decoration.fill, stops: [{ pos: 0, color: 'neutral.1050', alpha: 1 }, { pos: 1, color: 'neutral.780', alpha: 1 }] } },
    },
    chart: { barFillFrom: 1, barFillTo: 1, barHighlightFrom: 1, barHighlightTo: 1 },
  };
}

/** Importable from the tests, which re-derive and compare; only the CLI writes. */
export function darkPack() {
  return JSON.parse(readFileSync(join(themes, 'fp-v1.json'), 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const light = deriveLight(darkPack());
  if (process.argv.includes('--write')) {
    writeFileSync(join(themes, 'fp-v1-light.json'), JSON.stringify(light, null, 2) + '\n');
    console.log(`themes/fp-v1-light.json: ${Object.keys(light.color.neutral).length} neutral steps, appearance ${light.appearance}`);
  } else {
    process.stdout.write(JSON.stringify(light, null, 2) + '\n');
  }
}
