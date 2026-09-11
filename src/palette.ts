import type { Theme } from './types.js';

/**
 * Colour selection under the pack's constraints.
 *
 * The point of this module is that an agent never picks a hex. It states what the data is
 * — one highlight, a comparison, three unordered groups, a ranked sequence — and the pack
 * decides which of its authorised hues apply. That keeps output visually free while the
 * palette stays closed.
 */
export type ColorMode =
  | 'auto' | 'none' | 'mono' | 'pair' | 'categorical' | 'sequential' | 'diverging' | 'ordered';

export interface PaletteChoice {
  mode: Exclude<ColorMode, 'auto'>;
  /** key -> theme colour reference (`accent.blue`) or literal hex from a ramp. */
  assignment: Record<string, string>;
  rationale: string;
  warnings: string[];
}

/** Hue families that read as cool, used to alternate a four-way categorical set. */
const COOL: Record<string, true> = { violet: true, indigo: true, blue: true, cyan: true, teal: true };

function ordered(theme: Theme): string[] {
  const order = theme.color.accentOrder?.length ? theme.color.accentOrder : Object.keys(theme.color.accent);
  return order.filter((k) => theme.color.accent[k]);
}

/** Evenly spaced picks around the wheel: the guide's rule for unordered groups. */
function evenlySpaced(wheel: string[], count: number): string[] {
  if (count >= wheel.length) return wheel.slice(0, count);
  const step = wheel.length / count;
  return Array.from({ length: count }, (_, i) => wheel[Math.round(i * step) % wheel.length]);
}

/** Cool, warm, cool, warm so every neighbour contrasts with the next. */
function alternateTemperature(wheel: string[], count: number): string[] {
  const cool = wheel.filter((k) => COOL[k]);
  const warm = wheel.filter((k) => !COOL[k]);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const pool = i % 2 === 0 ? cool : warm;
    const pick = pool[Math.floor(i / 2) % pool.length];
    out.push(pick ?? wheel[i % wheel.length]);
  }
  return out;
}

function defaultMode(keys: string[], hint: { orderedData?: boolean; diverging?: boolean; highlightOnly?: boolean }): Exclude<ColorMode, 'auto'> {
  if (!keys.length) return 'none';
  if (hint.highlightOnly) return 'mono';
  if (hint.diverging) return 'diverging';
  if (hint.orderedData) return keys.length > 2 ? 'ordered' : 'pair';
  if (keys.length === 1) return 'mono';
  if (keys.length === 2) return 'pair';
  return 'categorical';
}

export function choosePalette(
  theme: Theme,
  keys: string[],
  requested: ColorMode = 'auto',
  hint: { orderedData?: boolean; diverging?: boolean; highlightOnly?: boolean; ramp?: string } = {},
): PaletteChoice {
  const wheel = ordered(theme);
  const warnings: string[] = [];
  const assignment: Record<string, string> = {};

  if (!wheel.length) {
    return { mode: 'none', assignment, rationale: `theme "${theme.id}" authorises no accent palette; emphasis stays typographic`, warnings };
  }

  const mode = requested === 'auto' ? defaultMode(keys, hint) : requested;
  const ceiling = theme.rules.categoricalCeiling ?? 6;

  switch (mode) {
    case 'none':
      return { mode, assignment, rationale: 'no accent requested', warnings };

    case 'mono': {
      // One accent on neutral: everything else stays grey so the point reads immediately.
      const hue = wheel.includes('blue') ? 'blue' : wheel[0];
      if (keys.length) assignment[keys[0]] = `accent.${hue}`;
      if (keys.length > 1) warnings.push(`mono mode colours only "${keys[0]}"; the remaining ${keys.length - 1} key(s) stay neutral, which is the pack's rule for a single highlight`);
      return { mode, assignment, rationale: `single highlight in ${hue} on the neutral base`, warnings };
    }

    case 'pair': {
      const pair = theme.color.pairs?.[0] ?? [wheel[0], wheel[Math.floor(wheel.length / 2)]];
      keys.slice(0, 2).forEach((k, i) => { assignment[k] = `accent.${pair[i]}`; });
      if (keys.length > 2) warnings.push(`pair mode carries two series; ${keys.length - 2} extra key(s) stay neutral`);
      return { mode, assignment, rationale: `complementary duo ${pair.join(' vs ')} for an opposed comparison`, warnings };
    }

    case 'categorical': {
      if (keys.length > ceiling) {
        warnings.push(`${keys.length} categories exceed the pack's categorical ceiling of ${ceiling}; group the tail or switch to a sequential ramp instead of adding hues`);
      }
      const count = Math.min(keys.length, ceiling);
      const picks = count === 4 ? alternateTemperature(wheel, count) : evenlySpaced(wheel, count);
      keys.slice(0, count).forEach((k, i) => { assignment[k] = `accent.${picks[i]}`; });
      return {
        mode, assignment, warnings,
        rationale: count === 4
          ? 'four groups alternating cool and warm so each neighbour contrasts'
          : `${count} unordered groups spaced evenly around the wheel`,
      };
    }

    case 'ordered': {
      const picks = evenlySpaced(wheel, Math.min(keys.length, wheel.length));
      keys.forEach((k, i) => { assignment[k] = `accent.${picks[i % picks.length]}`; });
      if (keys.length > wheel.length) warnings.push(`${keys.length} steps exceed the ${wheel.length}-hue sequence; hues repeat`);
      return { mode, assignment, rationale: 'ordered data: hue itself carries the order', warnings };
    }

    case 'sequential':
    case 'diverging': {
      const table = mode === 'sequential' ? theme.color.ramps?.sequential : theme.color.ramps?.diverging;
      const name = hint.ramp ?? Object.keys(table ?? {})[0];
      const ramp = name ? table?.[name] : undefined;
      if (!ramp?.length) {
        warnings.push(`theme "${theme.id}" has no ${mode} ramp; falling back to categorical`);
        return choosePalette(theme, keys, 'categorical', hint);
      }
      // Sample the ramp so the first and last keys always hit its ends.
      keys.forEach((k, i) => {
        const t = keys.length === 1 ? 0 : i / (keys.length - 1);
        assignment[k] = ramp[Math.round(t * (ramp.length - 1))];
      });
      return {
        mode, assignment, warnings,
        rationale: mode === 'sequential'
          ? `single-hue "${name}" ramp, low to high`
          : `"${name}" ramp diverging through a neutral middle`,
      };
    }
  }
}

/** Lightened accent used for a value label sitting on a dark canvas. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
