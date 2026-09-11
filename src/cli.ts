#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { doctor, render } from './index.js';
import { listThemes, loadTheme } from './theme.js';
import { buildBrief } from './brief.js';
import { buildTokenDoc, buildTokenSpec } from './tokens.js';
import { toSvg } from './backends/svg.js';
import { toFigmaScript, toFigmaSheet, type SheetItem } from './backends/figma-plugin.js';
import type { FPInput } from './types.js';

const [, , command, ...rest] = process.argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

function loadInput(): FPInput {
  const path = rest.find((a) => !a.startsWith('--') && rest[rest.indexOf(a) - 1]?.startsWith('--') !== true);
  if (!path) throw new Error('usage: fp <svg|script|audit|plan> <input.json> [--theme id] [--out file] [--page name]');
  return JSON.parse(readFileSync(path, 'utf8')) as FPInput;
}

function emit(value: string): void {
  const out = flag('out');
  if (out) { writeFileSync(out, value); process.stdout.write(`${out}\n`); }
  else process.stdout.write(`${value}\n`);
}

switch (command) {
  case 'recipes':
    process.stdout.write(`${readFileSync(new URL('../../templates/recipes.json', import.meta.url), 'utf8')}\n`);
    break;
  case 'themes':
    process.stdout.write(`${JSON.stringify(listThemes(), null, 2)}\n`);
    break;
  case 'doctor':
    process.stdout.write(`${JSON.stringify(doctor(flag('theme') ?? 'fp-v1'), null, 2)}\n`);
    break;
  case 'svg': {
    const input = loadInput();
    if (flag('theme')) input.theme = flag('theme');
    emit(toSvg(render(input).program));
    break;
  }
  case 'script': {
    const input = loadInput();
    if (flag('theme')) input.theme = flag('theme');
    const { program, audit } = render(input);
    if (!audit.ok) {
      process.stderr.write(`${JSON.stringify(audit, null, 2)}\n`);
      process.exit(1);
    }
    emit(toFigmaScript(program, {
      pageName: flag('page'),
      reusePage: rest.includes('--reuse'),
      clearPage: rest.includes('--reuse'),
      readOnlyDocuments: flag('protect')?.split(',').map((s) => s.trim()).filter(Boolean),
      originY: flag('originY') ? Number(flag('originY')) : undefined,
    }));
    break;
  }
  case 'audit': {
    const input = loadInput();
    if (flag('theme')) input.theme = flag('theme');
    const { audit } = render(input);
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    if (!audit.ok) process.exit(1);
    break;
  }
  case 'library': {
    // Renders every specimen in one pass so a grammar regression shows up as a diffable file.
    const specs = JSON.parse(readFileSync(rest.find((a) => !a.startsWith('--'))!, 'utf8')) as FPInput[];
    const dir = flag('outDir') ?? '.';
    const report = specs.map((spec, i) => {
      if (flag('theme')) spec.theme = flag('theme');
      const { program, audit } = render(spec);
      const slug = `${String(i + 1).padStart(2, '0')}-${program.template}`;
      writeFileSync(`${dir}/${slug}.svg`, toSvg(program));
      return { slug, template: program.template, height: program.frame.height, ok: audit.ok, findings: audit.findings };
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.some((r) => !r.ok)) process.exit(1);
    break;
  }
  case 'tokens': {
    const pack = loadTheme(flag('theme') ?? 'fp-v1');
    emit(flag('format') === 'md' ? buildTokenDoc(pack) : JSON.stringify(buildTokenSpec(pack), null, 2));
    break;
  }
  case 'sheet': {
    // One page, frames tiled in rows by family, the way a report page is laid out.
    const specs = JSON.parse(readFileSync(rest.find((a) => !a.startsWith('--'))!, 'utf8')) as
      Array<FPInput & { family?: string }>;
    const gapX = Number(flag('gapX') ?? 160);
    const gapY = Number(flag('gapY') ?? 420);
    const perRow = Number(flag('perRow') ?? 4);
    const items: SheetItem[] = [];
    const byFamily = new Map<string, Array<FPInput & { family?: string }>>();
    for (const spec of specs) {
      const key = spec.family ?? 'Grammars';
      byFamily.set(key, [...(byFamily.get(key) ?? []), spec]);
    }
    // A whole sheet can exceed a plugin's payload limit, so it may be emitted one family
    // per script. Those scripts must share one running offset; laying each chunk out from
    // zero is what stacks every frame on top of the others.
    const chunkDir = flag('chunk');
    let y = Number(flag('offsetY') ?? 0);
    const chunks: Array<{ family: string; path: string; y: number }> = [];
    for (const [label, group] of byFamily) {
      let rowTop = y;
      let rowHeight = 0;
      group.forEach((spec, i) => {
        if (flag('theme')) spec.theme = flag('theme');
        const { program, audit } = render(spec);
        if (!audit.ok) throw new Error(`${spec.title}: ${JSON.stringify(audit.findings)}`);
        const col = i % perRow;
        if (col === 0 && i > 0) { rowTop += rowHeight + gapY; rowHeight = 0; }
        items.push({
          program,
          x: col * (program.frame.width + gapX),
          y: rowTop,
          label: i === 0 ? label : undefined,
        });
        rowHeight = Math.max(rowHeight, program.frame.height);
      });
      if (chunkDir) {
        const path = join(chunkDir, `${String(chunks.length).padStart(2, '0')}.js`);
        writeFileSync(path, toFigmaSheet(items.splice(0), {
          pageName: flag('page'), reusePage: true, clearPage: chunks.length === 0 && !rest.includes('--append'),
          readOnlyDocuments: flag('protect')?.split(',').map((t) => t.trim()).filter(Boolean),
        }));
        chunks.push({ family: label, path, y: rowTop });
      }
      y = rowTop + rowHeight + gapY;
    }
    if (chunkDir) { process.stdout.write(`${JSON.stringify(chunks, null, 2)}\n`); break; }
    if (rest.includes('--measure')) { process.stdout.write(`${y}\n`); break; }
    emit(toFigmaSheet(items, {
      pageName: flag('page'), reusePage: true, clearPage: !rest.includes('--append'),
      readOnlyDocuments: flag('protect')?.split(',').map((t) => t.trim()).filter(Boolean),
    }));
    break;
  }
  case 'brief': {
    const input = loadInput();
    emit(JSON.stringify(buildBrief(input, loadTheme(flag('theme') ?? input.theme ?? 'fp-v1')), null, 2));
    break;
  }
  case 'plan': {
    const input = loadInput();
    if (flag('theme')) input.theme = flag('theme');
    const { ir, program } = render(input);
    emit(JSON.stringify({ ir, program }, null, 2));
    break;
  }
  default:
    process.stderr.write('usage: fp <themes|recipes|doctor|brief|plan|svg|script|audit|library|sheet|tokens> [input.json] [--theme id] [--out file] [--page name] [--protect "A,B"]\n');
    process.exit(1);
}
