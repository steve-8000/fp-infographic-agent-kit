import type { Block, Card, FPInput, Theme } from './types.js';
import { color } from './theme.js';

/**
 * The design-language frame is generated from the pack, never written by hand.
 * A token sheet that can disagree with the renderer is worse than none.
 */
export function buildTokenSpec(theme: Theme): FPInput {
  const roles = Object.entries(theme.typography.roles).sort((a, b) => b[1].size - a[1].size);
  const neutrals = Object.entries(theme.color.neutral).sort((a, b) => Number(a[0]) - Number(b[0]));
  const accents = (theme.color.accentOrder?.length ? theme.color.accentOrder : Object.keys(theme.color.accent))
    .filter((key) => theme.color.accent[key]);

  const blocks: Block[] = [
    {
      kind: 'columns',
      gap: 64,
      columns: [
        { span: 5, blocks: [
          { kind: 'text', role: 'h2', text: 'Type scale' },
          { kind: 'text', gapBefore: 16, role: 'detail', color: 'neutral.500',
            text: `${theme.typography.family} · minimum ${theme.typography.minSize}px · sizes on a ${theme.typography.sizeGrid}px grid` },
          ...roles.map((entry): Block => ({
            kind: 'text', gapBefore: 14, role: entry[0], size: Math.min(entry[1].size, 44),
            text: `${entry[0]} · ${entry[1].size}/${Math.round(entry[1].size * (entry[1].lineHeight ?? 1.45))} · ${entry[1].weight}`,
          })),
        ] },
        { span: 7, blocks: [
          { kind: 'text', role: 'h2', text: 'Surfaces' },
          { kind: 'text', gapBefore: 16, role: 'detail', color: 'neutral.500',
            text: `canvas ${color(theme, theme.canvas.background)} · safe zone x=${theme.canvas.safe.x} w=${theme.canvas.safe.width} · bottom band ${theme.chrome?.bottomBand ?? 0}` },
          { kind: 'cards', gapBefore: 24, columns: 2, items: surfaceCards(theme) },
        ] },
      ],
    },
    {
      kind: 'chart',
      gapBefore: 64,
      title: `Neutral ramp · ${neutrals.length} steps`,
      template: 'treemap',
      height: 240,
      rows: neutrals.map(([step, hex]) => ({ id: `neutral.${step}`, Step: `${step}\n${hex}`, Weight: 1 })),
    },
  ];

  if (accents.length) {
    blocks.push({
      kind: 'chart',
      gapBefore: 48,
      title: `Accent palette · ${accents.length} authorised hues · categorical ceiling ${theme.rules.categoricalCeiling ?? '—'}`,
      template: 'treemap',
      height: 240,
      rows: accents.map((key) => ({ id: key, Hue: `${key}\n${theme.color.accent[key]}`, Weight: 1 })),
    });
  }

  // Every swatch is painted with the literal value it names, so the sheet cannot show a
  // colour the pack does not actually contain.
  const swatches: Record<string, string> = {};
  for (const [step, hex] of neutrals) swatches[`neutral.${step}`] = hex;
  for (const key of accents) swatches[key] = theme.color.accent[key];

  return {
    title: `${theme.label ?? theme.id} · design language`,
    subtitle: `Generated from themes/${theme.id}.json v${theme.version}`,
    source: 'Theme pack',
    colorMode: 'none',
    accents: swatches,
    blocks,
  };
}

function surfaceCards(theme: Theme): Card[] {
  const cards: Card[] = [
    {
      id: 'panel', eyebrow: 'Panel',
      title: `${color(theme, theme.surface.panel.fill)} at ${Math.round((theme.surface.panel.fillOpacity ?? 1) * 100)}%`,
      body: `stroke ${color(theme, theme.surface.panel.stroke)} ${theme.surface.panel.strokeWidth}px · radius ${theme.surface.panel.radius} · padding ${theme.surface.panel.padding}`,
    },
  ];
  if (theme.surface.node) {
    cards.push({
      id: 'node', eyebrow: 'Flow node',
      title: `${theme.surface.node.fill} at ${Math.round((theme.surface.node.fillOpacity ?? 1) * 100)}% fill`,
      body: `stroke at ${Math.round((theme.surface.nodeStrokeOpacity ?? 1) * 100)}% for a base node and 100% for a point colour · radius ${theme.surface.node.radius}`,
    });
  }
  if (theme.surface.card) {
    cards.push({
      id: 'card', eyebrow: 'Editorial card',
      title: `radius ${theme.surface.card.radius} · padding ${theme.surface.card.paddingX}/${theme.surface.card.paddingY}`,
      body: `accent tab ${theme.surface.card.accentRule.width}px wide, radius ${theme.surface.card.accentRule.radius} on its outer side, offset ${theme.surface.card.accentRule.offsetX}`,
    });
  }
  cards.push({
    id: 'chart', eyebrow: 'Chart',
    title: `stroke ${theme.chart.strokeWidth} · point ${theme.chart.pointRadius ?? '—'}`,
    body: `axis ${color(theme, theme.chart.axis.color)} ${theme.chart.axis.width}px · gridline ${color(theme, theme.chart.gridline.color)} at ${Math.round((theme.chart.gridline.opacity ?? 1) * 100)}%`,
  });
  return cards;
}

/** The same pack, as a written reference. Generated so it cannot drift from the renderer. */
export function buildTokenDoc(theme: Theme): string {
  const roles = Object.entries(theme.typography.roles).sort((a, b) => b[1].size - a[1].size);
  const neutrals = Object.entries(theme.color.neutral).sort((a, b) => Number(a[0]) - Number(b[0]));
  const accents = (theme.color.accentOrder?.length ? theme.color.accentOrder : Object.keys(theme.color.accent))
    .filter((key) => theme.color.accent[key]);
  const provenance = (path: string) => {
    const fields = theme.provenance?.fields ?? {};
    const key = Object.keys(fields).filter((k) => path === k || path.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0];
    return key ? fields[key].status : (theme.provenance?.default.status ?? 'unverified');
  };

  const lines: string[] = [
    `# ${theme.label ?? theme.id} · design language`,
    '',
    `Generated from \`themes/${theme.id}.json\` v${theme.version}. Do not edit by hand: change the pack.`,
    '',
    '## Frame',
    '',
    '| property | value | evidence |',
    '|---|---|---|',
    `| canvas | ${theme.canvas.width} x auto, ${color(theme, theme.canvas.background)} | ${provenance('canvas.background')} |`,
    `| safe zone | x=${theme.canvas.safe.x}, width=${theme.canvas.safe.width} | ${provenance('canvas.safe')} |`,
    `| height | ${theme.canvas.heights.mode}, min ${theme.canvas.heights.min}${theme.canvas.heights.max ? `, max ${theme.canvas.heights.max}` : ''} | ${provenance('canvas.heights.mode')} |`,
    `| top band | mark ${theme.chrome?.topMark?.width ?? 0}x${theme.chrome?.topMark?.height ?? 0} centred; title block x=${theme.chrome?.titleBlock?.x ?? 0} w=${theme.chrome?.titleBlock?.width ?? 0} | ${provenance('chrome.topMark')} |`,
    `| bottom band | ${theme.chrome?.bottomBand ?? 0} | ${provenance('chrome.bottomBand')} |`,
    '',
    '## Type',
    '',
    `${theme.typography.family} — minimum ${theme.typography.minSize}px, sizes on a ${theme.typography.sizeGrid}px grid. Overridable per run through \`style.roles\`; the minimum is not.`,
    '',
    '| role | size / line | weight | colour |',
    '|---|---|---|---|',
    ...roles.map(([name, r]) => `| \`${name}\` | ${r.size}/${Math.round(r.size * (r.lineHeight ?? 1.45))} | ${r.weight} | ${r.color} |`),
    '',
    '## Neutral ramp',
    '',
    '| token | hex |',
    '|---|---|',
    ...neutrals.map(([step, hex]) => `| \`neutral.${step}\` | \`${hex}\` |`),
    '',
    '## Accents',
    '',
    accents.length
      ? `Categorical ceiling ${theme.rules.categoricalCeiling ?? '—'}. An accent is chosen by occasion, never by hex.`
      : 'This pack authorises no accent palette, so emphasis stays typographic.',
    '',
    ...(accents.length ? ['| token | hex |', '|---|---|', ...accents.map((k) => `| \`accent.${k}\` | \`${theme.color.accent[k]}\` |`), ''] : []),
    ...(theme.color.pairs?.length ? ['Authorised contrast pairs: ' + theme.color.pairs.map((p) => p.join(' / ')).join(', '), ''] : []),
    '## Surfaces',
    '',
    '| surface | fill | stroke | radius |',
    '|---|---|---|---|',
    `| panel | ${theme.surface.panel.fill} @${theme.surface.panel.fillOpacity} | ${theme.surface.panel.stroke} ${theme.surface.panel.strokeWidth}px | ${theme.surface.panel.radius} |`,
    ...(theme.surface.node ? [`| flow node | ${theme.surface.node.fill} @${theme.surface.node.fillOpacity} | ${theme.surface.node.stroke} @${theme.surface.nodeStrokeOpacity ?? 1} | ${theme.surface.node.radius} |`] : []),
    ...(theme.surface.card ? [`| editorial card | gradient | ${theme.surface.card.stroke} @${theme.surface.card.strokeOpacity ?? 1} | ${theme.surface.card.radius} |`] : []),
    '',
    '## Rules the renderer enforces',
    '',
    '- Content stays inside the safe zone; chrome is positioned from the frame edges and is exempt.',
    `- No text below ${theme.typography.minSize}px.`,
    '- Every source fact is printed or positionally encoded.',
    '- An accent must come from the brief or from this pack.',
    '- Axes, connectors and gridlines are true vector strokes.',
    '- Reads parallelise; writes go through one agent.',
    '',
  ];
  return lines.join('\n');
}
