/** Public contracts. Nothing here knows about Figma, MCP or any specific host. */

/* ------------------------------------------------------------------ theme */

export type Evidence = { status: 'measured' | 'declared' | 'unverified'; source?: string; note?: string };

export interface TextRole {
  size: number; weight: number; color: string;
  lineHeight?: number; letterSpacing?: number; transform?: 'none' | 'upper';
}

export interface VectorAsset { w: number; h: number; paths: Array<{ dx: number; dy: number; d: string }> }

export interface Theme {
  id: string; version: string; label?: string; locale?: string;
  /** Light or dark. The user's declaration selects the pack; the pack states which it is. */
  appearance?: 'dark' | 'light';
  /** Pack this one is the measured difference from. Resolved leaf-first by `loadTheme`. */
  extends?: string;
  /** Inheritance chain `loadTheme` actually merged, nearest parent first. */
  inherits?: string[];
  /** Vector assets loaded from the pack's sibling asset file, keyed by name. */
  assets?: Record<string, VectorAsset>;
  provenance: { default: Evidence; sources?: Array<Record<string, string>>; fields: Record<string, Evidence> };
  canvas: {
    width: number; background: string; backgroundAlt?: string;
    safe: { x: number; width: number; variants?: Array<{ id: string; x: number; width: number }> };
    overlay?: GradientPaint;
    /** Named background compositions measured from the source file, e.g. a flat cover. */
    backgroundVariants?: Record<string, { background: string; overlay?: GradientPaint | null; decoration?: boolean; brandMarkAlign?: 'center' | 'right'; brandMarkBottom?: number }>;
    heights: { mode: 'fixed' | 'auto' | 'snap'; min: number; max?: number; steps?: number[]; roundTo?: number };
  };
  typography: {
    family: string; fallbacks?: string[]; minSize: number; sizeGrid: number;
    metrics?: { latin?: number; digit?: number; space?: number; cjk?: number; punct?: number; lineHeightRatio?: number };
    roles: Record<string, TextRole>;
  };
  color: {
    neutral: Record<string, string>; accent: Record<string, string>; accentOrder?: string[];
    /** Authorised complementary duos for an opposed comparison. */
    pairs?: Array<[string, string]>;
    ramps?: { sequential?: Record<string, string[]>; diverging?: Record<string, string[]> };
    /** Selectable measured accent vocabularies. The active one becomes `color.accent`. */
    /** Structural hues that are neither neutral nor a data accent. */
    base?: Record<string, string>;
    accentSets?: Record<string, { hues: Record<string, string>; order: string[]; ceiling?: number }>;
    accentSet?: string;
    /** Neutral that carries an "Other" segment or an unhighlighted series. Never an accent. */
    tail?: string;
  };
  surface: {
    panel: { fill: string; fillOpacity: number; stroke: string; strokeWidth: number; strokeOpacity?: number; radius: number; padding: number };
    header?: { fill: string; fillOpacity?: number };
    divider: { color: string; width: number; opacity?: number };
    node?: { fill: string; fillOpacity?: number; stroke: string; strokeWidth: number; radius: number; paddingX: number; paddingY: number; gapX: number; gapY: number; minWidth: number;
      /**
       * A node the accent FILLS rather than washes: the surface becomes the label's
       * background, so its text is ink chosen against the fill, not against the canvas.
       * `tint` mixes the authorised hue toward white; the same value reads on paper and
       * on ink, which is why a tinted node needs no light-pack override.
       */
      tinted?: { tint: number; strokeOpacity?: number } };
    nodeStrokeOpacity?: number;
    /** Named surface treatments. A block names one; it never invents fills. */
    variants?: Record<string, SurfaceVariant>;
    /** Editorial table: a header band, a constant row pitch and no row rules. */
    table?: {
      variant: string; rowPitch: number; padding: number;
      headerFill: string; headerOpacity?: number;
      headerRole: string; bodyRole: string; keyColumnRole: string;
      rowRules: boolean;
    };
    /** How an authorised accent may attach to a surface. */
    accentPlacement?: {
      default: AccentPlacement;
      edge: { width: number; radius: number; inset: number };
      tint: { opacity: number };
    };
    /** Rhythm for a heading that introduces one grammar inside a stacked frame. */
    section?: {
      headingSize: number; headingWeight: number; headingColor: string;
      subtitleSize: number; subtitleColor: string;
      headingToSubtitle: number; toContent: number; betweenSections: number;
    };
    /** Editorial card: its own surface, its own type roles, and a rounded accent tab. */
    card?: {
      fill: GradientPaint | string; fillOpacity?: number;
      stroke: string; strokeWidth: number; strokeOpacity?: number; radius: number;
      paddingX: number; paddingY: number; paddingBottom: number; gap: number;
      accentRule: { width: number; radius: number; offsetX: number; overhangY: number };
      roles: { eyebrow: string; title: string; body: string; note: string };
      gaps: { eyebrow: number; title: number; note: number };
    };
  };
  chart: {
    strokeWidth: number;
    axis: { color: string; width: number; opacity?: number };
    gridline: { color: string; width: number; opacity?: number; count?: number };
    connector: { color: string; width: number; opacity?: number; arrowSize?: number; cornerRadius?: number };
    barGap: number; seriesGap: number; barRadius?: number; pointRadius?: number; donutThicknessRatio?: number;
    pointHalo?: { color: string; width: number };
    barFillFrom?: number; barFillTo?: number; barStrokeOpacity?: number;
    barHighlightFrom?: number; barHighlightTo?: number; barHighlightStroke?: number;
    areaOpacity?: number; labelTint?: number;
    /**
     * Category chips under a diagram. A coloured node group with no name is a colour the
     * reader has to guess, but a legend also takes the eye away from the graphic - so the
     * author asks for it (`legend: true`) and the pack decides how it looks.
     */
    legend?: { swatch: number; radius: number; gap: number; columnGap: number; top: number; role: string };
    /** Horizontal bar rows: label, bar, value. No axis, no gridlines. */
    editorialBar?: {
      rowPitch: number; barHeight: number; radius: number; labelGutter: number; valueGap: number;
      labelRole: string; labelColor: string; valueRole: string;
      secondaryRole: string; secondaryColor: string; segmentGap: number;
    };
    /**
     * Paired rows: one row per measure, two or three bars inside it, each printed with
     * its own value. `rowPitch` is a minimum, not a step: a row grows for its content.
     */
    pairedBar?: {
      rowPitch: number; barHeight: number; seriesGap: number; rowGap: number; radius: number;
      labelGutter: number; valueGap: number; deltaGap: number; groupGap: number; groupLead: number; legendGap: number;
      labelRole: string; labelColor: string; unitRole: string; unitColor: string;
      valueRole: string; leadRole: string; leadColor: string; deltaRole: string; deltaColor: string;
      groupRole: string; groupColor: string; legendRole: string; legendColor: string; swatch: number;
    };
  };
  chrome?: {
    titleTop?: number; contentTop?: number; bottomBand?: number; footerBaseline?: number;
    titleGap?: number; sectionGap?: number;
    /** Centred bar mark at the top of every frame. Groups are drawn left to right. */
    topMark?: {
      y: number; height: number; width: number; color: string;
      groupOffsets: number[]; groupOpacity: number[];
  /** Width of the clip window each group is drawn inside, in the source file. */
  clipWidth?: number;
      barOffsets: number[]; barWidths: number[];
    };
    titleBlock?: { x: number; width: number; y: number; align: 'left' | 'center' | 'right'; gap: number };
    /** Full-bleed wordmark behind the content: a dot mark plus the brand name. */
    watermark?: {
      text?: string; required?: boolean; nodeName?: string; preserve?: boolean;
      width?: number; height?: number; color?: string; opacity?: number;
      markSize?: number; markPitch?: number; markGap?: number;
      /** `file.json#key` naming a vector asset beside the pack. Preferred over the text stand-in. */
      vector?: string;
      /** Per-glyph fill. The source ramps each glyph across its own box. */
      gradient?: GradientPaint;
      /** Anchor to the decoration layer instead of the frame, at this offset inside it. */
      anchor?: 'frame' | 'decoration';
      anchorOffsetY?: number;
    };
    /** Small signed mark pinned to the bottom-right corner. */
    brandMark?: {
      text: string; width: number; height: number; right: number; bottom: number;
      dotSize: number; dotPitch: number; gap: number; color: string;
      vector?: string;
      align?: 'center' | 'right';
    };
    footer?: {
      x: number; height: number; bottomGap: number;
      tickWidth: number; tick: GradientPaint;
      labelRole: string; labelDx: number; valueRole: string; valueDx: number;
      columnGap: number;
    };
    /** Decorative corner glows: four quadrant blobs on an oversized layer centred on the frame. */
    decoration?: {
      layerHeight: number; blobSize: number; inset: number;
      fill: GradientPaint;
      /** Per-corner gradient angle in TL, TR, BL, BR order. The source rotates the node, not the fill. */
      angles?: [number, number, number, number];
    };
    guideLayerNames?: string[];
    frameGuide?: { fileKey?: string; pageNodeId?: string; contractNodeId?: string; nodeNames?: string[] };
  };
  rules: {
    singleWriter: boolean; cloneChromeNeverRebuild?: boolean; bindTokensNeverRawHex?: boolean;
    deleteEmptyFields?: boolean; preserveInputFactsExactly: boolean; noInventedAccents: boolean;
    vectorStrokesOnly: boolean; targetDensity?: number; maxDensity?: number;
    /** Most distinct hues the pack allows in one categorical view. */
    categoricalCeiling?: number;
    defaultColorMode?: string;
  };
}

/* ------------------------------------------------------------------ input */

import type { ColorMode } from './palette.js';

export const TEMPLATE_IDS = [
  'table', 'bar', 'line', 'scatter', 'waterfall', 'donut', 'loop', 'timeline', 'process',
  'flowchart', 'architecture', 'data-flow', 'deployment', 'dependency', 'tree',
  'sequence', 'swimlane', 'layers', 'quadrant', 'sankey',
  // Free composition. Not a chart: the agent supplies the blocks.
  'area', 'combo',
  // Editorial grammars from the diagram-design taxonomy.
  'state', 'er', 'uml-class', 'db-schema', 'nested', 'org-chart', 'venn', 'pyramid', 'funnel',
  'treemap', 'gantt', 'radar', 'polar', 'fishbone', 'wardley', 'kanban', 'story-map', 'journey',
  'high-level', 'medallion', 'dp-integration', 'it-state', 'matrix',
  'compose',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const INTENTS = [
  'auto', 'compare', 'trend', 'distribution', 'composition', 'cycle', 'timeline', 'process',
  'flow', 'architecture', 'pipeline', 'deployment', 'dependency', 'hierarchy',
  'interaction', 'handoff', 'layering', 'positioning', 'quantity-flow', 'table',
  'stacked', 'trend-with-average',
  'lifecycle', 'entities', 'containment', 'ownership', 'overlap', 'ranked-tiers', 'drop-off',
  'area-share', 'schedule', 'multi-axis', 'cyclic', 'causes', 'evolution', 'work-state',
  'backbone', 'experience', 'landscape', 'tiering', 'permissions',
] as const;
export type Intent = (typeof INTENTS)[number];

export interface DiagramNode {
  id: string; label: string; kind?: string; group?: string; lane?: string; value?: number; note?: string;
  /** Entity fields, for ER / UML / schema grammars. */
  fields?: Array<{ name: string; type?: string; key?: string }>;
  /** Lifecycle or modernization status, for current-state landscapes. */
  status?: string;
  /** Normalised 0..1 placement, for maps that position rather than rank. */
  x?: number; y?: number;
}
export interface DiagramEdge { from: string; to: string; label?: string; style?: 'solid' | 'dashed' | 'bidirectional'; value?: number }
export interface Diagram { nodes?: DiagramNode[]; edges?: DiagramEdge[]; groups?: Array<{ id: string; label: string }> }

export interface FPInput {
  title: string; subtitle?: string; source?: string; dateAsOf?: string; note?: string;
  locale?: string;
  theme?: string;
  template?: TemplateId | 'auto';
  intent?: Intent;
  safeVariant?: string;
  /** Named background composition from the pack. */
  background?: string;
  /** How the pack's palette should be applied. `auto` derives it from the data shape. */
  /** Style axis inside the chosen grammar, e.g. `editorial` for bar. */
  chartStyle?: string;
  /** Which measured accent vocabulary this run draws from. */
  accentSet?: string;
  colorMode?: ColorMode;
  /** Named ramp for `sequential` / `diverging`. */
  ramp?: string;
  /** Accent assignments the brief authorises. Key = row id or series name, value = accent token or hex. */
  accents?: Record<string, string>;
  highlightIds?: string[];
  content?: unknown;
  /** Free composition. When present it replaces template routing entirely. */
  blocks?: Block[];
  /** Per-run type overrides. The pack minimum still applies. */
  style?: { roles?: Record<string, Partial<TextRole>> };
  /** Researched design direction. Recorded, checked and carried into the program. */
  direction?: Direction;
  diagram?: Diagram;
  options?: {
    strictFidelity?: boolean; allowTemplateSplit?: boolean; targetDensity?: number;
    /** Column order / axis field hints. Everything is inferred when omitted. */
    fields?: {
      category?: string; value?: string; series?: string; x?: string; y?: string;
      columns?: string[]; line?: string; unit?: string; delta?: string; group?: string;
    };
    maxHeight?: number;
  };
}

/* ---------------------------------------------------------------- fp-ir/1 */

/** Where an authorised accent is allowed to land on a surface. */
export type AccentPlacement = 'none' | 'edge' | 'tint' | 'text' | 'fill';

export interface SurfaceVariant {
  fill?: GradientPaint | string; fillOpacity?: number;
  stroke?: string; strokeWidth?: number; strokeOpacity?: number;
  radius?: number; padding?: number; paddingBottom?: number;
  /** Type roles a card uses inside this surface, so a variant is a whole treatment. */
  roles?: { eyebrow: string; title: string; body: string; note: string };
  gaps?: { eyebrow: number; title: number; note: number };
  uppercaseEyebrow?: boolean;
}

export interface Row { id?: string; [k: string]: unknown }

/* ---------------------------------------------------------------- direction */

export interface DirectionReference {
  /** Where it came from: a URL, a file, a frame id. A brand name is not a source. */
  source: string;
  /** When it was actually looked at. Absent means unverified. */
  observedAt?: string;
  /** What was seen. Not what it is famous for. */
  observation?: string;
  /** What must change for it to become ours. */
  transform?: string;
}

export interface Direction {
  statement: string;
  references?: DirectionReference[];
  /** Each decision names a pack surface it moves and, ideally, the reference behind it. */
  decisions?: Array<{ target: string; value: string; from?: string }>;
}

/* ------------------------------------------------------------- composition */

export interface Card { id?: string; eyebrow?: string; title: string; body?: string; note?: string; accent?: string }

/** A stage column: a titled actor with grouped field rows, as used in handoff diagrams. */
export interface StageGroup { label?: string; rows?: Array<{ label: string; value?: string; accent?: string }>; text?: string[] }
export interface Stage { id?: string; title: string; subtitle?: string; accent?: string; groups: StageGroup[] }
export interface StageConnector { badge: string; title?: string; note?: string }

interface BlockBase { gapBefore?: number; name?: string }

export type Block =
  | (BlockBase & { kind: 'text'; text: string; role?: string; align?: 'left' | 'center' | 'right'; color?: string; size?: number })
  | (BlockBase & { kind: 'columns'; gap?: number; columns: Array<{ span?: number; blocks: Block[] }> })
  | (BlockBase & { kind: 'cards'; items: Card[]; columns?: number; gap?: number; padding?: number; accentRule?: number; variant?: string; accentPlacement?: AccentPlacement })
  | (BlockBase & { kind: 'panel'; blocks: Block[]; tone?: 'base' | 'quiet'; accent?: string; padding?: number; variant?: string; accentPlacement?: AccentPlacement })
  | (BlockBase & { kind: 'kpi'; items: Array<{ value: string; label: string; note?: string; accent?: string }>; gap?: number })
  | (BlockBase & { kind: 'steps'; items: Array<{ eyebrow?: string; title: string; body?: string; accent?: string }>; direction?: 'vertical' | 'horizontal'; gap?: number })
  | (BlockBase & {
      kind: 'chart'; template: TemplateId; style?: string; title?: string; height?: number;
      /** Name the coloured node categories under a diagram. Off unless the author asks. */
      legend?: boolean;
      rows?: Row[]; diagram?: Diagram;
      /**
       * Which column plays which part. `columns` names the series a multi-series
       * grammar draws, in drawing order; `unit`, `delta` and `group` are printed as
       * copy, never as geometry.
       */
      fields?: {
        category?: string; value?: string; line?: string; columns?: string[];
        unit?: string; delta?: string; group?: string;
      };
      /** Paired rows: one scale per row (mixed units) or one for the block. */
      scale?: 'row' | 'shared';
    })
  | (BlockBase & { kind: 'stages'; items: Stage[]; connectors?: StageConnector[]; gap?: number })
  | (BlockBase & { kind: 'section'; heading: string; subtitle?: string; blocks: Block[] })
  | (BlockBase & {
      kind: 'table'; rows: Row[]; columns?: string[]; keyColumn?: string;
      /** Row id -> accent key. An accent must still be authorised by the pack. */
      accents?: Record<string, string>;
      accentPlacement?: AccentPlacement;
      align?: Record<string, 'left' | 'right'>;
      variant?: string; rowPitch?: number;
    })
  | (BlockBase & { kind: 'divider' })
  | (BlockBase & { kind: 'spacer'; height: number });

export interface FPIR {
  version: 'fp-ir/1';
  document: {
    title: string; subtitle?: string; source?: string; dateAsOf?: string; note?: string; locale: string;
  };
  data: {
    kind: 'rows' | 'text' | 'graph' | 'blocks';
    blocks?: Block[];
    rows: Row[];
    columns: string[];
    numericColumns: string[];
    graph?: Diagram;
    text?: string;
  };
  visual: {
    template: TemplateId; themeId: string; safeVariant: string;
    /** Style axis within a grammar, e.g. an editorial bar instead of a cartesian one. */
    style?: string; background?: string;
    accents: Record<string, string>; highlightIds: string[]; density: number;
    colorMode: string; colorRationale: string; colorWarnings: string[]; seriesKeys: string[];
    fields?: {
      category?: string; value?: string; series?: string; x?: string; y?: string;
      columns?: string[]; line?: string; unit?: string; delta?: string; group?: string;
    };
    /** Paired rows: one scale per row (mixed units) or one for the whole block. */
    scale?: 'row' | 'shared';
    /** Name the coloured node categories under a diagram; the author asks for it. */
    legend?: boolean;
  };
  fidelity: { immutableFacts: string[]; checksum: string; rowCount: number };
}

/* -------------------------------------------------------------- fp-plan/1 */

export interface SolidPaint { color: string; opacity?: number }
export interface GradientStop { pos: number; color: string; alpha?: number }
/** `angle` is degrees clockwise from the +x axis, so 0 is left-to-right. */
/**
 * `angle` is degrees clockwise from the +x axis. `transform` is the design tool's own
 * 2x3 gradient matrix and wins when present, so a measured gradient is reproduced exactly
 * instead of being approximated by an angle.
 */
export interface GradientPaint {
  gradient: 'linear' | 'radial'; angle?: number; stops: GradientStop[]; opacity?: number;
  transform?: [[number, number, number], [number, number, number]];
}
export type Paint = SolidPaint | GradientPaint;

export function isGradient(paint: Paint): paint is GradientPaint {
  return 'gradient' in paint;
}

/** Chrome is frame furniture (background, mark, title block, watermark, footer) and is
 *  positioned from the frame edges, so the content safe zone does not apply to it. */
export type Zone = 'content' | 'chrome';

export interface OpRect {
  op: 'rect'; name?: string; zone?: Zone; x: number; y: number; w: number; h: number;
  fill?: Paint; stroke?: Paint; strokeWidth?: number; radius?: number;
  /** Which corners the radius applies to. A header band rounds only 'top'. */
  corners?: 'all' | 'top' | 'bottom';
}
export interface OpText {
  op: 'text'; name?: string; zone?: Zone; x: number; y: number; w: number; h: number;
  text: string; role: string; size: number; weight: number; color: SolidPaint;
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom';
  lineHeight: number; letterSpacing?: number; maxLines?: number; lines: string[];
  /** Degrees clockwise about the block's own left baseline. Used for crowded axis labels. */
  rotate?: number;
  /** The string as supplied, before wrapping or case transform. The fidelity audit reads this. */
  source: string;
}
export interface OpLine {
  op: 'line'; name?: string; points: Array<[number, number]>;
  stroke: SolidPaint; strokeWidth: number; dash?: number[];
  arrowStart?: boolean; arrowEnd?: boolean; cornerRadius?: number;
}
export interface OpPolygon { op: 'polygon'; name?: string; points: Array<[number, number]>; fill?: Paint; stroke?: Paint; strokeWidth?: number }
export interface OpArc {
  op: 'arc'; name?: string; cx: number; cy: number; rOuter: number; rInner: number;
  startAngle: number; endAngle: number; fill: Paint;
}
export interface OpEllipse { op: 'ellipse'; name?: string; cx: number; cy: number; rx: number; ry: number; fill?: Paint; stroke?: Paint; strokeWidth?: number }
/** A real vector path from a pack asset. `x`/`y`/`scale` place it; the data is untouched. */
export interface OpPath {
  op: 'path'; name?: string; zone?: Zone; d: string;
  x: number; y: number; scale: number;
  fill?: Paint; stroke?: Paint; strokeWidth?: number;
}

export interface OpGroup { op: 'group'; name: string; zone?: Zone; children: Op[] }

export type Op = OpRect | OpText | OpLine | OpPolygon | OpArc | OpEllipse | OpPath | OpGroup;

export interface RenderProgram {
  version: 'fp-plan/1';
  theme: { id: string; version: string; appearance: 'dark' | 'light'; family: string; fallbacks: string[]; labelColor: string };
  frame: { name: string; width: number; height: number; background: Paint };
  safe: { x: number; width: number };
  template: TemplateId;
  ops: Op[];
  meta: {
    density: number; checksum: string; rowCount: number;
    warnings: string[];
    /** Values carried by geometry (bar height, point position) rather than by copy. */
    encodedValues: string[];
    /** Statement plus verified-reference count, so a frame stays traceable to its research. */
    direction?: { statement: string; verifiedReferences: number; decisions: number };
    unverifiedThemeFields: string[];
    splitSuggested: boolean;
  };
}

export interface AuditFinding { severity: 'fail' | 'warn'; rule: string; detail: string }
export interface AuditResult { ok: boolean; findings: AuditFinding[] }
