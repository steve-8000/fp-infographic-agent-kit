#!/usr/bin/env node
// Builds a release archive with a checksum manifest. Nothing is published from here.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stem = `${pkg.name}-${pkg.version}`;
const out = join(root, 'release');
mkdirSync(out, { recursive: true });

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
};

const included = pkg.files.flatMap((item) => {
  const full = join(root, item);
  try { return statSync(full).isDirectory() ? walk(full) : [full]; }
  catch { return []; }
});

const sums = included
  .map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${relative(root, file)}`)
  .sort();
writeFileSync(join(root, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

execFileSync('tar', ['-czf', join(out, `${stem}.tar.gz`), '-C', root,
  ...pkg.files, 'SHA256SUMS.txt'], { stdio: 'inherit' });

const archive = join(out, `${stem}.tar.gz`);
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(join(out, `${stem}.tar.gz.sha256`), `${digest}  ${stem}.tar.gz\n`);
process.stdout.write(`${relative(root, archive)}\n${digest}\n${sums.length} files\n`);
