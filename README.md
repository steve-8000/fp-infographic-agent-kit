# Infographic Agent Kit

A backend-agnostic compiler that turns structured data into editable infographic frames.
Claude, Codex, OMP or any other host shares one set of semantics and one visual contract.

```
input JSON ──▶ fp-ir/1 ──▶ fp-plan/1 ──▶ backend ──▶ audit
                facts        absolute      svg | figma-plugin
                checksum     coordinates
```

`fp-plan/1` is fully resolved: every coordinate, colour and wrapped text line is decided
before a backend is chosen. Two hosts therefore cannot drift.

## Why a theme pack

The renderer contains no colour, size, radius or gap. Everything comes from a pack
validated against `schemas/theme.schema.json`, and every field carries provenance:

```json
"canvas.safe": {"status": "measured", "source": "out-vitalik", "note": "rect x=112 width=1696"},
"color.accent":  {"status": "measured", "source": "fp-contract", "note": "FP Color System variables"}
```

`measured` means it was read off a real artefact. `unverified` means the pack cannot
argue from it. `fp doctor` lists them. This is what caught the original pack inventing a
palette and mis-stating every type size.

A different team ships `themes/<their-pack>.json` and changes no code.

## Backends

| Backend | Use |
|---|---|
| `svg` | CI, review and hosts without a design tool. Same geometry, diffable text. |
| `figma-plugin` | An async Figma Plugin API function body. Any bridge that can execute plugin code can run it: the OMP figma-bridge, a dev plugin, or an equivalent. |

The Figma backend creates native text, rectangles and ellipses, and emits every
connector, axis and ribbon as a real vector. It refuses to run inside a document listed
in `readOnlyDocuments`, and it can create one page per run so a source file is never
touched.

## The production pipeline

```
content in ──▶ 1 read        fp_brief      shape, candidates + costs, search queries
           ──▶ 2 research    web search    open the results, record what was observed
           ──▶ 3 direction   fp_direction  references become decisions on pack surfaces
           ──▶ 4 build       fp_plan ▸ fp_svg ▸ fp_figma_script
```

Stage 2 is an open-web search. `fp_direction` warns when every reference is internal,
because a direction assembled only from our own file reproduces the last frame.

## Direction before composition

A frame that should look different records why. `direction` carries a statement, the
references actually observed (source, date, observation, transform), and decisions that
each name a pack surface they move. `fp_direction` refuses a reference that is only a
brand name and a decision the renderer cannot express; the accepted direction travels into
`program.meta.direction`. Process in [docs/DIRECTION.md](docs/DIRECTION.md).

## Two ways in

```jsonc
// free composition — the usual path for an editorial frame
{ "title": "...", "blocks": [
  { "kind": "cards", "columns": 2, "items": [ { "eyebrow": "Neutrality", "title": "...", "body": "...", "note": "..." } ] },
  { "kind": "panel", "blocks": [ { "kind": "text", "text": "..." } ] }
] }

// one grammar, when the frame really is one chart
{ "title": "...", "intent": "compare", "content": [ { "id": "base", "Network": "Base", "Revenue": 4820000 } ] }
```

Blocks: `text`, `columns`, `cards`, `panel`, `kpi`, `steps`, `chart`, `divider`, `spacer`.
`chart` embeds any of the twenty grammars inside a layout, so composition and charting are
not separate products.

## Grammars

45 grammars, covering the full `diagram-design` taxonomy plus the chart types the FOUR
PILLARS reports actually use:

| family | grammars |
|---|---|
| table / grid | `table`, `matrix`, `quadrant` |
| cartesian | `bar`, `line`, `scatter`, `waterfall`, `area`, `combo` |
| radial | `donut`, `loop`, `radar`, `polar` |
| sequential | `timeline`, `process`, `gantt`, `journey` |
| graph | `flowchart`, `architecture`, `data-flow`, `deployment`, `dependency`, `tree`, `state`, `org-chart` |
| entity | `er`, `uml-class`, `db-schema` |
| lanes | `sequence`, `swimlane` |
| banded | `layers`, `high-level`, `medallion`, `dp-integration`, `it-state` |
| board | `kanban`, `story-map` |
| shape | `venn`, `pyramid`, `funnel`, `nested`, `treemap` |
| flow / map / causal | `sankey`, `wardley`, `fishbone` |
| composition | `compose` |

`examples/library.json` and `examples/grammars.json` hold a worked specimen for each, and
a test fails if a declared grammar has no renderer, no registry entry or no specimen.

## Use

```bash
npm install && npm test

node dist/src/cli.js doctor                                  # pack provenance report
node dist/src/cli.js svg    input.json --out frame.svg       # offline proof
node dist/src/cli.js library examples/library.json --outDir /tmp/lib
node dist/src/cli.js script input.json \
     --page "2026-09-11 · run" --protect "FP Infographic"    # Figma Plugin API body
```

MCP over stdio: `node dist/src/server.js` exposes `fp_themes`, `fp_templates`,
`fp_doctor`, `fp_plan`, `fp_audit`, `fp_svg`, `fp_figma_script`.
`fp_figma_script` refuses to emit a script when the audit fails.

## Rules that are enforced, not documented

- Content is clamped inside the pack's safe zone.
- No text below the pack minimum.
- Frame height follows content.
- A value must be printed or positionally encoded, or the run fails fidelity.
- An accent must be authorised by the brief or the pack; the pattern is chosen by data
  shape (`mono`, `pair`, `categorical`, `sequential`, `diverging`, `ordered`), never by hex.
- Competing hues cannot exceed the pack's categorical ceiling.
- Reads parallelise; writes are serialized through one agent.
