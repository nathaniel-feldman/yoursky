// UI and flow: landing → profile → questions → deck → results, plus the detail sheet and friend compare.
(function () {
  'use strict';
  const { MAJORS, POPULAR, METALS, REGIONS, STATES, QUESTIONS, FOLLOWUPS, ACTIVITIES, INCOMES } = window.CFG;
  const E = window.ENGINE;
  const { Planet, Sky, SandFX, loop, motion, portrait, hashStr } = window.SKY;
  const SCHOOLS = (window.ORBIT_DATA && window.ORBIT_DATA.schools) || [];
  const byId = new Map(SCHOOLS.map((s) => [s.id, s]));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = E.money, pct = E.pctTxt, fmtInt = E.fmtInt;
  const ICON = {
    check: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3l9.5 17h-19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12.3l2.6 2.6L16 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  // A school's color, lifted so it reads on graphite. Returns null when a school has none.
  function accentOf(s) {
    if (!s || !s.col) return null;
    const n = parseInt(s.col, 16);
    let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hh = 0, ss = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const dd = mx - mn; ss = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      hh = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; hh /= 6;
    }
    l = Math.max(l, 0.62); ss = Math.min(ss, 0.8);
    const q2 = l < 0.5 ? l * (1 + ss) : l + ss - l * ss, p2 = 2 * l - q2;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p2 + (q2 - p2) * 6 * t : t < 0.5 ? q2 : t < 2 / 3 ? p2 + (q2 - p2) * (2 / 3 - t) * 6 : p2; };
    const rgb = [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map((v) => Math.round(v * 255));
    return { css: `rgb(${rgb.join(',')})`, rgb: rgb.join(',') };
  }
  const accentStyle = (s) => { const a = accentOf(s); return a ? `style="--acc:${a.css};--acc-rgb:${a.rgb}"` : ''; };
  const schoolPortrait = (s, size, grains) => portrait(s.id, size, { tint: s.col ? window.SKY.tintFromHex(s.col) : [1, 1, 1], grains });
  const PILLS = '.rail-opt, .schip, .chip:not(.more), .tile, .seg button';
  const piles = (root) => window.SKY.piles(root, PILLS);
  window.SKY.hooks.drain = (rect, grains) => fx.drain(rect, grains);
  const CHANCE = { reach: 'Reach', target: 'Target', likely: 'Likely' };
  const pill = (cat) => `<span class="pill ${cat}">${CHANCE[cat]}</span>`;

  // ---- State -------------------------------------------------------------
  const fresh = () => ({
    profile: { name: '', gpa: null, testMode: 'sat', sat: null, act: null, major: null, major2: null, budget: null, dorm: true, region: null, state: null },
    answers: {}, qi: 0, deck: [], deckIdx: 0, history: [], kept: [], passed: [], income: null, screen: 'landing',
  });
  let S = fresh();
  S.friend = location.hash.startsWith('#s=') ? E.decodeShare(location.hash.slice(3)) : null;
  if (S.friend) S.friend.k = S.friend.k.filter((id) => byId.has(id));

  // ---- Rendering surfaces --------------------------------------------------
  const app = $('#app');
  const you = new Planet(7, 4200);
  you.set('moonVis', 1); you.set('moonR', 2.5);
  const main = new Sky($('#sky'), { sun: you, ambient: true });
  main.setSchools(SCHOOLS);
  main.labelFn = (b) => b.s.n;
  const fx = new SandFX($('#fx'));
  let resultsSky = null, compareSky = null, friendPlanet = null, stageSky = null, fxWasBusy = false;
  loop.add((dt) => {
    you.update(dt);
    if (friendPlanet) friendPlanet.update(dt);
    main.frame(dt);
    if (stageSky) stageSky.frame(dt);
    if (resultsSky) resultsSky.frame(dt);
    if (compareSky) compareSky.frame(dt);
    if (fx.busy) { fx.frame(dt); fxWasBusy = true; } else if (fxWasBusy) { fx.frame(0); fxWasBusy = false; }
  });
  addEventListener('resize', () => {
    main.resize(); fx.resize();
    if (resultsSky) resultsSky.resize();
    if (compareSky) compareSky.resize();
    if (S.screen === 'questions') layoutQuestionSky();
    if (S.screen === 'profile') layoutProfileSky();
    if (S.screen === 'landing') layoutLanding();
  });

  // ---- Scoring -------------------------------------------------------------
  let scored = [];
  const scoreMap = new Map();
  function rescore() {
    scored = SCHOOLS.map((s) => ({ s, r: E.score(s, S.profile, S.answers, S.income) })).sort((a, b) => b.r.fit - a.r.fit);
    scoreMap.clear(); scored.forEach((x) => scoreMap.set(x.s.id, x.r));
  }
  const resultOf = (id) => scoreMap.get(id) || E.score(byId.get(id), S.profile, S.answers, S.income);
  const fits = () => scored.map((x) => ({ id: x.s.id, fit: x.r.fit }));
  let liveQueued = false;
  function live() {
    if (liveQueued) return;
    liveQueued = true;
    setTimeout(() => {
      liveQueued = false; rescore();
      main.setFits(fits(), { focus: 36, labels: 5 });
      const tl = $('#topline');
      if (tl && scored[0]) tl.textContent = `Closest: ${scored[0].s.n} ${scored[0].r.fit}%`;
    }, 16);
  }

  // ---- Screen switching ----------------------------------------------------
  function go(name, opts = {}) {
    const old = app.firstElementChild;
    const build = () => {
      if (name !== 'results') grit.clear();
      app.innerHTML = '';
      document.body.dataset.screen = name;
      S.screen = name;
      const el = SCREENS[name]();
      app.appendChild(el);
      settle(el);
      piles(el);
      const head = el.querySelector('h1, h2');
      if (head && opts.focus !== false) { head.setAttribute('tabindex', '-1'); head.focus({ preventScroll: true }); }
      window.scrollTo(0, 0);
    };
    if (old && opts.erode !== false && !motion.reduced) fx.erodeScreen(old, { done: build });
    else build();
  }
  function settle(root) {
    $$('.settle > *', root).forEach((c, i) => c.style.setProperty('--i', i));
    root.classList.add('entering');
    void root.offsetWidth;
    setTimeout(() => root.classList.add('entered'), 20);
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---- Landing -------------------------------------------------------------
  let formed = false;
  function Landing() {
    const f = S.friend;
    const el = h(`<section class="screen landing">
      <header class="topbar"><span class="wordmark">Your Sky</span></header>
      <div class="landing-copy settle">
        ${f ? `<p class="eyebrow">${esc(f.n || 'A friend')} sent you their sky</p>` : ''}
        <h1 class="hook" id="hook"><span class="line metal">You are the sun.</span><span class="line metal italic">Colleges are planets.</span></h1>
        <p class="lede">${f ? 'Build yours and see where you overlap.' : 'The better a school fits you, the closer it orbits.'}</p>
        <button class="btn chrome big" id="start">${f ? 'Build my sky' : 'Start'}</button>
        <p class="fine">Four minutes. No sign-up. Data from the U.S. College Scorecard. <a href="about.html">About</a></p>
      </div>
    </section>`);
    layoutLanding();
    you.set('sunness', 1);
    if (f && f.k.length) {
      main.setFits(f.k.map((id, i) => ({ id, fit: 95 - i * 4 })), { only: f.k, focus: 40, labels: 12 });
      main.sunText = f.n || '';
      const fam = E.majorOf(f.m || 'undecided').fam; you.set('tint', METALS[fam].tint);
    } else {
      main.setFits(SCHOOLS.map((s) => ({ id: s.id, fit: 40 + (hashStr(String(s.id)) % 55) })), { focus: 26, labels: 4 });
      main.sunText = '';
    }
    $('#start', el).addEventListener('click', () => {
      fx.release(true); $('#hook', el).classList.remove('forming');
      you.set('tint', [1, 1, 1]);
      go('profile');
    });
    if (!formed && !motion.reduced) {
      formed = true;
      const hook = $('#hook', el);
      hook.classList.add('forming');
      (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
        setTimeout(() => fx.formText($$('.line', hook), { duration: 1500 })
          .catch(() => {})
          .then(() => { hook.classList.remove('forming'); setTimeout(() => fx.release(), 250); }), 0);
      });
    }
    return el;
  }
  function layoutLanding() {
    if (innerWidth >= 900) {
      const RX0 = Math.min(innerWidth * 0.47, (innerHeight * 0.46) / 0.46);
      main.setView({ sx: 0.7, sy: 0.5, sr: 52, ox: 0.7, oy: 0.5, orbit: Math.min(orbitFor(0.34), (innerWidth * 0.27) / RX0), orbitAlpha: 1, tilt: 0.46, binary: 0 });
    } else main.setView({ sx: 0.5, sy: 0.3, sr: 40, ox: 0.5, oy: 0.3, orbit: orbitFor(0.24), orbitAlpha: 1, tilt: 0.46, binary: 0 });
  }
  // Orbit scale so the ellipse's vertical radius is at most `frac` of the viewport height.
  function orbitFor(frac, sky = main) {
    const W = sky.w || innerWidth, H = sky.h || innerHeight, tilt = sky.view.tilt;
    const RX0 = Math.min(W * 0.47, (H * 0.46) / tilt);
    return Math.max(0.3, Math.min(1, (H * frac) / (RX0 * tilt)));
  }

  // ---- Profile -------------------------------------------------------------
  function Profile() {
    const P = S.profile;
    const el = h(`<section class="screen profile">
      <div class="planet-stage" aria-hidden="true"><canvas id="stage"></canvas></div>
      <form class="profile-form settle" id="pform" novalidate>
        <h1 class="form-title">Make your planet.</h1>
        <div class="field">
          <label class="fieldline" for="f-name">First name</label>
          <input id="f-name" class="textin" type="text" autocomplete="given-name" maxlength="16" placeholder="Optional" value="${esc(P.name)}">
        </div>
        <div class="field">
          <div class="fieldline"><label for="f-gpa">GPA <span class="dim">unweighted</span></label><output id="o-gpa" class="mono">${P.gpa != null ? P.gpa.toFixed(2) : '—'}</output></div>
          <input id="f-gpa" type="range" min="2" max="4" step="0.05" value="${P.gpa ?? 3.5}" class="${P.gpa == null ? 'unset' : ''}" aria-valuetext="${P.gpa != null ? P.gpa.toFixed(2) : 'Not set'}">
        </div>
        <div class="field">
          <div class="fieldline"><span id="l-test">Test score</span><output id="o-test" class="mono"></output></div>
          <div class="seg" role="radiogroup" aria-labelledby="l-test">
            ${[['sat', 'SAT'], ['act', 'ACT'], ['none', 'None']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${P.testMode === v}" data-test="${v}"><i class="pour" aria-hidden="true"></i><span>${l}</span></button>`).join('')}
          </div>
          <input id="f-test" type="range" aria-labelledby="l-test">
        </div>
        <div class="field">
          <div class="fieldline"><label for="f-major">Intended major</label><span class="mono dim">+ backup, optional</span></div>
          <input id="f-major" class="textin" type="text" placeholder="Search majors" autocomplete="off" value="${esc(majorText())}">
          <div class="chips" id="major-chips" role="listbox" aria-label="Majors"></div>
        </div>
        <div class="field">
          <span class="fieldline" id="l-region">Home</span>
          <div class="tiles" role="radiogroup" aria-labelledby="l-region">
            ${REGIONS.map((r) => `<button type="button" role="radio" class="tile" aria-checked="${P.region === r.id}" data-region="${r.id}"><i class="pour" aria-hidden="true"></i><span>${r.label}</span></button>`).join('')}
          </div>
          <div id="state-wrap"></div>
        </div>
        <div class="form-foot"><button type="button" class="btn ghost" id="back">Back</button><button type="submit" class="btn chrome" id="next">Continue</button></div>
      </form>
    </section>`);

    main.setFits([], { only: [] });
    main.setView({ sr: 0.01, orbitAlpha: 0 });
    main.sunText = '';
    you.set('sunness', 0);
    you.setName(P.name);
    setTimeout(() => {
      stageSky = new Sky($('#stage', el), { sun: you });
      layoutProfileSky(); stageSky.snap(); stageSky.cur.sr = 4; you.kick(1);
    }, 0);

    const nameI = $('#f-name', el);
    nameI.addEventListener('input', () => { P.name = nameI.value; you.setName(P.name); you.ripple(); syncPlanet(); });

    const gpaI = $('#f-gpa', el);
    gpaI.addEventListener('input', () => {
      P.gpa = +gpaI.value; gpaI.classList.remove('unset');
      $('#o-gpa', el).textContent = P.gpa.toFixed(2); gpaI.setAttribute('aria-valuetext', P.gpa.toFixed(2));
      syncPlanet();
    });

    const testI = $('#f-test', el);
    const setTestUI = () => {
      const m = P.testMode;
      $$('[data-test]', el).forEach((b) => b.setAttribute('aria-checked', b.dataset.test === m));
      (testI.closest('.ss') || testI).hidden = m === 'none';
      if (m === 'sat') { testI.min = 800; testI.max = 1600; testI.step = 10; testI.value = P.sat ?? 1250; testI.classList.toggle('unset', P.sat == null); }
      if (m === 'act') { testI.min = 12; testI.max = 36; testI.step = 1; testI.value = P.act ?? 26; testI.classList.toggle('unset', P.act == null); }
      const v = m === 'sat' ? P.sat : m === 'act' ? P.act : null;
      $('#o-test', el).textContent = m === 'none' ? 'Test-optional' : v ?? '—';
      if (testI._track) testI._track.refresh();
    };
    $$('[data-test]', el).forEach((b) => b.addEventListener('click', () => {
      P.testMode = b.dataset.test; setTestUI(); syncPlanet();
    }));
    testI.addEventListener('input', () => {
      if (P.testMode === 'sat') P.sat = +testI.value; else P.act = +testI.value;
      testI.classList.remove('unset'); setTestUI(); syncPlanet();
    });
    setTestUI();

    const majorI = $('#f-major', el), chipsEl = $('#major-chips', el);
    const chip = (m) => {
      const role = P.major === m.id ? 'main' : P.major2 === m.id ? 'backup' : '';
      return `<button type="button" class="chip" role="option" aria-selected="${!!role}" data-major="${m.id}"><i class="pour" aria-hidden="true"></i><span>${m.label}${role ? `<em class="mtag">${role === 'main' ? 'Main' : 'Backup'}</em>` : ''}</span></button>`;
    };
    const renderMajors = () => {
      const q = majorI.value.trim().toLowerCase();
      const chosen = [P.major, P.major2].filter(Boolean).map((id) => E.majorOf(id));
      let list = q && q !== majorText().toLowerCase() ? MAJORS.filter((m) => m.label.toLowerCase().includes(q)) : POPULAR.map((id) => E.majorOf(id));
      list = [...chosen.filter((m) => !list.includes(m)), ...list];
      chipsEl.innerHTML = list.slice(0, 12).map(chip).join('') +
        (!q || q === majorText().toLowerCase() ? '<button type="button" class="chip more" data-more="1">More</button>' : list.length ? '' : '<span class="hint">No match</span>');
      piles(chipsEl);
    };
    majorI.addEventListener('input', renderMajors);
    chipsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.more) { chipsEl.innerHTML = MAJORS.map(chip).join(''); piles(chipsEl); return; }
      const id = b.dataset.major;
      // First pick is the main major, a second is the backup; tapping a chosen one removes it.
      if (P.major === id) { P.major = P.major2; P.major2 = null; }
      else if (P.major2 === id) P.major2 = null;
      else if (!P.major) P.major = id;
      else P.major2 = id;
      majorI.value = majorText();
      if (S.answers.followup) delete S.answers.followup;
      chipsEl.querySelectorAll('[data-major]').forEach((x) => {
        const role = P.major === x.dataset.major ? 'Main' : P.major2 === x.dataset.major ? 'Backup' : '';
        x.setAttribute('aria-selected', !!role);
        const sp = x.querySelector('span'), label = E.majorOf(x.dataset.major).label;
        sp.innerHTML = role ? `${label}<em class="mtag">${role}</em>` : label;
      });
      syncPlanet();
    });
    renderMajors();

    const renderState = () => {
      const r = E.regionOf(P.region), wrap = $('#state-wrap', el);
      if (!r || !r.states.length) { wrap.innerHTML = ''; P.state = null; return; }
      if (P.state && !r.states.includes(P.state)) P.state = null;
      wrap.innerHTML = `<div class="select"><select id="f-state" aria-label="State, for in-state tuition"><option value="">State (for in-state tuition)</option>${r.states.map((s) => `<option value="${s}" ${P.state === s ? 'selected' : ''}>${STATES[s][0]}</option>`).join('')}</select></div>`;
      $('#f-state', el).addEventListener('change', (e) => { P.state = e.target.value || null; syncPlanet(); });
    };
    $$('[data-region]', el).forEach((b) => b.addEventListener('click', () => {
      P.region = b.dataset.region;
      $$('[data-region]', el).forEach((x) => x.setAttribute('aria-checked', x === b));
      renderState(); syncPlanet();
    }));
    renderState();
    $$('input[type="range"]', el).forEach((i) => (i._track = new window.SKY.SandTrack(i)));

    $('#back', el).addEventListener('click', () => { stageSky = null; go('landing'); });
    $('#pform', el).addEventListener('submit', (e) => { e.preventDefault(); handoffStage(); S.qi = 0; go('questions'); });
    syncPlanet();
    return el;
  }
  const majorText = () => [S.profile.major, S.profile.major2].filter(Boolean).map((id) => E.majorOf(id).label).join(' + ');
  const budgetText = (b) => (b >= 90000 ? '$90k+ / yr' : b === 0 ? '$0 / yr' : `${money(b)} / yr`);
  function layoutProfileSky() {
    if (!stageSky) return;
    stageSky.resize();
    const R = Math.min(stageSky.w * 0.19, stageSky.h * 0.25, 130);
    stageSky.setView({ sx: 0.5, sy: 0.47, sr: R, ox: 0.5, oy: 0.5, orbitAlpha: 0, orbit: 1, binary: 0 });
  }
  // Move the planet from the profile's own canvas back to the main sky at the same spot, then let it fly.
  function handoffStage() {
    if (!stageSky) return;
    const r = stageSky.c.getBoundingClientRect();
    const v = { sx: (r.left + stageSky.cur.sx * r.width) / innerWidth, sy: (r.top + stageSky.cur.sy * r.height) / innerHeight, sr: stageSky.cur.sr, orbitAlpha: 0 };
    Object.assign(main.view, v); Object.assign(main.cur, v);
    stageSky.ctx.clearRect(0, 0, stageSky.c.width, stageSky.c.height);
    stageSky = null;
  }
  function syncPlanet() {
    const P = S.profile;
    const m = P.major ? E.majorOf(P.major) : null;
    you.set('tint', METALS[m ? m.fam : 'explore'].tint);
    const nm = P.name.trim().toLowerCase(), hs = hashStr(nm || 'x');
    you.set('warp', nm ? 1.7 : 0); you.set('sA', (hs % 628) / 100); you.set('sB', ((hs >>> 10) % 628) / 100);
    if (P.gpa != null) { you.set('bands', 1 + ((P.gpa - 2) / 2) * 6); you.set('bandAmp', 1); you.set('scale', 0.74 + ((P.gpa - 2) / 2) * 0.4); }
    else { you.set('bandAmp', 0); you.set('scale', 0.9); }
    const sat = E.satOf(P);
    if (P.testMode === 'none') { you.set('ring', 0.6); you.set('ringScatter', 1); }
    else if (sat) { you.set('ring', 0.15 + ((sat - 800) / 800) * 0.85); you.set('ringScatter', 0); }
    else { you.set('ring', 0); you.set('ringScatter', 0); }
    you.set('halo', 0);
    you.set('moonR', 2.5);
    const reg = E.regionOf(P.region); you.set('light', reg ? reg.angle : -40);
  }

  // ---- Questions -----------------------------------------------------------
  function questionFor(i) {
    const q = QUESTIONS[i];
    if (q.id !== 'followup') return q;
    const m = E.majorOf(S.profile.major || 'undecided'), fu = FOLLOWUPS[m.fam];
    return Object.assign({}, q, { title: fu.title(m.id), options: fu.options, eyebrow: m.id === 'undecided' ? 'Exploring' : m.label });
  }
  function Questions() {
    const el = h(`<section class="screen questions">
      <div class="q-top">
        <div class="ticks" aria-hidden="true">${QUESTIONS.map(() => '<i></i>').join('')}</div>
        <div class="sky-legend"><span class="mono dim">Closer = better fit</span><span class="mono" id="topline"></span></div>
      </div>
      <div class="q-card" id="qcard" aria-live="polite"></div>
    </section>`);
    main.sunText = S.profile.name.trim();
    main.setView({ orbitAlpha: 1, binary: 0, dim: 0 });
    you.set('sunness', 1);
    setTimeout(() => { renderQ(el, 0); live(); }, 0);
    return el;
  }
  // The open sky above the question, centered on the student's sun.
  let cardTopTarget = null;
  function skyRegion() {
    const card = $('#qcard'), top = 70, bottom = cardTopTarget != null ? cardTopTarget + 24 : card ? card.getBoundingClientRect().top + 24 : innerHeight * 0.55;
    return { cx: innerWidth / 2, cy: (top + bottom) / 2, rx: Math.min(innerWidth / 2 - 12, 400), ry: Math.max(50, (bottom - top) / 2 - 8), r0: Math.max(16, main.view.sr * 1.5), top, bottom };
  }
  function sceneRegion() {
    const st = $('.q-inner:not(.q-leave) .q-stage');
    const r = st && st.getBoundingClientRect();
    return { sky: skyRegion(), band: r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null };
  }
  const scene = new window.SKY.Scene($('#scene'), sceneRegion);
  addEventListener('resize', () => scene.resize());
  function layoutQuestionSky() {
    const g = skyRegion(), H = innerHeight;
    main.setView({ sx: 0.5, sy: g.cy / H, sr: Math.max(12, Math.min(24, g.ry * 0.17)), ox: 0.5, oy: g.cy / H, orbit: orbitFor((g.ry - 10) / H), tilt: 0.46 });
  }
  // Picking an answer launches a comet out of it that swings around your planet and lands in it.
  function pour(btn) {
    const r = btn.getBoundingClientRect(), sx = main.cur.sx * innerWidth, sy = main.cur.sy * innerHeight;
    const x0 = Math.min(innerWidth - 16, r.left + r.width * 0.85), y0 = r.top + r.height / 2;
    fx.comet(x0, y0, sx, sy, () => you.ripple());
  }

  function sliderRead(q, v) {
    if (q.id === 'size') return { num: `~${window.SKY.Scene.classSize(v / 100)}`, unit: 'students per class' };
    if (q.id === 'distance') return v >= 95 ? { num: 'As far as possible', unit: '' } : { num: `< ${E.milesOf(v).toLocaleString('en-US')}`, unit: 'miles from home' };
    return { num: v < 34 ? q.left : v > 66 ? q.right : q.mid, unit: '', word: true };
  }
  const readHTML = (r) => `<span class="num ${r.word || !r.unit ? 'word' : ''}">${esc(r.num)}</span>${r.unit ? `<span class="unit">${r.unit}</span>` : ''}`;
  function qControl(q) {
    const A = S.answers;
    if (q.type === 'slider') {
      if (q.id === 'distance' && S.profile.region === 'intl') return `<p class="hint big">${q.intl}</p>`;
      if (q.id === 'distance' && !S.profile.region) return `<p class="hint">First, where’s home?</p><div class="tiles compact" role="radiogroup" aria-label="Home region">${REGIONS.map((r) => `<button type="button" role="radio" class="tile" aria-checked="false" data-home="${r.id}"><i class="pour" aria-hidden="true"></i><span>${r.label}</span></button>`).join('')}</div>`;
      const v = A[q.id] ?? 50, r = sliderRead(q, v);
      return `${q.id === 'distance' ? '' : '<div class="q-stage" aria-hidden="true"></div>'}
        <p class="big-read q-read" aria-hidden="true">${readHTML(r)}</p>
        <input type="range" class="q-range" min="0" max="100" step="1" value="${v}" aria-label="${esc(q.title)}" aria-valuetext="${esc(r.num + ' ' + r.unit)}">`;
    }
    if (q.type === 'chips') {
      const sel = A[q.id] || [];
      return `<div class="sand-chips" role="group" aria-label="${esc(q.title)}">${ACTIVITIES.map((a) => `<button type="button" class="schip" aria-pressed="${sel.includes(a.id)}" data-v="${a.id}"><i class="pour" aria-hidden="true"></i><span>${a.label}</span></button>`).join('')}</div>`;
    }
    const sel = A[q.id];
    return `<div class="rails" role="${q.type === 'tap' ? 'radiogroup' : 'group'}" aria-label="${esc(q.title)}">${q.options.map((o) => {
      const on = q.type === 'tap' ? sel === o.v : (sel || []).includes(o.v);
      return `<button type="button" class="rail-opt" ${q.type === 'tap' ? 'role="radio" aria-checked' : 'aria-pressed'}="${on}" data-v="${o.v}"><i class="pour" aria-hidden="true"></i><span class="ro-l">${o.l}</span><span class="ro-d">${o.d}</span></button>`;
    }).join('')}</div>`;
  }
  // dir: 1 forward, -1 back, 0 redraw in place.
  function renderQ(root, dir = 0) {
    const card = $('#qcard', root || document);
    if (!card) return;
    const q = questionFor(S.qi), A = S.answers;
    $$('.ticks i', root || document).forEach((t, i) => t.classList.toggle('on', i <= S.qi));
    const inner = h(`<div class="q-inner">
      <p class="eyebrow">${S.qi + 1} of ${QUESTIONS.length} · ${esc(q.eyebrow)}</p>
      <h2 class="q-title">${esc(q.title)}</h2>
      ${q.max ? `<p class="hint">${q.hint} <span class="mono q-count">${(A[q.id] || []).length} of ${q.max}</span></p>` : ''}
      <div class="q-control">${qControl(q)}</div>
      <div class="q-actions"><button type="button" class="btn ghost" data-act="back">Back</button><button type="button" class="btn text" data-act="skip">No preference</button><button type="button" class="btn chrome" data-act="next">Next</button></div>
    </div>`);
    const old = card.querySelector('.q-inner:not(.q-leave)');
    if (old && dir && !motion.reduced) {
      // Old and new share the card's bottom edge: the buttons stay put and only the content above crossfades.
      old.style.setProperty('--dx', `${-dir * 24}px`); old.classList.add('q-leave'); old.inert = true;
      inner.style.setProperty('--dx', `${dir * 24}px`); inner.classList.add('q-enter');
      card.appendChild(inner);
      const cs = getComputedStyle(card);
      cardTopTarget = innerHeight - Math.min(inner.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), innerHeight * 0.7);
      card.scrollTop = card.scrollHeight;
      setTimeout(() => inner.classList.remove('q-enter'), 20);
      setTimeout(() => { old.remove(); card.scrollTop = card.scrollHeight; cardTopTarget = null; layoutQuestionSky(); }, 460);
    } else { card.innerHTML = ''; card.appendChild(inner); card.scrollTop = card.scrollHeight; }
    layoutQuestionSky();
    piles(inner);
    wireQ(inner, q);
    if (dir) { const t = $('.q-title', inner); t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
  }
  function wireQ(inner, q) {
    const A = S.answers, nx = inner.querySelector('[data-act="next"]'), range = inner.querySelector('.q-range');
    const updateNext = () => {
      const v = A[q.id];
      nx.disabled = !(q.type === 'slider' ? range || S.profile.region === 'intl' : v != null && (!Array.isArray(v) || v.length));
    };
    // Multi-select: at the limit, a new pick replaces the most recent one.
    const pick = (btn) => {
      const v = btn.dataset.v, all = inner.querySelectorAll('[data-v]');
      if (q.type === 'tap') { A[q.id] = v; all.forEach((x) => x.setAttribute('aria-checked', x === btn)); pour(btn); }
      else {
        let cur = A[q.id] || [];
        if (cur.includes(v)) cur = cur.filter((x) => x !== v);
        else { if (cur.length >= q.max) cur = cur.slice(0, -1); cur = [...cur, v]; pour(btn); }
        A[q.id] = cur;
        all.forEach((x) => x.setAttribute('aria-pressed', cur.includes(x.dataset.v)));
        if (!cur.length) delete A[q.id];
        const c = inner.querySelector('.q-count'); if (c) c.textContent = `${cur.length} of ${q.max}`;
      }
      live(); updateNext();
    };
    inner.querySelectorAll('.rail-opt, .schip').forEach((b) => b.addEventListener('click', () => pick(b)));
    inner.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => {
      S.profile.region = b.dataset.home; syncPlanet(); live(); renderQ(document, 0);
    }));
    if (range) {
      new window.SKY.SandTrack(range);
      scene.set(q.id, () => +range.value / 100);
      range.addEventListener('input', () => {
        const v = +range.value, r = sliderRead(q, v); A[q.id] = v;
        range.setAttribute('aria-valuetext', `${r.num} ${r.unit}`); inner.querySelector('.q-read').innerHTML = readHTML(r);
        live();
      });
    } else scene.set(null);
    inner.querySelector('[data-act="back"]').addEventListener('click', () => advance(-1));
    inner.querySelector('[data-act="skip"]').addEventListener('click', () => { delete A[q.id]; live(); advance(1); });
    nx.addEventListener('click', () => {
      if (range && A[q.id] == null) { A[q.id] = +range.value; live(); }
      advance(1);
    });
    updateNext();
  }
  function advance(d) {
    const n = S.qi + d;
    if (n < 0 || n >= QUESTIONS.length) { scene.set(null); return n < 0 ? go('profile') : go('deck'); }
    S.qi = n; renderQ(document, d);
  }

  // ---- Deck ----------------------------------------------------------------
  function buildDeck() {
    rescore();
    const pool = scored.filter((x) => x.r.fit > 0);
    const deck = pool.slice(0, 10);
    const need = (cat, n) => {
      const have = deck.filter((x) => x.r.chance.cat === cat).length;
      if (have >= n) return;
      pool.slice(10, 50).filter((x) => x.r.chance.cat === cat && !deck.includes(x)).slice(0, n - have).forEach((x) => deck.push(x));
    };
    need('likely', 2); need('target', 2);
    return deck.slice(0, 13).map((x) => x.s.id);
  }
  function Deck() {
    S.deck = buildDeck(); S.deckIdx = 0; S.history = [];
    const el = h(`<section class="screen deck">
      <header class="deck-head settle">
        <div><p class="eyebrow">Your top matches</p><h2 class="deck-title">Keep or pass</h2></div>
        <div class="kept-count" id="keptc" aria-live="polite"><span class="mono">Kept</span><strong id="keptn">0</strong></div>
      </header>
      <div class="deck-stack" id="stack"></div>
      <div class="deck-controls">
        <button class="round ghost" id="undo" aria-label="Undo last choice">${ICON.undo}</button>
        <button class="round pass" id="pass" aria-label="Pass">${ICON.x}<span>Pass</span></button>
        <button class="round keep" id="keep" aria-label="Keep">${ICON.check}<span>Keep</span></button>
        <button class="round ghost text" id="finish">Done</button>
      </div>
    </section>`);
    main.setView({ orbitAlpha: 0.0, sy: 0.12, oy: 0.12, sr: 0.1, orbit: 0.35 });
    main.setFits([], { only: [] });
    you.set('sunness', 1);
    $('#keep', el).addEventListener('click', () => decide(true));
    $('#pass', el).addEventListener('click', () => decide(false));
    $('#undo', el).addEventListener('click', undo);
    $('#finish', el).addEventListener('click', finishDeck);
    setTimeout(renderStack, 0);
    return el;
  }
  function cardHTML(id) {
    const s = byId.get(id), r = resultOf(id), ex = E.explain(s, r), c = r.cost;
    const sat = s.sat ? `${s.sat[0]}–${s.sat[1]}` : s.act ? `ACT ${s.act[0]}–${s.act[1]}` : 'Not reported';
    const scale = Math.max(c.sticker, 1);
    return `<article class="card ${s.col ? 'has-acc' : ''}" ${accentStyle(s)} data-id="${id}" tabindex="-1" aria-label="${esc(s.n)}, ${r.fit}% fit">
      <div class="card-top">
        <div class="card-portrait" data-portrait="${id}"></div>
        <div class="card-fit"><span class="fit-num metal">${r.fit}</span><span class="fit-unit">% fit</span></div>
      </div>
      <h3 class="card-name">${esc(s.n)}</h3>
      <p class="card-sub">${esc(s.c)}, ${s.s} · ${s.pub ? 'Public' : 'Private'} · ${fmtInt(s.size)} students</p>
      <div class="card-row">${pill(r.chance.cat)}<span class="mono dim">Admit ${pct(s.adm)}</span><span class="mono dim">SAT ${sat}</span></div>
      <ul class="why">${ex.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="heads">${ICON.warn}<span>${esc(ex.heads)}</span></p>
      ${s.note && !ex.why.includes(s.note) ? `<p class="card-note">${esc(s.note)}</p>` : ''}
      <div class="cost">
        <div class="cost-line"><span>Est. for you</span><strong>${money(c.est)}<small>/yr</small></strong></div>
        <div class="bar"><i class="est" style="width:${(c.est / scale) * 100}%"></i></div>
        <div class="cost-line dim"><span>Sticker price</span><span>${money(c.sticker)}/yr</span></div>
      </div>
      <dl class="facts">
        <div><dt>Grad rate</dt><dd>${pct(s.grad)}</dd></div>
        <div><dt>Earnings at 10 yrs</dt><dd>${money(s.earn)}</dd></div>
        <div><dt>Students per prof</dt><dd>${s.sfr ?? '—'}</dd></div>
      </dl>
      <div class="lean keep-lean">Keep</div><div class="lean pass-lean">Pass</div>
    </article>`;
  }
  function renderStack() {
    const stack = $('#stack'); if (!stack) return;
    while (S.deckIdx < S.deck.length && S.kept.includes(S.deck[S.deckIdx])) S.deckIdx++;
    if (S.deckIdx >= S.deck.length) { finishDeck(); return; }
    const ids = S.deck.slice(S.deckIdx, S.deckIdx + 3);
    const existing = new Map($$('.card', stack).map((c) => [+c.dataset.id, c]));
    existing.forEach((c, id) => { if (!ids.includes(id) && !c.classList.contains('leaving')) c.remove(); });
    ids.forEach((id, k) => {
      let c = existing.get(id);
      if (!c) {
        c = h(cardHTML(id)); stack.insertBefore(c, stack.firstChild);
        const slot = c.querySelector('[data-portrait]'); slot.appendChild(schoolPortrait(byId.get(id), 56));
      }
      c.style.setProperty('--k', k);
      c.classList.toggle('top', k === 0);
      c.setAttribute('aria-hidden', k === 0 ? 'false' : 'true');
    });
    const top = $('.card.top', stack);
    if (top && !top.dataset.wired) wireCard(top);
    if (top && !deckHint.shown) {
      deckHint.shown = true;
      setTimeout(() => demoSwipe(top, 1), 900);
      setTimeout(() => demoSwipe(top, 0.65), 7200);
    }
    $('#keptn').textContent = S.kept.length;
    $('#finish').hidden = S.kept.length === 0;
    $('#undo').disabled = !S.history.length;
  }
  // Teach the gesture: the first card leans to Keep, then to Pass, shedding a little sand, then settles.
  const deckHint = { shown: false, touched: false };
  ['pointerdown', 'keydown', 'wheel'].forEach((t) => addEventListener(t, () => { if (S.screen === 'deck') deckHint.touched = true; }, { passive: true }));
  function demoSwipe(card, amp) {
    if (motion.reduced || deckHint.touched || !card.isConnected || !card.classList.contains('top') || !sheet.hidden) return;
    const t0 = performance.now(), dur = 2100 * (0.8 + amp * 0.2), ez = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    let burstR = false, burstL = false;
    card.classList.add('dragging');
    const reset = () => { card.style.transform = ''; card.style.setProperty('--lean', 0); card.classList.remove('dragging'); };
    const step = (now) => {
      if (deckHint.touched || !card.isConnected || card.classList.contains('leaving')) { if (!card.classList.contains('leaving')) reset(); return; }
      const u = Math.min(1, (now - t0) / dur);
      const x = u < 0.32 ? ez(u / 0.32) : u < 0.68 ? 1 - 2 * ez((u - 0.32) / 0.36) : -1 + ez((u - 0.68) / 0.32);
      const dx = x * 70 * amp;
      card.style.transform = `translate(${dx.toFixed(1)}px, 0) rotate(${(dx * 0.05).toFixed(2)}deg)`;
      card.style.setProperty('--lean', Math.max(-1, Math.min(1, dx / 70)));
      const r = card.getBoundingClientRect();
      if (!burstR && u > 0.28) { burstR = true; fx.burst(r.right - 6, r.top + r.height * 0.45, 22); }
      if (!burstL && u > 0.64) { burstL = true; fx.burst(r.left + 6, r.top + r.height * 0.45, 22); }
      if (u < 1) requestAnimationFrame(step); else reset();
    };
    requestAnimationFrame(step);
  }
  function wireCard(card) {
    card.dataset.wired = '1';
    let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, dragging = false, moved = false;
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now();
      card.setPointerCapture(e.pointerId); card.classList.add('dragging');
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 6) moved = true;
      card.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx * 0.05}deg)`;
      card.style.setProperty('--lean', Math.max(-1, Math.min(1, dx / 110)));
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; card.classList.remove('dragging');
      const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
      if (Math.abs(dx) > 110 || (v > 0.6 && Math.abs(dx) > 40)) decide(dx > 0, { dx, dy });
      else { card.style.transform = ''; card.style.setProperty('--lean', 0); if (!moved) openSheet(+card.dataset.id); }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', () => { dragging = false; card.classList.remove('dragging'); card.style.transform = ''; card.style.setProperty('--lean', 0); });
  }
  function decide(keep, drag) {
    const card = $('.card.top'); if (!card || card.classList.contains('leaving')) return;
    const id = +card.dataset.id;
    card.classList.add('leaving'); card.classList.remove('top');
    S.history.push({ id, keep });
    if (keep) { if (!S.kept.includes(id)) S.kept.push(id); } else S.passed.push(id);
    S.deckIdx++;
    if (keep) {
      const tgt = $('#keptc').getBoundingClientRect();
      card.style.transition = 'none';
      fx.erode(card, { dir: 'right', duration: 700, target: { x: tgt.left + tgt.width / 2, y: tgt.top + tgt.height / 2 }, done: () => card.remove() });
      setTimeout(() => { const k = $('#keptc'); if (k) { k.classList.remove('pulse'); void k.offsetWidth; k.classList.add('pulse'); } }, 650);
    } else {
      const r = card.getBoundingClientRect();
      card.style.transition = motion.reduced ? 'opacity .2s' : 'transform .5s cubic-bezier(.3,.1,.6,1), opacity .5s';
      card.style.transform = motion.reduced ? '' : `translate(${-innerWidth * 1.1}px, ${(drag ? drag.dy : 0) + 60}px) rotate(-22deg)`;
      card.style.opacity = '0';
      for (let i = 0; i < 4; i++) setTimeout(() => fx.burst(r.left + r.width * (0.1 + Math.random() * 0.3) - i * 60, r.top + r.height * Math.random(), 22), i * 70);
      setTimeout(() => card.remove(), 520);
    }
    renderStack();
  }
  function undo() {
    const last = S.history.pop(); if (!last) return;
    if (last.keep) S.kept = S.kept.filter((x) => x !== last.id); else S.passed = S.passed.filter((x) => x !== last.id);
    S.deckIdx = S.deck.indexOf(last.id);
    $$('.card').forEach((c) => c.remove());
    renderStack();
  }
  function finishDeck() {
    if (S.screen !== 'deck') return;
    go('results');
  }

  // ---- Results -------------------------------------------------------------
  const SECTIONS = [['sky', 'Sky'], ['list', 'List'], ['money', 'Money'], ['dates', 'Dates'], ['share', 'Share']];
  function Results() {
    rescore();
    const name = S.profile.name.trim();
    const secs = S.friend ? [...SECTIONS, ['compare', 'Compare']] : SECTIONS;
    const el = h(`<section class="screen results">
      <section class="r-sec" id="sec-sky" aria-labelledby="h-sky">
        <div class="r-head settle"><p class="eyebrow">Results</p><h1 id="h-sky" class="r-title metal">${name ? esc(name) + '’s sky' : 'Your sky'}</h1>
          <p class="hint">Closest = best fit. Tap a planet.</p></div>
        <div class="sky-wrap"><canvas id="rsky" role="img" aria-label="Your kept schools orbiting you; the list below has the same information."></canvas><div class="empty-sky" id="empty-sky" hidden></div></div>
        <div class="scroll-cue" id="cue" aria-hidden="true">${'<i></i>'.repeat(7)}<b></b></div>
      </section>
      <section class="r-sec" id="sec-list" aria-labelledby="h-list"><h2 id="h-list" class="r-h">Your list</h2><div id="list-body"></div></section>
      <section class="r-sec" id="sec-money" aria-labelledby="h-money"><h2 id="h-money" class="r-h">Money</h2><div id="money-body"></div></section>
      <section class="r-sec" id="sec-dates" aria-labelledby="h-dates"><h2 id="h-dates" class="r-h">Deadlines</h2><div id="dates-body"></div></section>
      <section class="r-sec" id="sec-share" aria-labelledby="h-share"><h2 id="h-share" class="r-h">Share</h2><div id="share-body"></div></section>
      ${S.friend ? `<section class="r-sec" id="sec-compare" aria-labelledby="h-compare"><h2 id="h-compare" class="r-h">You + ${esc(S.friend.n || 'your friend')}</h2><div id="compare-body"></div></section>` : ''}
      <footer class="r-foot" data-rv>
        <a class="btn ghost" href="mailto:contact@findyoursky.com?subject=Your%20Sky">Get in touch</a>
        <p class="fine">contact@findyoursky.com</p>
      </footer>
      <nav class="rail" aria-label="Progress through your results"><span class="rail-label mono" id="rail-label" aria-live="polite">${secs[0][1]}</span>
        <div class="rail-track">${secs.map(([id, l]) => `<button type="button" data-sec="${id}" data-label="${l}" aria-label="Jump to ${l}"><i></i></button>`).join('')}</div></nav>
    </section>`);
    main.setFits([], { only: [] });
    main.setView({ orbitAlpha: 0, sr: 0.01 });
    main.sunText = '';
    setTimeout(() => {
      const c = $('#rsky');
      resultsSky = new Sky(c, { sun: you });
      resultsSky.labelFn = (b) => `${b.s.n}  ${b.fit}%`;
      resultsSky.sunText = name; resultsSky.colorize = true;
      resultsSky.setView({ sx: 0.5, sy: 0.5, sr: 22, ox: 0.5, oy: 0.5, orbit: 1, tilt: 0.8, labels: 99, pscale: 2.2 });
      resultsSky.setSchools(SCHOOLS);
      c.addEventListener('click', (e) => {
        const r = c.getBoundingClientRect(), b = resultsSky.pick(e.clientX - r.left, e.clientY - r.top);
        if (b) { resultsSky.selected = b; openSheet(b.id); }
      });
      new IntersectionObserver(([en]) => (resultsSky.visible = en.isIntersecting)).observe(c);
      refreshResults(true);
      wireNav(el); reveal(el);
      [300, 900, 1800].forEach((ms) => setTimeout(() => grit.wake(), ms));
      if (S.friend) buildCompare();
    }, 0);
    return el;
  }
  function refreshResults(snap) {
    if (S.screen !== 'results') return;
    rescore();
    if (resultsSky) {
      resultsSky.setFits(S.kept.map((id) => ({ id, fit: resultOf(id).fit })), { only: S.kept, focus: 99, labels: 99 });
      if (snap) { resultsSky.snap(); for (const b of resultsSky.bodies.values()) if (S.kept.includes(b.id)) { b.r = 1.3; b.mass = 0; b.alpha = 1; } }
      const empty = $('#empty-sky');
      empty.hidden = S.kept.length > 0;
      if (!S.kept.length) empty.innerHTML = `<p>Your sky is empty. You passed on every card.</p><button class="btn ghost" id="redo">Go through them again</button>`, $('#redo').addEventListener('click', () => { S.passed = []; go('deck'); });
    }
    renderList(); renderMoney(); renderDates(); renderShare();
    if (S.friend) renderCompare();
  }
  function keptResults() { return S.kept.map((id) => ({ s: byId.get(id), r: resultOf(id) })).sort((a, b) => b.r.fit - a.r.fit); }
  function suggest(filter) { return scored.find((x) => !S.kept.includes(x.s.id) && filter(x)); }
  function addBtn(x, label) { return x ? `<button class="btn ghost small" data-open="${x.s.id}">${label || 'See ' + esc(x.s.n)}</button>` : ''; }

  function renderList() {
    const body = $('#list-body'); if (!body) return;
    const ks = keptResults();
    const n = { reach: 0, target: 0, likely: 0 }; ks.forEach((x) => n[x.r.chance.cat]++);
    const tot = ks.length || 1;
    const warns = [];
    if (!n.likely) { const sg = suggest((x) => x.r.chance.cat === 'likely' && x.r.fit >= 55); warns.push({ t: 'No likely schools yet. Every list needs one or two you’re very likely to get into.', a: addBtn(sg, `Try ${sg ? esc(sg.s.n) : ''}, ${sg ? sg.r.fit : ''}% fit`) }); }
    if (ks.length && n.reach / tot > 0.6) warns.push({ t: `Reach-heavy: ${n.reach} of ${ks.length} are reaches. Balance them with targets.` });
    if (ks.length && !n.target) { const sg = suggest((x) => x.r.chance.cat === 'target' && x.r.fit >= 55); warns.push({ t: 'No targets yet. These are the schools where your scores sit right in the middle.', a: addBtn(sg, sg ? `Try ${esc(sg.s.n)}, ${sg.r.fit}% fit` : '') }); }
    if (ks.length > 0 && ks.length < 5) warns.push({ t: `${ks.length} school${ks.length > 1 ? 's' : ''} so far. Most students apply to 6 to 10.` });
    if (ks.length > 14) warns.push({ t: `${ks.length} schools is a lot of essays. Most students apply to 6 to 10.` });
    const ed = ks.filter((x) => E.deadlinesOf(x.s).some((d) => d.binding));
    if (ed.length > 1) warns.push({ t: 'Early Decision is binding: you can apply ED to only one school.' });
    body.innerHTML = `
      <div class="balance" role="img" aria-label="${n.reach} reach, ${n.target} target, ${n.likely} likely">
        ${['reach', 'target', 'likely'].map((c, i) => `<div class="bal ${c}" style="--f:${Math.max(n[c], 0.35)};--i:${i}"><span class="bal-n" data-count="${n[c]}">${n[c]}</span><span class="bal-l">${CHANCE[c]}</span></div>`).join('')}
      </div>
      <p class="hint" data-rv>Aim for 2–3 of each.</p>
      ${warns.map((w) => `<div class="warn" data-rv>${ICON.warn}<div><p>${w.t}</p>${w.a || ''}</div></div>`).join('')}
      ${!warns.length && ks.length ? `<div class="warn ok" data-rv>${ICON.ok}<p>Nicely balanced.</p></div>` : ''}
      <ul class="rows">${ks.map((x, i) => `<li data-rv style="--i:${i}"><button class="row" data-open="${x.s.id}"><span class="row-p" data-portrait="${x.s.id}"></span>
        <span class="row-main"><span class="row-name">${esc(x.s.n)}</span><span class="row-sub">${esc(x.s.c)}, ${x.s.s} · est. ${money(x.r.cost.est)}/yr</span></span>
        <span class="row-fit mono">${x.r.fit}%</span>${pill(x.r.chance.cat)}${ICON.chev}</button></li>`).join('')}</ul>
      <div class="search"><label class="fieldline" for="find">Add any school</label><input id="find" class="textin" type="search" placeholder="Search ${SCHOOLS.length} schools" autocomplete="off"><ul class="find-results" id="find-results"></ul></div>`;
    $$('[data-portrait]', body).forEach((p) => p.appendChild(schoolPortrait(byId.get(+p.dataset.portrait), 30, 220)));
    reveal(body);
    const find = $('#find', body), out = $('#find-results', body);
    find.addEventListener('input', () => {
      const q = find.value.trim().toLowerCase();
      out.innerHTML = q.length < 2 ? '' : SCHOOLS.filter((s) => (s.n + ' ' + s.f + ' ' + s.c).toLowerCase().includes(q)).slice(0, 6)
        .map((s) => `<li><button class="row slim" data-open="${s.id}"><span class="row-main"><span class="row-name">${esc(s.n)}</span><span class="row-sub">${esc(s.c)}, ${s.s}</span></span><span class="row-fit mono">${resultOf(s.id).fit}%</span>${ICON.chev}</button></li>`).join('');
    });
  }

  function renderMoney() {
    const body = $('#money-body'); if (!body) return;
    const P = S.profile, ks = keptResults();
    const max = Math.max(P.budget || 0, ...ks.map((x) => x.r.cost.sticker), 1);
    const within = P.budget != null ? ks.filter((x) => x.r.cost.est <= P.budget) : [];
    body.innerHTML = `
      <div class="money-ctrls">
        <div class="field"><span class="fieldline" id="l-inc">Family income <span class="dim">optional</span></span>
          <div class="chips" role="radiogroup" aria-labelledby="l-inc">${INCOMES.map((i) => `<button class="chip" role="radio" aria-checked="${S.income === i.v}" data-inc="${i.v}"><i class="pour" aria-hidden="true"></i><span>${i.l}</span></button>`).join('')}<button class="chip" role="radio" aria-checked="${S.income == null}" data-inc=""><i class="pour" aria-hidden="true"></i><span>Not sure</span></button></div></div>
        <div class="field"><div class="fieldline"><label for="m-budget">Yearly budget</label><output class="mono" id="m-out">${P.budget != null ? budgetText(P.budget) : 'Not set'}</output></div>
          <input id="m-budget" type="range" min="0" max="90000" step="1000" value="${P.budget ?? 30000}" class="${P.budget == null ? 'unset' : ''}"></div>
      </div>
      <p class="summary" data-rv>${P.budget == null ? 'Set a budget to see which schools fit it.' : `<strong class="metal"><span data-count="${within.length}">${within.length}</span> of ${ks.length}</strong> schools fit your ${budgetText(P.budget)} budget.`}</p>
      <div class="chart" style="--budget:${P.budget != null ? (P.budget / max) * 100 : -10}%">
        ${P.budget != null ? `<div class="budget-line"><span class="mono">Budget</span></div>` : ''}
        ${ks.map((x, i) => `<button class="crow" style="--i:${i}" data-open="${x.s.id}">
          <span class="crow-top"><span class="crow-name">${esc(x.s.n)}</span><span class="mono ${P.budget != null && x.r.cost.est > P.budget ? 'over' : ''}">${money(x.r.cost.est)}</span></span>
          <span class="cbar"><i class="sticker" style="--w:${(x.r.cost.sticker / max) * 100}%"></i><i class="est" style="--w:${(x.r.cost.est / max) * 100}%"></i></span></button>`).join('')}
        <div class="legend mono"><span><i class="est"></i>Est. for you</span><span><i class="sticker"></i>Sticker price</span></div>
      </div>
      <p class="fine">Based on what students actually paid after grants. Confirm with each school’s net price calculator.</p>`;
    $$('[data-inc]', body).forEach((b) => b.addEventListener('click', () => { S.income = b.dataset.inc === '' ? null : +b.dataset.inc; refreshResults(); }));
    reveal(body); piles(body);
    const mb = $('#m-budget', body);
    new window.SKY.SandTrack(mb);
    mb.addEventListener('input', () => { P.budget = +mb.value; mb.classList.remove('unset'); $('#m-out', body).textContent = budgetText(P.budget); });
    mb.addEventListener('change', () => refreshResults());
  }

  function renderDates() {
    const body = $('#dates-body'); if (!body) return;
    const cy = E.cycleYear(), now = new Date(), events = [], rolling = [];
    for (const x of keptResults()) for (const d of E.deadlinesOf(x.s)) {
      if (!d.date) { rolling.push(x.s.n); continue; }
      events.push({ date: d.date, title: x.s.n, sub: d.name + (d.binding ? ' · binding' : ''), id: x.s.id });
    }
    const fixed = [
      { date: new Date(cy, 9, 1), title: 'FAFSA and CSS Profile open', sub: 'File early. Some aid is first come, first served.', fixed: true },
      { date: new Date(cy, 11, 15), title: 'Early results arrive', sub: 'Most ED and EA decisions land mid-December', fixed: true },
      { date: new Date(cy + 1, 2, 25), title: 'Regular decisions arrive', sub: 'Late March to early April', fixed: true },
      { date: new Date(cy + 1, 4, 1), title: 'National Decision Day', sub: 'Commit to one school and send your deposit', fixed: true },
    ];
    const all = [...events, ...fixed].sort((a, b) => a.date - b.date);
    const groups = [];
    for (const e of all) { const k = e.date.toDateString(); const g = groups.find((x) => x.k === k); g ? g.items.push(e) : groups.push({ k, date: e.date, items: [e] }); }
    let todayPlaced = false;
    const html = [];
    for (const g of groups) {
      if (!todayPlaced && g.date > now) { html.push(`<li class="tl today"><span class="tl-date mono">Today</span><span class="tl-dot"></span><div class="tl-items"><p class="tl-t">${E.fmtDate(now)}</p></div></li>`); todayPlaced = true; }
      const past = g.date < now && g.date.toDateString() !== now.toDateString();
      html.push(`<li class="tl ${past ? 'past' : ''}" data-rv style="--i:${html.length % 4}"><span class="tl-date mono">${E.fmtDate(g.date)}</span><span class="tl-dot"></span><div class="tl-items">${g.items.map((e) =>
        e.fixed ? `<p class="tl-t fixed">${e.title}<small>${e.sub}</small></p>` : `<button class="tl-t" data-open="${e.id}">${esc(e.title)}<small>${e.sub}</small></button>`).join('')}</div></li>`);
    }
    if (!todayPlaced) html.push(`<li class="tl today"><span class="tl-date mono">Today</span><span class="tl-dot"></span><div class="tl-items"><p class="tl-t">${E.fmtDate(now)}</p></div></li>`);
    body.innerHTML = `<ol class="timeline" id="timeline">${html.join('')}</ol>
      ${rolling.length ? `<p class="hint">Rolling admission at ${rolling.map(esc).join(', ')}: they decide as applications arrive, so apply early in the fall.</p>` : ''}
      <p class="fine">Typical dates for fall ${cy + 1}. Confirm on each school’s site.</p>`;
    reveal(body);
  }

  function shareLink() { return location.href.split('#')[0] + '#s=' + E.encodeShare(S); }
  // Shown on the share card. Uses the live host once deployed; the planned domain while running locally.
  const SITE = 'findyoursky.com';
  const siteLabel = () => (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname) || location.protocol === 'file:' ? SITE : location.host);

  // ---- Share card: one story-sized frame of your sky, drawn in the browser ----
  async function makeShareCard() {
    if (document.fonts) await document.fonts.ready;
    const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), name = S.profile.name.trim(), ks = keptResults();
    const bg = g.createRadialGradient(W / 2, -120, 0, W / 2, -120, H * 1.1);
    bg.addColorStop(0, '#2e3137'); bg.addColorStop(0.42, '#17191c'); bg.addColorStop(1, '#0b0c0e');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3200; i++) { g.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.035})`; g.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6); }
    for (let i = 0; i < 170; i++) { const sz = 1.5 + Math.random() * 2.2; g.fillStyle = `rgba(235,238,244,${0.25 + Math.random() * 0.55})`; g.fillRect(Math.random() * W, Math.random() * H, sz, sz); }

    const metal = (x0, x1) => { const m = g.createLinearGradient(x0, 0, x1, 0); m.addColorStop(0, '#9aa0a8'); m.addColorStop(0.3, '#f7f8fa'); m.addColorStop(0.5, '#b4b9c1'); m.addColorStop(0.68, '#ffffff'); m.addColorStop(1, '#9196a0'); return m; };
    g.textBaseline = 'alphabetic';
    g.font = '500 28px "Geist Mono", monospace'; if ('letterSpacing' in g) g.letterSpacing = '8px';
    g.fillStyle = 'rgba(184,188,196,0.9)'; g.fillText('YOUR SKY', 84, 140);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = '400 118px "Instrument Serif", Georgia, serif';
    const title = name ? `${name}’s sky` : 'My sky';
    g.fillStyle = metal(84, 84 + g.measureText(title).width); g.fillText(title, 80, 262);

    // The sky: engraved orbits, then schools at their fit distances, your planet at the center.
    const cx = W / 2, cy = 880, RX = 470, tilt = 0.74;
    for (const f of [0.3, 0.55, 0.78, 1]) {
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(cx, cy + 2, RX * f, RX * f * tilt, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(220,225,235,0.08)'; g.beginPath(); g.ellipse(cx, cy, RX * f, RX * f * tilt, 0, 0, Math.PI * 2); g.stroke();
    }
    const fitsK = ks.map((x) => x.r.fit), hi = Math.max(...fitsK, 1), lo = Math.min(...fitsK, 0), span = Math.max(8, hi - lo);
    const shared = new Set(S.friend ? S.friend.k.filter((id) => S.kept.includes(id)) : []);
    const bodies = ks.map((x, i) => {
      const norm = (hi - x.r.fit) / span, rank = ks.length > 1 ? i / (ks.length - 1) : 0, rr = 0.32 + (norm * 0.55 + rank * 0.45) * 0.66;
      const ang = i * 2.39996 + (hashStr(String(x.s.id)) % 100) / 60, sizeF = Math.max(0, Math.min(1, (Math.log10(x.s.size || 2000) - 3) / 1.6));
      return { x, px: cx + Math.cos(ang) * RX * rr, py: cy + Math.sin(ang) * RX * rr * tilt, sz: 58 + sizeF * 36, depth: Math.sin(ang) };
    });
    const drawBody = (b) => {
      if (shared.has(b.x.s.id)) { g.strokeStyle = 'rgba(240,242,246,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(b.px, b.py, b.sz * 0.62, 0, Math.PI * 2); g.stroke(); }
      const pic = schoolPortrait(b.x.s, b.sz, 700);
      g.drawImage(pic, b.px - b.sz / 2, b.py - b.sz / 2, b.sz, b.sz);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55; g.drawImage(pic, b.px - b.sz / 2, b.py - b.sz / 2, b.sz, b.sz);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    };
    bodies.filter((b) => b.depth < 0).forEach(drawBody);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 360); glow.addColorStop(0, 'rgba(235,238,245,0.2)'); glow.addColorStop(0.4, 'rgba(200,205,215,0.07)'); glow.addColorStop(1, 'rgba(200,205,215,0)');
    g.fillStyle = glow; g.fillRect(cx - 360, cy - 360, 720, 720);
    const keepSun = you.p.sunness, keepRing = you.p.ring, keepHalo = you.p.halo;
    you.p.sunness = 0.12; you.p.ring = keepRing * 0.55; you.p.halo = keepHalo * 0.4;
    you.draw(new window.SKY.Painter(), g, cx, cy, 132, 2);
    you.p.sunness = keepSun; you.p.ring = keepRing; you.p.halo = keepHalo;
    bodies.filter((b) => b.depth >= 0).forEach(drawBody);
    // Labels under each planet, nudged to avoid collisions.
    g.font = '500 25px "Geist Mono", monospace'; g.textBaseline = 'middle';
    const placed = [[cx - 120, cy - 90, 240, 180]];
    for (const b of bodies.slice().sort((p, q) => q.x.r.fit - p.x.r.fit)) {
      const txt = `${b.x.s.n}  ${b.x.r.fit}%`, tw = g.measureText(txt).width, off = b.sz / 2 + 12;
      const spots = [];
      for (const k of [0, 36, 72]) spots.push([b.px - tw / 2, b.py + off + 14 + k], [b.px + off + k * 0.5, b.py], [b.px - off - tw - k * 0.5, b.py], [b.px - tw / 2, b.py - off - 14 - k], [b.px + off * 0.7, b.py + off + 10 + k], [b.px - off * 0.7 - tw, b.py - off - 10 - k]);
      const ux = b.px - cx, uy = b.py - cy, ul = Math.hypot(ux, uy) || 1;
      // Fallback: push the label outward from the center, joined to its planet by a hairline.
      for (let k = 1; k <= 6; k++) { const dd = off + 40 * k, lx = b.px + (ux / ul) * dd, ly = b.py + (uy / ul) * dd; spots.push([ux > 0 ? lx : lx - tw, ly, true]); }
      for (const [x, y, lead] of spots) {
        const r = [x - 8, y - 17, tw + 16, 34];
        if (r[0] < 30 || r[0] + r[2] > W - 30 || r[1] < 300 || r[1] + r[3] > 1360 || placed.some((p) => r[0] < p[0] + p[2] && r[0] + r[2] > p[0] && r[1] < p[1] + p[3] && r[1] + r[3] > p[1])) continue;
        placed.push(r);
        if (lead) { g.strokeStyle = 'rgba(220,225,235,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(b.px + (ux / ul) * b.sz * 0.5, b.py + (uy / ul) * b.sz * 0.5); g.lineTo(ux > 0 ? r[0] : r[0] + r[2], y); g.stroke(); }
        g.fillStyle = 'rgba(12,13,16,0.62)'; g.fillRect(r[0], r[1], r[2], r[3]);
        g.fillStyle = 'rgba(232,235,240,0.95)'; g.fillText(txt, x, y + 1);
        break;
      }
    }

    // Caption: the three closest orbits.
    let y = 1400;
    g.textBaseline = 'alphabetic'; g.font = '500 24px "Geist Mono", monospace'; if ('letterSpacing' in g) g.letterSpacing = '6px';
    g.fillStyle = 'rgba(142,147,156,1)'; g.fillText('CLOSEST ORBITS', 84, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    y += 34;
    for (const x of ks.slice(0, 3)) {
      g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 2; g.beginPath(); g.moveTo(84, y); g.lineTo(W - 84, y); g.stroke();
      y += 76;
      g.font = '400 58px "Instrument Serif", Georgia, serif'; g.fillStyle = '#eef0f3'; g.fillText(x.s.n, 84, y - 8);
      g.font = '500 32px "Geist Mono", monospace'; g.fillStyle = '#eef0f3'; const f = `${x.r.fit}%`; g.fillText(f, W - 84 - g.measureText(f).width, y - 14);
      y += 22;
    }
    g.font = '500 26px "Geist Mono", monospace'; g.fillStyle = 'rgba(160,165,174,0.9)';
    const foot = `${siteLabel()}  ·  build yours`; g.fillText(foot, (W - g.measureText(foot).width) / 2, H - 92);
    return c;
  }

  let shareBlob = null, shareURL = null, shareJob = 0;
  function renderShare() {
    const body = $('#share-body'); if (!body) return;
    const ks = keptResults(), name = S.profile.name.trim();
    body.innerHTML = `
      <figure class="share-preview" data-rv><img id="share-img" alt="${esc(name ? name + '’s' : 'My')} sky: ${ks.length} schools${ks[0] ? ', closest ' + ks.slice(0, 3).map((x) => esc(x.s.n)).join(', ') : ''}"></figure>
      <div class="share-btns" data-rv style="--i:2">
        <button class="btn chrome" id="sh-primary" disabled>Save image</button>
        <button class="btn ghost" id="sh-copy">Copy link</button>
      </div>
      <button class="btn text small" id="sh-save" hidden>Save image</button>
      <p class="fine">Friends who open your link can build their own sky and compare. It never includes grades, scores or budget. <a href="about.html">About Your Sky</a></p>
      <button class="btn text small" id="restart">Start over</button>`;
    reveal(body);
    const job = ++shareJob, img = $('#share-img', body), primary = $('#sh-primary', body), save = $('#sh-save', body);
    const download = () => { if (!shareURL) return; const a = document.createElement('a'); a.href = shareURL; a.download = 'your-sky.png'; document.body.appendChild(a); a.click(); a.remove(); };
    setTimeout(async () => {
      const c = await makeShareCard();
      if (job !== shareJob) return;
      c.toBlob((b) => {
        if (!b || job !== shareJob) return;
        shareBlob = b; if (shareURL) URL.revokeObjectURL(shareURL); shareURL = URL.createObjectURL(b); img.src = shareURL;
        const file = new File([b], 'your-sky.png', { type: 'image/png' });
        const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
        primary.disabled = false;
        if (canShareFile) {
          primary.textContent = 'Share'; save.hidden = false;
          primary.onclick = () => navigator.share({ files: [file], title: 'My sky', text: `Here’s my college sky. Build yours and see how we overlap: ${shareLink()}` }).catch(() => {});
        } else primary.onclick = download;
      }, 'image/png');
    }, 120);
    save.addEventListener('click', download);
    $('#sh-copy', body).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(shareLink()); toast('Link copied'); }
      catch (e) { prompt('Copy your link', shareLink()); }
    });
    $('#restart', body).addEventListener('click', () => {
      if (!confirm('Start over? Your answers and sky will be cleared.')) return;
      const f = S.friend; S = fresh(); S.friend = f; resultsSky = null; compareSky = null; friendPlanet = null;
      you.set('tint', [1, 1, 1]); syncPlanet(); go('landing');
    });
  }

  function buildCompare() {
    const f = S.friend, body = $('#compare-body'); if (!body) return;
    body.innerHTML = `<div class="compat"><div class="compat-num"><span class="metal" id="compat-n">0</span><small>% compatible</small></div><p class="hint" id="compat-sub"></p></div>
      <div class="sky-wrap small"><canvas id="csky" role="img" aria-label="Both skies side by side; shared schools orbit between you."></canvas></div>
      <div id="compat-detail"></div>`;
    friendPlanet = new Planet((hashStr(f.n || 'friend') % 9000) + 11, 1100);
    friendPlanet.set('tint', METALS[E.majorOf(f.m || 'undecided').fam].tint); friendPlanet.set('sunness', 1); friendPlanet.set('moonVis', 0);
    const c = $('#csky');
    compareSky = new Sky(c, { sun: you });
    compareSky.friendSun = friendPlanet;
    compareSky.labelFn = (b) => b.s.n;
    compareSky.sunText = S.profile.name.trim() || 'You'; compareSky.friendText = f.n || 'Friend'; compareSky.colorize = true;
    compareSky.setView({ sx: 0.5, sy: 0.5, sr: 19, ox: 0.5, oy: 0.5, orbit: 1, tilt: 0.62, binary: 1, labels: 99, pscale: 1.7 });
    compareSky.setSchools(SCHOOLS);
    c.addEventListener('click', (e) => { const r = c.getBoundingClientRect(), b = compareSky.pick(e.clientX - r.left, e.clientY - r.top); if (b) openSheet(b.id); });
    new IntersectionObserver(([en]) => (compareSky.visible = en.isIntersecting)).observe(c);
    renderCompare(true);
  }
  function renderCompare(snap) {
    const f = S.friend; if (!compareSky || !f) return;
    const cp = E.compat(S, f, SCHOOLS);
    const all = [...new Set([...S.kept, ...f.k])];
    const homes = new Map(all.map((id) => [id, S.kept.includes(id) && f.k.includes(id) ? 2 : S.kept.includes(id) ? 0 : 1]));
    const fp = { major: f.m, major2: f.b, region: f.r, dorm: true };
    compareSky.setFits(all.map((id) => ({ id, fit: homes.get(id) === 1 ? E.score(byId.get(id), fp, f.a, null).fit : resultOf(id).fit })), { only: all, focus: 99, labels: 99, homes });
    for (const b of compareSky.bodies.values()) if (b.homeT === 2 && all.includes(b.id)) b.rT = 0.82 + ((b.rT - 0.2) / 0.76) * 0.16;
    if (snap) compareSky.snap();
    const nEl = $('#compat-n'), target = cp.total;
    if (snap && !motion.reduced) { const t0 = performance.now(); const tick = (t) => { const p = Math.min(1, (t - t0) / 1400); nEl.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    else nEl.textContent = target;
    $('#compat-sub').textContent = cp.shared.length ? `You both kept ${cp.shared.length} school${cp.shared.length > 1 ? 's' : ''}.` : 'No schools in common yet, but your answers tell part of the story.';
    const names = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
    $('#compat-detail').innerHTML = `
      ${cp.shared.length ? `<h3 class="r-sub">Both of you kept</h3><ul class="rows">${names(cp.shared).map((s) => `<li><button class="row slim" data-open="${s.id}"><span class="row-main"><span class="row-name">${esc(s.n)}</span><span class="row-sub">${esc(s.c)}, ${s.s}</span></span><span class="row-fit mono">${resultOf(s.id).fit}%</span>${ICON.chev}</button></li>`).join('')}</ul>` : ''}
      ${cp.same.length ? `<h3 class="r-sub">You both want</h3><p class="tags">${cp.same.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
      ${cp.diff.length ? `<h3 class="r-sub">Where you differ</h3><p class="tags dim">${cp.diff.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
      <h3 class="r-sub">Only on ${esc(f.n || 'their')}${f.n ? '’s' : ''} list</h3>
      <ul class="rows">${names(f.k.filter((id) => !S.kept.includes(id))).map((s) => `<li><button class="row slim" data-open="${s.id}"><span class="row-main"><span class="row-name">${esc(s.n)}</span><span class="row-sub">${resultOf(s.id).fit}% fit for you</span></span>${pill(resultOf(s.id).chance.cat)}${ICON.chev}</button></li>`).join('') || '<li class="hint">Nothing. You kept everything they did.</li>'}</ul>`;
  }

  // Results animations are tied to scroll position (see ScrollSand), so they rewind as you scroll back up.
  const grit = new window.SKY.ScrollSand($('#grit'));
  const reveal = (root) => grit.scan(root);

  function wireNav(el) {
    const nav = $('.rail', el), btns = $$('button', nav), cue = $('#cue', el), label = $('#rail-label', el);
    btns.forEach((b) => b.addEventListener('click', () => {
      const t = $('#sec-' + b.dataset.sec);
      window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 8, behavior: motion.reduced ? 'auto' : 'smooth' });
    }));
    let queued = false;
    const update = () => {
      queued = false;
      if (S.screen !== 'results') return;
      const vh = innerHeight, mid = scrollY + vh * 0.45, atEnd = scrollY + vh >= document.documentElement.scrollHeight - 4;
      let active = 0;
      btns.forEach((b, i) => {
        const sec = $('#sec-' + b.dataset.sec); if (!sec) return;
        const top = sec.offsetTop, hgt = sec.offsetHeight;
        const p = atEnd ? 1 : Math.max(0, Math.min(1, (mid - top) / hgt));
        b.querySelector('i').style.transform = `scaleX(${p})`;
        if (mid >= top) active = i;
      });
      if (atEnd) active = btns.length - 1;
      btns.forEach((b, i) => b.toggleAttribute('aria-current', i === active));
      const lbl = `${btns[active].dataset.label}  ${active + 1}/${btns.length}`;
      if (label.textContent !== lbl) label.textContent = lbl;
      cue.classList.toggle('gone', scrollY > 40);
      // The sky drifts back and dims as you scroll past it; the timeline draws itself as you read.
      const skyW = $('.sky-wrap', el), skySec = $('#sec-sky', el);
      if (skyW && !motion.reduced) { const p = Math.max(0, Math.min(1, scrollY / skySec.offsetHeight)); skyW.style.transform = `translateY(${(p * 90).toFixed(1)}px) scale(${(1 - p * 0.1).toFixed(3)})`; skyW.style.opacity = (1 - p * 0.75).toFixed(3); }
      const tl = $('#timeline');
      if (tl) { const r = tl.getBoundingClientRect(); tl.style.setProperty('--tl', Math.max(0, Math.min(1, (vh * 0.75 - r.top) / r.height)).toFixed(3)); }
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    update();
    // One gentle nudge if they haven't discovered scrolling: the content lifts and settles back.
    let engaged = false;
    const engage = () => (engaged = true);
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((t) => addEventListener(t, engage, { once: true, passive: true }));
    setTimeout(() => {
      if (engaged || motion.reduced || scrollY > 10 || S.screen !== 'results' || !sheet.hidden) return;
      el.classList.add('nudge');
      const tick = setInterval(() => grit.wake(), 100);
      setTimeout(() => { el.classList.remove('nudge'); clearInterval(tick); grit.wake(); }, 1500);
    }, 3200);
  }

  // ---- Detail sheet --------------------------------------------------------
  const sheet = $('#sheet'), sheetBody = $('#sheet-body'), backdrop = $('#backdrop');
  let lastFocus = null;
  const TEST = { 1: 'Required', 2: 'Recommended', 3: 'Not considered', 5: 'Test-optional' };
  function openSheet(id) {
    const s = byId.get(id); if (!s) return;
    const r = resultOf(id), ex = E.explain(s, r), c = r.cost, kept = S.kept.includes(id);
    const sat = E.satOf(S.profile);
    const dls = E.deadlinesOf(s);
    const satBar = s.sat ? (() => {
      const L = 800, R = 1600, a = ((s.sat[0] - L) / (R - L)) * 100, b = ((s.sat[1] - L) / (R - L)) * 100;
      const m = sat ? ((Math.max(L, Math.min(R, sat)) - L) / (R - L)) * 100 : null;
      return `<div class="range"><i class="band" style="left:${a}%;width:${b - a}%"></i>${m != null ? `<i class="you" style="left:${m}%"><span class="mono">You ${sat}</span></i>` : ''}</div><div class="scale mono"><span>800</span><span>Middle 50%: ${s.sat[0]}–${s.sat[1]}</span><span>1600</span></div>`;
    })() : '<p class="hint">No SAT range reported.</p>';
    const calc = s.calc ? (s.calc.startsWith('http') ? s.calc : 'https://' + s.calc) : null;
    sheetBody.innerHTML = `
      <header class="sh-head">
        <div class="sh-portrait" id="sh-portrait"></div>
        <div class="sh-title"><h2 id="sheet-title">${esc(s.n)}</h2><p class="hint">${esc(s.c)}, ${s.s} · ${s.pub ? 'Public' : 'Private'} · ${fmtInt(s.size)} undergrads</p></div>
        <div class="sh-fit"><span class="metal">${r.fit}</span><small>% fit</small></div>
      </header>
      <div class="sh-row">${pill(r.chance.cat)}${s.hbcu ? '<span class="tag">HBCU</span>' : ''}${s.wo ? '<span class="tag">Women’s college</span>' : ''}${s.note ? `<span class="tag">${esc(s.note)}</span>` : ''}</div>
      <section><h3>Why it fits you</h3><ul class="why">${ex.why.map((w) => `<li>${esc(w)}</li>`).join('') || '<li>Answer more questions to see why.</li>'}</ul>
        <p class="heads">${ICON.warn}<span>${esc(ex.heads)}</span></p></section>
      <section><h3>Fit breakdown</h3><ul class="parts">${r.parts.sort((a, b) => b.w - a.w).map((p) => `<li><span>${esc(p.label)}</span><span class="pbar"><i style="width:${Math.round(p.v * 100)}%"></i></span><span class="mono">${Math.round(p.v * 100)}</span></li>`).join('')}</ul></section>
      <section><h3>Your chances</h3><p>${CHANCE[r.chance.cat]}: ${esc(r.chance.basis)}.</p>
        <dl class="facts"><div><dt>Admit rate</dt><dd>${pct(s.adm)}</dd></div><div><dt>Testing</dt><dd>${TEST[s.test] || '—'}</dd></div><div><dt>ACT range</dt><dd>${s.act ? s.act.join('–') : '—'}</dd></div></dl>${satBar}</section>
      <section><h3>Cost per year</h3>
        <table class="ctable"><tbody>
          <tr><td>Tuition${s.pub ? (c.inState ? ' (in-state)' : ' (out-of-state)') : ''}</td><td>${money(c.tuition)}</td></tr>
          <tr><td>${S.profile.dorm ? 'Housing and food' : 'Housing or commute'}</td><td>${money(c.housing)}</td></tr>
          <tr><td>Books and supplies</td><td>${money(c.books)}</td></tr>
          <tr><td>Other costs</td><td>${money(c.other)}</td></tr>
          <tr class="total"><td>Sticker price</td><td>${money(c.sticker)}</td></tr>
          <tr class="you"><td>Estimated for you<small>${esc(c.basis)}</small></td><td class="metal">${money(c.est)}</td></tr>
        </tbody></table>
        ${c.note ? `<p class="hint">${esc(c.note)}.</p>` : ''}
        ${s.nbi && s.nbi.some((v) => v != null) ? `<p class="fieldline">Average net price by family income</p><div class="nbi">${INCOMES.map((i) => `<div class="${S.income === i.v ? 'on' : ''}"><span class="mono">${i.l}</span><strong>${money(s.nbi[i.v])}</strong></div>`).join('')}</div>` : ''}
        ${calc ? `<a class="btn ghost small" href="${esc(calc)}" target="_blank" rel="noopener">Net price calculator</a>` : ''}</section>
      <section><h3>Deadlines</h3><ul class="dl">${dls.map((d) => `<li><span>${d.name}${d.binding ? ' <span class="dim">· binding</span>' : ''}</span><span class="mono">${d.date ? E.fmtDate(d.date) : 'Apply early'}</span></li>`).join('')}</ul><p class="fine">Typical dates; confirm on the school’s site.</p></section>
      <section><h3>Key facts</h3><dl class="facts">
        <div><dt>Graduation rate</dt><dd>${pct(s.grad)}</dd></div><div><dt>Earnings at 10 yrs</dt><dd>${money(s.earn)}</dd></div>
        <div><dt>Median debt</dt><dd>${money(s.debt)}</dd></div><div><dt>Students per prof</dt><dd>${s.sfr ?? '—'}</dd></div>
        <div><dt>Setting</dt><dd>${esc(E.LOCALE_WORDS[E.locGroup(s.loc)].replace(/^a /, ''))}</dd></div><div><dt>From home</dt><dd>${r.dist != null ? fmtInt(Math.round(r.dist / 10) * 10) + ' mi' : '—'}</dd></div>
      </dl>${s.url ? `<a class="link" href="${esc(s.url.startsWith('http') ? s.url : 'https://' + s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}</section>
      <div class="sh-foot"><button class="btn ${kept ? 'ghost' : 'chrome'} wide" id="sh-toggle">${kept ? 'Remove from my sky' : 'Add to my sky'}</button></div>`;
    $('#sh-portrait').appendChild(schoolPortrait(s, 52));
    const acc = accentOf(s);
    sheet.style.setProperty('--acc', acc ? acc.css : 'transparent'); sheet.style.setProperty('--acc-rgb', acc ? acc.rgb : '0,0,0');
    sheet.classList.toggle('has-acc', !!acc);
    $('#sh-toggle').addEventListener('click', (e) => {
      if (S.kept.includes(id)) { S.kept = S.kept.filter((x) => x !== id); toast(`Removed ${s.n}`); }
      else { S.kept.push(id); const r2 = e.currentTarget.getBoundingClientRect(); fx.burst(r2.left + r2.width / 2, r2.top, 50); toast(`Added ${s.n} to your sky`); }
      closeSheet(); refreshResults();
      if (S.screen === 'deck') renderStack();
    });
    lastFocus = document.activeElement;
    sheet.hidden = false; backdrop.hidden = false;
    sheetBody.scrollTop = 0;
    requestAnimationFrame(() => { sheet.classList.add('open'); backdrop.classList.add('open'); $('#sheet-close').focus(); });
  }
  function closeSheet() {
    sheet.classList.remove('open'); backdrop.classList.remove('open');
    sheet.style.transform = '';
    if (resultsSky) resultsSky.selected = null;
    setTimeout(() => { if (!sheet.classList.contains('open')) { sheet.hidden = true; backdrop.hidden = true; } }, motion.reduced ? 0 : 380);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  $('#sheet-close').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);
  (() => {
    const grip = $('#sheet-grip'); let y0 = null, dy = 0;
    grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; grip.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); });
    grip.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; });
    const up = () => { if (y0 == null) return; y0 = null; sheet.classList.remove('dragging'); if (dy > 110) closeSheet(); else sheet.style.transform = ''; };
    grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  })();
  document.addEventListener('keydown', (e) => {
    if (!sheet.hidden) {
      if (e.key === 'Escape') closeSheet();
      if (e.key === 'Tab') {
        const f = $$('button, a[href], input, select', sheet).filter((x) => !x.disabled && x.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (S.screen === 'deck' && !e.target.closest('input')) {
      if (e.key === 'ArrowRight') decide(true);
      if (e.key === 'ArrowLeft') decide(false);
    }
  });
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o && !o.closest('.card')) openSheet(+o.dataset.open);
  });
  $('#sky').addEventListener('click', (e) => {
    if (S.screen !== 'questions') return;
    const b = main.pick(e.clientX, e.clientY);
    if (b) openSheet(b.id);
  });

  const SCREENS = { landing: Landing, profile: Profile, questions: Questions, deck: Deck, results: Results };
  if (!SCHOOLS.length) { app.innerHTML = '<section class="screen"><p class="lede" style="padding:24px">School data is missing. Run scripts/build_data.py to generate app/data.js.</p></section>'; return; }
  rescore();
  go('landing', { erode: false, focus: false });
})();
