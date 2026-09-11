# Third-party notices

This kit synthesizes methodology from the projects below. No upstream source, prompt body
or asset is vendored; the implementations here are original.

## cathrynlavery/diagram-design — MIT

Grammar taxonomy and editorial method: meaning-first type selection, deletion-first
composition, target density, quantitative honesty. The full type taxonomy is implemented
as native render grammars in `src/renderers.ts`.

## Squirbie/im-not-ai-codex — MIT

Surgical rewriting and content-fidelity auditing: change only the spans that need it, and
verify that facts survive. Implemented as the fidelity rule in `src/audit.ts`.

## steve-8000/product-design-skill — MIT

Design-tool-first workflow: discover capabilities before the first write, inspect, mutate,
render, critique. Implemented as the single-writer contract and the read-only document
guard in `src/backends/figma-plugin.ts`.

## FOUR PILLARS Infographic (Figma, file fp-source)

The visual contract behind `themes/fp-v1.json`. Every measured value records the node it
was read from in the pack's `provenance` block. The file itself is not redistributed.
