# Composition

A template answers "which chart". It cannot answer "an opening strip, then a ranking, then
the table behind it". Real FOUR PILLARS frames are almost entirely the latter, so this kit
does not grow templates to cover new layouts. It exposes a small number of **axes** and a
corpus of **recipes**, and an agent assembles a frame from the reader's question and its
research. The rules refuse the assemblies that stop informing.

Read the machine-readable corpus first: `fp recipes`, or the `fp_recipes` MCP tool.

## The unit of a frame

```
opening    at most one   the headline figures, before any chart
evidence   one or more   a section: heading, subject line, exactly one grammar
detail     optional      the enumerable record, usually a table
closing    optional      the conclusion in words, or a side panel that qualifies it
```

A frame answers one question. A second question with its own opening is a second frame.

## Axes

These vary independently. Choosing them is the composition; adding a template is not.

| axis | values | decides |
|---|---|---|
| `surface` | `flat` `glass` `raised` `bare` | how solid a container reads |
| `accentPlacement` | `none` `edge` `tint` `text` `fill` | which single channel carries a hue |
| `chartStyle` | `cartesian` `editorial` `share` | how a grammar is read |
| `accentSet` | `report` `guide` | which measured vocabulary the hues come from |

Every value is measured from a published frame and carries its provenance in the pack.
`fp doctor` reports any field that is not.

### Surfaces

A block names a surface; it never describes one. `{"kind":"cards","variant":"flat"}` gets
the opaque `#1A1B1D` card with a `#6C707A` hairline, radius 10 and 33px padding, plus the
type roles that belong to it — a 26px sentence-case eyebrow, a 68px figure, a 26px note.
A variant is a whole treatment, not a fill.

Naming a surface the pack does not ship is an error, not a fallback.

### Accent placement

An accent is spent once, on one channel:

- `edge` — a 4px rule down the left of one row or card. The exception in a set.
- `text` — the row's non-key cells take the hue. The finding is a status word.
- `tint` — an 8% wash. The whole row is the finding, not one cell.
- `fill` — the surface takes the hue. One call-out per frame, never a strip.
- `none` — the default, and correct whenever nothing is exceptional.

A series that carries no accent of its own takes the pack's ordered vocabulary. It never
borrows a hue already assigned to other data; that would silently claim the two mean the
same thing.

### Chart style

`bar` is one grammar with three readings. `cartesian` measures against a scale.
`editorial` prints the number beside each bar and draws no axis, because an axis would
only repeat the printed value less precisely. `share` splits a constant-width row into
segments that sum to the whole, with the segment label inside the segment so the reader
never looks away to a legend.

### Colour in a diagram

A structure diagram is not exempt from colour, and it is not decorated with it either.
The contract puts flow nodes on a slate base with point-colour highlights, so the rule is:

> hue encodes a distinction the author declared.

A node's accent is resolved by its `group`, then its `kind`, then the node itself. When
the nodes declare a group or a kind, those distinct values become the palette keys and the
pack assigns hues categorically — no wiring, no per-node colour in the input. When every
node is the same, the diagram stays slate, because there is nothing for colour to mean.
Asking for a hue per node id would be a rainbow and is never done.

### Accent sets

`report` is four muted hues plus a neutral tail, as published in the renewed reports. It
is the default and its categorical ceiling is four. `guide` is the eleven-hue Color System
Guide set, for frames about the system itself. The tail neutral carries every "Other"
segment and every unhighlighted series; it is never an accent.

## What the rules refuse

Legibility, safe zone and data fidelity are checked on the rendering. These are checked on
the **composition**, because the rendered ops no longer show what the author intended:

| rule | refuses |
|---|---|
| `surface-carries-nothing` | a card that is a bare one- or two-word label with no figure, claim or note |
| `undifferentiated-strip` | three or more cards without a single figure between them (warning) |
| `unlabelled-section` | a grammar stacked under another with no heading saying which question it answers |
| `accent-without-subject` | an accent aimed at a row the table does not contain |
| `table-of-one` | a one-row table, which is a sentence (warning) |

The pack itself is held to the same standard: every colour in it resolves to a named token
(`neutral.*`, `accent.*`, `base.*`) or carries measured provenance, and no renderer holds a
hex of its own. `npm test` enforces both.

A sentence claim is a fact. `Neutrality / No company sets the direction.` is a card.
`Security` alone is a list item wearing a box.

## Worked reference

`examples/compositions.json` reproduces three published frames from the Monad report
renewal, each assembled only from recipes and axes:

| frame | assembly |
|---|---|
| MIP status | `status-table` with `accentPlacement: text` on the withdrawn row |
| Validators by region | `kpi-strip` (flat) + `evidence-section`→`ranking-rows` + `evidence-section`→`flagged-table` with an `edge` accent |
| Provider mix | `share-rows` with a verdict column and the neutral tail on "Other" |

Render them with `node dist/src/cli.js library examples/compositions.json --outDir out`.
