// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Bundles src/client/main.ts into one classic script and writes it as a
// string constant to src/site/client-script.generated.ts. The generated file
// is committed; test/client-bundle.test.ts fails if it is out of date.
// Usage: node scripts/build-client.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleClient, OUTPUT } from './client-bundle.mjs';

const root = join(import.meta.dirname, '..');
const target = join(root, OUTPUT);
const generated = await bundleClient(root);
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== generated) {
    process.stderr.write(`${OUTPUT} is out of date. Run: npm run build:client\n`);
    process.exit(1);
  }
} else {
  writeFileSync(target, generated);
  process.stdout.write(`Wrote ${OUTPUT}\n`);
}
