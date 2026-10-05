// Static configuration: majors, regions, climate, questions, activities.
(function () {
  // Metal tints per major family: [r,g,b] multipliers applied to silver.
  const METALS = {
    explore: { name: 'polished silver', tint: [1, 1, 1] },
    tech: { name: 'blue steel', tint: [0.86, 0.93, 1.08] },
    science: { name: 'titanium', tint: [0.9, 1.0, 1.0] },
    health: { name: 'verdigris', tint: [0.86, 1.02, 0.94] },
    biz: { name: 'champagne gold', tint: [1.08, 1.0, 0.84] },
    social: { name: 'pewter', tint: [0.96, 0.94, 1.02] },
    hum: { name: 'bronze', tint: [1.1, 0.94, 0.8] },
    arts: { name: 'rose gold', tint: [1.1, 0.92, 0.9] },
  };

  // progs: Scorecard program_percentage keys (share of graduates by field).
  const MAJORS = [
    { id: 'undecided', label: 'Undecided', fam: 'explore', progs: [] },
    { id: 'cs', label: 'Computer Science', fam: 'tech', progs: ['computer'] },
    { id: 'engineering', label: 'Engineering', fam: 'tech', progs: ['engineering'] },
    { id: 'business', label: 'Business', fam: 'biz', progs: ['business_marketing'] },
    { id: 'bio', label: 'Biology / Pre-med', fam: 'health', progs: ['biological'] },
    { id: 'psych', label: 'Psychology', fam: 'social', progs: ['psychology'] },
    { id: 'nursing', label: 'Nursing', fam: 'health', progs: ['health'] },
    { id: 'econ', label: 'Economics', fam: 'biz', progs: ['social_science'] },
    { id: 'polisci', label: 'Political Science', fam: 'social', progs: ['social_science'] },
    { id: 'comms', label: 'Communications & Journalism', fam: 'arts', progs: ['communication'] },
    { id: 'data', label: 'Data Science & Statistics', fam: 'tech', progs: ['mathematics', 'computer'] },
    { id: 'math', label: 'Mathematics', fam: 'science', progs: ['mathematics'] },
    { id: 'physsci', label: 'Physics & Chemistry', fam: 'science', progs: ['physical_science'] },
    { id: 'neuro', label: 'Neuroscience', fam: 'health', progs: ['biological', 'psychology'] },
    { id: 'env', label: 'Environmental Science', fam: 'science', progs: ['resources', 'biological'] },
    { id: 'publichealth', label: 'Public Health', fam: 'health', progs: ['health'] },
    { id: 'kines', label: 'Kinesiology & Sports Science', fam: 'health', progs: ['parks_recreation_fitness', 'health'] },
    { id: 'english', label: 'English & Creative Writing', fam: 'hum', progs: ['english'] },
    { id: 'history', label: 'History', fam: 'hum', progs: ['history'] },
    { id: 'philosophy', label: 'Philosophy & Religion', fam: 'hum', progs: ['philosophy_religious'] },
    { id: 'languages', label: 'Languages & Linguistics', fam: 'hum', progs: ['language'] },
    { id: 'ir', label: 'International Relations', fam: 'social', progs: ['social_science'] },
    { id: 'sociology', label: 'Sociology & Anthropology', fam: 'social', progs: ['social_science'] },
    { id: 'education', label: 'Education', fam: 'social', progs: ['education'] },
    { id: 'crimjustice', label: 'Criminal Justice', fam: 'social', progs: ['security_law_enforcement'] },
    { id: 'art', label: 'Art & Design', fam: 'arts', progs: ['visual_performing'] },
    { id: 'music', label: 'Music', fam: 'arts', progs: ['visual_performing'] },
    { id: 'film', label: 'Film & Media', fam: 'arts', progs: ['visual_performing', 'communication'] },
    { id: 'theater', label: 'Theater & Dance', fam: 'arts', progs: ['visual_performing'] },
    { id: 'architecture', label: 'Architecture', fam: 'arts', progs: ['architecture'] },
    { id: 'gamedesign', label: 'Game Design', fam: 'tech', progs: ['computer', 'visual_performing'] },
    { id: 'agriculture', label: 'Agriculture & Food Science', fam: 'science', progs: ['agriculture'] },
  ];
  const POPULAR = ['undecided', 'cs', 'business', 'bio', 'engineering', 'psych', 'nursing', 'econ', 'art', 'polisci'];

  const STATES = {
    AL: ['Alabama', 32.8, -86.8], AK: ['Alaska', 61.2, -149.9], AZ: ['Arizona', 33.9, -111.9], AR: ['Arkansas', 34.9, -92.4],
    CA: ['California', 36.2, -119.6], CO: ['Colorado', 39.4, -105.3], CT: ['Connecticut', 41.6, -72.7], DE: ['Delaware', 39.2, -75.5],
    DC: ['Washington, D.C.', 38.9, -77.0], FL: ['Florida', 28.2, -81.9], GA: ['Georgia', 33.2, -83.6], HI: ['Hawaii', 21.3, -157.8],
    ID: ['Idaho', 43.9, -115.4], IL: ['Illinois', 41.0, -88.6], IN: ['Indiana', 39.9, -86.3], IA: ['Iowa', 41.9, -93.3],
    KS: ['Kansas', 38.5, -97.0], KY: ['Kentucky', 37.8, -85.3], LA: ['Louisiana', 30.7, -91.5], ME: ['Maine', 44.2, -69.8],
    MD: ['Maryland', 39.1, -76.8], MA: ['Massachusetts', 42.3, -71.4], MI: ['Michigan', 42.9, -84.6], MN: ['Minnesota', 45.3, -93.6],
    MS: ['Mississippi', 32.6, -89.7], MO: ['Missouri', 38.5, -92.3], MT: ['Montana', 46.5, -110.6], NE: ['Nebraska', 41.1, -97.4],
    NV: ['Nevada', 37.6, -116.4], NH: ['New Hampshire', 43.2, -71.5], NJ: ['New Jersey', 40.4, -74.5], NM: ['New Mexico', 34.8, -106.4],
    NY: ['New York', 41.6, -74.6], NC: ['North Carolina', 35.6, -79.4], ND: ['North Dakota', 47.4, -99.3], OH: ['Ohio', 40.3, -82.8],
    OK: ['Oklahoma', 35.6, -97.0], OR: ['Oregon', 44.6, -122.4], PA: ['Pennsylvania', 40.5, -76.9], RI: ['Rhode Island', 41.8, -71.4],
    SC: ['South Carolina', 33.9, -80.9], SD: ['South Dakota', 44.0, -99.4], TN: ['Tennessee', 35.8, -86.4], TX: ['Texas', 30.9, -97.4],
    UT: ['Utah', 40.4, -111.8], VT: ['Vermont', 44.2, -72.8], VA: ['Virginia', 37.8, -77.8], WA: ['Washington', 47.3, -121.6],
    WV: ['West Virginia', 38.7, -80.6], WI: ['Wisconsin', 43.8, -89.2], WY: ['Wyoming', 42.8, -107.5],
  };

  // angle: direction the light comes from on the student's planet (degrees, 0 = right, -90 = top).
  const REGIONS = [
    { id: 'ne', label: 'New England', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'], angle: -40 },
    { id: 'ma', label: 'Mid-Atlantic', states: ['NY', 'NJ', 'PA', 'DE', 'MD', 'DC'], angle: -15 },
    { id: 'se', label: 'Southeast', states: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'KY', 'TN', 'AL', 'MS'], angle: 30 },
    { id: 'mw', label: 'Midwest', states: ['OH', 'IN', 'IL', 'MI', 'WI', 'MN', 'IA', 'MO', 'KS', 'NE', 'SD', 'ND'], angle: -90 },
    { id: 'sc', label: 'Texas & South Central', states: ['TX', 'OK', 'AR', 'LA'], angle: 90 },
    { id: 'mt', label: 'Mountain West', states: ['CO', 'UT', 'WY', 'MT', 'ID', 'NV', 'AZ', 'NM'], angle: -140 },
    { id: 'pc', label: 'West Coast & Pacific', states: ['CA', 'OR', 'WA', 'AK', 'HI'], angle: 180 },
    { id: 'intl', label: 'Outside the U.S.', states: [], angle: 140 },
  ];
  for (const r of REGIONS) {
    if (!r.states.length) continue;
    const pts = r.states.filter((s) => s !== 'AK' && s !== 'HI').map((s) => STATES[s]);
    r.lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    r.lon = pts.reduce((a, p) => a + p[2], 0) / pts.length;
  }

  // Climate profiles: how well a state matches each weather preference.
  const CLIMATE = {
    warm: { sun: 1, seasons: 0.2, snow: 0, mild: 0.45 },
    socal: { sun: 1, seasons: 0.1, snow: 0, mild: 0.85 },
    temperate: { sun: 0.6, seasons: 0.85, snow: 0.2, mild: 0.6 },
    fourseason: { sun: 0.3, seasons: 1, snow: 0.55, mild: 0.3 },
    cold: { sun: 0.1, seasons: 0.8, snow: 1, mild: 0.1 },
    mountain: { sun: 0.7, seasons: 0.85, snow: 1, mild: 0.2 },
    pacific: { sun: 0.25, seasons: 0.45, snow: 0.1, mild: 1 },
  };
  const STATE_CLIMATE = {};
  'FL HI AZ TX LA MS AL GA SC'.split(' ').forEach((s) => (STATE_CLIMATE[s] = 'warm'));
  'NC VA TN KY AR OK NM NV'.split(' ').forEach((s) => (STATE_CLIMATE[s] = 'temperate'));
  'NJ PA MD DE DC MO KS'.split(' ').forEach((s) => (STATE_CLIMATE[s] = 'fourseason'));
  'ME NH VT MA RI CT NY OH MI IN IL WI MN IA NE ND SD WV AK'.split(' ').forEach((s) => (STATE_CLIMATE[s] = 'cold'));
  'CO UT MT WY ID'.split(' ').forEach((s) => (STATE_CLIMATE[s] = 'mountain'));
  'WA OR'.split(' ').forEach((s) => (STATE_CLIMATE[s] = 'pacific'));
  const climateOf = (s) => (s.s === 'CA' ? (s.lat < 35.2 ? 'socal' : 'pacific') : STATE_CLIMATE[s.s] || 'fourseason');

  const MOUNTAIN_STATES = new Set(['CO', 'UT', 'WY', 'MT', 'ID', 'VT', 'NH', 'ME', 'WA', 'OR']);
  const SKI = (s) => ['CO', 'UT', 'WY', 'MT', 'ID', 'VT', 'NH', 'ME', 'WA', 'OR'].includes(s.s) ||
    (['NY', 'MI', 'WI', 'MN', 'MA'].includes(s.s) && s.lat > 42.2) || (s.s === 'CA' && s.lat > 37.5 && s.lon > -122);
  const BEACH = (s) => ['HI', 'FL'].includes(s.s) || (s.s === 'CA' && s.lon < -117.1) ||
    (['NC', 'SC'].includes(s.s) && s.lon > -79.5) || (s.s === 'VA' && s.lon > -76.6) || (s.s === 'TX' && s.lon > -95.5 && s.lat < 30);
  const pct = (s, k) => (s.prog && s.prog[k]) || 0;
  const big = (s) => (s.size || 0) > 15000;
  const r1 = (s) => s.cb === 15;
  const city = (s) => s.loc && s.loc <= 13;
  const lac = (s) => s.cb === 21;
  const has = (s, f) => (s.x || '').includes(f);

  // Each activity scores a school 0..1 and explains a strong match.
  const ACTIVITIES = [
    { id: 'varsity', label: 'Varsity sports', score: (s) => (has(s, 'S') ? 1 : big(s) ? 0.6 : 0.45), why: 'Division I athletics' },
    { id: 'gameday', label: 'Game days', score: (s) => (has(s, 'S') ? 1 : 0.1), why: 'Packed stadium on game days' },
    { id: 'greek', label: 'Greek life', score: (s) => (has(s, 'G') ? 1 : has(s, 'S') ? 0.6 : 0.2), why: 'Big Greek life' },
    { id: 'theater', label: 'Theater', score: (s) => Math.min(1, pct(s, 'visual_performing') * 9 + (lac(s) ? 0.35 : 0.1)), why: 'Lots of students in the performing arts' },
    { id: 'music', label: 'Music', score: (s) => Math.min(1, pct(s, 'visual_performing') * 7 + (city(s) ? 0.4 : 0.3)), why: 'Strong music scene' },
    { id: 'art', label: 'Art & design', score: (s) => (has(s, 'A') ? 1 : Math.min(1, pct(s, 'visual_performing') * 8 + 0.2)), why: 'Serious studio art community' },
    { id: 'film', label: 'Film', score: (s) => Math.min(1, (pct(s, 'visual_performing') + pct(s, 'communication')) * 5 + (city(s) ? 0.25 : 0)), why: 'Film and media students everywhere' },
    { id: 'debate', label: 'Debate & politics', score: (s) => (s.s === 'DC' ? 1 : Math.min(1, pct(s, 'social_science') * 3 + (city(s) ? 0.3 : 0.15))), why: 'Politically engaged campus' },
    { id: 'hackathons', label: 'Hackathons', score: (s) => Math.min(1, pct(s, 'computer') * 6 + (r1(s) ? 0.3 : 0.1)), why: 'Big CS community and hackathons' },
    { id: 'research', label: 'Research', score: (s) => (r1(s) ? 1 : lac(s) ? 0.7 : 0.35), why: 'Undergrad research is easy to find' },
    { id: 'startups', label: 'Startups', score: (s) => Math.min(1, (city(s) ? 0.4 : 0.1) + (r1(s) ? 0.3 : 0) + pct(s, 'business_marketing') * 1.5 + pct(s, 'computer') * 2), why: 'Startup and founder scene' },
    { id: 'outdoors', label: 'Outdoors', score: (s) => (MOUNTAIN_STATES.has(s.s) ? 0.9 : 0.3) + (s.loc >= 31 ? 0.1 : 0), why: 'Trails and mountains nearby' },
    { id: 'ski', label: 'Skiing', score: (s) => (SKI(s) ? 1 : 0.05), why: 'Ski slopes within driving distance' },
    { id: 'beach', label: 'Beach', score: (s) => (BEACH(s) ? 1 : 0.05), why: 'Beach is close' },
    { id: 'service', label: 'Service', score: (s) => (s.rel ? 0.85 : 0.65), why: 'Service is part of campus life' },
    { id: 'faith', label: 'Faith', score: (s) => (s.rel ? 1 : 0.4), why: 'Religious tradition is part of the school' },
  ];

  const QUESTIONS = [
    {
      id: 'setting', type: 'tap', eyebrow: 'Setting', title: 'Where do you picture yourself walking to class?',
      options: [
        { v: 'city', l: 'Big city', d: 'Subways, internships, noise' },
        { v: 'town', l: 'College town', d: 'The school is the town' },
        { v: 'suburb', l: 'Suburbs', d: 'Leafy, a train ride from a city' },
        { v: 'rural', l: 'Out in nature', d: 'Trees, quiet, real stars' },
      ],
    },
    { id: 'size', type: 'slider', eyebrow: 'Class size', title: 'How big should your classes feel?', left: 'Twelve around a table', right: 'Three hundred in a hall', mid: 'A bit of both', short: ['small classes', 'mid-size classes', 'big lectures'] },
    {
      id: 'distance', type: 'slider', eyebrow: 'Distance', title: 'How far from home?', left: 'Close to home', right: 'As far as possible', mid: 'A few hours away',
      short: ['close to home', 'a few hours away', 'far from home'], intl: 'You live outside the U.S., so distance is skipped.',
    },
    {
      id: 'weather', type: 'tap', eyebrow: 'Weather', title: 'What weather do you want to wake up to?',
      options: [
        { v: 'sun', l: 'Sunny and warm', d: 'Flip-flops in February' },
        { v: 'seasons', l: 'Four real seasons', d: 'Leaves, snow, spring' },
        { v: 'snow', l: 'Bring on winter', d: 'Snow days are a feature' },
        { v: 'mild', l: 'Mild, never extreme', d: 'Hoodie weather all year' },
      ],
    },
    {
      id: 'curriculum', type: 'tap', eyebrow: 'Curriculum', title: 'How do you want to choose your classes?',
      options: [
        { v: 'open', l: 'Total freedom', d: 'No required courses' },
        { v: 'dist', l: 'Some guardrails', d: 'A few areas to cover' },
        { v: 'core', l: 'A shared core', d: 'Same great books as everyone' },
        { v: 'hands', l: 'Hands-on projects', d: 'Build things, not just read' },
      ],
    },
    { id: 'vibe', type: 'slider', eyebrow: 'Culture', title: 'How should it feel to study there?', left: 'Shared notes, study groups', right: 'Racing everyone to the top', mid: 'Driven but friendly', short: ['a collaborative culture', 'driven but friendly', 'a competitive edge'] },
    {
      id: 'social', type: 'multi', max: 2, eyebrow: 'Social life', title: 'Your ideal Saturday?', hint: 'Pick up to two',
      options: [
        { v: 'game', l: 'Game day', d: 'Tailgates and a loud stadium' },
        { v: 'greek', l: 'Parties', d: 'Greek life, big nights out' },
        { v: 'arts', l: 'A show or a gallery', d: 'Weird, creative, artsy' },
        { v: 'chill', l: 'Low-key with friends', d: 'Board games, late talks' },
        { v: 'outdoors', l: 'Outside', d: 'A trail or a lake' },
      ],
    },
    { id: 'track', type: 'slider', eyebrow: 'Learning', title: 'What should college prepare you for?', left: 'Real jobs, early: co-ops', right: 'Deep ideas: research', mid: 'Both, evenly', short: ['co-ops and real jobs', 'jobs and research', 'research and theory'] },
    { id: 'activities', type: 'chips', max: 5, eyebrow: 'Activities', title: 'What do you want to do outside class?', hint: 'Pick up to five' },
    { id: 'followup', type: 'tap', eyebrow: 'Your major', title: '', options: [] },
  ];

  // Follow-up question by major family. Each option: label, detail, and a scorer.
  const FOLLOWUPS = {
    tech: {
      title: (m) => `What kind of ${m === 'engineering' ? 'engineer' : 'builder'} are you?`,
      options: [
        { v: 'startup', l: 'Startup founder', d: 'Ship products, meet investors', score: (s, h) => h.clamp((h.city(s) ? 0.5 : 0.15) + h.pct(s, 'computer') * 2 + (h.r1(s) ? 0.2 : 0)), why: 'Founder-friendly ecosystem' },
        { v: 'industry', l: 'Industry ready', d: 'Internships at real companies', score: (s, h) => (h.has(s, 'K') ? 1 : h.has(s, 'P') ? 0.75 : h.city(s) ? 0.55 : 0.3), why: 'Built-in paths into industry' },
        { v: 'research', l: 'Research', d: 'Labs, papers, grad school', score: (s, h) => (h.r1(s) ? 0.95 : h.lac(s) ? 0.6 : 0.3), why: 'Research university with deep labs' },
        { v: 'hardware', l: 'Hardware', d: 'Robots, circuits, machines', score: (s, h) => h.clamp(h.pct(s, 'engineering') * 4 + (h.has(s, 'P') ? 0.2 : 0)), why: 'Strong engineering hardware focus' },
      ],
    },
    health: {
      title: () => 'Pre-health can get intense. What do you want around you?',
      options: [
        { v: 'hospital', l: 'A hospital next door', d: 'Shadowing and clinical hours', score: (s, h) => (h.r1(s) && h.city(s) ? 1 : h.r1(s) ? 0.7 : h.city(s) ? 0.55 : 0.25), why: 'Medical center close by' },
        { v: 'support', l: 'Supportive advising', d: 'Small classes, real mentors', score: (s, h) => (h.lac(s) ? 1 : (s.sfr || 20) <= 12 ? 0.75 : 0.35), why: 'Small classes with close advising' },
        { v: 'research', l: 'Lab research', d: 'Publish before you graduate', score: (s, h) => (h.r1(s) ? 0.95 : h.lac(s) ? 0.55 : 0.3), why: 'Lots of research labs to join' },
        { v: 'direct', l: 'Straight into practice', d: 'Nursing, PT, public health', score: (s, h) => h.clamp(h.pct(s, 'health') * 4), why: 'Large health professions program' },
      ],
    },
    biz: {
      title: () => 'How do you want to learn business?',
      options: [
        { v: 'school', l: 'Business school from day one', d: 'Finance, marketing, cases', score: (s, h) => h.clamp(h.pct(s, 'business_marketing') * 3.2), why: 'Big undergrad business program' },
        { v: 'liberal', l: 'Econ plus liberal arts', d: 'Think first, specialize later', score: (s, h) => (h.lac(s) ? 0.95 : h.clamp(h.pct(s, 'social_science') * 4)), why: 'Strong economics within a broad education' },
        { v: 'city', l: 'Internships in a big city', d: 'Recruiting on your doorstep', score: (s, h) => (h.city(s) ? 1 : 0.2), why: 'Recruiters are right there in the city' },
        { v: 'found', l: 'Start something', d: 'Build a company in school', score: (s, h) => (h.has(s, 'P') || h.has(s, 'K') ? 0.9 : h.city(s) ? 0.6 : 0.35), why: 'Hands-on, venture-friendly programs' },
      ],
    },
    arts: {
      title: () => 'How intense should your arts training be?',
      options: [
        { v: 'conservatory', l: 'Studio intensity', d: 'Art school, all day', score: (s, h) => (h.has(s, 'A') ? 1 : h.clamp(h.pct(s, 'visual_performing') * 5)), why: 'Studio-focused, art-school intensity' },
        { v: 'balance', l: 'Arts inside a broad college', d: 'Studio plus everything else', score: (s, h) => (h.lac(s) ? 0.95 : h.clamp(h.pct(s, 'visual_performing') * 6 + 0.2)), why: 'Arts within a broad college' },
        { v: 'scene', l: 'A city arts scene', d: 'Galleries, venues, studios', score: (s, h) => (h.city(s) ? 1 : 0.2), why: 'City arts scene around campus' },
        { v: 'industry', l: 'Industry connections', d: 'Film, media, design jobs', score: (s, h) => h.clamp((h.city(s) ? 0.45 : 0.1) + (h.pct(s, 'communication') + h.pct(s, 'visual_performing')) * 3), why: 'Pipeline into creative industries' },
      ],
    },
    hum: {
      title: () => 'Where do you want to read and argue?',
      options: [
        { v: 'seminar', l: 'Small seminars', d: 'Professors who know you', score: (s, h) => (h.lac(s) ? 1 : (s.sfr || 20) <= 10 ? 0.7 : 0.25), why: 'Seminar-style classes' },
        { v: 'range', l: 'Endless course catalog', d: 'Big research university', score: (s, h) => (h.r1(s) && h.big(s) ? 1 : h.r1(s) ? 0.75 : 0.3), why: 'Huge course catalog' },
        { v: 'core', l: 'The great books', d: 'A shared core curriculum', score: (s, h) => (h.has(s, 'C') ? 1 : 0.3), why: 'Shared great-books core' },
        { v: 'writing', l: 'Writing every week', d: 'Workshops and thesis work', score: (s, h) => h.clamp(h.pct(s, 'english') * 10 + (h.lac(s) ? 0.3 : 0)), why: 'Writing-intensive programs' },
      ],
    },
    social: {
      title: () => 'How do you want to study people and society?',
      options: [
        { v: 'policy', l: 'Near the action', d: 'Government, policy, NGOs', score: (s, h) => (s.s === 'DC' ? 1 : h.city(s) ? 0.6 : 0.25), why: 'Close to policy and government' },
        { v: 'research', l: 'Research and data', d: 'Run studies, crunch numbers', score: (s, h) => (h.r1(s) ? 0.95 : 0.4), why: 'Strong social science research' },
        { v: 'seminar', l: 'Discussion-heavy', d: 'Small classes, big debates', score: (s, h) => (h.lac(s) ? 1 : (s.sfr || 20) <= 11 ? 0.65 : 0.25), why: 'Discussion-based classes' },
        { v: 'community', l: 'Out in the community', d: 'Service, fieldwork, practice', score: (s, h) => (h.city(s) ? 0.8 : 0.5) + (s.rel ? 0.1 : 0), why: 'Lots of fieldwork and service' },
      ],
    },
    science: {
      title: () => 'What kind of science life do you want?',
      options: [
        { v: 'lab', l: 'Big labs', d: 'Join research early', score: (s, h) => (h.r1(s) ? 1 : 0.35), why: 'Major research labs' },
        { v: 'field', l: 'Field work', d: 'Mountains, oceans, farms', score: (s, h) => (h.MOUNTAIN_STATES.has(s.s) || h.BEACH(s) || s.loc >= 31 ? 0.9 : 0.35), why: 'Field sites close by' },
        { v: 'mentors', l: 'Close mentors', d: 'Professors, not grad students', score: (s, h) => (h.lac(s) ? 1 : (s.sfr || 20) <= 12 ? 0.6 : 0.25), why: 'Faculty teach every class' },
        { v: 'applied', l: 'Applied and practical', d: 'Co-ops, industry projects', score: (s, h) => (h.has(s, 'K') || h.has(s, 'P') ? 1 : 0.35), why: 'Applied, project-heavy science' },
      ],
    },
    explore: {
      title: () => 'Undecided is great. How do you want to explore?',
      options: [
        { v: 'freedom', l: 'Total freedom', d: 'Try anything, no requirements', score: (s, h) => (h.has(s, 'O') ? 1 : h.lac(s) ? 0.6 : 0.3), why: 'Freedom to explore before declaring' },
        { v: 'range', l: 'Every option on the table', d: 'Hundreds of majors', score: (s, h) => (h.big(s) ? 1 : 0.3), why: 'Hundreds of majors to try' },
        { v: 'guided', l: 'Guided exploration', d: 'Advisors who know you', score: (s, h) => (h.lac(s) ? 1 : (s.sfr || 20) <= 12 ? 0.6 : 0.3), why: 'Close advising while you decide' },
        { v: 'doing', l: 'Learn by doing', d: 'Jobs and projects to test ideas', score: (s, h) => (h.has(s, 'K') || h.has(s, 'P') ? 1 : 0.35), why: 'Hands-on ways to test careers' },
      ],
    },
  };

  const INCOMES = [
    { v: 0, l: 'Under $30k' }, { v: 1, l: '$30–48k' }, { v: 2, l: '$48–75k' }, { v: 3, l: '$75–110k' }, { v: 4, l: 'Over $110k' },
  ];

  // ACT → SAT concordance (College Board / ACT 2018).
  const ACT_TO_SAT = { 36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370, 29: 1340, 28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140, 22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890, 15: 850, 14: 800, 13: 760, 12: 710 };

  window.CFG = {
    METALS, MAJORS, POPULAR, STATES, REGIONS, CLIMATE, climateOf, ACTIVITIES, QUESTIONS, FOLLOWUPS, INCOMES, ACT_TO_SAT,
    helpers: { pct, big, r1, city, lac, has, MOUNTAIN_STATES, SKI, BEACH, clamp: (v) => Math.max(0, Math.min(1, v)) },
  };
})();
