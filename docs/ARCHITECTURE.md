# Architecture

```text
input JSON
    |
[normalize]        immutable facts + SHA-256 checksum + routing
    |
 fp-ir/1
    |
[compile]          theme pack -> absolute coordinates, resolved paints, wrapped lines
    |
 fp-plan/1 ────────┬──────────────┐
    |              |              |
[audit]        [svg backend]  [figma-plugin backend]
                                  |
                            one serialized writer
```

## Why fp-plan/1 exists

Agents differ in model, prompt and host. Handing prose to each renderer makes geometry
nondeterministic. `fp-plan/1` is fully resolved before a backend is chosen, so two hosts
compiling the same input cannot drift. A backend is a translator, never a designer.

## Why the theme pack exists

The renderer holds no colour, size, radius, gap or font. `schemas/theme.schema.json`
defines the whole visual contract, and each field records where it came from:

- `measured` — read off the live design contract or a real exported artefact.
- `declared` — stated by the contract but not independently verified.
- `unverified` — present so the renderer can draw, but not evidence for anything.

`fp_doctor` lists unverified fields. This is the mechanism that stops a plausible value
from hardening into a fake brand rule.

## Zones

Every positioned op is `content` or `chrome`. Content is bound by the pack's safe zone and
is clamped into it. Chrome — background, top mark, title block, watermark, footer — is
positioned from the frame edges and is exempt. The audit enforces exactly that split.

## Single writer

Reads parallelise. Writes do not: page, selection, clone identity and auto-layout sizing
are stateful. `toFigmaScript` takes `readOnlyDocuments` and aborts before its first write
when it finds itself inside a protected source document, and creates one page per run.

## Layout families

20 grammars over 10 families: table; cartesian (bar, line, scatter, waterfall); radial
(donut, loop); sequential (timeline); layered graph (process, flowchart, architecture,
data-flow, deployment, dependency, tree); lanes (sequence, swimlane); stack (layers);
grid (quadrant); quantity flow (sankey).

Graph layouts rank nodes by longest path over the acyclic part of the graph. Feedback
edges are detected by DFS, excluded from ranking and routed through a side channel, so a
cycle cannot collapse the layout and a long edge cannot run through the nodes it skips.
