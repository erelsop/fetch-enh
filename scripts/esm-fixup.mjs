#!/usr/bin/env node
/**
 * Post-build fixup for the ESM output in dist/esm/:
 *
 *   1. Rewrites extensionless relative imports  (`'./foo'` → `'./foo.js'`)
 *      so that native Node.js ESM resolution works without a bundler.
 *   2. Writes {"type":"module"} to dist/esm/package.json so Node treats
 *      the .js files in that directory as ES modules.
 *
 * Run automatically as part of `npm run build` / `npm run build:esm`.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ESM_DIR = join(__dirname, '..', 'dist', 'esm');

/** Returns true when the path segment already carries a file extension. */
function hasExtension(p) {
  const last = p.split('/').pop() ?? '';
  return last.includes('.');
}

/** Appends .js to a relative path that has no extension. */
function ensureJsExt(p) {
  return hasExtension(p) ? p : `${p}.js`;
}

/** Rewrites all extensionless relative imports / dynamic imports in a JS file. */
function processFile(filePath) {
  let src = readFileSync(filePath, 'utf8');

  // static:  from './foo'   or  from "../foo"
  src = src.replace(
    /\bfrom\s+(['"])(\.{1,2}\/[^'"]+)\1/g,
    (_, q, p) => `from ${q}${ensureJsExt(p)}${q}`,
  );

  // dynamic: import('./foo')  or  import("../foo")
  src = src.replace(
    /\bimport\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g,
    (_, q, p) => `import(${q}${ensureJsExt(p)}${q})`,
  );

  writeFileSync(filePath, src, 'utf8');
}

/** Recursively walks a directory and processes every .js file. */
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (extname(full) === '.js') {
      processFile(full);
    }
  }
}

walk(ESM_DIR);

writeFileSync(
  join(ESM_DIR, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
  'utf8',
);

console.log('[esm-fixup] .js extensions added; dist/esm/package.json written.');
