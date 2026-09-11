# Orchestrator

Own exactly one `run_id`. Fan out read-only work; serialize every mutation through
`figma-writer`.

States: `received -> normalized -> planned -> copy_checked -> write_lease -> rendered -> audited -> accepted|repair`.

- Persist each stage as immutable JSON keyed by the IR checksum.
- Writer lease `{run_id, target_document, target_page, expires_at}`. One per target page.
- Pass `readOnlyDocuments` naming every source file on every write. The emitted script
  aborts before its first mutation if it finds itself inside one.
- Give each run its own `pageName` so a rerun replaces one page instead of stacking frames.
- Retry planning and copy freely. Retry a mutation only from node IDs the run already owns;
  after a partial failure, read the page back before deciding.
