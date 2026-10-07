#!/usr/bin/env node
// Records what the engine outputs for fixed students, so tests/parity.test.js can catch any unintended change.
//
//   node scripts/make_baseline.mjs 2ee6dd0   from the pre-refactor classic scripts at a commit (vm sandbox)
//   node scripts/make_baseline.mjs current   from the current modules, after an intentional scoring change
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CASES, snapshot, compact } from '../tests/fixtures/cases.mjs';

const source = process.argv[2] || '2ee6dd0';
let engine, cfg, schools;
if (source === 'current') {
  ({ ENGINE: engine } = await import('../app/src/engine.js'));
  ({ CFG: cfg } = await import('../app/src/config.js'));
  schools = JSON.parse(readFileSync('app/src/data.json', 'utf8')).schools;
} else {
  const show = (path) => execFileSync('git', ['show', `${source}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const ctx = { window: {}, btoa, atob };
  vm.createContext(ctx);
  for (const f of ['app/data.js', 'app/config.js', 'app/engine.js']) vm.runInContext(show(f), ctx, { filename: f });
  ({ ORBIT_DATA: { schools }, CFG: cfg, ENGINE: engine } = ctx.window);
}

// vm objects come from another realm; round-trip through JSON so the fixture is plain data.
const commit = source === 'current' ? execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() : source;
const out = compact(JSON.parse(JSON.stringify({ commit, ...snapshot(engine, cfg, schools, CASES) })));
mkdirSync('tests/fixtures', { recursive: true });
writeFileSync('tests/fixtures/engine-baseline.json', JSON.stringify(out) + '\n');
console.log(`Wrote tests/fixtures/engine-baseline.json from ${source} (${commit}): ${out.cases.length} cases × ${schools.length} schools`);
