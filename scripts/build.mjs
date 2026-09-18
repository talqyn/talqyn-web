#!/usr/bin/env node
// Builds the package: ES modules and declarations per source file with tsc — what a bundler of the site
// imports and tree-shakes — and one minified script for a page that loads the SDK with a script tag.

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });

const isWindows = process.platform === 'win32';
const tsc = join(root, 'node_modules', '.bin', isWindows ? 'tsc.cmd' : 'tsc');
const compiled = spawnSync(tsc, ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit', shell: isWindows });
if (compiled.error) {
  console.error(`could not run tsc: ${compiled.error.message}`);
  process.exit(1);
}
if (compiled.status !== 0) {
  console.error(`tsc exited with ${compiled.status ?? compiled.signal}`);
  process.exit(compiled.status ?? 1);
}

// The script-tag build: everything under one global, `window.TalqynWeb`.
const outfile = join(dist, 'talqyn.global.js');
await esbuild.build({
  entryPoints: [join(root, 'src', 'global.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'TalqynWeb',
  minify: true,
  sourcemap: true,
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'warning',
});

const bytes = statSync(outfile).size;
const gzipped = gzipSync(readFileSync(outfile)).length;
const kib = (count) => `${(count / 1024).toFixed(1)} KiB`;
console.log(`dist/talqyn.global.js  ${kib(bytes)} (gzip ${kib(gzipped)})`);
