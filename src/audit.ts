import type { AuditFinding, AuditResult, FPIR, Op, RenderProgram, Theme } from './types.js';

/**
 * Deterministic audit of a compiled program. It inspects real geometry, not intentions,
 * so it catches clipping and illegible type before anything is written to a design tool.
 */
export function auditProgram(program: RenderProgram, ir: FPIR, theme: Theme): AuditResult {
  const findings: AuditFinding[] = [];
  const left = program.safe.x;
  const right = program.safe.x + program.safe.width;

  const seenText: string[] = [];
  let watermark = false;

  const walk = (ops: Op[], inChrome = false) => {
    for (const op of ops) {
      if (op.op === 'group') { walk(op.children, inChrome || op.zone === 'chrome'); continue; }
      const chrome = inChrome || ('zone' in op && op.zone === 'chrome');

      const rotated = op.op === 'text' && Boolean(op.rotate);
      if (!chrome && !rotated && (op.op === 'rect' || op.op === 'text')) {
        if (op.x < left - 0.5 || op.x + op.w > right + 0.5) {
          findings.push({ severity: 'fail', rule: 'safe-zone', detail: `"${op.name ?? op.op}" spans ${Math.round(op.x)}..${Math.round(op.x + op.w)}, outside ${left}..${right}` });
        }
      }
      if (!rotated && (op.op === 'rect' || op.op === 'text')) {
        if (op.y + op.h > program.frame.height + 0.5) {
          findings.push({ severity: 'fail', rule: 'frame-overflow', detail: `"${op.name ?? op.op}" ends at ${Math.round(op.y + op.h)} beyond frame height ${program.frame.height}` });
        }
      }
      if (op.op === 'text') {
        if (op.size < theme.typography.minSize) {
          findings.push({ severity: 'fail', rule: 'typography-minimum', detail: `"${op.text.slice(0, 32)}" is ${op.size}px, below pack minimum ${theme.typography.minSize}px` });
        }
        if (!op.text.trim()) {
          findings.push({ severity: 'fail', rule: 'empty-placeholder', detail: `empty text node "${op.name ?? ''}" must be deleted, not rendered` });
        }
        if (op.text.endsWith('…')) {
          findings.push({ severity: 'warn', rule: 'truncation', detail: `"${op.name ?? op.text.slice(0, 24)}" was truncated to fit; split the content instead` });
        }
        seenText.push(op.source ?? op.text);
        if (theme.chrome?.watermark?.text && op.text.includes(theme.chrome.watermark.text)) watermark = true;
      }
      // The watermark may be a vector asset rather than a text stand-in.
      if (op.op === 'path' && (op.name ?? '').startsWith('Watermark')) watermark = true;
      if (op.op === 'line' && op.points.length < 2) {
        findings.push({ severity: 'fail', rule: 'vector-connectors', detail: `line "${op.name ?? ''}" has fewer than two points` });
      }
    }
  };
  walk(program.ops);

  if (theme.chrome?.watermark?.required && !watermark) {
    findings.push({ severity: 'fail', rule: 'watermark-present', detail: `pack requires the "${theme.chrome.watermark.text}" watermark` });
  }

  // Fidelity: every literal string/number fact must still be findable in rendered copy.
  // Compare against source strings so wrapping and case transforms cannot look like data loss.
  const haystack = seenText.join('\u0000').replace(/\s+/g, ' ');
  const encoded = new Set(program.meta.encodedValues);
  const missing: string[] = [];
  for (const fact of ir.fidelity.immutableFacts) {
    const value = fact.slice(fact.indexOf('=') + 1);
    if (!value || value === 'undefined' || value === 'null' || value === '') continue;
    if (fact.endsWith('.id=' + value)) continue; // ids are addressing, not displayed copy
    const numeric = Number(value);
    const printed = Number.isFinite(numeric) && value.trim() !== ''
      ? [value, numeric.toLocaleString(ir.document.locale), numeric.toLocaleString('en-US')]
      : [value];
    if (!printed.some((p) => haystack.includes(p.replace(/\s+/g, ' ')) || encoded.has(p))) missing.push(fact);
  }
  if (missing.length) {
    findings.push({
      severity: 'fail', rule: 'data-fidelity',
      detail: `${missing.length} source fact(s) are not present in the rendered copy: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`,
    });
  }

  if (program.meta.splitSuggested) {
    findings.push({ severity: 'warn', rule: 'editorial-density', detail: `density ${program.meta.density} exceeds the pack target; split overview and detail` });
  }
  for (const w of program.meta.warnings) {
    if (!findings.some((f) => f.detail === w)) findings.push({ severity: 'warn', rule: 'compile-warning', detail: w });
  }

  return { ok: !findings.some((f) => f.severity === 'fail'), findings };
}
