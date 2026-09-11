import type { Direction, Theme } from './types.js';

/**
 * Design direction as a checked artifact.
 *
 * A frame that looks different should be different on purpose. This module does not do
 * research and cannot invent it: it records what was actually observed, forces each
 * observation to name what it changes in *our* language, and refuses to let an
 * unverified reference justify a decision. The output is pack-expressible decisions,
 * so a direction either lands in the render program or it is not a direction.
 */

export interface DirectionCheck {
  ok: boolean;
  statement: string;
  verifiedReferences: number;
  unverifiedReferences: string[];
  decisions: Array<{ target: string; value: string; from?: string }>;
  problems: string[];
  warnings: string[];
}

/** Pack surfaces a direction is allowed to move. Anything else is content, not direction. */
const TARGETS: Record<string, true> = {
  'style.roles': true, colorMode: true, ramp: true, accents: true,
  'blocks.shape': true, density: true, safeVariant: true, 'chrome.titleBlock': true,
};

export function checkDirection(direction: Direction | undefined, theme: Theme): DirectionCheck {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!direction) {
    return { ok: true, statement: '', verifiedReferences: 0, unverifiedReferences: [], decisions: [], problems, warnings };
  }
  if (!direction.statement?.trim()) problems.push('a direction needs one sentence saying what this frame does differently and why');

  const unverified: string[] = [];
  for (const ref of direction.references ?? []) {
    if (!ref.source?.trim()) problems.push(`reference "${ref.observation ?? 'unnamed'}" has no source`);
    // A name or a search snippet is not an observation. Only something actually looked at counts.
    if (!ref.observedAt || !ref.observation?.trim()) unverified.push(ref.source ?? 'unnamed');
    if (!ref.transform?.trim()) {
      problems.push(`reference "${ref.source}" records no transform: say what changes when it becomes ours`);
    }
  }
  // Stage 2 is an open-web search. A direction built only from our own file is a copy of
  // the last frame, which is exactly how a house style stops producing new work.
  const external = (direction.references ?? []).filter((r) => !/^figma:\/\//.test(r.source ?? ''));
  if ((direction.references ?? []).length && !external.length) {
    warnings.push('every reference is internal; search outside the file before claiming a new direction');
  }
  const verified = (direction.references ?? []).length - unverified.length;

  const decisions = (direction.decisions ?? []).map((d) => ({ target: d.target, value: d.value, from: d.from }));
  for (const d of decisions) {
    const root = d.target.split('.').slice(0, 2).join('.');
    if (!TARGETS[d.target] && !TARGETS[root]) {
      problems.push(`decision target "${d.target}" is not something the pack can express; keep direction out of content`);
    }
    if (d.from && !(direction.references ?? []).some((r) => r.source === d.from)) {
      problems.push(`decision "${d.target}" cites "${d.from}", which is not in the reference list`);
    }
  }

  if (!decisions.length) warnings.push('a direction with no decisions changes nothing; either name what moves or drop it');
  if (!verified && (direction.references ?? []).length) {
    warnings.push('every reference is unverified: mark them as inspiration, do not cite them as evidence');
  }
  if (verified === 0 && decisions.length) {
    warnings.push(`this direction moves ${decisions.length} pack value(s) with no verified reference behind it`);
  }
  if (theme.rules.preserveInputFactsExactly && direction.decisions?.some((d) => d.target.startsWith('content'))) {
    problems.push('a direction may not change content; facts are immutable');
  }

  return {
    ok: problems.length === 0,
    statement: direction.statement ?? '',
    verifiedReferences: verified,
    unverifiedReferences: unverified,
    decisions, problems, warnings,
  };
}
