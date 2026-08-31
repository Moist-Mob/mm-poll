#!/usr/bin/env node
// The build pipeline. Deploys run this on the server ("clone, pull, build,
// launch"), so the tests gate everything; then css, vendored browser assets,
// and the typescript build. The first failing step stops the build.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const step = name => console.log(`\n=== ${name} ===`);

const run = (name, cmd, args) => {
  step(name);
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\nbuild step failed: ${name}`);
    process.exit(res.status ?? 1);
  }
};

// self-hosted third-party browser assets, copied out of node_modules into
// public/ so the app never depends on a CDN. public/vendor is gitignored;
// this step recreates it wherever the build runs.
// (no bundled css: the widget is restyled to match the site in style.css)
const VENDORED = ['accessible-autocomplete/dist/accessible-autocomplete.min.js'];

const vendor = () => {
  step('vendor');
  const dest = path.join(root, 'public', 'vendor');
  mkdirSync(dest, { recursive: true });
  for (const asset of VENDORED) {
    const from = path.join(root, 'node_modules', asset);
    if (!existsSync(from)) {
      console.error(`missing ${asset}; run pnpm i first`);
      process.exit(1);
    }
    const to = path.join(dest, path.basename(asset));
    copyFileSync(from, to);
    console.log(`${asset} -> ${path.relative(root, to)}`);
  }
};

// `--vendor-only` refreshes public/vendor without running the full build
// (useful in dev, where nothing else creates it)
if (process.argv.includes('--vendor-only')) {
  vendor();
  process.exit(0);
}

run('tests', 'npx', ['vitest', 'run']);
run('css', 'pnpm', ['run', 'build:css']);
vendor();
run('typescript', 'pnpm', ['run', 'build:node']);

console.log('\nbuild ok');
