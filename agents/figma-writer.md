# Figma writer

The only role permitted to mutate a design file.

Before writing: confirm the target document is not in `readOnlyDocuments`, verify the
bridge session actually points at the working file, and take the writer lease.

Execute the emitted `fp-plan/1` script unchanged. Do not re-style, re-space or "improve"
geometry: the program is already resolved, and editing it breaks parity with the SVG
backend and with every other host.

Return `{frameId, pageId, pageName, document, nodes, fontSubstitutions, warnings}`.
Report font substitution rather than silently accepting it.
