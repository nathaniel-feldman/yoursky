// The Phase 3 chances heuristic (supabase/functions/_shared/chances.js).
import { describe, it, expect } from 'vitest';
import { estimateChance, gpaFloor, ALWAYS_REACH_BELOW } from '../../supabase/functions/_shared/chances.js';
import { CFG } from '../../app/src/config.js';

const est = (school, student) => estimateChance(school, student, CFG.ACT_TO_SAT);
const school = (over = {}) => ({ adm: 0.4, sat: [1200, 1400], act: [26, 31], ...over });

describe('always reach', () => {
  it('under 15% admit, even with perfect stats', () => {
    const r = est(school({ adm: 0.04, sat: [1500, 1580] }), { gpa: 4, sat: 1600 });
    expect(r).toMatchObject({ category: 'reach', basis: 'selectivity' });
    expect(r.reasons[0]).toMatch(/4%/);
  });
  it('the threshold is exactly 15%', () => {
    expect(ALWAYS_REACH_BELOW).toBe(0.15);
    expect(est(school({ adm: 0.1499 }), { gpa: 4, sat: 1600 }).category).toBe('reach');
    expect(est(school({ adm: 0.15 }), { gpa: 4, sat: 1600 }).category).toBe('target');
  });
});

describe('with a test score', () => {
  it('reads position in the middle 50% against selectivity', () => {
    // 40% admit: likely at/above the 75th, target from a quarter in, reach below.
    expect(est(school(), { sat: 1400 }).category).toBe('likely');
    expect(est(school(), { sat: 1260 }).category).toBe('target');
    expect(est(school(), { sat: 1220 }).category).toBe('reach');
    // 70% admit: likely from the middle, target slightly under the 25th.
    expect(est(school({ adm: 0.7 }), { sat: 1300 }).category).toBe('likely');
    expect(est(school({ adm: 0.7 }), { sat: 1160 }).category).toBe('target');
    expect(est(school({ adm: 0.7 }), { sat: 1100 }).category).toBe('reach');
    // 20% admit: never likely.
    expect(est(school({ adm: 0.2 }), { sat: 1600 }).category).toBe('target');
    expect(est(school({ adm: 0.2 }), { sat: 1390 }).category).toBe('reach');
  });

  it('compares ACT with ACT, and converts only when the school reports just the SAT', () => {
    const r = est(school(), { act: 31 });
    expect(r.reasons[0]).toMatch(/ACT is above their middle 50% \(26–31\)/);
    const conv = est(school({ act: null }), { act: 29 }); // ACT 29 ≈ SAT 1340
    expect(conv.reasons[0]).toMatch(/ACT \(converted\) is inside their middle 50% \(1200–1400\)/);
    expect(conv.category).toBe('target');
  });

  it('a GPA well under the band moves the result down a step, never below reach', () => {
    expect(est(school({ adm: 0.7 }), { sat: 1300, gpa: 3.5 }).category).toBe('likely');
    const low = est(school({ adm: 0.7 }), { sat: 1300, gpa: 2.0 });
    expect(low.category).toBe('target');
    expect(low.reasons.at(-1)).toMatch(/GPA is below/);
    expect(est(school(), { sat: 1210, gpa: 1.5 }).category).toBe('reach');
  });

  it('handles a tiny or inverted reported range without dividing by zero', () => {
    // A one-point range is widened to 60 points: 1300 sits at the bottom, 1360 at the top.
    expect(est(school({ sat: [1300, 1300] }), { sat: 1300 })).toMatchObject({ category: 'reach', basis: 'test' });
    expect(est(school({ sat: [1300, 1300] }), { sat: 1360 }).category).toBe('likely');
    expect(est(school({ sat: [1400, 1200] }), { sat: 1300, gpa: 3.6 }).basis).toBe('gpa');
  });

  it('with no admit rate, leans on scores alone and says so', () => {
    const r = est(school({ adm: null }), { sat: 1450 });
    expect(r.category).toBe('likely');
    expect(r.reasons.join(' ')).toMatch(/no admit rate/);
  });
});

describe('without a test score', () => {
  it('uses admit rate plus the GPA band, and says so', () => {
    const r = est(school({ adm: 0.8 }), { gpa: 3.0 });
    expect(r).toMatchObject({ category: 'likely', basis: 'gpa' });
    expect(r.reasons[0]).toMatch(/No test score/);
    expect(est(school({ adm: 0.8 }), { gpa: 2.2 }).category).toBe('target');
    expect(est(school({ adm: 0.6 }), { gpa: 3.3 }).category).toBe('likely');
    expect(est(school({ adm: 0.6 }), { gpa: 3.1 }).category).toBe('target');
    expect(est(school({ adm: 0.6 }), { gpa: 2.6 }).category).toBe('reach');
    expect(est(school({ adm: 0.35 }), { gpa: 3.5 }).category).toBe('target');
    expect(est(school({ adm: 0.2 }), { gpa: 3.95 }).category).toBe('target');
    expect(est(school({ adm: 0.2 }), { gpa: 3.8 }).category).toBe('reach');
  });

  it('notes when the school reports no score range for the test the student took', () => {
    const r = est(school({ sat: null, act: null }), { sat: 1400, gpa: 3.8 });
    expect(r.basis).toBe('gpa');
    expect(r.reasons[0]).toMatch(/report no score range/);
  });

  it('falls back to admit rate alone with no GPA either', () => {
    expect(est(school({ adm: 0.75 }), {})).toMatchObject({ category: 'likely', basis: 'admit_rate' });
    expect(est(school({ adm: 0.45 }), {}).category).toBe('target');
    expect(est(school({ adm: 0.25 }), {}).category).toBe('reach');
    expect(est(school({ adm: 0.45 }), {}).reasons[0]).toMatch(/admit rate only/);
  });

  it('returns no category when there is no admit rate and no usable range', () => {
    expect(est({ adm: null, sat: null, act: null }, { gpa: 3.9 })).toEqual({ category: null, basis: 'none', reasons: ['Not enough public data for an estimate'] });
    expect(est({}, {}).category).toBeNull();
  });
});

describe('extreme and invalid inputs', () => {
  it('ignores impossible values instead of crashing', () => {
    expect(est(school(), { sat: 99999, gpa: -1 }).category).toBe('likely');
    expect(est(school(), { sat: 10, act: 0, gpa: 'x' }).basis).toBe('admit_rate');
    expect(est(school({ adm: 0 }), { sat: 1300 }).reasons.join(' ')).toMatch(/no admit rate/);
  });
  it('never returns a percentage chance', () => {
    const all = [est(school(), { sat: 1300 }), est(school({ adm: 0.9 }), { gpa: 3 }), est(school({ adm: 0.1 }), {})];
    for (const r of all) for (const t of r.reasons) expect(t).not.toMatch(/chance|probability|\d+% (chance|likely)/i);
  });
  it('GPA floors rise with selectivity', () => {
    expect([0.2, 0.4, 0.6, 0.9].map(gpaFloor)).toEqual([3.7, 3.4, 3.0, 2.5]);
  });
});
