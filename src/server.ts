#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Direction, FPInput } from './types.js';
import { TEMPLATE_IDS } from './types.js';
import { doctor, render } from './index.js';
import { checkDirection } from './direction.js';
import { buildBrief } from './brief.js';
import { buildTokenSpec } from './tokens.js';
import { listThemes, loadTheme } from './theme.js';
import { choosePalette, type ColorMode } from './palette.js';
import { toSvg } from './backends/svg.js';
import { toFigmaScript } from './backends/figma-plugin.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(resolve(here, '../templates/registry.json'), 'utf8'));
const recipes = JSON.parse(readFileSync(resolve(here, '../templates/recipes.json'), 'utf8'));

const server = new McpServer({ name: 'fp-infographic', version: '1.0.0' });
const inputArg = { input: z.string().describe('FP input JSON (see schemas/input.schema.json)') };

function parse(raw: string): FPInput {
  const value = JSON.parse(raw) as FPInput;
  if (!value || typeof value !== 'object') throw new Error('input must be a JSON object');
  return value;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

server.tool('fp_themes', 'List installed theme packs. A pack is the entire visual contract; the renderer has no built-in style.', {}, async () =>
  text(listThemes()));

server.tool('fp_templates', 'List visual grammars with their trigger semantics and content budgets.', {}, async () =>
  text({ templates: TEMPLATE_IDS, registry }));

server.tool('fp_recipes',
  'Composable units and the rules for combining them. Read this before choosing a layout: it names the question each unit answers, the data it needs, what it refuses, and the axes (surface, accent placement, chart style, accent set) that vary a frame without adding a template.',
  {}, async () => text(recipes));

server.tool('fp_palette',
  'Explain how the pack would colour a given set of keys. Use this to choose a colour pattern without ever naming a hex.',
  { keys: z.array(z.string()), mode: z.string().optional(), theme: z.string().optional(), ramp: z.string().optional() },
  async ({ keys, mode, theme: themeId, ramp }) => {
    const pack = loadTheme(themeId ?? 'fp-v1');
    const choice = choosePalette(pack, keys, (mode ?? 'auto') as ColorMode, { ramp });
    return text({
      ...choice,
      authorised: pack.color.accentOrder ?? Object.keys(pack.color.accent),
      pairs: pack.color.pairs ?? [],
      ramps: { sequential: Object.keys(pack.color.ramps?.sequential ?? {}), diverging: Object.keys(pack.color.ramps?.diverging ?? {}) },
      categoricalCeiling: pack.rules.categoricalCeiling,
    });
  });

server.tool('fp_tokens',
  'Emit the pack as a renderable design-language frame: type scale, surfaces, neutral ramp and authorised accents, generated from the pack so it cannot drift.',
  { theme: z.string().optional() }, async ({ theme }) => text(buildTokenSpec(loadTheme(theme ?? 'fp-v1'))));

server.tool('fp_brief',
  'Stage 1. Read the request before designing: what the content is, which shapes it admits and what each costs, what to search the open web for, and what still has to be decided.',
  { ...inputArg }, async ({ input }) => {
    const parsed = parse(input);
    return text(buildBrief(parsed, loadTheme(parsed.theme ?? 'fp-v1')));
  });

server.tool('fp_direction',
  'Check a researched design direction before building: every reference needs a real source and observation, every decision must name a pack surface it moves. Returns what will actually change.',
  { direction: z.string().describe('Direction JSON: {statement, references[], decisions[]}'), theme: z.string().optional() },
  async ({ direction, theme: themeId }) =>
    text(checkDirection(JSON.parse(direction) as Direction, loadTheme(themeId ?? 'fp-v1'))));

server.tool('fp_doctor', 'Report which theme-pack fields are still unverified against a live design contract.',
  { theme: z.string().optional() }, async ({ theme }) => text(doctor(theme ?? 'fp-v1')));

server.tool('fp_plan', 'Compile input into fp-ir/1 plus the resolved fp-plan/1 render program and its audit.',
  inputArg, async ({ input }) => {
    const { ir, program, audit } = render(parse(input));
    return text({ ir, program, audit });
  });

server.tool('fp_audit', 'Audit input against the theme contract without producing a render program payload.',
  inputArg, async ({ input }) => {
    const { audit, program } = render(parse(input));
    return text({ audit, warnings: program.meta.warnings, unverifiedThemeFields: program.meta.unverifiedThemeFields });
  });

server.tool('fp_svg', 'Render the program to SVG. Backend-free proof of the exact geometry a Figma writer will produce.',
  inputArg, async ({ input }) => text(toSvg(render(parse(input)).program)));

server.tool('fp_figma_script',
  'Emit an async Figma Plugin API function body for the single writer. Pass it verbatim to whatever bridge the host has.',
  {
    ...inputArg,
    pageName: z.string().optional().describe('Create (or reuse) a page with this name for the run'),
    reusePage: z.boolean().optional(),
    readOnlyDocuments: z.array(z.string()).optional().describe('Document names the script must refuse to mutate'),
    originX: z.number().optional(),
    originY: z.number().optional(),
  },
  async ({ input, pageName, reusePage, readOnlyDocuments, originX, originY }) => {
    const { program, audit } = render(parse(input));
    if (!audit.ok) {
      return text({ refused: true, reason: 'audit failed before write', findings: audit.findings });
    }
    return text(toFigmaScript(program, { pageName, reusePage, readOnlyDocuments, originX, originY }));
  });

await server.connect(new StdioServerTransport());
