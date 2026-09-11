---
name: fp-infographic
description: Turn structured data, research findings, reports and system descriptions into editable infographic frames in Figma. Route content to the smallest visual grammar that communicates more than prose, preserve every source fact exactly, apply a versioned theme pack instead of ad-hoc styling, and mutate the design tool through one serialized writer. Use for charts, diagrams, tables and data-driven editorial frames on any host that can execute Figma Plugin API code.
---

# Infographic compiler

This skill is a compiler, not a second designer. It turns input into a deterministic
render program and hands that program to exactly one writer.

```
input JSON -> fp-ir/1 -> fp-plan/1 (absolute coordinates) -> backend -> audit
```

Two agents on two hosts compiling the same input produce byte-identical geometry.
Nothing about visual style lives in the code: every colour, size, gap and rule comes
from a theme pack validated against `schemas/theme.schema.json`.

## Contract hierarchy

1. Input facts and explicit user requirements are immutable.
2. The live design contract in the design tool is the visual source of truth.
3. A theme pack is a cache of that contract. Each field carries `provenance`; a field
   marked `unverified` may be used to draw but never to argue.
4. Grammar decides information geometry only. It never overrides pack typography,
   colour, frame or chrome rules.
5. Copy may be reworded only when facts, numbers, proper nouns, labels, quotations and
   technical identifiers stay semantically identical.

## Workflow

The user supplies content — prose, a table, a requirement. Four stages follow, in order.

### 1. Read the request

`fp_brief` reports what the content actually is: row and column shape, whether it is
ordered or crosses a baseline, whether it is narrative, its density, and the candidate
shapes with what each one costs. It narrows; it does not choose. Decide here which single
question the frame answers.

### 2. Search the open web for references

`fp_brief` returns the queries to start from. Search outside this repository and outside
the FOUR PILLARS file: an internal-only direction reproduces the last frame. Open the
results and look at them. Record each one as `{source, observedAt, observation,
transform}` — what was on the screen, and what must change for it to become ours. A brand
name with no observation is marked unverified and cannot be cited as evidence.

### 3. Design in our language

Turn the useful references into decisions on pack surfaces: `style.roles.*`, `colorMode`,
`ramp`, `accents`, `blocks.shape`, `density`, `safeVariant`, `chrome.titleBlock`.
`fp_direction` rejects a reference that was never observed and a decision the renderer
cannot express. This is the translation step; a principle arrives, a value in our tokens
leaves. `fp_palette` resolves colour from the data's occasion, never from a hex.

### 4. Choose the assembly, not a template

`fp_recipes` is the composition corpus. It names the four layers a frame is built from
(opening, evidence, detail, closing), the rules for combining them, and the axes that
vary a frame without adding a template: `surface`, `accentPlacement`, `chartStyle`,
`accentSet`. Each recipe states the question it answers, the data it needs and what it
refuses. Pick and combine them from the reader's question and step 2's research; do not
reach for a fixed layout. `docs/COMPOSITION.md` is the prose version.

A surface is named from the pack, never described inline. An accent is spent on exactly
one channel of one surface. A series with no accent of its own takes the pack's ordered
vocabulary and never borrows a hue already assigned to other data.

### 5. Build

Compose with `blocks`, or route a single grammar with `intent`/`template`. `fp_plan`
compiles to `fp-plan/1` and audits it. `fp_svg` proves the geometry with no design tool.
`fp_figma_script` emits the writer script — pass `readOnlyDocuments` for every source file
and `pageName` so each run lands on its own page. Snapshot, audit, repair the highest
impact failure first.

## What is fixed, and what is not

Fixed, because breaking it produces a defect: content stays inside the safe zone; no text
below the pack minimum; every source fact is printed or positionally encoded; an accent
must come from the brief or the pack; chrome is preserved; one writer.

Fixed at the composition level too, because these produce frames that look designed and
say nothing: a card that is a bare one- or two-word label with no figure, claim or note; a
grammar stacked under another with no heading; an accent aimed at a row that does not
exist. A sentence claim is a fact and passes; `Security` in a box does not.

Not fixed, because prescribing it produces sameness: the arrangement, the number and shape
of blocks, which grammar appears where, the title sizes (`style.roles` overrides per run —
published frames use 50, 54 and 60 in the same file), whether colour appears at all, and
how a story is told. A composed frame gets no automatic palette: colour goes where the
author puts it.

## Whitespace

The pack reserves the top and bottom bands; everything between is the content budget, and
a chart fills it rather than sitting at a fixed height. Content shorter than the budget is
centred in that band instead of being pinned under the title. Frame height follows content
once it exceeds the budget. Never solve a spacing problem by shrinking type.

## Theme packs

`themes/fp-v1.json` is the FOUR PILLARS pack. `themes/starter.json` is the blank pack a
different team copies. Adding a pack requires no code change: drop the JSON in `themes/`,
run `fp_doctor`, then pass `"theme": "<id>"` in the input.

Never hardcode a colour or size in a renderer. If a grammar needs a new value, add it to
the schema and to every pack.

## Multi-agent contract

Reads parallelise. Writes do not.

- `orchestrator` owns one `run_id` and the writer lease.
- `normalizer` produces the IR and checksum.
- `visual-planner` chooses grammar and split.
- `copy-auditor` rewords prose only.
- `figma-writer` is the sole mutator.
- `qa` audits fidelity and the rendered result.

Roles exchange JSON artifacts. Any checksum or fact-set drift fails the run.

## Computer use

Only for an action with no API: installing a plugin, renaming a file, creating a project.
It is never the renderer. Inspect first, never resolve a destructive target by fuzzy
name, and capture before and after evidence.
