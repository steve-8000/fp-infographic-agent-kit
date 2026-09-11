import type { Block, Diagram, FPInput, Row, TemplateId, Theme } from './types.js';

/**
 * Stage 1 of the production pipeline: read the request before designing anything.
 *
 * This is deterministic analysis, not taste. It reports what the content actually is,
 * which grammars the shape admits and what each one costs, and what still has to be
 * decided. It also writes the search brief for stage 2 — the references are found on the
 * open web by the agent, not in this repository. Nothing here chooses; it narrows.
 */

export interface Reading {
  rows: number;
  columns: string[];
  numericColumns: string[];
  nodes: number;
  edges: number;
  /** Rows carry an intrinsic order (dates, versions, stages). */
  ordered: boolean;
  /** A signed measure that crosses zero: above/below a baseline. */
  diverging: boolean;
  /** Several measures per row, so a single chart would hide most of them. */
  multiMeasure: boolean;
  /** Long prose fields, which push toward editorial cards rather than a chart. */
  narrative: boolean;
  /** Rough cell/node pressure on the editorial 1..10 scale. */
  density: number;
  notes: string[];
}

export interface LayoutCandidate {
  shape: string;
  grammar: TemplateId;
  why: string;
  cost: string;
  /** A starting skeleton the author edits; never rendered without review. */
  blocks?: Block[];
}

export interface Brief {
  question: string;
  reading: Reading;
  candidates: LayoutCandidate[];
  /** Stage 2: run these against the open web, then record what was actually observed. */
  researchQueries: string[];
  /** Stage 3 must settle these before the frame is buildable. */
  openDecisions: string[];
}

const ORDER_HINT = /\b(date|month|year|quarter|period|stage|step|phase|version|시기|연도|월|단계)\b/i;
const NARRATIVE_MIN = 80;

function readRows(rows: Row[], diagram: Diagram | undefined): Reading {
  const columns: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
  const numericColumns = columns.filter((c) =>
    rows.some((r) => typeof r[c] === 'number') &&
    rows.every((r) => r[c] === undefined || r[c] === null || typeof r[c] === 'number'));

  const values = numericColumns.flatMap((c) => rows.map((r) => r[c]).filter((v): v is number => typeof v === 'number'));
  const notes: string[] = [];

  const ordered = columns.some((c) => ORDER_HINT.test(c))
    || rows.every((r) => typeof r.id === 'string' && /^\d{4}([-/]\d{2})?/.test(r.id));
  const diverging = values.some((v) => v < 0) && values.some((v) => v > 0);
  const multiMeasure = numericColumns.length > 1;
  const narrative = rows.some((r) => Object.values(r).some((v) => typeof v === 'string' && v.length >= NARRATIVE_MIN));

  if (numericColumns.length && rows.length > 18) notes.push(`${rows.length} rows exceeds a comfortable single view; consider a top-N plus a remainder row`);
  if (columns.length > 8) notes.push(`${columns.length} columns is past table legibility; split by theme or drop derived columns`);
  if (!numericColumns.length && rows.length) notes.push('no numeric column: this is a matrix or an editorial set, not a chart');
  if (diverging) notes.push('values cross zero, so a baseline and a diverging treatment carry the meaning');

  const nodes = diagram?.nodes?.length ?? 0;
  const edges = diagram?.edges?.length ?? 0;
  const density = nodes
    ? Math.min(10, Math.round((nodes / 3 + edges / 5) * 10) / 10)
    : Math.min(10, Math.round((rows.length * Math.max(1, columns.length) / 18) * 10) / 10);

  return { rows: rows.length, columns, numericColumns, nodes, edges, ordered, diverging, multiMeasure, narrative, density, notes };
}

function cardSkeleton(rows: Row[], columns: string[]): Block[] {
  const title = columns.find((c) => c !== 'id') ?? 'id';
  const body = columns.find((c) => c !== 'id' && c !== title);
  return [{
    kind: 'cards',
    columns: rows.length <= 4 ? 2 : 3,
    items: rows.slice(0, 6).map((r) => ({
      id: String(r.id ?? r[title]),
      title: String(r[title] ?? ''),
      body: body ? String(r[body] ?? '') : undefined,
    })),
  }];
}

function candidatesFor(reading: Reading, rows: Row[], diagram: Diagram | undefined): LayoutCandidate[] {
  const out: LayoutCandidate[] = [];

  if (reading.nodes) {
    const lanes = diagram?.nodes?.some((n) => n.lane);
    const valued = diagram?.edges?.some((e) => typeof e.value === 'number');
    if (valued) out.push({ shape: 'quantity flow', grammar: 'sankey', why: 'edges carry real amounts, so width can encode them honestly', cost: 'unreadable past about five stages' });
    if (lanes) out.push({ shape: 'ownership lanes', grammar: 'swimlane', why: 'the story is who hands off to whom', cost: 'wastes width when most lanes are idle' });
    out.push({ shape: 'layered graph', grammar: reading.edges > reading.nodes ? 'dependency' : 'flowchart', why: 'structure and direction are the message', cost: 'a dense graph reads slower than a table of the same facts' });
    if (reading.nodes <= 4) {
      out.push({ shape: 'stage columns', grammar: 'compose', why: 'each actor can carry its own field rows, which a node box cannot', cost: 'only works for a short linear handoff',
        blocks: [{ kind: 'stages', items: (diagram?.nodes ?? []).slice(0, 4).map((n) => ({ id: n.id, title: n.label, subtitle: n.note, groups: [] })),
          connectors: (diagram?.edges ?? []).slice(0, 3).map((e, i) => ({ badge: String(i + 1), title: e.label })) }] });
    }
    out.push({ shape: 'stepped cards', grammar: 'compose', why: 'if the reader only needs the sequence, cards beat a diagram', cost: 'loses branching and exact topology', blocks: [{ kind: 'steps', items: (diagram?.nodes ?? []).slice(0, 6).map((n) => ({ title: n.label, body: n.note })) }] });
    return out;
  }

  if (reading.narrative || !reading.numericColumns.length) {
    out.push({ shape: 'editorial cards', grammar: 'compose', why: 'the claims are the content; a chart would only decorate them', cost: 'no comparison is possible between cards', blocks: cardSkeleton(rows, reading.columns) });
    out.push({ shape: 'exact matrix', grammar: 'table', why: 'keeps every field addressable and comparable', cost: 'reads as reference material, not as an argument' });
    return out;
  }

  if (reading.ordered) {
    out.push({ shape: 'trend', grammar: 'line', why: 'the movement over the sequence is the point', cost: 'hides the individual values unless they are labelled' });
    out.push({ shape: 'milestones', grammar: 'timeline', why: 'discrete events rather than a continuous measure', cost: 'no magnitude comparison' });
    if (reading.multiMeasure) {
      out.push({ shape: 'stacked volume', grammar: 'area', why: 'the total and its composition move together', cost: 'only the bottom band is easy to read precisely' });
      out.push({ shape: 'volume plus average', grammar: 'combo', why: 'stacked bars carry the parts while an overlay line carries the trend', cost: 'needs one column nominated as the line via options.fields.line' });
    }
  }
  if (reading.diverging) {
    out.push({ shape: 'signed contributions', grammar: 'waterfall', why: 'shows how the total was reached, not just where it ended', cost: 'needs a meaningful running order' });
  }
  if (reading.multiMeasure) {
    out.push({ shape: 'two-axis position', grammar: 'quadrant', why: 'two real measures place each item against both at once', cost: 'the axes must be genuinely independent' });
    out.push({ shape: 'exact matrix', grammar: 'table', why: 'more than one measure per row usually belongs in a table', cost: 'no shape to scan' });
  } else {
    out.push({ shape: 'ranking', grammar: 'bar', why: 'one measure across categories compares directly', cost: `${reading.rows} bars is a lot of ink for ${reading.rows} numbers` });
    if (reading.rows <= 6) out.push({ shape: 'part to whole', grammar: 'donut', why: 'the shares add to a meaningful total', cost: 'only if they really do sum to the whole' });
  }
  out.push({ shape: 'lede plus chart', grammar: 'compose', why: 'state the finding in words, then evidence it', cost: 'costs vertical space the chart could use',
    blocks: [
      { kind: 'text', role: 'h2', text: 'State the finding here, in one sentence.' },
      { kind: 'chart', gapBefore: 32, template: reading.multiMeasure ? 'table' : 'bar', rows },
    ] });
  return out;
}

export function buildBrief(input: FPInput, theme: Theme): Brief {
  const rows = Array.isArray(input.content)
    ? (input.content as Row[])
    : input.content && typeof input.content === 'object' ? [input.content as Row] : [];
  const reading = readRows(rows, input.diagram);
  const candidates = candidatesFor(reading, rows, input.diagram);

  const subject = input.title.trim();
  const researchQueries = [
    `${subject} infographic`,
    `${subject} chart design`,
    reading.nodes ? `${subject} architecture diagram` : `${subject} data visualization`,
    `${candidates[0]?.shape ?? 'editorial'} layout editorial design`,
    'annual report data visualization dark theme',
  ];

  const openDecisions: string[] = [
    'which single question the frame answers',
    'which of the candidate shapes carries that question',
  ];
  if (reading.density > (theme.rules.maxDensity ?? 6)) {
    openDecisions.push(`density is ${reading.density}; decide the overview/detail split before building`);
  }
  if (reading.numericColumns.length) {
    openDecisions.push('whether colour encodes a ranking, a comparison or a single highlight');
  }
  if (reading.narrative) openDecisions.push('how far the prose may be tightened without changing meaning');

  return {
    question: `What should a reader conclude from "${subject}"?`,
    reading, candidates, researchQueries, openDecisions,
  };
}
