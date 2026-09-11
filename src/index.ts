import type { AuditResult, FPInput, FPIR, RenderProgram, Theme } from './types.js';
import { loadTheme, unverifiedFields } from './theme.js';
import { normalize } from './normalize.js';
import { compile } from './plan.js';
import { auditProgram } from './audit.js';
import { checkComposition } from './compose-rules.js';

export * from './types.js';
export { loadTheme, listThemes, validateTheme, unverifiedFields, accentPalette } from './theme.js';
export { normalize, selectTemplate } from './normalize.js';
export { compile } from './plan.js';
export { composeBlocks, collectAccentKeys, collectText } from './blocks.js';
export { auditProgram } from './audit.js';
export { checkComposition } from './compose-rules.js';
export { checkDirection, type DirectionCheck } from './direction.js';
export { buildTokenDoc, buildTokenSpec } from './tokens.js';
export { buildBrief, type Brief, type LayoutCandidate, type Reading } from './brief.js';
export { choosePalette, tint, type ColorMode, type PaletteChoice } from './palette.js';
export { toSvg } from './backends/svg.js';
export { toFigmaScript, toFigmaSheet, type FigmaTarget, type SheetItem } from './backends/figma-plugin.js';

export interface RenderResult { ir: FPIR; program: RenderProgram; audit: AuditResult }

/** input -> fp-ir/1 -> fp-plan/1 -> audit. Backends consume `program`; nothing else. */
export function render(input: FPInput, themeDirs: string[] = []): RenderResult {
  const theme = withOverrides(loadTheme(input.theme ?? 'fp-v1', themeDirs), input);
  const ir = normalize(input, theme);
  const program = compile(ir, theme, input.direction);
  const audit = auditProgram(program, ir, theme);
  // Composition rules judge the authored structure, which the rendered ops no longer show.
  const composition = input.blocks ? checkComposition(input.blocks) : [];
  const findings = [...composition, ...audit.findings];
  return { ir, program, audit: { ok: !findings.some((f) => f.severity === 'fail'), findings } };
}

/**
 * Per-run type overrides. Published FOUR PILLARS frames set their own title sizes — 50, 54
 * and 60 all appear in the same file — so the pack supplies a default, not a ceiling. The
 * pack's minimum size is still enforced, because that one is a legibility rule.
 */
function withOverrides(base: Theme, input: FPInput): Theme {
  let theme = base;
  if (input.accentSet && input.accentSet !== theme.color.accentSet) {
    const set = theme.color.accentSets?.[input.accentSet];
    if (!set) {
      throw new Error(`Theme "${theme.id}" ships no accent set "${input.accentSet}"; it has ${Object.keys(theme.color.accentSets ?? {}).join(', ') || 'none'}`);
    }
    theme = {
      ...theme,
      color: { ...theme.color, accent: set.hues, accentOrder: set.order, accentSet: input.accentSet },
      rules: { ...theme.rules, categoricalCeiling: set.ceiling ?? theme.rules.categoricalCeiling },
    };
  }
  const overrides = input.style?.roles;
  if (!overrides) return theme;
  const roles = { ...theme.typography.roles };
  for (const [name, patch] of Object.entries(overrides)) {
    const base = roles[name];
    if (!base) throw new Error(`Theme "${theme.id}" has no text role "${name}" to override`);
    if (patch.size !== undefined && patch.size < theme.typography.minSize) {
      throw new Error(`role "${name}" override ${patch.size}px is below the pack minimum ${theme.typography.minSize}px`);
    }
    roles[name] = { ...base, ...patch };
  }
  return { ...theme, typography: { ...theme.typography, roles } };
}

export function doctor(themeId = 'fp-v1', themeDirs: string[] = []) {
  const theme = loadTheme(themeId, themeDirs);
  const unverified = unverifiedFields(theme);
  return {
    theme: { id: theme.id, version: theme.version, label: theme.label },
    accentPaletteSize: Object.keys(theme.color.accent).length,
    unverified,
    ok: unverified.length === 0,
    advice: unverified.length
      ? 'Sync these fields against the live design contract before treating the pack as authoritative.'
      : 'Every pack field is backed by measured or declared evidence.',
  };
}
