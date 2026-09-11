# MCP tools

`node dist/src/server.js` over stdio.

| Tool | Returns |
|---|---|
| `fp_themes` | installed packs |
| `fp_templates` | grammars with trigger semantics and content budgets |
| `fp_doctor` | which pack fields are still unverified |
| `fp_brief` | stage 1: what the content is, candidate shapes and their costs, what to search for |
| `fp_direction` | validates a researched direction and returns what it will actually move |
| `fp_palette` | how the pack would colour a set of keys, with rationale and the authorised hues |
| `fp_plan` | `fp-ir/1` + `fp-plan/1` + audit |
| `fp_audit` | audit only |
| `fp_svg` | SVG rendered from the same program |
| `fp_figma_script` | async Figma Plugin API function body |

`fp_figma_script` refuses to emit a script when the audit fails, and takes
`pageName`, `reusePage`, `readOnlyDocuments`, `originX`, `originY`.

Credentials belong to the host connector. This server holds none.
