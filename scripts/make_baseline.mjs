#!/usr/bin/env node
// Records what the pre-refactor engine (classic scripts at commit 2ee6dd0) outputs for fixed students,
// so tests/parity.test.js can prove the module version behaves identically.
//
// Usage: node scripts/make_baseline.mjs [commit]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { CASES, snapshot, compact } from '../tests/fixtures/cases.mjs';

const commit = process.argv[2] || '2ee6dd0';
const show = (path) => execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 });

const ctx = { window: {}, btoa, atob };
vm.createContext(ctx);
for (const f of ['app/data.js', 'app/config.js', 'app/engine.js']) vm.runInContext(show(f), ctx, { filename: f });
const { ORBIT_DATA, CFG, ENGINE } = ctx.window;

// vm objects come from another realm; round-trip through JSON so the fixture is plain data.
const out = compact(JSON.parse(JSON.stringify({ commit, ...snapshot(ENGINE, CFG, ORBIT_DATA.schools, CASES) })));
mkdirSync('tests/fixtures', { recursive: true });
writeFileSync('tests/fixtures/engine-baseline.json', JSON.stringify(out, null, 0) + '\n');
console.log(`Wrote tests/fixtures/engine-baseline.json from ${commit}: ${out.cases.length} cases × ${ORBIT_DATA.schools.length} schools`);
