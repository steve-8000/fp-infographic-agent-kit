import { createHash } from 'node:crypto';
import type { Diagram, FPInput, FPIR, Intent, Row, TemplateId, Theme } from './types.js';
import { TEMPLATE_IDS } from './types.js';
import { choosePalette, type ColorMode } from './palette.js';
import { collectAccentKeys, collectText } from './blocks.js';

/** Semantic job -> visual grammar. Geometry never decides; meaning does. */
const TEMPLATE_BY_INTENT: Record<Exclude<Intent, 'auto'>, TemplateId> = {
  compare: 'bar', trend: 'line', distribution: 'scatter', composition: 'donut',
  cycle: 'loop', timeline: 'timeline', process: 'process', flow: 'flowchart',
  architecture: 'architecture', pipeline: 'data-flow', deployment: 'deployment',
  dependency: 'dependency', hierarchy: 'tree', interaction: 'sequence',
  handoff: 'swimlane', layering: 'layers', positioning: 'quadrant',
  'quantity-flow': 'sankey', table: 'table',
  stacked: 'area', 'trend-with-average': 'combo',
  lifecycle: 'state', entities: 'er', containment: 'nested', ownership: 'org-chart',
  overlap: 'venn', 'ranked-tiers': 'pyramid', 'drop-off': 'funnel', 'area-share': 'treemap',
  schedule: 'gantt', 'multi-axis': 'radar', cyclic: 'polar', causes: 'fishbone',
  evolution: 'wardley', 'work-state': 'kanban', backbone: 'story-map', experience: 'journey',
  landscape: 'it-state', tiering: 'medallion', permissions: 'matrix',
};

/**
 * Default colour pattern per grammar, following the pack's "pick by occasion" table.
 *
 * The guide is explicit that a rainbow on ordered data and a categorical set on a ranking
 * are both wrong, and that flow nodes stay on the slate base with point colours used
 * sparingly. So the default is deliberately restrained; a brief can always override it.
 */
function defaultColorMode(template: TemplateId, keyCount: number): ColorMode {
  if (!keyCount) return 'none';
  switch (template) {
    // Ranked magnitude: one hue, dim to bright.
    case 'bar': case 'waterfall':
      return keyCount >= 3 ? 'sequential' : 'pair';
    // Unordered groups.
    case 'donut': case 'line': case 'scatter': case 'quadrant':
      return keyCount === 1 ? 'mono' : keyCount === 2 ? 'pair' : 'categorical';
    // Hue carries the order.
    case 'timeline': case 'process': case 'loop': case 'layers': case 'sankey':
    case 'pyramid': case 'funnel': case 'journey': case 'medallion':
      return 'ordered';
    case 'treemap': case 'radar': case 'polar': case 'venn': case 'kanban':
      return keyCount === 1 ? 'mono' : keyCount === 2 ? 'pair' : 'categorical';
    case 'gantt':
      return 'sequential';
    // The contract puts flow nodes on a slate base with point-colour highlights. For a
    // structure diagram a key exists only where the nodes declare a group or a kind, so a
    // distinction the author actually stated earns a hue and an undifferentiated diagram
    // stays slate. Colour arrives by rule here rather than by the author remembering.
    default:
      return keyCount === 1 ? 'mono' : keyCount === 2 ? 'pair' : 'categorical';
  }
}

/**
 * The keys a palette is assigned to. For a chart that is the series or the category
 * column; for a diagram it is the nodes. Highlight ids win outright so a single-highlight
 * brief never accidentally colours the whole set.
 */
function paletteKeys(input: FPInput, rows: Row[], columns: string[], numericColumns: string[], template: TemplateId): string[] {
  if (input.highlightIds?.length) return [...input.highlightIds];
  if (isGraphTemplate(template)) {
    // Every node id would ask the palette for a hue per box, which is a rainbow, so the
    // keys are the distinctions the author actually declared. None declared, none spent.
    const nodes = input.diagram?.nodes ?? [];
    const distinct = (pick: (n: typeof nodes[number]) => string | undefined) =>
      [...new Set(nodes.map(pick).filter((v): v is string => Boolean(v)))];
    const groups = distinct((n) => n.group);
    if (groups.length > 1) return groups;
    const kinds = distinct((n) => n.kind);
    return kinds.length > 1 ? kinds : [];
  }
  // Only a line chart turns numeric columns into series; a scatter's two columns are axes.
  if (template === 'line' && numericColumns.length > 1) return numericColumns;
  const category = input.options?.fields?.category
    ?? columns.find((c) => c !== 'id' && !numericColumns.includes(c));
  return rows.map((r, i) => String(r.id ?? (category ? r[category] : undefined) ?? i));
}

const GRAPH_TEMPLATES: Record<string, true> = {
  flowchart: true, architecture: true, 'data-flow': true, deployment: true,
  dependency: true, tree: true, sequence: true, swimlane: true, layers: true,
  loop: true, process: true, sankey: true,
  state: true, er: true, 'uml-class': true, 'db-schema': true, nested: true,
  'org-chart': true, venn: true, pyramid: true, funnel: true, fishbone: true,
  wardley: true, kanban: true, 'story-map': true, 'high-level': true,
  medallion: true, 'dp-integration': true, 'it-state': true,
};

export function isGraphTemplate(id: TemplateId): boolean {
  return GRAPH_TEMPLATES[id] === true;
}

function toRows(content: unknown): { rows: Row[]; text?: string } {
  if (Array.isArray(content)) {
    return { rows: content.map((r) => (r && typeof r === 'object' ? (r as Row) : { value: r })) };
  }
  if (content && typeof content === 'object') {
    const entries = Object.entries(content as Record<string, unknown>);
    // A flat object of scalars is a one-column series, not a single row.
    const scalar = entries.every(([, v]) => v === null || typeof v !== 'object');
    if (scalar) return { rows: entries.map(([k, v]) => ({ id: k, name: k, value: v })) };
    return { rows: [content as Row] };
  }
  return { rows: [], text: content === undefined || content === null ? '' : String(content) };
}

function collectColumns(rows: Row[]): string[] {
  const ordered: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

/** Facts are flattened leaf paths. Any change to this set between stages fails the run. */
function flattenFacts(value: unknown, path = '$', out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') {
    out.push(`${path}=${typeof value === 'string' ? value : String(value)}`);
    return out;
  }
  if (Array.isArray(value)) value.forEach((v, i) => flattenFacts(v, `${path}[${i}]`, out));
  else for (const [k, v] of Object.entries(value as Record<string, unknown>)) flattenFacts(v, `${path}.${k}`, out);
  return out;
}

export function selectTemplate(input: FPInput, rows: Row[], numericColumns: string[], diagram?: Diagram): TemplateId {
  if (input.template && input.template !== 'auto') {
    if (!(TEMPLATE_IDS as readonly string[]).includes(input.template)) throw new Error(`Unsupported template "${input.template}"`);
    return input.template;
  }
  if (input.intent && input.intent !== 'auto') return TEMPLATE_BY_INTENT[input.intent];

  if (diagram?.nodes?.length) {
    if (diagram.nodes.some((n) => n.lane)) return 'swimlane';
    if (diagram.edges?.some((e) => typeof e.value === 'number')) return 'sankey';
    const hasCycle = Boolean(diagram.edges?.length) && diagram.edges!.length >= diagram.nodes.length;
    return hasCycle ? 'dependency' : 'flowchart';
  }
  // A matrix wider than one measure is a table; a single measure is a comparison.
  if (rows.length && numericColumns.length === 1) return rows.length > 14 ? 'table' : 'bar';
  return 'table';
}

/** Density is a content-pressure estimate on the editorial 1..10 scale, not a style knob. */
function estimateDensity(rows: Row[], columns: string[], diagram: Diagram | undefined, template: TemplateId): number {
  if (isGraphTemplate(template) && diagram?.nodes?.length) {
    const nodes = diagram.nodes.length, edges = diagram.edges?.length ?? 0;
    return Math.min(10, Math.round((nodes / 3 + edges / 5) * 10) / 10);
  }
  // A long single-measure series is one shape, not many facts competing for attention.
  const measures = Math.max(1, columns.filter((c) => c !== 'id').length - 1);
  const seriesLike = template === 'line' || template === 'area' || template === 'combo'
    || (template === 'bar' && measures <= 1);
  const cells = seriesLike ? rows.length * measures / 6 : rows.length * Math.max(1, columns.length);
  return Math.min(10, Math.round((cells / 18) * 10) / 10);
}

export function normalize(input: FPInput, theme: Theme): FPIR {
  if (!input.title?.trim()) throw new Error('title is required');
  if (!input.blocks?.length && input.content === undefined) throw new Error('either content or blocks is required');

  const composed = Boolean(input.blocks?.length);
  const { rows, text } = toRows(input.content ?? []);
  const columns = collectColumns(rows);
  const numericColumns = columns.filter(
    (c) => rows.length > 0 && rows.every((r) => r[c] === undefined || r[c] === null || typeof r[c] === 'number'),
  ).filter((c) => rows.some((r) => typeof r[c] === 'number'));

  const template = composed ? 'compose' : selectTemplate(input, rows, numericColumns, input.diagram);

  // Colour is chosen under the pack's constraints, never invented. An explicit brief wins;
  // otherwise the data shape selects a pattern and the pack supplies the hues.
  const accents: Record<string, string> = {};
  for (const [key, ref] of Object.entries(input.accents ?? {})) {
    const token = ref.replace(/^accent\./, '');
    const ok = /^#[0-9A-Fa-f]{6}$/.test(ref) || theme.color.accent[token];
    if (!ok) throw new Error(`Accent "${ref}" for "${key}" is neither a hex value nor an accent token of theme "${theme.id}"`);
    accents[key] = /^#/.test(ref) ? ref.toUpperCase() : `accent.${token}`;
  }

  const seriesKeys = composed ? collectAccentKeys(input.blocks!) : paletteKeys(input, rows, columns, numericColumns, template);
  const explicit = Object.keys(accents);
  const remaining = seriesKeys.filter((k) => !accents[k]);
  const requested: ColorMode = input.colorMode
    ?? (explicit.length && !input.highlightIds?.length ? 'none'
      : input.highlightIds?.length ? 'mono'
      // Composed frames get no automatic palette: the author decides where colour goes.
      : composed ? 'none' : defaultColorMode(template, remaining.length));
  const choice = choosePalette(theme, remaining, requested, { ramp: input.ramp });
  Object.assign(accents, choice.assignment);

  if (input.background && !theme.canvas.backgroundVariants?.[input.background]) {
    throw new Error(`Theme "${theme.id}" has no background variant "${input.background}"`);
  }
  const safeVariant = input.safeVariant ?? 'default';
  if (!theme.canvas.safe.variants?.some((v) => v.id === safeVariant) && safeVariant !== 'default') {
    throw new Error(`Theme "${theme.id}" has no safe-zone variant "${safeVariant}"`);
  }

  return {
    version: 'fp-ir/1',
    document: {
      title: input.title, subtitle: input.subtitle, source: input.source,
      dateAsOf: input.dateAsOf, note: input.note, locale: input.locale ?? theme.locale ?? 'ko-KR',
    },
    data: {
      kind: composed ? 'blocks' : input.diagram?.nodes?.length ? 'graph' : rows.length ? 'rows' : 'text',
      blocks: input.blocks, rows, columns, numericColumns, graph: input.diagram, text,
    },
    visual: {
      template, themeId: theme.id, safeVariant, background: input.background,
      accents, highlightIds: input.highlightIds ?? [],
      density: input.options?.targetDensity ?? estimateDensity(rows, columns, input.diagram, template),
      style: input.chartStyle,
      colorMode: choice.mode, colorRationale: choice.rationale, colorWarnings: choice.warnings, seriesKeys,
      fields: input.options?.fields,
    },
    fidelity: {
      // A composed frame's facts are the copy it renders, not its structural keys. Data
      // passed as `content` alongside blocks still counts: declaring it and then not
      // rendering it is dropped data, which is exactly what this audit exists to catch.
      immutableFacts: composed
        ? [
            ...collectText(input.blocks!).map((t, i) => `$.block[${i}]=${t}`),
            ...(input.content === undefined ? [] : flattenFacts(input.content)),
          ]
        : flattenFacts(input.content),
      checksum: createHash('sha256').update(JSON.stringify(composed ? input.blocks : input.content ?? null)).digest('hex'),
      rowCount: rows.length,
    },
  };
}
