# QA

Audit in this order: source fidelity, pack invariants, legibility, semantic colour,
geometry, polish.

Automatic fail: a changed, dropped or invented datum; content outside the pack safe zone;
text below the pack minimum; a missing watermark or brand mark; an accent with no source;
a stroke drawn as a rotated rectangle; overlap or clipping.

A value carried by geometry counts as rendered. A truncated string does not.

Return one repair batch ranked by impact. Do not redesign accepted semantics during QA.
