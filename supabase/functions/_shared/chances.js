// Admission chances: a simple, transparent heuristic over public College Scorecard data.
//
// It is an estimate, not a prediction. It only knows a school's admit rate and the middle 50% of admitted students'
// SAT/ACT scores, plus the student's GPA and scores. Essays, courses, recommendations, major, residency and
// everything else that drives real decisions are invisible to it. The UI always shows:
//   "Estimate based on public data — not a prediction."
// and never a percentage chance.
//
// Rules, in order:
//   1. Under 15% admit rate → Reach, whatever the stats. Nobody is a sure thing there.
//   2. With a test score and the school's middle-50% range for that test, place the score in the range:
//        position = (score − 25th) / (75th − 25th)    0 = at the 25th percentile, 1 = at the 75th
//      and read the category from the table below (more selective schools need a higher position).
//   3. With no usable score (test-optional, not taken, or the school reports no range), use admit rate plus a GPA
//      band for that level of selectivity, and say so.
//   4. With neither score nor GPA, use admit rate alone, and say so.
//   5. A GPA below the school's band moves a test-based result down one step.
//   6. With no admit rate and no score range, there isn't enough data: category is null.
//
// Category names follow the rest of the app: reach / target / likely ("likely" rather than "safety", since nothing
// in public data makes admission certain).

/** @typedef {'reach' | 'target' | 'likely'} Category */

export const ALWAYS_REACH_BELOW = 0.15;

// Minimum position in the middle-50% range for each category, by admit rate.
//   admit ≥ 50%:     likely from the middle (0.5), target from a bit below the 25th (−0.25)
//   admit 30–50%:    likely from the 75th (1.0),   target from a quarter of the way in (0.25)
//   admit 15–30%:    never likely,                 target from the 75th (1.0)
const POSITION_TABLE = [
  { minAdmit: 0.5, likely: 0.5, target: -0.25 },
  { minAdmit: 0.3, likely: 1.0, target: 0.25 },
  { minAdmit: ALWAYS_REACH_BELOW, likely: Infinity, target: 1.0 },
];

// Unweighted GPA that admitted students at a school this selective typically meet or beat.
export function gpaFloor(admit) {
  if (admit < 0.3) return 3.7;
  if (admit < 0.5) return 3.4;
  if (admit < 0.7) return 3.0;
  return 2.5;
}

const STEP_DOWN = { likely: 'target', target: 'reach', reach: 'reach' };
const pct = (v) => `${Math.round(v * 100)}%`;
const valid = (r) => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number' && x > 0) && r[1] >= r[0];

/**
 * @param {{ adm?: number|null, sat?: [number, number]|null, act?: [number, number]|null }} school
 * @param {{ gpa?: number|null, sat?: number|null, act?: number|null }} student  sat and act are raw scores; pass only
 *   the ones the student wants considered (test-optional students pass neither).
 * @param {Record<number, number>} [actToSat]  concordance used when the school reports only the other test
 * @returns {{ category: Category|null, basis: 'test'|'gpa'|'admit_rate'|'selectivity'|'none', reasons: string[] }}
 */
export function estimateChance(school, student, actToSat = {}) {
  const adm = typeof school.adm === 'number' && school.adm > 0 ? school.adm : null;
  const gpa = typeof student.gpa === 'number' && student.gpa > 0 ? student.gpa : null;

  // 1. Highly selective: always a reach.
  if (adm != null && adm < ALWAYS_REACH_BELOW) {
    return { category: 'reach', basis: 'selectivity', reasons: [`They admit ${pct(adm)} of applicants, so it's a reach for everyone`] };
  }

  // 2. Test-based: compare like with like, converting ACT→SAT only when the school reports just the SAT.
  const test = pickTest(school, student, actToSat);
  if (test) {
    const span = Math.max(test.range[1] - test.range[0], test.range[1] > 36 ? 60 : 2); // minimum spread: 60 SAT points or 2 ACT points
    const position = (test.score - test.range[0]) / span;
    const where = test.score >= test.range[1] ? 'above' : test.score >= test.range[0] ? 'inside' : 'below';
    const reasons = [`Your ${test.name} ${test.converted ? '(converted) ' : ''}is ${where} their middle 50% (${test.range[0]}–${test.range[1]})`];
    let category;
    if (adm == null) {
      category = position >= 1 ? 'likely' : position >= 0.25 ? 'target' : 'reach';
      reasons.push('They report no admit rate, so this leans on scores alone');
    } else {
      const row = POSITION_TABLE.find((r) => adm >= r.minAdmit);
      category = position >= row.likely ? 'likely' : position >= row.target ? 'target' : 'reach';
      reasons.push(`They admit ${pct(adm)} of applicants`);
    }
    // 5. A GPA well under the school's usual range pulls the estimate down a step.
    if (gpa != null && adm != null && gpa < gpaFloor(adm) - 0.2 && category !== 'reach') {
      category = STEP_DOWN[category];
      reasons.push(`Your GPA is below what admitted students usually have`);
    }
    return { category, basis: 'test', reasons };
  }

  // 6. Nothing to go on.
  if (adm == null) return { category: null, basis: 'none', reasons: ['Not enough public data for an estimate'] };

  // 3. GPA and admit rate.
  const noScoreNote = student.sat || student.act ? 'They report no score range, so this uses your GPA and their admit rate' : 'No test score, so this uses your GPA and their admit rate';
  if (gpa != null) {
    const floor = gpaFloor(adm);
    let category;
    if (adm >= 0.7) category = gpa >= floor ? 'likely' : 'target';
    else if (adm >= 0.5) category = gpa >= floor + 0.2 ? 'likely' : gpa >= floor ? 'target' : 'reach';
    else if (adm >= 0.3) category = gpa >= floor ? 'target' : 'reach';
    else category = gpa >= 3.9 ? 'target' : 'reach';
    return { category, basis: 'gpa', reasons: [noScoreNote, `They admit ${pct(adm)} of applicants`] };
  }

  // 4. Admit rate only.
  const category = adm >= 0.7 ? 'likely' : adm >= 0.4 ? 'target' : 'reach';
  return { category, basis: 'admit_rate', reasons: [`Based on their ${pct(adm)} admit rate only; add your GPA or a test score for a better estimate`] };
}

function pickTest(school, student, actToSat) {
  const sat = typeof student.sat === 'number' && student.sat >= 400 ? student.sat : null;
  const act = typeof student.act === 'number' && student.act >= 1 ? student.act : null;
  if (act != null && valid(school.act)) return { name: 'ACT', score: act, range: school.act };
  if (sat != null && valid(school.sat)) return { name: 'SAT', score: sat, range: school.sat };
  if (act != null && valid(school.sat) && actToSat[act]) return { name: 'ACT', score: actToSat[act], range: school.sat, converted: true };
  return null;
}
