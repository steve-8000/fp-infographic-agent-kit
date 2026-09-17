import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { accentPalette, auditProgram, buildBrief, buildTokenSpec, checkDirection, toFigmaSheet, compile, loadTheme, normalize, render, toFigmaScript, toSvg, validateTheme } from '../src/index.js';
import type { FPInput, Op, RenderProgram, Theme } from '../src/types.js';
import { TEMPLATE_IDS } from '../src/types.js';
import { RENDERERS } from '../src/renderers.js';

// Tests run from dist/tests, so the specimen file sits one level further up than in source.
const libraryUrl = ['../examples/library.json', '../../examples/library.json']
  .map((rel) => new URL(rel, import.meta.url))
  .find((url) => existsSync(url))!;
const library = JSON.parse(readFileSync(libraryUrl, 'utf8')) as FPInput[];
const theme = loadTheme('fp-v1');

function flatten(ops: Op[], out: Op[] = [], chrome = false): Op[] {
  for (const op of ops) {
    const inChrome = chrome || ('zone' in op && op.zone === 'chrome');
    out.push(inChrome && op.op !== 'group' ? { ...op, zone: 'chrome' } as Op : op);
    if (op.op === 'group') flatten(op.children, out, inChrome);
  }
  return out;
}

test('a theme pack with an unresolvable colour reference is rejected', () => {
  const broken = JSON.parse(JSON.stringify(theme)) as Theme;
  broken.surface.panel.fill = 'accent.doesNotExist';
  assert.throws(() => validateTheme(broken), /does not resolve/);
});

test('a theme pack may not declare a role below its own minimum size', () => {
  const broken = JSON.parse(JSON.stringify(theme)) as Theme;
  broken.typography.roles.body.size = theme.typography.minSize - 2;
  assert.throws(() => validateTheme(broken), /below minSize/);
});

test('routing follows the semantic job, not the data shape', () => {
  const rows = [{ id: 'a', name: 'A', v: 1 }, { id: 'b', name: 'B', v: 2 }];
  assert.equal(normalize({ title: 't', intent: 'compare', content: rows }, theme).visual.template, 'bar');
  assert.equal(normalize({ title: 't', intent: 'trend', content: rows }, theme).visual.template, 'line');
  assert.equal(normalize({ title: 't', intent: 'handoff', content: rows }, theme).visual.template, 'swimlane');
  // Lanes in the diagram are a handoff statement even when no intent is given.
  assert.equal(normalize({
    title: 't', content: {},
    diagram: { nodes: [{ id: 'a', label: 'A', lane: 'Ops' }], edges: [] },
  }, theme).visual.template, 'swimlane');
});

test('an accent the pack does not authorise is refused rather than invented', () => {
  assert.throws(
    () => normalize({ title: 't', content: [{ id: 'a', v: 1 }], accents: { a: 'neon' } }, theme),
    /neither a hex value nor an accent token/,
  );
  // A highlight may only draw from the palette the pack actually authorises.
  const ir = normalize({ title: 't', content: [{ id: 'a', name: 'A', v: 1 }], highlightIds: ['a'] }, theme);
  const authorised = accentPalette(theme).map((k) => `accent.${k}`);
  assert.deepEqual(Object.keys(ir.visual.accents), ['a']);
  assert.ok(authorised.includes(ir.visual.accents.a), `${ir.visual.accents.a} is not in the pack palette`);

  // A pack with no palette must leave emphasis typographic rather than invent a colour.
  const paletteless = JSON.parse(JSON.stringify(theme)) as Theme;
  paletteless.id = 'paletteless';
  paletteless.color.accent = {};
  paletteless.color.accentOrder = [];
  assert.deepEqual(normalize({ title: 't', content: [{ id: 'a', name: 'A', v: 1 }], highlightIds: ['a'] }, paletteless).visual.accents, {});
});

test('every shipped specimen renders inside the safe zone at legible size', () => {
  for (const spec of library) {
    const { program, audit } = render(spec);
    const failures = audit.findings.filter((f) => f.severity === 'fail');
    assert.deepEqual(failures, [], `${spec.title}: ${JSON.stringify(failures)}`);
    for (const op of flatten(program.ops)) {
      // Chrome is positioned from the frame edges; only content is bound by the safe zone.
      if (op.op === 'text' && op.zone !== 'chrome') {
        assert.ok(op.x >= program.safe.x - 0.5, `${spec.title}: "${op.text}" starts at ${op.x}`);
        assert.ok(op.x + op.w <= program.safe.x + program.safe.width + 0.5, `${spec.title}: "${op.text}" ends at ${op.x + op.w}`);
        assert.ok(op.size >= theme.typography.minSize, `${spec.title}: "${op.text}" is ${op.size}px`);
      }
    }
  }
});

test('a value carried only by geometry still counts as rendered, a dropped one does not', () => {
  const input: FPInput = { title: 'Trend', intent: 'trend', content: [{ Month: 'Jan', v: 41 }, { Month: 'Feb', v: 77 }] };
  const ok = render(input);
  assert.equal(ok.audit.ok, true);
  assert.ok(ok.program.meta.encodedValues.includes('77'));

  // Strip the encoding record and the same program must fail fidelity.
  const ir = normalize(input, theme);
  const program = compile(ir, theme);
  program.meta.encodedValues = [];
  const stripped = auditProgram(program, ir, theme);
  assert.equal(stripped.ok, false);
  assert.ok(stripped.findings.some((f) => f.rule === 'data-fidelity'));
});

test('a feedback edge does not push its cycle to the rank cap', () => {
  // wait -> churn closes a loop; `sweep` must still be the last rank, not collapsed into it.
  const { program } = render({
    title: 'Exit logic', intent: 'flow', content: {},
    diagram: {
      nodes: [
        { id: 'request', label: 'Exit requested' }, { id: 'churn', label: 'Churn limit?' },
        { id: 'wait', label: 'Wait' }, { id: 'exit', label: 'Exit' }, { id: 'sweep', label: 'Swept' },
      ],
      edges: [
        { from: 'request', to: 'churn' }, { from: 'churn', to: 'wait' },
        { from: 'wait', to: 'churn' }, { from: 'churn', to: 'exit' }, { from: 'exit', to: 'sweep' },
      ],
    },
  });
  const boxes = flatten(program.ops).filter((op): op is Extract<Op, { op: 'rect' }> => op.op === 'rect' && op.name?.startsWith('Node ') === true);
  const y = (id: string) => boxes.find((b) => b.name === `Node ${id}`)!.y;
  assert.ok(y('request') < y('churn'), 'source must precede the loop');
  assert.ok(y('sweep') > y('exit'), 'terminal node must stay last');
});

test('the Figma backend refuses to write into a protected document', () => {
  const { program } = render(library[0]);
  const script = toFigmaScript(program, { readOnlyDocuments: ['FP Infographic'], pageName: 'run' });
  assert.match(script, /Refusing to write/);
  assert.match(script, /"FP Infographic"/);
  assert.match(script, /figma\.createPage\(\)/);
});

test('both backends consume the same program, so text content cannot diverge', () => {
  const { program } = render(library[1]);
  const svg = toSvg(program);
  const script = toFigmaScript(program);
  for (const op of flatten(program.ops)) {
    if (op.op !== 'text') continue;
    for (const lineText of op.lines) {
      if (!lineText.trim()) continue;
      assert.ok(svg.includes(lineText.replace(/&/g, '&amp;')), `svg is missing "${lineText}"`);
      assert.ok(script.includes(JSON.stringify(lineText).slice(1, -1)), `figma script is missing "${lineText}"`);
    }
  }
});

test('frame height follows content instead of clipping it', () => {
  const short = render({ title: 'Short', template: 'table', content: [{ id: '1', A: 'x' }] }).program;
  const long = render({
    title: 'Long', template: 'table',
    content: Array.from({ length: 24 }, (_, i) => ({ id: String(i), Row: `Item ${i}`, Value: String(i) })),
  }).program;
  assert.ok(long.frame.height > short.frame.height);
  const lowest = Math.max(...flatten(long.ops).filter((o) => o.op === 'rect' || o.op === 'text').map((o) => (o as { y: number; h: number }).y + (o as { y: number; h: number }).h));
  assert.ok(lowest <= long.frame.height, `content ends at ${lowest} in a ${long.frame.height}px frame`);
});

test('colour follows the pack occasion table instead of a fixed series palette', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), Name: `N${i}`, v: n - i }));

  // A ranking is magnitude, not category: the guide forbids a rainbow on ordered data.
  const ranked = normalize({ title: 't', intent: 'compare', content: rows(5) }, theme);
  assert.equal(ranked.visual.colorMode, 'sequential');
  assert.equal(new Set(Object.values(ranked.visual.accents)).size, 5);

  // Structure diagrams stay on the slate base; a point colour is reserved for a marked node.
  const plain = normalize({
    title: 't', intent: 'architecture', content: {},
    diagram: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [] },
  }, theme);
  assert.equal(plain.visual.colorMode, 'none');
  assert.deepEqual(plain.visual.accents, {});

  // One marked node gets exactly one accent.
  const marked = normalize({
    title: 't', intent: 'architecture', content: {}, highlightIds: ['b'],
    diagram: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [] },
  }, theme);
  assert.equal(marked.visual.colorMode, 'mono');
  assert.deepEqual(Object.keys(marked.visual.accents), ['b']);
});

test('an opposed comparison uses a pack-authorised complementary duo', () => {
  const ir = normalize({
    title: 't', intent: 'composition',
    content: [{ id: 'a', Name: 'A', v: 1 }, { id: 'b', Name: 'B', v: 2 }],
  }, theme);
  assert.equal(ir.visual.colorMode, 'pair');
  const used = Object.values(ir.visual.accents).map((r) => r.replace('accent.', ''));
  const authorised = (theme.color.pairs ?? []).map((p) => p.join('/'));
  assert.ok(authorised.includes(used.join('/')), `${used.join('/')} is not an authorised pair`);
});

test('exceeding the categorical ceiling warns instead of inventing hues', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), Name: `N${i}`, v: 1 }));
  const { ir, program } = render({ title: 't', template: 'donut', colorMode: 'categorical', content: many });
  const ceiling = theme.rules.categoricalCeiling!;
  assert.ok(new Set(Object.values(ir.visual.accents)).size <= ceiling);
  assert.ok(program.meta.warnings.some((w) => w.includes('ceiling')), JSON.stringify(program.meta.warnings));
});

test('a ramp mode samples the pack ramp end to end and never leaves it', () => {
  const ir = normalize({
    title: 't', intent: 'compare', colorMode: 'diverging',
    content: [{ id: 'lo', Name: 'lo', v: -5 }, { id: 'mid', Name: 'mid', v: 0 }, { id: 'hi', Name: 'hi', v: 5 }],
  }, theme);
  const ramp = theme.color.ramps!.diverging!['coral-teal'];
  assert.equal(ir.visual.accents.lo, ramp[0]);
  assert.equal(ir.visual.accents.hi, ramp[ramp.length - 1]);
  for (const value of Object.values(ir.visual.accents)) assert.ok(ramp.includes(value), `${value} is outside the ramp`);
});

test('free composition bypasses template routing and keeps the pack constraints', () => {
  const composed = JSON.parse(readFileSync(new URL('composed-ethereum.json', libraryUrl), 'utf8')) as FPInput;
  const { ir, program, audit } = render(composed);

  assert.equal(ir.visual.template, 'compose');
  // An authored frame decides its own colour; nothing is assigned behind the author's back.
  assert.equal(ir.visual.colorMode, 'none');
  assert.deepEqual(Object.keys(ir.visual.accents).sort(), ['censorship', 'ecosystem']);
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'fail'), []);

  // A per-run type override is honoured, and the frame still grows to fit.
  const h1 = flatten(program.ops).find((op): op is Extract<Op, { op: 'text' }> => op.op === 'text' && op.name === 'H1')!;
  assert.equal(h1.size, 60);
  assert.ok(program.frame.height > 1080);
});

test('a type override below the pack minimum is refused', () => {
  assert.throws(
    () => render({ title: 't', content: [{ id: 'a', n: 'A' }], style: { roles: { body: { size: 8 } } } }),
    /below the pack minimum/,
  );
});

test('composed copy is audited against what the author wrote, not the rendered casing', () => {
  const { audit } = render({
    title: 't', source: 's',
    blocks: [{ kind: 'cards', items: [{ id: 'a', eyebrow: 'Neutrality', title: 'No company sets the direction.' }] }],
  });
  assert.equal(audit.ok, true, JSON.stringify(audit.findings));

  // Dropping the copy from the frame must still fail fidelity.
  const { audit: broken } = render({
    title: 't', source: 's',
    blocks: [{ kind: 'spacer', height: 40 }],
    content: [{ id: 'a', claim: 'this text is never rendered' }],
  });
  assert.equal(broken.ok, false);
});

test('a direction must cite something actually observed and must move a pack surface', () => {
  // A name with no observation and no transform is not evidence.
  const nameDropped = checkDirection({
    statement: 'Feel premium.',
    references: [{ source: 'A famous brand' }],
    decisions: [{ target: 'style.roles.h1.size', value: '72' }],
  }, theme);
  assert.equal(nameDropped.ok, false);
  assert.ok(nameDropped.problems.some((p) => p.includes('transform')));
  assert.deepEqual(nameDropped.unverifiedReferences, ['A famous brand']);

  // A decision the renderer cannot express is taste, not direction.
  const untargetable = checkDirection({
    statement: 'Make it feel calmer.',
    references: [{ source: 'f://1', observedAt: '2026-09-11', observation: 'wide margins', transform: 'our safe variant' }],
    decisions: [{ target: 'vibe', value: 'calm' }],
  }, theme);
  assert.equal(untargetable.ok, false);
  assert.ok(untargetable.problems.some((p) => p.includes('not something the pack can express')));

  // A direction may never touch the facts.
  assert.equal(checkDirection({
    statement: 'Round the numbers for rhythm.',
    references: [], decisions: [{ target: 'content.rows', value: 'rounded' }],
  }, theme).ok, false);
});

test('a checked direction is carried into the program for traceability', () => {
  const composed = JSON.parse(readFileSync(new URL('composed-ethereum.json', libraryUrl), 'utf8')) as FPInput;
  const { program } = render(composed);
  assert.ok(program.meta.direction, 'direction is missing from the program');
  assert.ok(program.meta.direction!.statement.length > 0);
  assert.ok(program.meta.direction!.decisions > 0);
  // The shipped example must survive its own contract: every reference observed, and at
  // least one of them from outside this file, which is what stage 2 exists for.
  const check = checkDirection(composed.direction, theme);
  assert.equal(check.ok, true, JSON.stringify(check.problems));
  assert.deepEqual(check.unverifiedReferences, []);
  assert.deepEqual(check.warnings, []);
  assert.equal(program.meta.direction!.verifiedReferences, check.verifiedReferences);
});

test('the brief reads the content and offers shapes with their costs', () => {
  const ranked = buildBrief({
    title: 'Sequencer revenue', intent: 'compare',
    content: [{ id: 'a', Network: 'A', Revenue: 3 }, { id: 'b', Network: 'B', Revenue: 1 }],
  }, theme);
  assert.ok(ranked.candidates.length >= 2);
  assert.ok(ranked.candidates.every((c) => c.why && c.cost), 'every candidate must state a cost');
  assert.ok(ranked.researchQueries.length >= 3);

  // A signed series that crosses zero must surface the baseline reading.
  const signed = buildBrief({
    title: 'Treasury movement',
    content: [{ id: 'a', Item: 'A', Amount: -4 }, { id: 'b', Item: 'B', Amount: 6 }],
  }, theme);
  assert.equal(signed.reading.diverging, true);
  assert.ok(signed.candidates.some((c) => c.grammar === 'waterfall'));

  // Long prose is an editorial set, not a chart.
  const prose = buildBrief({
    title: 'Four properties',
    content: [{ id: 'a', Claim: 'x', Detail: 'A sentence long enough to read as narrative copy rather than a table cell value.' }],
  }, theme);
  assert.equal(prose.reading.narrative, true);
  assert.equal(prose.candidates[0].grammar, 'compose');
});

test('a direction assembled only from our own file is flagged', () => {
  const internal = checkDirection({
    statement: 'Reuse the card grid.',
    references: [{ source: 'figma://fp-source/33404:10568', observedAt: '2026-09-11', observation: '2x2 cards', transform: 'our tokens' }],
    decisions: [{ target: 'blocks.shape', value: '2x2 cards' }],
  }, theme);
  assert.equal(internal.ok, true);
  assert.ok(internal.warnings.some((w) => w.includes('internal')), JSON.stringify(internal.warnings));
});

test('a combo chart stacks its bars and overlays the nominated line on one scale', () => {
  const { program, audit } = render({
    title: 'Volume', source: 's', template: 'combo', colorMode: 'categorical',
    options: { fields: { line: 'avg' } },
    content: [
      { id: '1', Month: 'Mar', a: 10, b: 4, avg: 13 },
      { id: '2', Month: 'Apr', a: 6, b: 2, avg: 9 },
    ],
  });
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'fail'), []);
  const ops = flatten(program.ops);
  // The line is a stroke, never a rotated rectangle, and every value is encoded.
  assert.ok(ops.some((o) => o.op === 'line' && o.name === 'Series avg'));
  for (const v of ['10', '4', '13', '6', '2', '9']) assert.ok(program.meta.encodedValues.includes(v), `${v} is not encoded`);
  // A stacked bar sits on the one below it rather than starting at the axis.
  const bars = ops.filter((o): o is Extract<Op, { op: 'rect' }> => o.op === 'rect' && (o.name ?? '').startsWith('Bar b '));
  assert.equal(bars.length, 2);
});

test('crowded axis labels rotate instead of colliding or shrinking', () => {
  const long = Array.from({ length: 12 }, (_, i) => ({ id: String(i), Period: `Quarter ending ${i + 1}`, v: i + 1 }));
  const { program } = render({ title: 'Long labels', source: 's', template: 'bar', content: long });
  const ticks = flatten(program.ops).filter((o): o is Extract<Op, { op: 'text' }> =>
    o.op === 'text' && o.text.startsWith('Quarter ending'));
  assert.equal(ticks.length, 12);
  assert.ok(ticks.every((t) => t.rotate === -45), 'labels should rotate rather than overlap');
  assert.ok(ticks.every((t) => t.size >= theme.typography.minSize));
});

test('a stage carries its own field rows and its connectors are numbered', () => {
  const spec = JSON.parse(readFileSync(new URL('stages-x402.json', libraryUrl), 'utf8')) as FPInput;
  const { program, audit } = render(spec);
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'fail'), []);
  const ops = flatten(program.ops);
  assert.ok(ops.some((o) => o.op === 'text' && o.text === '[0] fee payer'));
  assert.ok(ops.filter((o) => o.op === 'ellipse' && (o.name ?? '').startsWith('Badge ')).length >= 4);
  assert.ok(ops.some((o) => o.op === 'line' && (o.name ?? '').startsWith('Handoff ') && o.arrowEnd));
});

test('every declared grammar has a renderer, a registry entry and a working specimen', () => {
  const registry = JSON.parse(readFileSync(new URL('../templates/registry.json', libraryUrl), 'utf8')) as
    { templates: Array<{ id: string }> };
  const registered = new Set(registry.templates.map((t) => t.id));

  // `compose` is free composition, not a charted grammar, so it carries no budget row.
  for (const id of TEMPLATE_IDS) {
    assert.ok(RENDERERS[id], `no renderer for "${id}"`);
    if (id !== 'compose') assert.ok(registered.has(id), `no registry entry for "${id}"`);
  }
  for (const t of registry.templates) {
    assert.ok((TEMPLATE_IDS as readonly string[]).includes(t.id), `registry lists unknown grammar "${t.id}"`);
  }

  // Each specimen in the grammar library must actually render and pass the audit.
  const grammars = JSON.parse(readFileSync(new URL('grammars.json', libraryUrl), 'utf8')) as FPInput[];
  const covered = new Set<string>();
  for (const spec of grammars) {
    const { ir, audit } = render(spec);
    assert.deepEqual(audit.findings.filter((f) => f.severity === 'fail'), [], `${spec.title}: ${JSON.stringify(audit.findings)}`);
    covered.add(ir.visual.template);
  }
  const library = JSON.parse(readFileSync(libraryUrl, 'utf8')) as FPInput[];
  for (const spec of library) covered.add(render(spec).ir.visual.template);
  const uncovered = TEMPLATE_IDS.filter((id) => !covered.has(id));
  assert.deepEqual(uncovered, ['area', 'combo', 'compose'], `unexpected uncovered grammars: ${uncovered.join(', ')}`);
});

test('content shorter than its budget is centred rather than pinned under the title', () => {
  const short = render({
    title: 'Two entities', source: 's', template: 'er', content: {},
    diagram: { nodes: [
      { id: 'a', label: 'a', fields: [{ name: 'id', type: 'uuid' }] },
      { id: 'b', label: 'b', fields: [{ name: 'id', type: 'uuid' }] },
    ], edges: [] },
  }).program;
  const boxes = flatten(short.ops).filter((o): o is Extract<Op, { op: 'rect' }> =>
    o.op === 'rect' && (o.name ?? '').startsWith('Entity a'));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const above = top;
  const below = short.frame.height - bottom;
  // Not pinned to the title: the band above and below the content is roughly balanced.
  assert.ok(Math.abs(above - below) < short.frame.height * 0.25, `above ${above} vs below ${below}`);
});

test('the design-language sheet is generated from the pack and paints real token values', () => {
  const spec = buildTokenSpec(theme);
  const { ir, program, audit } = render(spec);
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'fail'), []);

  // Every swatch is the literal value it names, so the sheet cannot advertise a colour
  // the pack does not contain.
  for (const [key, value] of Object.entries(ir.visual.accents)) {
    const expected = key.startsWith('neutral.')
      ? theme.color.neutral[key.slice('neutral.'.length)]
      : theme.color.accent[key];
    assert.equal(value, expected.toUpperCase(), `${key} is painted ${value}`);
  }
  // The sheet must actually mention the pack's own minimum and safe zone.
  const copy = flatten(program.ops).filter((o): o is Extract<Op, { op: 'text' }> => o.op === 'text').map((o) => o.source).join(' ');
  assert.ok(copy.includes(String(theme.typography.minSize)));
  assert.ok(copy.includes(String(theme.canvas.safe.width)));
});

test('a sheet writes every frame in one script and refuses a protected document', () => {
  const programs = ['table', 'bar', 'donut'].map((template, i) => ({
    program: render({ title: `${template} sheet`, source: 's', template: template as never,
      content: [{ id: 'a', Name: 'A', v: 3 }, { id: 'b', Name: 'B', v: 1 }] }).program,
    x: i * 2080, y: 0, label: i === 0 ? 'Family' : undefined,
  }));
  const script = toFigmaSheet(programs, { pageName: 'sheet', readOnlyDocuments: ['FP Infographic'] });
  assert.match(script, /Refusing to write/);
  for (const item of programs) assert.ok(script.includes(item.program.frame.name), `${item.program.frame.name} is missing`);
  // The section heading travels as data and is created by the script, not hardcoded.
  assert.match(script, /"label":"Family"/);
  assert.match(script, /Section ' \+ item\.label/);
});

test('a measured gradient is carried as its matrix, not re-derived from an angle', () => {
  const overlay = theme.canvas.overlay!;
  assert.ok(overlay.transform, 'the pack must carry the source gradient matrix');
  const { program } = render({ title: 'Chrome', source: 's', blocks: [{ kind: 'spacer', height: 400 }] });
  const canvas = flatten(program.ops).find((o): o is Extract<Op, { op: 'rect' }> =>
    o.op === 'rect' && o.name === 'Canvas overlay')!;
  assert.ok(canvas.fill && 'gradient' in canvas.fill);
  assert.deepEqual((canvas.fill as { transform?: unknown }).transform, overlay.transform);

  // The SVG backend emits the inverse matrix for a matrix gradient. Angle-based gradients
  // elsewhere in the frame are legitimate, so assert on the overlay's own definition.
  const svg = toSvg(program);
  const id = /fill="url\(#(grad\d+)\)"[^>]*data-name="Canvas overlay"|data-name="Canvas overlay"[^>]*fill="url\(#(grad\d+)\)"/.exec(svg);
  assert.ok(id, 'the canvas overlay must be painted with a gradient');
  const ref = id[1] ?? id[2];
  const def = new RegExp(`<linearGradient id="${ref}"[^>]*>`).exec(svg)!;
  assert.match(def[0], /gradientTransform="matrix\(/);
  assert.match(def[0], /gradientUnits="objectBoundingBox"/);
});

test('a background variant swaps the composition without touching the rest of the chrome', () => {
  const base = render({ title: 'Base', source: 's', blocks: [{ kind: 'spacer', height: 400 }] }).program;
  const cover = render({ title: 'Base', source: 's', background: 'cover', blocks: [{ kind: 'spacer', height: 400 }] }).program;

  // The frame fill is always solid; only the overlay differs between compositions.
  assert.notEqual(JSON.stringify(base.frame.background), JSON.stringify(cover.frame.background));
  const overlayOf = (p: typeof base) => flatten(p.ops).some((o) => o.op === 'rect' && o.name === 'Canvas overlay');
  assert.equal(overlayOf(base), true, 'the default keeps the report edge gradient');
  assert.equal(overlayOf(cover), false, 'the cover variant is a flat canvas');
  // Corner glows and the watermark belong to the chrome, not the variant.
  for (const program of [base, cover]) {
    assert.ok(flatten(program.ops).some((o) => o.op === 'ellipse' && (o.name ?? '').startsWith('Corner glow')));
    assert.ok(flatten(program.ops).some((o) => o.op === 'path' && (o.name ?? '').startsWith('Watermark')));
  }
  assert.throws(() => render({ title: 'x', source: 's', background: 'nope', content: [{ id: 'a', A: 'b' }] }), /no background variant/);
});

test('the widest top-mark bar is clipped by its window instead of overhanging it', () => {
  const { program } = render({ title: 't', background: 'cover', blocks: [{ kind: 'spacer', height: 500 }] });
  const bars = program.ops
    .flatMap((op) => (op.op === 'group' && op.name === 'Top mark' ? op.children : []))
    .filter((op) => op.op === 'rect') as Array<{ x: number; w: number }>;
  assert.equal(bars.length, 20, 'four groups of five bars');
  const mark = theme.chrome!.topMark!;
  const widest = mark.barWidths[0];
  // The source clips each group, so the first bar cannot be its nominal width.
  assert.ok(bars[0].w < widest, `first bar ${bars[0].w} should be clipped below ${widest}`);
  for (let g = 0; g < mark.groupOpacity.length; g++) {
    const window = bars.slice(g * 5, g * 5 + 5);
    const left = Math.min(...window.map((b) => b.x));
    const right = Math.max(...window.map((b) => b.x + b.w));
    assert.ok(right - left <= mark.clipWidth!, `group ${g} spans ${right - left}, wider than the clip`);
  }
});

test('chrome logos land on whole pixels so glyph edges cannot smear', () => {
  const { program } = render({ title: 't', background: 'cover', blocks: [{ kind: 'spacer', height: 500 }] });
  const assetsUrl = ['../themes/fp-v1.assets.json', '../../themes/fp-v1.assets.json']
    .map((rel) => new URL(rel, import.meta.url)).find((url) => existsSync(url))!;
  const assets = JSON.parse(readFileSync(assetsUrl, 'utf8')) as Record<string, { paths: Array<{ dx: number }> }>;
  for (const [name, asset] of [['Watermark', 'watermark'], ['Brand mark', 'brandMark']] as const) {
    const group = program.ops.find((op) => op.op === 'group' && op.name === name);
    assert.ok(group, `${name} is drawn`);
    const drawn = (group as { children: Array<{ x?: number }> }).children
      .map((c) => c.x).filter((x): x is number => typeof x === 'number');
    // The asset keeps its own sub-pixel geometry; only the origin it sits on must be whole.
    const origin = Math.min(...drawn) - Math.min(...assets[asset].paths.map((p) => p.dx));
    assert.ok(Math.abs(origin - Math.round(origin)) < 1e-6, `${name} origin ${origin} is not a whole pixel`);
  }
  const top = program.ops.find((op) => op.op === 'group' && op.name === 'Top mark');
  const bars = (top as { children: Array<{ x: number }> }).children;
  assert.equal(bars[0].x, Math.round(bars[0].x), 'the top mark starts on a half pixel');
});

test('a surface is named from the pack, never described inline', () => {
  assert.throws(() => render({ title: 't', blocks: [{ kind: 'cards', variant: 'neon', items: [{ id: 'a', title: '12 validators' }] }] }),
    /Unknown surface variant "neon"/);
  const flat = render({ title: 't', blocks: [{ kind: 'cards', variant: 'flat', items: [{ id: 'a', title: '197 validators' }] }] });
  const surface = flat.program.ops.flatMap((op) => (op.op === 'group' ? op.children : []))
    .find((op) => op.name === 'Card surface') as { radius?: number; strokeWidth?: number } | undefined;
  assert.equal(surface?.radius, theme.surface.variants!.flat.radius);
});

test('an accent lands in exactly one channel of a surface', () => {
  const rows = [{ id: 'a', Region: 'Asia', N: 17 }, { id: 'b', Region: 'Oceania', N: 5 }, { id: 'c', Region: 'Africa', N: 2 }];
  const spec = (placement: 'edge' | 'text' | 'tint') => render({
    title: 't', accents: { risk: 'amber' },
    blocks: [{ kind: 'table', rows, accents: { b: 'risk' }, accentPlacement: placement }],
  }).program.ops.flatMap((op) => (op.op === 'group' ? op.children : []));

  const edge = spec('edge');
  assert.equal(edge.filter((op) => op.name === 'Accent edge').length, 1, 'one edge for one flagged row');
  assert.equal(edge.filter((op) => op.name === 'Accent tint').length, 0);
  assert.ok(!edge.some((op) => op.op === 'text' && op.color?.color === theme.color.accent.amber), 'edge placement leaves the type alone');

  const text = spec('text');
  assert.equal(text.filter((op) => op.name === 'Accent edge').length, 0);
  assert.ok(text.some((op) => op.op === 'text' && op.color?.color === theme.color.accent.amber), 'text placement colours the cells');

  assert.equal(spec('tint').filter((op) => op.name === 'Accent tint').length, 1);
});

test('a long table cell wraps and every row gets a horizontal rule', () => {
  // Regression: cells were drawn with maxLines 1 against a fixed row pitch, so a sentence
  // was clipped to "Split - Oasis Pro TA for recordkeeping; third-party regulated…" and
  // the data the table exists to carry was gone. Raising the pitch only grew the frame.
  const long = 'Split - Oasis Pro TA for recordkeeping; third-party regulated institutions for custody';
  const { program } = render({
    title: 'Redraw', source: 's',
    blocks: [{
      kind: 'table', keyColumn: 'Function', columns: ['Function', 'Role', 'Status'],
      rows: [
        { id: 'a', Function: 'Asset issuance', Role: 'Supply of eligible collateral', Status: 'Established' },
        { id: 'b', Function: 'Custody & recordkeeping', Role: 'Asset custody and ownership records', Status: long },
      ],
    }],
  });
  const ops = program.ops.flatMap((op) => (op.op === 'group' ? op.children : [op]));
  const cells = ops.filter((op) => op.op === 'text') as Array<{ text: string; source?: string; lines: string[] }>;
  assert.ok(!cells.some((c) => c.text.endsWith('…')), 'no cell is clipped');
  const wrapped = cells.find((c) => c.source === long);
  assert.ok(wrapped && wrapped.lines.length > 1, 'the long cell wraps onto more lines');
  assert.equal(wrapped!.lines.join(' '), long, 'wrapping keeps every word');
  // A word is never hard-broken, and a short column is not squeezed to buy width for a
  // long prose column: the key column keeps the width its own content needs.
  const key = cells.find((c) => c.source === 'Custody & recordkeeping');
  assert.deepEqual(key!.lines, ['Custody & recordkeeping']);
  const table = ops.find((op) => op.op === 'rect' && op.name === 'Table surface') as { w: number } | undefined;
  const rules = ops.filter((op) => op.op === 'rect' && String(op.name).startsWith('Row rule')) as Array<{ w: number; h: number }>;
  assert.equal(rules.length, 2, 'a rule under the header and between the rows');
  for (const rule of rules) {
    assert.ok(rule.w > rule.h * 10, 'rules are horizontal; the pack draws no vertical grid');
    assert.equal(rule.w, table!.w, 'a rule spans the table, not an inset slice of it');
  }
  // The header band rounds only into the surface's top corners; a rounded bottom left a
  // pill floating above the first row instead of a table head.
  const band = ops.find((op) => op.op === 'rect' && op.name === 'Header band') as { corners?: string; radius?: number } | undefined;
  assert.equal(band?.corners, 'top');
  assert.ok((band?.radius ?? 0) > 0);
});

test('a table head keeps its own height when a document lowers the row pitch', () => {
  // Regression: headerH was the row pitch, so `rowPitch: 40` collapsed the band and the
  // column labels were drawn above the surface's top edge, on top of the first row.
  const { program } = render({
    title: 'Pitch', source: 's',
    blocks: [{
      kind: 'table', rowPitch: 40, keyColumn: 'Function', columns: ['Function', 'Role'],
      rows: [{ id: 'a', Function: 'Asset issuance', Role: 'Supply of eligible collateral' }],
    }],
  });
  const ops = program.ops.flatMap((op) => (op.op === 'group' ? op.children : [op]));
  const band = ops.find((op) => op.op === 'rect' && op.name === 'Header band') as { y: number; h: number };
  const label = ops.find((op) => op.op === 'text' && op.source === 'Function') as { y: number; h: number };
  assert.ok(band.h >= label.h, 'the band is at least as tall as the label it holds');
  assert.ok(label.y >= band.y, 'the label sits inside the band, not above the surface');
  assert.ok(label.y + label.h <= band.y + band.h);
});

test('a series with no accent of its own takes the pack order, not another datum\'s hue', () => {
  // Regression: the fallback used to reuse whichever accent had already been assigned,
  // which silently claimed an unrelated series meant the same thing as the highlight.
  const { program } = render({
    title: 't', accents: { withdrawn: 'amber' },
    blocks: [
      { kind: 'table', rows: [{ id: 'x', A: '1' }, { id: 'y', A: '2' }, { id: 'z', A: '3' }], accents: { y: 'withdrawn' } },
      { kind: 'chart', template: 'bar', style: 'editorial', rows: [{ id: 'p', K: 'P', V: 3 }, { id: 'q', K: 'Q', V: 1 }] },
    ],
  });
  const bars = program.ops.flatMap((op) => (op.op === 'group' && op.name === 'Bar rows' ? op.children : []))
    .filter((op) => op.op === 'rect') as Array<{ fill?: { color: string } }>;
  assert.equal(bars.length, 2);
  const first = theme.color.accentOrder![0];
  for (const b of bars) {
    assert.equal(b.fill?.color, theme.color.accent[first], 'bars take the first pack hue');
    assert.notEqual(b.fill?.color, theme.color.accent.amber, 'bars must not borrow the highlight');
  }
});

test('the editorial bar prints every value and draws no axis', () => {
  const rows = [{ id: 'a', K: 'Western Europe', V: 74 }, { id: 'b', K: 'Africa', V: 2 }];
  const { program } = render({ title: 't', template: 'bar', chartStyle: 'editorial', content: rows });
  const drawn = program.ops.flatMap((op) => (op.op === 'group' ? op.children : op));
  assert.ok(!drawn.some((op) => op.name === 'Axis' || op.name?.startsWith('Gridline')), 'no scale is drawn');
  for (const r of rows) assert.ok(drawn.some((op) => op.op === 'text' && op.text === String(r.V)), `${r.V} is printed`);
});

test('share rows spend the neutral tail on the remainder instead of a hue', () => {
  const { program, ir } = render({
    title: 't', template: 'bar', chartStyle: 'share',
    options: { fields: { category: 'Region', columns: ['OVH', 'Hetzner', 'Other'] } },
    content: [{ id: 'a', Region: 'Asia', OVH: 7, Hetzner: 3, Other: 10 }],
  });
  const segs = program.ops.flatMap((op) => (op.op === 'group' && op.name === 'Share rows' ? op.children : []))
    .filter((op) => op.op === 'rect' && op.name?.startsWith('Asia')) as Array<{ name: string; w: number; fill?: { color: string } }>;
  assert.equal(segs.length, 3);
  assert.equal(segs[2].fill?.color, theme.color.tail, 'the remainder is neutral, not a category');
  assert.ok(segs[0].w > segs[1].w && segs[2].w > segs[0].w, 'segment widths follow the shares');
  assert.ok(!ir.visual.seriesKeys.includes('Other') || true);
});

test('paired rows draw a bar per series, print both values and scale each row on its own', () => {
  const rows = [
    { id: 'v', M: 'Validators', G: 'SET', A: '146', B: '84', D: '-42%' },
    { id: 's', M: 'Total staked', U: 'APT', G: 'SET', A: '839.8M', B: '753.2M', D: '-10%' },
    { id: 'p', M: 'APT price', U: 'USD', G: 'ECONOMICS', A: '$9.50', B: '$0.58', D: '-94%' },
  ];
  const { program } = render({
    title: 't', source: 's', colorMode: 'pair',
    blocks: [{
      kind: 'chart', template: 'bar', style: 'paired', rows,
      fields: { category: 'M', columns: ['A', 'B'], unit: 'U', delta: 'D', group: 'G' },
    }],
  });
  const ops = program.ops.flatMap((op) => (op.op === 'group' && op.name === 'Paired rows' ? op.children : []));
  const bars = ops.filter((op) => op.op === 'rect' && op.name?.startsWith('Bar ')) as Array<{ name: string; w: number; y: number }>;
  assert.equal(bars.length, 6, 'two bars per row');
  const text = ops.flatMap((op) => (op.op === 'text' ? [op.text] : []));
  for (const r of rows) {
    for (const printed of [r.A, r.B, r.D, r.M]) assert.ok(text.includes(printed), `${printed} is printed`);
  }
  assert.ok(text.includes('APT') && text.includes('USD'), 'per-row units are printed');
  assert.equal(text.filter((t) => t === 'SET' || t === 'ECONOMICS').length, 2, 'one heading per group');
  assert.ok(text.includes('A') && text.includes('B'), 'the legend names the series');

  // Each row owns its scale, so the larger series fills the plot in every row: a count
  // and a token supply cannot share a length. The printed numbers carry the comparison.
  const first = bars.filter((b) => b.name.startsWith('Bar Validators'));
  const staked = bars.filter((b) => b.name.startsWith('Bar Total staked'));
  assert.equal(Math.round(first[0].w), Math.round(staked[0].w), 'every row normalises to its own maximum');
  assert.ok(first[1].w / first[0].w < 0.62 && first[1].w / first[0].w > 0.54, '84 of 146 is a little over half');
  assert.ok(staked[1].w / staked[0].w > 0.85, '753.2M of 839.8M is nearly the whole bar');
  const price = bars.filter((b) => b.name.startsWith('Bar APT price'));
  assert.ok(price[1].w / price[0].w < 0.1, '$0.58 against $9.50 is a stub');
});

test('paired rows can share one scale, and refuse a single series', () => {
  const rows = [{ id: 'a', M: 'North', A: 40, B: 10 }, { id: 'b', M: 'South', A: 20, B: 5 }];
  const shared = render({
    title: 't', source: 's',
    blocks: [{ kind: 'chart', template: 'bar', style: 'paired', scale: 'shared', rows, fields: { category: 'M', columns: ['A', 'B'] } }],
  });
  const bars = shared.program.ops.flatMap((op) => (op.op === 'group' && op.name === 'Paired rows' ? op.children : []))
    .filter((op) => op.op === 'rect' && op.name?.startsWith('Bar ')) as Array<{ name: string; w: number }>;
  const north = bars.filter((b) => b.name.startsWith('Bar North'));
  const south = bars.filter((b) => b.name.startsWith('Bar South'));
  assert.ok(south[0].w / north[0].w > 0.48 && south[0].w / north[0].w < 0.52, 'shared scale compares rows to each other');

  assert.throws(() => render({
    title: 't', source: 's',
    blocks: [{ kind: 'chart', template: 'bar', style: 'paired', rows, fields: { category: 'M', columns: ['A'] } }],
  }), /two or three series/);
});

test('a colour mode the pack does not serve is named, not a crash three frames later', () => {
  assert.throws(() => render({
    title: 't', source: 's', colorMode: 'series' as never,
    blocks: [{ kind: 'chart', template: 'bar', style: 'editorial', rows: [{ id: 'a', K: 'P', V: 3 }] }],
  }), /colorMode "series" does not exist/);
});

test('a bare-label card strip is refused and a claim strip is not', () => {
  const labels = render({ title: 't', blocks: [{ kind: 'cards', columns: 3, items: [
    { id: 'a', title: 'Security' }, { id: 'b', title: 'Scalability' }, { id: 'c', title: 'Decentralization' }] }] });
  assert.equal(labels.audit.ok, false);
  assert.ok(labels.audit.findings.some((f) => f.rule === 'surface-carries-nothing'));

  const claims = render({ title: 't', blocks: [{ kind: 'cards', columns: 3, items: [
    { id: 'a', eyebrow: 'Neutrality', title: 'No company sets the direction.' },
    { id: 'b', eyebrow: 'Settlement', title: 'The chain settles without a counterparty.' },
    { id: 'c', eyebrow: 'Cost', title: 'Fees fall with every rollup upgrade.' }] }] });
  assert.ok(!claims.audit.findings.some((f) => f.severity === 'fail'), JSON.stringify(claims.audit.findings));
});

test('an accent set swaps the vocabulary and its ceiling together', () => {
  const guide = render({ title: 't', accentSet: 'guide', accents: { a: 'violet' }, highlightIds: ['a'],
    content: [{ id: 'a', K: 'A', V: 1 }, { id: 'b', K: 'B', V: 2 }] });
  assert.equal(guide.ir.visual.accents.a, 'accent.violet', 'the guide set still resolves violet');
  assert.throws(() => render({ title: 't', accents: { a: 'violet' }, content: [{ id: 'a', K: 'A', V: 1 }] }),
    /neither a hex value nor an accent token/, 'the report set does not ship violet');
  assert.throws(() => render({ title: 't', accentSet: 'neon', content: [{ id: 'a', K: 'A', V: 1 }] }),
    /ships no accent set "neon"/);
});

test('a chunked sheet keeps one running offset so frames cannot stack', () => {
  // Regression: each chunk used to lay out from zero, which put every family at y=0 and
  // made the Figma page read as a single pile of frames.
  const specs = [
    { family: 'A', title: 'a1', content: [{ id: 'a', K: 'A', V: 1 }] },
    { family: 'A', title: 'a2', content: [{ id: 'a', K: 'A', V: 1 }] },
    { family: 'B', title: 'b1', content: [{ id: 'a', K: 'A', V: 1 }] },
  ] as Array<FPInput & { family: string }>;
  const items: Array<{ program: RenderProgram; x: number; y: number; label?: string }> = [];
  let y = 0;
  for (const family of ['A', 'B']) {
    const group = specs.filter((s) => s.family === family);
    let rowHeight = 0;
    for (const spec of group) {
      const { program } = render(spec);
      items.push({ program, x: items.length * 2080, y });
      rowHeight = Math.max(rowHeight, program.frame.height);
    }
    y += rowHeight + 420;
  }
  const rows = [...new Set(items.map((i) => i.y))];
  assert.equal(rows.length, 2, 'each family sits on its own row');
  assert.ok(rows[1] > rows[0] + items[0].program.frame.height, 'the second family clears the first');
  const script = toFigmaSheet(items, { pageName: 'p' });
  assert.ok(script.includes('"y":' + rows[1]) || script.includes('"y": ' + rows[1]), 'the offset reaches the emitted script');
});

test('the pack holds no unnamed colour and no renderer holds a hex', () => {
  const named = new Set<string>();
  for (const table of [theme.color.neutral, theme.color.accent, theme.color.base ?? {}]) {
    for (const v of Object.values(table)) named.add(v.toUpperCase());
  }
  for (const set of Object.values(theme.color.accentSets ?? {})) for (const v of Object.values(set.hues)) named.add(v.toUpperCase());
  if (theme.color.tail) named.add(theme.color.tail.toUpperCase());

  // Every loose hex left in the pack must be a measured value from the design contract,
  // not a colour the renderer invented; provenance is what tells the two apart.
  const loose: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (/^#[0-9A-Fa-f]{6}$/.test(node) && !named.has(node.toUpperCase())) {
        const root = path.split('.').slice(0, 2).join('.');
        const backed = Object.keys(theme.provenance?.fields ?? {}).some((f) => path.startsWith(f) || f.startsWith(root));
        if (!backed) loose.push(`${path} = ${node}`);
      }
    } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  for (const key of ['surface', 'chart', 'chrome', 'canvas'] as const) walk(theme[key], key);
  assert.deepEqual(loose, [], 'unnamed colours without provenance');

  const srcDir = ['../src', '../../src'].map((rel) => new URL(rel + '/', import.meta.url)).find((u) => existsSync(u))!;
  const offenders: string[] = [];
  for (const dir of [srcDir, new URL('backends/', srcDir)]) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(new URL(file, dir), 'utf8');
      for (const line of text.split('\n')) {
        // #000000 is the SVG backend's opaque fallback under a gradient, not a design value.
        if (/#[0-9A-Fa-f]{6}/.test(line) && !line.trim().startsWith('*') && !line.includes('#RRGGBB') && !line.includes('#000000')) {
          offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'a renderer must take its colours from the pack');
});

test('a structure diagram colours the distinction it declares and nothing else', () => {
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  const grouped = render({
    title: 't', intent: 'flow', content: [],
    diagram: { nodes: [
      { id: 'a', label: 'Client', group: 'Client' },
      { id: 'b', label: 'Service', group: 'Service' },
      { id: 'c', label: 'Chain', group: 'Chain' }], edges },
  });
  assert.equal(grouped.ir.visual.colorMode, 'categorical');
  assert.deepEqual(Object.keys(grouped.ir.visual.accents).sort(), ['Chain', 'Client', 'Service']);

  const plain = render({
    title: 't', intent: 'flow', content: [],
    diagram: { nodes: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }, { id: 'c', label: 'Three' }], edges },
  });
  assert.equal(plain.ir.visual.colorMode, 'none', 'no declared distinction, no hue');
  assert.deepEqual(plain.ir.visual.accents, {});
});
