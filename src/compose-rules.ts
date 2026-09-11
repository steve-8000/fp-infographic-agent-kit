import type { AuditFinding, Block, Card } from './types.js';

/**
 * Rules that judge a composition, not a rendering.
 *
 * The renderer already guarantees the frame is legible, inside the safe zone and faithful
 * to the input. None of that stops a frame from being a grid of grey boxes that restate
 * the prose. These rules refuse the specific ways a composed frame stops informing:
 * a surface that carries no fact, a strip that repeats one shape without a single number,
 * a heading-free section, and an accent spent on something that is not a finding.
 *
 * They run on the authored blocks, so the agent is told what to change, not what to nudge.
 */

const DIGIT = /\d/;

function carriesFact(card: Card): boolean {
  // A card earns its surface by saying something. A figure says it, a body or note says
  // it, and so does a title that is a claim. What does not is a bare label - one or two
  // words with nothing behind them - which is cheaper and clearer as a list item.
  if (DIGIT.test(card.title)) return true;
  if (card.note?.trim() || card.body?.trim()) return true;
  return card.title.trim().split(/\s+/).length >= 3;
}

function walk(blocks: Block[], visit: (block: Block, depth: number) => void, depth = 0): void {
  for (const block of blocks) {
    visit(block, depth);
    switch (block.kind) {
      case 'panel': walk(block.blocks, visit, depth + 1); break;
      case 'section': walk(block.blocks, visit, depth + 1); break;
      case 'columns': for (const c of block.columns) walk(c.blocks, visit, depth + 1); break;
      default: break;
    }
  }
}

export function checkComposition(blocks: Block[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walk(blocks, (block) => {
    if (block.kind === 'cards') {
      const empty = block.items.filter((c) => !carriesFact(c));
      for (const card of empty) {
        findings.push({
          severity: 'fail', rule: 'surface-carries-nothing',
          detail: `card "${card.title}" is a bare label with no figure, no claim and no note; a titled empty box is decoration, so say what it measures or write the set as a list`,
        });
      }
      // A qualitative card grid is legitimate editorial, so this is a prompt, not a veto:
      // it fires only when the whole strip contains no figure anywhere.
      const numberless = block.items.every((c) => ![c.title, c.body, c.note, c.eyebrow].some((t) => t && DIGIT.test(t)));
      if (block.items.length >= 3 && numberless) {
        findings.push({
          severity: 'warn', rule: 'undifferentiated-strip',
          detail: `${block.items.length} cards and not one figure between them; name the measure that makes each card worth its surface, or write the set as prose`,
        });
      }
    }
    if (block.kind === 'kpi') {
      for (const item of block.items) {
        if (!item.value.trim()) {
          findings.push({
            severity: 'fail', rule: 'surface-carries-nothing',
            detail: `kpi "${item.label}" has no value; a metric without its number says less than the sentence it replaced`,
          });
        }
      }
    }
    if (block.kind === 'section' && !block.heading.trim()) {
      findings.push({
        severity: 'fail', rule: 'unlabelled-section',
        detail: 'a section introduces one grammar and must say which question it answers',
      });
    }
    if (block.kind === 'table') {
      if (block.rows.length === 1) {
        findings.push({
          severity: 'warn', rule: 'table-of-one',
          detail: 'a one-row table is a sentence; print it as text or add the rows it is meant to be compared against',
        });
      }
      const accented = Object.keys(block.accents ?? {});
      const unknown = accented.filter((id) => !block.rows.some((r) => String(r.id ?? '') === id));
      for (const id of unknown) {
        findings.push({
          severity: 'fail', rule: 'accent-without-subject',
          detail: `table accent targets row "${id}", which the table does not contain`,
        });
      }
    }
    if (block.kind === 'panel' && !block.blocks.length) {
      findings.push({
        severity: 'fail', rule: 'surface-carries-nothing',
        detail: 'an empty panel is a grey rectangle; fill it or remove it',
      });
    }
  });

  return findings;
}
