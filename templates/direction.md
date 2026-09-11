# Design direction

One frame family, one direction. Fill this in before building something that should look
different from the last thing. Attach it as `direction` on the input; `fp_direction`
checks it and `fp_plan` records it in the program.

## Statement

> One sentence: what this frame family does differently, and why the subject demands it.

## References

Only things actually looked at. A brand name, a search snippet or a landing-page claim is
not an observation. Leave `observedAt` blank and it is marked unverified — usable as
inspiration, never citable as evidence.

| source | observedAt | observation | transform |
|---|---|---|---|
| URL / file / frame id | 2026-09-11 | what was on the screen | what must change to become ours |

## Decisions

Each decision names a pack surface it moves. If it cannot be expressed as one of these, it
is content or taste, not direction.

| target | value | from |
|---|---|---|
| `style.roles.h1.size` | `60` | which reference |
| `colorMode` | `sequential` | |
| `blocks.shape` | `2x2 cards then a summary panel` | |
| `density` | `3` | |

Allowed targets: `style.roles.*`, `colorMode`, `ramp`, `accents`, `blocks.shape`,
`density`, `safeVariant`, `chrome.titleBlock`.

## What must not change

Facts, the safe zone, the pack minimum size, chrome, palette membership. A direction that
needs one of these is not a direction; it is a new pack.
