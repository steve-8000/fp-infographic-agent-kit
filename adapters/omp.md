# OMP

The kit is a deterministic tool layer, not a second orchestrator.

- Main owns run state and the writer lease.
- `scout` gathers source material, read-only.
- `reviewer` audits the rendered result independently.

Write path: `fp_figma_script` -> `figma_exec` on the connected plugin session.
Always pass `readOnlyDocuments` naming every source file, and `pageName` so each run lands
on its own page. Snapshot with `figma_snapshot` before accepting.

Register: `node /absolute/path/fp-infographic-agent-kit/dist/src/server.js`.
