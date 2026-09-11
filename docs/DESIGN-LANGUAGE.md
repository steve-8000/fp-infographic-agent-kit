# FOUR PILLARS Infographic v1 · design language

Generated from `themes/fp-v1.json` v1.0.0. Do not edit by hand: change the pack.

## Frame

| property | value | evidence |
|---|---|---|
| canvas | 1920 x auto, #0C0D0F | measured |
| safe zone | x=112, width=1696 | measured |
| height | auto, min 1080, max 2400 | measured |
| top band | mark 131x41 centred; title block x=89 w=1743 | measured |
| bottom band | 164 | measured |

## Type

Pretendard — minimum 16px, sizes on a 2px grid. Overridable per run through `style.roles`; the minimum is not.

| role | size / line | weight | colour |
|---|---|---|---|
| `cardValue` | 68/68 | 700 | neutral.100 |
| `h1` | 60/54 | 700 | neutral.150 |
| `hero` | 52/57 | 400 | neutral.100 |
| `sectionHead` | 44/53 | 700 | neutral.100 |
| `cardTitle` | 35/42 | 700 | neutral.150 |
| `h2` | 34/35 | 500 | neutral.175 |
| `title` | 30/37 | 400 | neutral.100 |
| `dataTitle` | 28/38 | 600 | neutral.200 |
| `body` | 28/32 | 400 | neutral.200 |
| `footer` | 28/28 | 400 | neutral.475 |
| `tableHead` | 28/41 | 700 | neutral.100 |
| `tableCell` | 28/41 | 400 | neutral.200 |
| `tableKey` | 28/41 | 700 | neutral.100 |
| `cardEyebrow` | 26/34 | 400 | neutral.400 |
| `cardNote` | 26/34 | 400 | neutral.400 |
| `sectionSub` | 26/36 | 400 | neutral.400 |
| `label` | 24/26 | 400 | neutral.300 |
| `cardBody` | 23/33 | 400 | #888888 |
| `footerLabel` | 22/22 | 700 | neutral.600 |
| `sectionLabel` | 22/34 | 700 | neutral.475 |
| `detail` | 18/26 | 400 | neutral.400 |

## Neutral ramp

| token | hex |
|---|---|
| `neutral.100` | `#ECEDEE` |
| `neutral.150` | `#E8E8E8` |
| `neutral.175` | `#BDBDBD` |
| `neutral.200` | `#D4D5D9` |
| `neutral.250` | `#CBCBCB` |
| `neutral.300` | `#BCBCBC` |
| `neutral.350` | `#B1B4B9` |
| `neutral.400` | `#8D929A` |
| `neutral.450` | `#898989` |
| `neutral.475` | `#8D929A` |
| `neutral.500` | `#82868A` |
| `neutral.525` | `#6C707A` |
| `neutral.550` | `#777B80` |
| `neutral.600` | `#51555C` |
| `neutral.650` | `#4F5358` |
| `neutral.675` | `#4F5358` |
| `neutral.700` | `#3C3E44` |
| `neutral.725` | `#3C3E41` |
| `neutral.750` | `#3C3E44` |
| `neutral.800` | `#222324` |
| `neutral.850` | `#212327` |
| `neutral.900` | `#1A1B1D` |
| `neutral.950` | `#141414` |
| `neutral.960` | `#151618` |
| `neutral.1000` | `#0C0D0F` |
| `neutral.1050` | `#040404` |

## Accents

Categorical ceiling 4. An accent is chosen by occasion, never by hex.

| token | hex |
|---|---|
| `accent.blue` | `#4F86C6` |
| `accent.green` | `#5BA86B` |
| `accent.coral` | `#C97A5B` |
| `accent.amber` | `#D2A24E` |

Authorised contrast pairs: blue / amber, violet / lime, teal / coral, cyan / pink

## Surfaces

| surface | fill | stroke | radius |
|---|---|---|---|
| panel | neutral.900 @0.3 | neutral.600 1px | 16 |
| flow node | base.slate @0.12 | base.slate @0.38 | 10 |
| editorial card | gradient | #E1E0D9 @0.22 | 16 |

## Rules the renderer enforces

- Content stays inside the safe zone; chrome is positioned from the frame edges and is exempt.
- No text below 16px.
- Every source fact is printed or positionally encoded.
- An accent must come from the brief or from this pack.
- Axes, connectors and gridlines are true vector strokes.
- Reads parallelise; writes go through one agent.
