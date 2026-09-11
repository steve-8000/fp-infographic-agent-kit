import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SolidPaint, Theme, VectorAsset } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));

export function listThemes(extra: string[] = []): Array<{ id: string; version: string; label?: string; path: string }> {
  // Packs ship next to the source tree and next to the build output; both are searched.
  const dirs = [...extra, resolve(here, '../themes'), resolve(here, '../../themes')].filter((d) => existsSync(d));
  const seen = new Map<string, { id: string; version: string; label?: string; path: string }>();
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const path = join(dir, file);
      try {
        const t = JSON.parse(readFileSync(path, 'utf8')) as Theme;
        if (t?.id && !seen.has(t.id)) seen.set(t.id, { id: t.id, version: t.version, label: t.label, path });
      } catch { /* a malformed pack is reported by loadTheme, not by listing */ }
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const cache = new Map<string, Theme>();

export function loadTheme(id = 'fp-v1', extra: string[] = []): Theme {
  const cached = cache.get(id);
  if (cached) return cached;
  const direct = id.endsWith('.json') ? resolve(id) : undefined;
  const path = direct && existsSync(direct) ? direct : listThemes(extra).find((t) => t.id === id)?.path;
  if (!path) throw new Error(`Unknown theme "${id}". Available: ${listThemes(extra).map((t) => t.id).join(', ') || 'none'}`);
  const theme = JSON.parse(readFileSync(path, 'utf8')) as Theme;
  // A pack may ship several measured accent vocabularies; exactly one is active, and
  // every `accent.*` reference resolves against it so there is never a second truth.
  const setName = theme.color.accentSet;
  if (setName) {
    const set = theme.color.accentSets?.[setName];
    if (!set) throw new Error(`Theme "${theme.id}" selects accent set "${setName}" which it does not ship`);
    theme.color.accent = set.hues;
    theme.color.accentOrder = set.order;
    if (set.ceiling !== undefined) theme.rules.categoricalCeiling = set.ceiling;
  }
  // Vector assets live beside the pack so the pack itself stays readable.
  const refs = [theme.chrome?.watermark?.vector, theme.chrome?.brandMark?.vector].filter(Boolean) as string[];
  if (refs.length) {
    theme.assets = {};
    for (const ref of refs) {
      const [file, key] = ref.split('#');
      const assetPath = join(dirname(path), file);
      if (!existsSync(assetPath)) throw new Error(`Theme "${theme.id}" references missing asset file "${file}"`);
      const bundle = JSON.parse(readFileSync(assetPath, 'utf8')) as Record<string, VectorAsset>;
      if (!bundle[key]) throw new Error(`Asset file "${file}" has no vector "${key}"`);
      theme.assets[ref] = bundle[key];
    }
  }
  validateTheme(theme);
  cache.set(theme.id, theme);
  return theme;
}

/**
 * Structural validation the renderer actually depends on. JSON Schema covers shape;
 * this covers referential integrity, which is what turns into a wrong-coloured node.
 */
export function validateTheme(theme: Theme): void {
  const problems: string[] = [];
  const need = (cond: unknown, msg: string) => { if (!cond) problems.push(msg); };

  need(theme.id, 'theme.id is required');
  need(theme.canvas?.width > 0, 'canvas.width must be positive');
  need(theme.canvas?.safe?.width > 0, 'canvas.safe.width must be positive');
  need(theme.canvas.safe.x + theme.canvas.safe.width <= theme.canvas.width, 'safe zone exceeds canvas width');
  need(theme.typography?.minSize > 0, 'typography.minSize must be positive');

  for (const required of ['h1', 'body', 'detail']) {
    need(theme.typography?.roles?.[required], `typography.roles.${required} is required`);
  }
  for (const [name, role] of Object.entries(theme.typography?.roles ?? {})) {
    if (role.size < theme.typography.minSize) problems.push(`role "${name}" size ${role.size} is below minSize ${theme.typography.minSize}`);
    if (!isResolvable(theme, role.color)) problems.push(`role "${name}" colour "${role.color}" does not resolve`);
  }

  const refs: Array<[string, string | undefined]> = [
    ['canvas.background', theme.canvas.background],
    ['canvas.backgroundAlt', theme.canvas.backgroundAlt],
    ['surface.panel.fill', theme.surface?.panel?.fill],
    ['surface.panel.stroke', theme.surface?.panel?.stroke],
    ['surface.header.fill', theme.surface?.header?.fill],
    ['surface.divider.color', theme.surface?.divider?.color],
    ['surface.node.fill', theme.surface?.node?.fill],
    ['surface.node.stroke', theme.surface?.node?.stroke],
    ['chart.axis.color', theme.chart?.axis?.color],
    ['chart.gridline.color', theme.chart?.gridline?.color],
    ['chart.connector.color', theme.chart?.connector?.color],
  ];
  for (const [path, ref] of refs) {
    if (ref !== undefined && !isResolvable(theme, ref)) problems.push(`${path} colour "${ref}" does not resolve`);
  }
  for (const key of theme.color?.accentOrder ?? []) {
    if (!theme.color.accent[key]) problems.push(`accentOrder references missing accent "${key}"`);
  }
  if (problems.length) throw new Error(`Invalid theme pack "${theme.id}":\n  - ${problems.join('\n  - ')}`);
}

function isResolvable(theme: Theme, ref: string): boolean {
  if (/^#[0-9A-Fa-f]{6}$/.test(ref)) return true;
  const [group, key] = ref.split('.');
  if (group === 'neutral') return Boolean(theme.color?.neutral?.[key]);
  if (group === 'accent') return Boolean(theme.color?.accent?.[key]);
  if (group === 'base') return Boolean(theme.color?.base?.[key]);
  return false;
}

/** `neutral.600` / `accent.primary` / `#RRGGBB` -> hex. Throws rather than guessing. */
export function color(theme: Theme, ref: string): string {
  if (/^#[0-9A-Fa-f]{6}$/.test(ref)) return ref.toUpperCase();
  const [group, key] = ref.split('.');
  const hex = group === 'neutral' ? theme.color.neutral[key]
    : group === 'accent' ? theme.color.accent[key]
    // Structural hues that are neither neutral nor a data accent, e.g. the flow-node slate.
    : group === 'base' ? theme.color.base?.[key]
    : undefined;
  if (!hex) throw new Error(`Theme "${theme.id}" cannot resolve colour reference "${ref}"`);
  return hex.toUpperCase();
}

export function paint(theme: Theme, ref: string, opacity?: number): SolidPaint {
  const p: SolidPaint = { color: color(theme, ref) };
  if (opacity !== undefined && opacity !== 1) p.opacity = opacity;
  return p;
}

/** Dotted-path provenance lookup with prefix fallback, mirroring how packs annotate groups. */
export function evidenceFor(theme: Theme, path: string) {
  const fields = theme.provenance?.fields ?? {};
  if (fields[path]) return fields[path];
  const segments = path.split('.');
  for (let i = segments.length - 1; i > 0; i--) {
    const prefix = segments.slice(0, i).join('.');
    if (fields[prefix]) return fields[prefix];
  }
  return fields[''] ?? theme.provenance?.default ?? { status: 'unverified' as const };
}

export function unverifiedFields(theme: Theme): string[] {
  return Object.entries(theme.provenance?.fields ?? {})
    .filter(([, e]) => e.status === 'unverified')
    .map(([k]) => k || '(whole pack)')
    .sort();
}

/** Accent tokens the pack itself authorises, in declared order. Empty is a legal, meaningful answer. */
export function accentPalette(theme: Theme): string[] {
  const order = theme.color.accentOrder?.length ? theme.color.accentOrder : Object.keys(theme.color.accent);
  return order.filter((k) => theme.color.accent[k]);
}
