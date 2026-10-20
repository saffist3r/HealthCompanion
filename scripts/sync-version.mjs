#!/usr/bin/env node
// Propagate the repo-root VERSION file to every package that reports a version.
//   node scripts/sync-version.mjs          # rewrite files
//   node scripts/sync-version.mjs --check  # exit 1 if anything is out of sync (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const check = process.argv.includes('--check');

const jsonVersion = (path, isCurrent, set) => ({
  path,
  update(text) {
    const data = JSON.parse(text);
    if (isCurrent(data)) return text;
    set(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  },
});

const targets = [
  jsonVersion('package.json', (d) => d.version === version, (d) => (d.version = version)),
  jsonVersion('frontend/package.json', (d) => d.version === version, (d) => (d.version = version)),
  jsonVersion('apps/mobile/package.json', (d) => d.version === version, (d) => (d.version = version)),
  jsonVersion('apps/mobile/app.json', (d) => d.expo.version === version, (d) => (d.expo.version = version)),
  jsonVersion(
    'package-lock.json',
    (d) => [d.version, d.packages[''].version, d.packages['apps/mobile'].version].every((v) => v === version),
    (d) => {
      d.version = version;
      d.packages[''].version = version;
      d.packages['apps/mobile'].version = version;
    }
  ),
  jsonVersion(
    'frontend/package-lock.json',
    (d) => d.version === version && d.packages[''].version === version,
    (d) => {
      d.version = version;
      d.packages[''].version = version;
    }
  ),
  {
    path: 'backend/app/__init__.py',
    update: (text) => text.replace(/__version__ = "[^"]*"/, `__version__ = "${version}"`),
  },
];

let stale = 0;
for (const target of targets) {
  const file = join(root, target.path);
  const before = readFileSync(file, 'utf8');
  const after = target.update(before);
  if (after === before) continue;
  stale += 1;
  if (check) {
    console.error(`${target.path} is not at version ${version}`);
  } else {
    writeFileSync(file, after);
    console.log(`${target.path} -> ${version}`);
  }
}

if (check && stale) {
  console.error('Run: node scripts/sync-version.mjs');
  process.exit(1);
}
