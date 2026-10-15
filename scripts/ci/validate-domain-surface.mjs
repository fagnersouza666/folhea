#!/usr/bin/env node
// Repository text contract: report locations, never file contents.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const retiredHost = /\bfolhea\.(?:com\.br|fagnersouza\.tech)\b/i;
try {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  const failures = [];
  for (const name of files) {
    const path = join(root, name);
    if (lstatSync(path).isSymbolicLink()) {
      failures.push(`${JSON.stringify(name)}: symlink cannot be inspected safely`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue; // Match the repository's text-search scope.
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      // Also reject escaped dots in source/regex fixtures, without echoing text.
      if (retiredHost.test(lines[index].replaceAll('\\', ''))) failures.push(`${JSON.stringify(name)}:${index + 1}`);
    }
  }
  if (failures.length) throw new Error('Retired domain references in tracked text:\n' + failures.join('\n'));
  console.log(`Domain surface: ${files.length} tracked paths checked; no retired hosts in text`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
