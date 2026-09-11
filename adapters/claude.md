# Claude Code / Desktop

Connect this MCP plus whatever Figma bridge the host provides.

1. `fp_doctor` — confirm the pack is grounded.
2. `fp_plan` — compile; read the audit before anything else.
3. `fp_svg` — review the geometry offline.
4. `fp_figma_script` with `pageName` and `readOnlyDocuments`; one agent executes it.
5. Snapshot and audit the result.

Parallelise research and copy review. Never parallelise the write.

Command: `node /absolute/path/fp-infographic-agent-kit/dist/src/server.js`.
