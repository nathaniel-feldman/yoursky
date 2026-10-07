// The module engine must produce exactly what the pre-refactor classic scripts did (see scripts/make_baseline.mjs).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CFG } from '../app/src/config.js';
import { ENGINE } from '../app/src/engine.js';
import data from '../app/src/data.json';
import { CASES, snapshot, compact } from './fixtures/cases.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/engine-baseline.json', import.meta.url), 'utf8'));
const now = compact(JSON.parse(JSON.stringify(snapshot(ENGINE, CFG, data.schools, CASES))));

describe('engine parity with the pre-refactor scripts', () => {
  it('covers the same schools and cases', () => {
    expect(data.schools.length).toBe(203);
    expect(now.cases.map((c) => c.id)).toEqual(baseline.cases.map((c) => c.id));
  });

  for (const [i, c] of baseline.cases.entries()) {
    it(`matches every school for "${c.id}"`, () => {
      // Compare rows one at a time so a failure names the school instead of dumping 203 rows.
      for (const [j, row] of c.rows.entries()) expect(now.cases[i].rows[j], `school ${row.id}`).toEqual(row);
    });
  }

  it('matches share links, friend compatibility and helpers', () => {
    expect(now.share).toEqual(baseline.share);
    expect(now.compat).toEqual(baseline.compat);
    expect(now.misc).toEqual(baseline.misc);
  });
});
