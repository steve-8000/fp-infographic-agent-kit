# Source integration

Concepts are synthesized; no upstream prompt body is vendored.

- `cathrynlavery/diagram-design` (MIT): meaning-first grammar selection, editorial density,
  deletion-first diagrams, quantitative honesty. Its full type taxonomy is implemented here
  as native render grammars — architecture, IT current-state, flowchart, sequence, state
  machine, ER, timeline, swimlane, quadrant, radar, loop, nested, tree, org chart, layer
  stack, venn, pyramid, funnel, bar, treemap, line, gantt, scatter, high-level, process,
  medallion, data flow, DP integration, permission matrix, sankey, fishbone, Wardley map,
  kanban, user journey, deployment, dependency graph, UML class, story map, database schema,
  polar and waterfall. A test fails if any declared grammar lacks a renderer or a specimen.
- `Squirbie/im-not-ai-codex` (MIT): surgical rewriting, bounded change, content-fidelity auditing.
- `steve-8000/product-design-skill` (MIT): design-tool-first authority, inspect -> mutate ->
  render -> critique, capability discovery before the first write.
- FOUR PILLARS Infographic Figma file: the visual contract behind `themes/fp-v1.json`.

`figma-product-design` already carries the first three as references. This kit layers the
measured FP contract and a deterministic renderer on top; it does not restate them.

## What was actually measured

Read from the live file `fp-source`, page `28391:3632`, frame `28868:14831`:

- canvas `#0C0D0F` plus a horizontal gradient `#4F5358` a1 / `#151618` a0 at 0.4925 / `#4F5358` a1
- layout grids `COLUMNS MIN 112`, `COLUMNS MAX 112`, `ROWS MAX 164`
- top mark: four 24x40 groups at x 895/931/966/1002, opacity 1/0.7/0.4/0.2, five strokes each
  at dx 1/7/13/18/24 with widths 6/5/4/3/2
- title block x=89 w=1743, H1 y=88 at 50/50 Bold centred, H2 y=151 at 32/38 SemiBold centred
- watermark 1400x131 centred, `#BCBCBC` at 0.16 inside a 0.35 group
- footer item: 2x66 gradient tick `#222324` to `#82868A` at 0.8, label +26 at 22 Bold `#51555C`,
  value at 28 Regular `#8D929A`
- text styles MIN SIZE 16/24.2, MAX SIZE 52/57.2, Title 30/37.4, Regular 28/32, Details 18/26,
  Text_24pt 24/110%, Text_28pt 28/38
- `FP Color System` variables: Slate 100/300/400/500/600/900, Blue/500 `#4F86C6`,
  Green/500 `#5BA86B`, Red/500 `#C36E6F`
- the `'26 ver` templates add a 1920x1912 `Background Image` layer centred on the frame with
  four 720x720 corner blobs (`#FFFFFF` to `#333131` linear at 0.06) over a `#141414` canvas

The FP file is a read-only source. Every write in this kit targets a separate working file.
