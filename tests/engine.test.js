// Edge cases for the current engine. These describe today's behavior; Phase 3 replaces the chance heuristic.
import { describe, it, expect } from 'vitest';
import { ENGINE as E } from '../app/src/engine.js';
import data from '../app/src/data.json';

const P = { name: '', gpa: null, testMode: 'sat', sat: null, act: null, major: null, major2: null, budget: null, dorm: true, region: null, state: null };
const school = (over = {}) => ({ id: 1, n: 'Test', s: 'OH', lat: 40, lon: -83, loc: 21, pub: 0, adm: 0.5, sat: [1200, 1400], size: 5000, sfr: 14, prog: {}, x: '', ...over });

describe('chanceOf', () => {
  it('treats admit rates under 12% as a reach whatever the stats', () => {
    expect(E.chanceOf(school({ adm: 0.05 }), { ...P, sat: 1600, gpa: 4 }).cat).toBe('reach');
  });
  it('falls back to admit rate alone with no GPA or score', () => {
    expect(E.chanceOf(school({ adm: 0.2 }), P).cat).toBe('reach');
    expect(E.chanceOf(school({ adm: 0.5 }), P).cat).toBe('target');
    expect(E.chanceOf(school({ adm: 0.9 }), P).cat).toBe('likely');
  });
  it('handles a school with no admit rate or SAT range', () => {
    const r = E.chanceOf(school({ adm: null, sat: null }), { ...P, sat: 1300, gpa: 3.5 });
    expect(['reach', 'target', 'likely']).toContain(r.cat);
    expect(r.adm).toBe(0.6);
  });
  it('converts ACT to SAT and ignores scores in test-optional mode', () => {
    expect(E.satOf({ testMode: 'act', act: 36 })).toBeGreaterThan(1500);
    expect(E.satOf({ testMode: 'none', sat: 1500 })).toBeNull();
  });
});

describe('costOf', () => {
  it('uses the income bracket when the school reports it', () => {
    const s = school({ coa: 60000, net: 30000, nbi: [5000, 10000, 15000, 20000, 25000] });
    const c = E.costOf(s, P, 1);
    expect(c.est).toBe(10000);
    expect(c.basis).toMatch(/income range/);
  });
  it('falls back to 70% of sticker with no net price at all', () => {
    const c = E.costOf(school({ coa: 50000 }), P, null);
    expect(c.est).toBe(35000);
  });
  it('never estimates more than the sticker price', () => {
    const s = school({ coa: 20000, net: 90000 });
    expect(E.costOf(s, P, null).est).toBeLessThanOrEqual(20000);
  });
  it('adds out-of-state tuition at publics', () => {
    const s = school({ pub: 1, s: 'MI', tin: 15000, tout: 50000, coa: 32000, net: 18000 });
    const inState = E.costOf(s, { ...P, region: 'mw', state: 'MI' }, null);
    const out = E.costOf(s, { ...P, region: 'ne', state: 'NY' }, null);
    expect(out.est).toBeGreaterThan(inState.est);
    expect(out.sticker - inState.sticker).toBe(35000);
  });
});

describe('score', () => {
  it('scores every real school without throwing, for an empty profile', () => {
    for (const s of data.schools) {
      const r = E.score(s, P, {}, null);
      expect(r.fit).toBeGreaterThanOrEqual(0);
      expect(r.fit).toBeLessThanOrEqual(100);
    }
  });
});

describe('share links', () => {
  it('round-trips and never includes grades, scores or budget', () => {
    const enc = E.encodeShare({ profile: { ...P, name: 'Sam', gpa: 3.9, sat: 1500, budget: 30000, major: 'cs', region: 'ne' }, answers: { size: 40 }, kept: [166027] });
    const json = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    expect(json).not.toMatch(/3\.9|1500|30000/);
    expect(E.decodeShare(enc)).toMatchObject({ n: 'Sam', m: 'cs', k: [166027], a: { size: 40 } });
  });
  it('rejects garbage', () => {
    expect(E.decodeShare('%%%')).toBeNull();
  });
});
