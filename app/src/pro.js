// Pro: hidden planets, chances, real cost, earnings and the balanced-list builder. Everything Pro-only comes from the
// `sky` Edge Function, which checks is_pro on the server; free users get placeholders, never the real values.
import { proOn, MOCK, LEMON_CHECKOUT_URL, LEMON_STORE, PRO_PRICE } from './env.js';
import { callFunction, track } from './api.js';
import { getBackend } from './backend.js';
import { getReferral } from './referral.js';
import { store } from './storage.js';
import { buildCheckoutUrl, openCheckout, loadAffiliateTracking } from './checkout.js';

export const CHANCE_LABEL = { reach: 'Reach', target: 'Target', likely: 'Likely' };
export const NOT_A_PREDICTION = 'Estimate based on public data — not a prediction.';
const GHOST_COLOR = '3b4048';
const PLACEHOLDER = ['target', 'reach', 'likely'];

export function createPro(ctx, accounts) {
  const { $, $$, esc, toast } = ctx;
  let data = null, inflight = null, lastKey = '';

  const isPro = () => proOn && (data?.pro === true || accounts.isPro());
  function requestBody(extraIds = []) {
    const S = ctx.S(), P = S.profile;
    return {
      profile: { gpa: P.gpa, testMode: P.testMode, sat: P.sat, act: P.act, major: P.major, major2: P.major2, region: P.region, state: P.state, budget: P.budget },
      answers: S.answers, income: S.income, ids: [...new Set([...S.kept, ...extraIds])].filter((id) => id > 0),
    };
  }
  async function fetchSky(body) {
    if (accounts.user()) return (await accounts.load()).skyData(body);
    if (MOCK) return (await getBackend()).skyData(body);
    return callFunction('sky', body);
  }

  // Loads gated data for the current answers; repeated calls with the same inputs reuse the result.
  async function refresh({ force = false } = {}) {
    if (!proOn) return null;
    const body = requestBody(), key = JSON.stringify(body) + (accounts.user()?.id || '') + accounts.isPro();
    if (!force && key === lastKey && data) return data;
    if (!force && key === lastKey && inflight) return inflight;
    lastKey = key;
    inflight = fetchSky(body)
      .then((d) => { if (key === lastKey) { data = d; registerHidden(); ctx.onProData(); } return d; })
      .catch(() => null)
      .finally(() => (inflight = null));
    return inflight;
  }
  // Pro: details for a school outside the top list (e.g. one found by search).
  async function ensureDetail(id) {
    if (!isPro() || data?.details?.[id] || id < 0) return;
    const d = await fetchSky(requestBody([id])).catch(() => null);
    if (d?.details) { data.details = { ...data.details, ...d.details }; ctx.onProData(); }
  }
  function registerHidden() {
    if (data?.pro) for (const h of data.hidden) { if (!ctx.byId.has(h.school.id)) ctx.byId.set(h.school.id, { ...h.school, hidden: true }); }
  }

  const detail = (id) => (isPro() ? data?.details?.[id] || data?.hidden?.find((h) => h.school.id === id) : data?.reveal?.id === id ? data.reveal : null) || null;
  const isFreeLook = (id) => !isPro() && data?.reveal?.id === id;

  // ---- Planets the free sky doesn't name ----------------------------------------------------------------
  // Free: dark, unnamed planets at their fit distance. Pro: the real schools, flagged as new.
  function skyExtras() {
    if (!proOn || !data) return [];
    if (data.pro) return data.hidden.map((h) => ({ s: ctx.byId.get(h.school.id), fit: h.fit }));
    return (data.hidden?.fits || []).map((fit, i) => ({
      s: { id: -(i + 1), n: 'Hidden match', f: 'Hidden match', col: GHOST_COLOR, size: 4000, ghost: true, prog: {}, x: '' },
      fit,
    }));
  }
  function hiddenLine() {
    if (!proOn || !data) return '';
    if (data.pro) return data.hidden.length ? `<p class="hidden-line pro"><span class="mono">New</span> ${data.hidden.length} hidden ${data.hidden.length === 1 ? 'match' : 'matches'} revealed: ${data.hidden.map((h) => `<button class="link-btn" data-open="${h.school.id}">${esc(h.school.n)}</button>`).join(', ')}</p>` : '';
    const n = data.hidden?.count || 0;
    // The one free reveal: your best match overall, which you may not have kept.
    const r = data.reveal, rs = r && ctx.byId.get(r.id);
    const look = rs ? `<button class="free-look-line" data-open="${r.id}"><span class="mono">Your free look</span><span class="fl-name">${esc(rs.n)}</span>${r.chance.category ? `<span class="pill ${r.chance.category}">${CHANCE_LABEL[r.chance.category]}</span>` : ''}<span class="mono">${ctx.money(r.cost.net)}/yr</span></button>` : '';
    return look + (n ? `<button class="hidden-line" data-unlock><span class="ghosts" aria-hidden="true"><i></i><i></i><i></i></span><span><b>${n} hidden ${n === 1 ? 'match' : 'matches'}</b> in your sky</span><span class="mono">Unlock</span></button>` : '');
  }
  const halo = (b) => {
    if (b.s.ghost) return [150, 160, 180];
    const c = isPro() ? detail(b.id)?.chance?.category : null;
    return c === 'reach' ? [235, 150, 140] : c === 'target' ? [230, 205, 140] : c === 'likely' ? [150, 215, 170] : null;
  };

  // ---- Chance pills -----------------------------------------------------------------------------------
  function pill(id, fallbackCat) {
    if (!proOn) return `<span class="pill ${fallbackCat}">${CHANCE_LABEL[fallbackCat]}</span>`;
    const d = detail(id);
    if (d) {
      const c = d.chance.category;
      return c ? `<span class="pill ${c}${isFreeLook(id) ? ' free-look' : ''}" title="${NOT_A_PREDICTION}">${CHANCE_LABEL[c]}</span>` : '<span class="pill none">No data</span>';
    }
    if (isPro()) return '<span class="pill pending" aria-label="Loading">···</span>';
    const fake = PLACEHOLDER[Math.abs(id) % 3];
    // A span, not a button: pills sit inside row buttons. Clicking it still opens the paywall (see init).
    return `<span class="pill locked" data-unlock role="img" aria-label="Chance hidden: Pro"><span aria-hidden="true">${CHANCE_LABEL[fake]}</span></span>`;
  }

  // A blurred block of placeholder text with an unlock button. The placeholder is never the real value.
  const teaser = (inner, label = 'Unlock with Pro') => `<div class="teaser"><div class="teaser-blur" aria-hidden="true">${inner}</div><button class="teaser-btn" data-unlock>${ctx.ICON.lock}<span>${label}</span></button></div>`;

  // ---- Sheet sections ---------------------------------------------------------------------------------
  function sheetChances(s, fallbackHTML) {
    if (!proOn) return fallbackHTML;
    const d = detail(s.id);
    const facts = `<dl class="facts"><div><dt>Admit rate</dt><dd>${ctx.pct(s.adm)}</dd></div><div><dt>Testing</dt><dd>${ctx.testLabel(s)}</dd></div><div><dt>ACT range</dt><dd>${s.act ? s.act.join('–') : '—'}</dd></div></dl>${ctx.satBar(s)}`;
    if (d) {
      const c = d.chance.category;
      return `<section><h3>Your chances${isFreeLook(s.id) ? ' <span class="free-tag">Your free look</span>' : ''}</h3>
        <p>${c ? `<strong>${CHANCE_LABEL[c]}.</strong> ` : ''}${d.chance.reasons.map(esc).join('. ')}.</p>
        <p class="fine">${NOT_A_PREDICTION}</p>${facts}</section>`;
    }
    return `<section><h3>Your chances</h3>${teaser('<p><strong>Target.</strong> Your SAT is inside their middle 50%. They admit about half of applicants.</p>')}${facts}</section>`;
  }
  function sheetCost(s, c) {
    if (!proOn) return null;
    const d = detail(s.id);
    const basis = { income: 'for families in your income range', average: 'average after grants, all families', estimate: 'estimate; no federal net price reported', international: 'international students get little federal aid' };
    if (d) return { est: d.cost.net, basis: basis[d.cost.basis] + (d.cost.grantsExceedCost ? '; grants can exceed the cost' : ''), byIncome: true };
    return { est: s.net != null ? Math.max(0, Math.min(s.net, c.sticker)) : null, basis: 'average after grants, all families', locked: true };
  }
  function earningsCell(s) {
    if (!proOn) return ctx.money(s.earn);
    const d = detail(s.id);
    return d ? ctx.money(d.earnings) : '<span class="locked-cell" data-unlock role="img" aria-label="Earnings: Pro">$••k</span>';
  }
  // Pro: "estimated for you" at your income from the server; otherwise null.
  const netFor = (id) => detail(id)?.cost?.net ?? null;

  // ---- Paywall ----------------------------------------------------------------------------------------
  function openPaywall() {
    if (isPro()) return toast('You already have Pro.');
    track('unlock_clicked');
    const ref = getReferral(store);
    const n = data?.hidden?.count || 3;
    ctx.openPanel('', (panel) => {
      panel.innerHTML = `<div class="pay">
        <div class="pay-orb" aria-hidden="true"><canvas width="168" height="168"></canvas><i></i><i></i><i></i></div>
        <p class="eyebrow">Application Season Pass</p>
        <h2 id="sheet-title" class="pay-t metal">See your whole sky</h2>
        <ul class="pay-list">
          <li><b>${n} hidden ${n === 1 ? 'match' : 'matches'}</b> from a much bigger pool of schools</li>
          <li><b>Your chances</b> at every school: reach, target or likely</li>
          <li><b>What you’d actually pay</b> at your family’s income</li>
          <li><b>Earnings</b> ten years after starting</li>
          <li><b>A balanced list</b>, built in one tap</li>
        </ul>
        <button class="btn chrome big wide" id="pay-go">Unlock for ${esc(PRO_PRICE)}</button>
        <p class="fine">One payment for the whole application season. No subscription.${ref?.discount ? ` Creator code <b>${esc(ref.discount)}</b> is applied at checkout.` : ''} Checkout by Lemon Squeezy. Chances and costs are estimates from public data, not predictions.</p>
      </div>`;
      ctx.drawYou($('canvas', panel));
      $('#pay-go', panel).addEventListener('click', () => (accounts.user() ? startCheckout() : accounts.openSignIn({ reason: 'pro', then: () => (accounts.isPro() ? welcome() : startCheckout()) })));
    }, { label: 'Unlock Pro' });
  }

  async function startCheckout() {
    if (accounts.isPro()) { ctx.closeSheet(); return welcome(); }
    const user = accounts.user();
    if (MOCK) {
      ctx.openPanel('', (panel) => {
        panel.innerHTML = `<div class="auth"><p class="eyebrow">Mock backend</p><h2 id="sheet-title" class="auth-t">Test checkout</h2>
          <p class="hint">Stands in for Lemon Squeezy and its webhook. No money moves.</p>
          <button class="btn chrome wide" id="mock-pay">Pay ${esc(PRO_PRICE)} (test)</button></div>`;
        $('#mock-pay', panel).addEventListener('click', async (e) => {
          e.currentTarget.disabled = true; e.currentTarget.textContent = 'Processing…';
          await (await getBackend()).mockPurchase();
          ctx.closeSheet(); waitForPro();
        });
      }, { label: 'Test checkout' });
      return;
    }
    const ref = getReferral(store);
    const url = buildCheckoutUrl(LEMON_CHECKOUT_URL, { userId: user.id, email: user.email, discount: ref?.discount, ref: ref?.ref });
    ctx.closeSheet();
    try {
      await openCheckout(url, (event) => { if (event === 'Checkout.Success') waitForPro(); });
    } catch (e) {
      toast(e.message);
    }
  }

  // The webhook flips is_pro within seconds of payment; poll until it lands.
  async function waitForPro() {
    toast('Finishing up…');
    for (let i = 0; i < 40; i++) {
      const p = await accounts.refreshProfile();
      if (p?.is_pro) {
        data = null; lastKey = '';
        await refresh({ force: true });
        return welcome();
      }
      await new Promise((r) => setTimeout(r, i < 10 ? 1500 : 3000));
    }
    toast('Payment received. Pro will switch on shortly; reopen Your Sky if it hasn’t.');
  }

  function welcome() {
    const el = ctx.h(`<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="wel-t">
      <div class="wel-inner">
        <p class="eyebrow">Application Season Pass</p>
        <h2 id="wel-t" class="wel-t metal">Welcome to Pro</h2>
        <p class="lede">Your whole sky is open: hidden matches, your chances, real costs and earnings.</p>
        <button class="btn chrome big" id="wel-go">See my sky</button>
      </div></div>`);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    if (!ctx.motion.reduced) [0, 260, 540].forEach((ms, i) => setTimeout(() => ctx.fx.burst(innerWidth / 2 + (i - 1) * 70, innerHeight * 0.42, 90), ms));
    const close = () => {
      el.classList.remove('open');
      setTimeout(() => el.remove(), 400);
      if (ctx.S().screen !== 'results' && ctx.S().kept.length) ctx.go('results');
      else ctx.onProData();
    };
    $('#wel-go', el).addEventListener('click', close);
    el.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    setTimeout(() => $('#wel-go', el).focus(), 50);
  }

  // ---- Balanced list builder (Pro) --------------------------------------------------------------------
  // 2–3 reaches, 4–5 targets, 2–3 likelies, best fits first. Pinned schools always stay.
  function suggestList(pinned = new Set(), removed = new Set()) {
    const pool = [...(data.ranked || []), ...data.hidden.map((h) => ({ id: h.school.id, fit: h.fit }))]
      .filter((x) => !removed.has(x.id))
      .map((x) => ({ ...x, cat: detail(x.id)?.chance?.category }))
      .filter((x) => x.cat)
      .sort((a, b) => b.fit - a.fit);
    const want = { reach: 3, target: 5, likely: 3 };
    const out = pool.filter((x) => pinned.has(x.id));
    for (const x of out) want[x.cat] = Math.max(0, want[x.cat] - 1);
    for (const x of pool) if (!pinned.has(x.id) && want[x.cat] > 0) { out.push(x); want[x.cat]--; }
    return out;
  }
  function listText(list) {
    const S = ctx.S(), name = S.profile.name.trim();
    const lines = [`${name ? name + '’s' : 'My'} college list (Your Sky)`, ''];
    for (const c of ['reach', 'target', 'likely']) {
      const xs = list.filter((x) => x.cat === c);
      if (xs.length) lines.push(`${CHANCE_LABEL[c]}: ${xs.map((x) => `${ctx.byId.get(x.id)?.n} (${x.fit}% fit)`).join(', ')}`);
    }
    lines.push('', NOT_A_PREDICTION, 'findyoursky.com');
    return lines.join('\n');
  }
  function openBuilder() {
    if (!isPro()) return openPaywall();
    if (!data?.ranked) { toast('Loading your data…'); refresh().then(() => data?.ranked && openBuilder()); return; }
    const pinned = new Set(ctx.S().kept.filter((id) => detail(id)?.chance?.category)), removed = new Set();
    ctx.openPanel('', (panel) => {
      const draw = () => {
        const list = suggestList(pinned, removed);
        panel.innerHTML = `<div class="builder">
          <p class="eyebrow">Pro</p><h2 id="sheet-title" class="auth-t">A balanced list</h2>
          <p class="hint">${list.length} schools, best fits first: a few reaches, mostly targets, and likelies you’d be happy at. Pin the ones you love; remove any you don’t.</p>
          ${['reach', 'target', 'likely'].map((c) => {
            const xs = list.filter((x) => x.cat === c);
            return `<h3 class="r-sub">${CHANCE_LABEL[c]} · ${xs.length}</h3><ul class="rows">${xs.map((x) => `<li class="b-row"><span class="row-main"><span class="row-name">${esc(ctx.byId.get(x.id)?.n || '')}</span><span class="row-sub">${x.fit}% fit${ctx.byId.get(x.id)?.hidden ? ' · hidden match' : ''}</span></span>
              <button class="icon-btn ${pinned.has(x.id) ? 'on' : ''}" data-pin="${x.id}" aria-pressed="${pinned.has(x.id)}" aria-label="${pinned.has(x.id) ? 'Unpin' : 'Pin'} ${esc(ctx.byId.get(x.id)?.n || '')}">${ctx.ICON.pin}</button>
              <button class="icon-btn" data-rm="${x.id}" aria-label="Remove ${esc(ctx.byId.get(x.id)?.n || '')}">${ctx.ICON.close}</button></li>`).join('') || '<li class="hint">None that fit well.</li>'}</ul>`;
          }).join('')}
          <p class="fine">${NOT_A_PREDICTION}</p>
          <div class="builder-btns"><button class="btn chrome wide" id="b-use">Use this list</button><button class="btn ghost wide" id="b-copy">Copy as text</button></div>
        </div>`;
        $$('[data-pin]', panel).forEach((b) => b.addEventListener('click', () => { const id = +b.dataset.pin; pinned.has(id) ? pinned.delete(id) : pinned.add(id); draw(); }));
        $$('[data-rm]', panel).forEach((b) => b.addEventListener('click', () => { const id = +b.dataset.rm; removed.add(id); pinned.delete(id); draw(); }));
        $('#b-use', panel).addEventListener('click', () => { ctx.setKept(list.map((x) => x.id)); ctx.closeSheet(); toast('Your sky now holds this list'); });
        $('#b-copy', panel).addEventListener('click', async () => { const t = listText(list); try { await navigator.clipboard.writeText(t); toast('List copied'); } catch { prompt('Copy your list', t); } });
      };
      draw();
    }, { label: 'Balanced list' });
  }

  function init() {
    if (!proOn) return;
    loadAffiliateTracking(LEMON_STORE);
    document.addEventListener('click', (e) => {
      const u = e.target.closest('[data-unlock]');
      if (u) { e.preventDefault(); e.stopPropagation(); openPaywall(); }
    }, true);
    accounts.onChange(() => { if (ctx.S().screen === 'results') refresh(); });
  }

  return { init, refresh, ensureDetail, isPro, detail, pill, teaser, sheetChances, sheetCost, earningsCell, netFor, skyExtras, hiddenLine, halo, openPaywall, openBuilder, data: () => data, welcome };
}
