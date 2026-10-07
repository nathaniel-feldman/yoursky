// Accounts: sign-in, saving skies, the account page and friends. Everything here is optional: the quiz never needs it,
// and with no backend configured (env.js) none of it renders.
import { accountsOn, MOCK, OTP_LENGTH } from './env.js';
import { getBackend, shouldLoadAtStart } from './backend.js';
import { captureReferral, getReferral } from './referral.js';
import { saveStash, loadStash, clearStash, snapshotOf } from './stash.js';
import { isInAppBrowser } from './inapp.js';
import { track } from './api.js';
import { store } from './storage.js';

const FRIEND_KEY = 'yoursky.friendcode', DISMISS_KEY = 'yoursky.savecard', CONFIRM_KEY = 'yoursky.13';
const GOOGLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z"/></svg>';
const session = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} } };

export function createAccounts(ctx) {
  const { $, $$, h, esc, toast } = ctx;
  let backend = null, user = null, profile = null;
  let savedId = null, dirty = false, saving = null;
  const listeners = new Set();
  const changed = () => listeners.forEach((cb) => cb({ user, profile }));

  async function load() {
    if (backend) return backend;
    backend = await getBackend();
    if (!backend) return null;
    backend.onAuth(async (u) => {
      user = u;
      profile = u ? await backend.profile().catch(() => null) : null;
      changed();
    });
    return backend;
  }
  async function refreshProfile() {
    if (!backend || !user) return null;
    profile = await backend.profile().catch(() => profile);
    changed();
    return profile;
  }

  // ---- Start-up: attribution, friend links, and returning sessions --------------------------------------
  async function init() {
    if (!accountsOn) return;
    captureReferral(location.href, store);
    const m = location.pathname.match(/^\/f\/([A-Za-z0-9]{6,12})\/?$/);
    if (m) {
      session.set(FRIEND_KEY, m[1].toUpperCase());
      history.replaceState(null, '', '/' + location.search + location.hash);
      track('friend_link_opened');
    }
    if (!shouldLoadAtStart()) return;
    try {
      await load();
      await backend.ready();
      user = backend.user();
      if (user) await afterSignIn({ returning: true });
    } catch (e) {
      toast(e.message || 'Sign-in didn’t finish. Try again.');
    }
    changed();
  }

  // Runs after any sign-in: confirms 13+, records the creator code, saves the anonymous sky, connects a pending friend.
  async function afterSignIn({ returning = false } = {}) {
    profile = await backend.profile().catch(() => null);
    if (!profile) return;
    if (!profile.confirmed_13_plus && session.get(CONFIRM_KEY)) { await backend.confirm13(); profile.confirmed_13_plus = true; }
    session.set(CONFIRM_KEY, null);
    const ref = getReferral(store);
    if (ref && !profile.referral_code) await backend.claimReferral(ref.ref).catch(() => {});
    if (!returning && profile.created_at && Date.now() - Date.parse(profile.created_at) < 10 * 60 * 1000) track('signed_up');
    const stash = loadStash(store);
    if (stash && stash.kept.length && ctx.S().screen !== 'results' && !ctx.S().kept.length) ctx.restore(stash);
    const name = (ctx.S().profile.name || '').trim().slice(0, 40);
    if (name && !profile.display_name) {
      await backend.updateProfile({ display_name: name }).catch(() => {});
      profile.display_name = name;
    }
    if (stash && stash.kept.length && profile.confirmed_13_plus) await saveNow({ quiet: returning }).catch(() => {});
    await connectPendingFriend();
    changed();
  }

  async function connectPendingFriend() {
    const code = session.get(FRIEND_KEY);
    if (!code || !user) return;
    if (!profile?.confirmed_13_plus) return;
    session.set(FRIEND_KEY, null);
    try {
      const status = await backend.requestFriend(code);
      toast({ accepted: 'You’re friends now. Compare skies from your account.', pending: 'Friend request sent. You’ll see their sky once they accept.', self: 'That’s your own friend link.', not_found: 'That friend link doesn’t work anymore.' }[status] || 'Done');
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- Saving -----------------------------------------------------------------------------------------
  function record() {
    const S = ctx.S();
    return { version: 1, quiz_answers: S.answers, profile_snapshot: snapshotOf(S.profile), results: S.kept.filter((id) => ctx.byId.has(id)).map((id) => ({ id, fit: ctx.resultOf(id).fit })) };
  }
  // Saves the current sky as a new snapshot and removes the one this visit saved before, so history keeps one per visit.
  async function saveNow({ quiet = false } = {}) {
    if (!user) return;
    if (saving) return saving;
    saving = (async () => {
      const prev = savedId;
      savedId = await backend.saveSky(record());
      if (prev && prev !== savedId) await backend.deleteSky(prev).catch(() => {});
      dirty = false;
      clearStash(store);
      if (!quiet) toast('Saved to your account');
      renderSaveCard();
    })().finally(() => (saving = null));
    return saving;
  }

  // Opens a saved sky without re-saving it; brings back opted-in academics so fits match.
  function openSaved(sky) {
    const p = { ...sky.profile_snapshot };
    if (profile?.save_academics) {
      p.gpa = profile.gpa_unweighted != null ? Number(profile.gpa_unweighted) : null;
      p.testMode = profile.act_composite ? 'act' : profile.sat_total ? 'sat' : 'none';
      p.sat = profile.sat_total; p.act = profile.act_composite;
    }
    ctx.restore({ answers: sky.quiz_answers, profile: p, kept: sky.results.map((r) => r.id), income: profile?.save_academics ? profile.income_bracket : null });
    savedId = sky.id; dirty = false;
  }

  // Called when results first render and whenever kept schools change.
  function onResults({ first = false } = {}) {
    if (!accountsOn) return;
    const S = ctx.S();
    if (first) track('quiz_completed');
    if (!user) saveStash(store, S);
    else if (first && !savedId) saveNow({ quiet: true }).catch(() => {});
    else if (!first) dirty = true;
    renderSaveCard();
  }

  // ---- "Save your sky" card in the results ------------------------------------------------------------
  function saveCardHTML() {
    return accountsOn ? '<div class="save-slot" id="save-slot" aria-live="polite"></div>' : '';
  }
  let shownTracked = false;
  function renderSaveCard() {
    const slot = $('#save-slot');
    if (!slot) return;
    const invite = !!session.get(FRIEND_KEY);
    if (user) {
      slot.innerHTML = `<div class="save-card saved">
        <span class="save-ok" aria-hidden="true">${ctx.ICON.ok}</span>
        <p class="save-line">${dirty ? 'You changed your list.' : 'Saved to your account.'}</p>
        ${dirty ? '<button class="btn ghost small" id="save-again">Save changes</button>' : '<button class="btn text small" id="save-acct">Your account</button>'}
      </div>`;
      $('#save-again', slot)?.addEventListener('click', () => saveNow());
      $('#save-acct', slot)?.addEventListener('click', () => ctx.go('account'));
      return;
    }
    if (session.get(DISMISS_KEY) && !invite) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div class="save-card">
      <canvas class="save-orb" width="112" height="112" aria-hidden="true"></canvas>
      <div class="save-copy">
        <h3 class="save-t metal">${invite ? 'Connect with your friend' : 'Keep your sky'}</h3>
        <p class="hint">${invite ? 'Save your sky to compare with the friend who invited you.' : 'Save it to come back on any device and watch it shift as you change your mind. Free.'}</p>
        <div class="save-btns"><button class="btn chrome small" id="save-go">Save my sky</button>${invite ? '' : '<button class="btn text small" id="save-x">Not now</button>'}</div>
      </div>
    </div>`;
    ctx.drawYou($('.save-orb', slot));
    $('#save-go', slot).addEventListener('click', () => { track('save_prompt_clicked'); openSignIn({ reason: invite ? 'friend' : 'save' }); });
    $('#save-x', slot)?.addEventListener('click', () => { session.set(DISMISS_KEY, '1'); slot.firstElementChild.classList.add('leaving'); setTimeout(() => (slot.innerHTML = ''), 260); });
    if (!shownTracked) { shownTracked = true; track('save_prompt_shown'); }
  }

  // ---- Sign-in sheet ----------------------------------------------------------------------------------
  const REASONS = {
    save: ['Save your sky', 'Keep your sky', 'Come back to it on any device. No password: we email you a code.'],
    pro: ['Pro', 'Sign in to unlock', 'Pro is tied to your account so it works on every device. No password: we email you a code.'],
    friend: ['Friends', 'Sign in to connect', 'Friends can compare skies once you both have an account. No password: we email you a code.'],
    account: ['Your Sky', 'Sign in', 'See your saved skies and friends. No password: we email you a code.'],
  };
  function openSignIn({ reason = 'account', then } = {}) {
    const [eyebrow, title, lede] = REASONS[reason] || REASONS.account;
    const google = !isInAppBrowser();
    let email = '';
    const done = async () => {
      ctx.closeSheet();
      await afterSignIn();
      if (then) then();
    };
    const stepEmail = (panel) => {
      panel.innerHTML = `<div class="auth">
        <p class="eyebrow">${eyebrow}</p>
        <h2 id="sheet-title" class="auth-t">${title}</h2>
        <p class="hint">${lede}</p>
        <form class="auth-form" id="auth-form" novalidate>
          <label class="fieldline" for="auth-email">Email</label>
          <input id="auth-email" class="textin" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(email)}" required>
          <label class="check"><input type="checkbox" id="auth-13"><span class="check-box" aria-hidden="true"></span><span>I’m 13 or older</span></label>
          <p class="auth-err" id="auth-err" role="alert"></p>
          <button class="btn chrome wide" id="auth-send" type="submit">Email me a code</button>
        </form>
        ${google ? `<div class="auth-or" aria-hidden="true"><span>or</span></div><button class="btn ghost wide google" id="auth-google">${GOOGLE}<span>Continue with Google</span></button>` : '<p class="fine">Codes work right here in this app. No need to switch browsers.</p>'}
        <p class="fine">We use your email only to sign you in. Your Sky is for students 13 and up. <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a>${MOCK ? ' · <b>Mock backend: the code is 000000</b>' : ''}</p>
      </div>`;
      const err = $('#auth-err', panel), box = $('#auth-13', panel);
      const need13 = () => { if (box.checked) return true; err.textContent = 'Please confirm you’re 13 or older to make an account.'; box.focus(); return false; };
      $('#auth-form', panel).addEventListener('submit', async (e) => {
        e.preventDefault();
        email = $('#auth-email', panel).value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter your email address.'; return; }
        if (!need13()) return;
        const btn = $('#auth-send', panel); btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
        try {
          await load();
          session.set(CONFIRM_KEY, '1');
          await backend.sendCode(email, { confirmed13: true, referral: getReferral(store)?.ref });
          stepCode(panel);
        } catch (ex) {
          err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Email me a code';
        }
      });
      $('#auth-google', panel)?.addEventListener('click', async () => {
        if (!need13()) return;
        session.set(CONFIRM_KEY, '1');
        saveStash(store, ctx.S());
        try { await load(); await backend.signInWithGoogle(); if (backend.mock) { user = backend.user(); await done(); } }
        catch (ex) { err.textContent = ex.message; }
      });
      setTimeout(() => $('#auth-email', panel)?.focus(), 350);
    };
    const stepCode = (panel) => {
      panel.innerHTML = `<div class="auth">
        <p class="eyebrow">${eyebrow}</p>
        <h2 id="sheet-title" class="auth-t">Check your email</h2>
        <p class="hint">We sent a sign-in code to <strong>${esc(email)}</strong>. You can also tap the link in that email.</p>
        <form class="auth-form" id="code-form" novalidate>
          <label class="fieldline" for="auth-code">Code</label>
          <input id="auth-code" class="textin code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="${'0'.repeat(OTP_LENGTH)}" required>
          <p class="auth-err" id="auth-err" role="alert"></p>
          <button class="btn chrome wide" id="auth-verify" type="submit">Verify</button>
        </form>
        <div class="auth-row"><button class="btn text small" id="auth-back">Different email</button><button class="btn text small" id="auth-resend" disabled>Resend in 60s</button></div>
      </div>`;
      const err = $('#auth-err', panel), code = $('#auth-code', panel), resend = $('#auth-resend', panel);
      let left = 60;
      const t = setInterval(() => { left--; resend.textContent = left > 0 ? `Resend in ${left}s` : 'Send a new code'; resend.disabled = left > 0; if (left <= 0) clearInterval(t); }, 1000);
      const submit = async (e) => {
        e?.preventDefault();
        if (!/^\d{6,10}$/.test(code.value.trim())) { err.textContent = 'Enter the code from the email.'; return; }
        const btn = $('#auth-verify', panel); btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
        try {
          user = await backend.verifyCode(email, code.value);
          clearInterval(t);
          await done();
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Verify'; code.select(); }
      };
      $('#code-form', panel).addEventListener('submit', submit);
      // Pasting or autofilling the whole code submits it; typing submits at the expected length.
      code.addEventListener('input', (e) => {
        code.value = code.value.replace(/\D/g, '').slice(0, 10);
        if (code.value.length === OTP_LENGTH || (e.inputType === 'insertFromPaste' && code.value.length >= 6)) submit();
      });
      $('#auth-back', panel).addEventListener('click', () => { clearInterval(t); stepEmail(panel); });
      resend.addEventListener('click', async () => {
        resend.disabled = true;
        try { await backend.sendCode(email, { confirmed13: true, referral: getReferral(store)?.ref }); toast('New code sent'); left = 60; }
        catch (ex) { err.textContent = ex.message; resend.disabled = false; }
      });
      setTimeout(() => code.focus(), 200);
    };
    ctx.openPanel('', stepEmail, { label: title });
  }

  // ---- Account button (top right on landing and results) -----------------------------------------------
  function accountButton() {
    if (!accountsOn) return '';
    return `<button class="acct-btn" id="acct-btn" aria-label="${user ? 'Your account' : 'Sign in'}">${user ? `<span class="acct-dot">${esc((profile?.display_name || user.email || '?')[0].toUpperCase())}</span>` : '<span>Sign in</span>'}</button>`;
  }
  function wireAccountButton(root) {
    $('#acct-btn', root)?.addEventListener('click', () => (user ? ctx.go('account') : openSignIn({ reason: 'account', then: () => ctx.go('account') })));
  }

  // ---- Account page -----------------------------------------------------------------------------------
  function Account() {
    const el = h(`<section class="screen account">
      <header class="acct-head settle">
        <button class="btn text small back-link" id="acct-back">${ctx.ICON.back} Back</button>
        <p class="eyebrow">Account</p>
        <h1 class="r-title metal">${esc(profile?.display_name ? profile.display_name + '’s' : 'Your')} account</h1>
        <p class="hint">${esc(user?.email || '')}</p>
      </header>
      <div id="acct-pro"></div>
      <section class="r-sec" aria-labelledby="h-skies"><h2 class="r-h" id="h-skies">Saved skies</h2><div id="acct-skies"><p class="hint">Loading…</p></div></section>
      <section class="r-sec" aria-labelledby="h-friends"><h2 class="r-h" id="h-friends">Friends</h2><div id="acct-friends"><p class="hint">Loading…</p></div></section>
      <section class="r-sec" aria-labelledby="h-privacy"><h2 class="r-h" id="h-privacy">Privacy</h2><div id="acct-privacy"></div></section>
    </section>`);
    ctx.quietSky();
    $('#acct-back', el).addEventListener('click', () => ctx.go(ctx.S().kept.length ? 'results' : 'landing'));
    if (!user) { setTimeout(() => ctx.go('landing'), 0); return el; }
    setTimeout(() => { renderPro(el); renderSkies(el); renderFriends(el); renderPrivacy(el); }, 0);
    return el;
  }

  function renderPro(el) {
    const slot = $('#acct-pro', el);
    if (!ctx.proOn) return;
    slot.innerHTML = profile?.is_pro
      ? `<div class="pro-badge"><span class="metal">Pro</span><span class="hint">Application Season Pass${profile.pro_since ? ' · since ' + new Date(profile.pro_since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span></div>`
      : `<button class="pro-cta" id="acct-unlock"><span class="pro-cta-t metal">Unlock Pro</span><span class="hint">Hidden matches, your chances, real cost and earnings</span>${ctx.ICON.chev}</button>`;
    $('#acct-unlock', slot)?.addEventListener('click', () => ctx.openPaywall());
  }

  async function renderSkies(el) {
    const box = $('#acct-skies', el);
    try {
      const skies = await backend.listSkies();
      if (!skies.length) { box.innerHTML = '<p class="hint">No saved skies yet. Finish the questions and your sky saves here.</p>'; return; }
      box.innerHTML = `<ul class="rows">${skies.map((s) => {
        const names = s.results.slice().sort((a, b) => b.fit - a.fit).map((r) => ctx.byId.get(r.id)?.n).filter(Boolean);
        return `<li class="sky-row"><button class="row" data-sky="${s.id}"><span class="row-main"><span class="row-name">${new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span class="row-sub">${names.length} school${names.length === 1 ? '' : 's'}${names.length ? ' · ' + esc(names.slice(0, 3).join(', ')) : ''}</span></span>${ctx.ICON.chev}</button>
          <button class="icon-btn" data-del="${s.id}" aria-label="Delete the sky saved ${new Date(s.created_at).toLocaleDateString()}">${ctx.ICON.close}</button></li>`;
      }).join('')}</ul>`;
      $$('[data-sky]', box).forEach((b) => b.addEventListener('click', () => {
        openSaved(skies.find((x) => x.id === b.dataset.sky));
        ctx.go('results');
      }));
      $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this saved sky?')) return;
        await backend.deleteSky(b.dataset.del);
        if (savedId === b.dataset.del) savedId = null;
        renderSkies(el);
      }));
    } catch (e) {
      box.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
    }
  }

  async function renderFriends(el) {
    const box = $('#acct-friends', el);
    if (!profile?.confirmed_13_plus) {
      box.innerHTML = `<p class="hint">Confirm you’re 13 or older to connect with friends.</p><button class="btn ghost small" id="conf13">I’m 13 or older</button>`;
      $('#conf13', box).addEventListener('click', async () => { await backend.confirm13(); await refreshProfile(); renderFriends(el); });
      return;
    }
    const link = `${location.origin}/f/${profile.friend_code}`;
    let list = [];
    try { list = await backend.listFriends(); } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
    const incoming = list.filter((f) => f.incoming), friends = list.filter((f) => f.status === 'accepted'), waiting = list.filter((f) => f.status === 'pending' && !f.incoming);
    const nameOf = (f) => esc(f.display_name || 'A friend');
    box.innerHTML = `
      <div class="friend-link">
        <p class="fieldline">Your friend link</p>
        <div class="friend-url"><span class="mono">${esc(link.replace(/^https?:\/\//, ''))}</span><button class="btn ghost small" id="fl-copy">Copy</button></div>
        <p class="fine">Send it to people you know. They’ll see your sky only after you both accept. No search, no strangers.</p>
      </div>
      ${incoming.length ? `<h3 class="r-sub">Requests</h3><ul class="rows">${incoming.map((f) => `<li class="friend-row"><span class="row-name">${nameOf(f)}</span><span class="friend-acts"><button class="btn chrome small" data-acc="${f.friendship_id}">Accept</button><button class="btn text small" data-dec="${f.friendship_id}">Decline</button></span></li>`).join('')}</ul>` : ''}
      ${friends.length ? `<h3 class="r-sub">Friends</h3><ul class="rows">${friends.map((f) => `<li class="friend-row"><span class="row-name">${nameOf(f)}</span><span class="friend-acts"><button class="btn ghost small" data-cmp="${f.friend_id}" data-name="${nameOf(f)}">Compare</button><button class="icon-btn" data-un="${f.friendship_id}" aria-label="Remove ${nameOf(f)}">${ctx.ICON.close}</button></span></li>`).join('')}</ul>` : ''}
      ${waiting.length ? `<h3 class="r-sub">Waiting on</h3><ul class="rows">${waiting.map((f) => `<li class="friend-row"><span class="row-name dim">${nameOf(f)}</span><span class="friend-acts"><button class="btn text small" data-un="${f.friendship_id}">Cancel</button></span></li>`).join('')}</ul>` : ''}
      ${!list.length ? '<p class="hint">No friends yet. Share your link to compare skies.</p>' : ''}`;
    $('#fl-copy', box).addEventListener('click', async () => {
      if (navigator.share && isInAppBrowser()) return navigator.share({ title: 'Compare skies with me', url: link }).catch(() => {});
      try { await navigator.clipboard.writeText(link); toast('Friend link copied'); } catch { prompt('Copy your friend link', link); }
    });
    $$('[data-acc]', box).forEach((b) => b.addEventListener('click', async () => { await backend.respondFriend(b.dataset.acc, true); toast('You’re friends now'); renderFriends(el); }));
    $$('[data-dec]', box).forEach((b) => b.addEventListener('click', async () => { await backend.respondFriend(b.dataset.acc || b.dataset.dec, false); renderFriends(el); }));
    $$('[data-un]', box).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Remove this friend? You’ll stop seeing each other’s skies.')) return; await backend.unfriend(b.dataset.un); renderFriends(el); }));
    $$('[data-cmp]', box).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const sky = await backend.friendSky(b.dataset.cmp);
        if (!sky) { toast('They haven’t saved a sky yet.'); b.disabled = false; return; }
        if (!ctx.S().kept.length) {
          const mine = (await backend.listSkies())[0];
          if (!mine) { toast('Finish your own sky first, then compare.'); b.disabled = false; return; }
          openSaved(mine);
        }
        ctx.compareWith({ v: 1, n: b.dataset.name, m: sky.profile_snapshot.major, b: sky.profile_snapshot.major2, r: sky.profile_snapshot.region, k: sky.results.map((r) => r.id), a: sky.quiz_answers || {} });
      } catch (e) { toast(e.message); b.disabled = false; }
    }));
  }

  function renderPrivacy(el) {
    const box = $('#acct-privacy', el);
    box.innerHTML = `
      <label class="check row-check"><input type="checkbox" id="pv-acad" ${profile?.save_academics ? 'checked' : ''}><span class="check-box" aria-hidden="true"></span>
        <span>Remember my GPA, scores and income range<small class="hint">So chances and cost are ready on any device. Off by default; never shared with friends.</small></span></label>
      <div class="acct-links">
        <a class="btn text small" href="/privacy.html">Privacy policy</a>
        <button class="btn text small" id="pv-out">Sign out</button>
        <button class="btn text small danger" id="pv-del">Delete account</button>
      </div>`;
    $('#pv-acad', box).addEventListener('change', async (e) => {
      const S = ctx.S(), on = e.target.checked;
      const P = S.profile;
      await backend.updateProfile(on
        ? { save_academics: true, gpa_unweighted: P.gpa, sat_total: P.testMode === 'sat' ? P.sat : null, act_composite: P.testMode === 'act' ? P.act : null, income_bracket: S.income }
        : { save_academics: false, gpa_unweighted: null, sat_total: null, act_composite: null, income_bracket: null });
      toast(on ? 'Saved to your account' : 'Removed from your account');
      refreshProfile();
    });
    $('#pv-out', box).addEventListener('click', async () => { await backend.signOut(); user = null; profile = null; savedId = null; changed(); toast('Signed out'); ctx.go('landing'); });
    $('#pv-del', box).addEventListener('click', () => confirmDelete());
  }

  function confirmDelete() {
    ctx.openPanel('', (panel) => {
      panel.innerHTML = `<div class="auth">
        <p class="eyebrow">Delete account</p>
        <h2 id="sheet-title" class="auth-t">Delete everything?</h2>
        <p class="hint">This permanently deletes your account, saved skies and friend connections. It can’t be undone.${profile?.is_pro ? ' Pro is tied to this account and ends with it.' : ''}</p>
        <form class="auth-form" id="del-form"><label class="fieldline" for="del-type">Type DELETE to confirm</label>
          <input id="del-type" class="textin" autocomplete="off" autocapitalize="characters">
          <p class="auth-err" id="auth-err" role="alert"></p>
          <button class="btn ghost wide danger" type="submit">Delete my account</button></form>
      </div>`;
      $('#del-form', panel).addEventListener('submit', async (e) => {
        e.preventDefault();
        if ($('#del-type', panel).value.trim().toUpperCase() !== 'DELETE') { $('#auth-err', panel).textContent = 'Type DELETE to confirm.'; return; }
        try {
          await backend.deleteAccount();
          clearStash(store);
          user = null; profile = null; savedId = null; changed();
          ctx.closeSheet(); ctx.reset(); toast('Your account and everything in it is deleted.');
        } catch (ex) { $('#auth-err', panel).textContent = ex.message; }
      });
    }, { label: 'Delete account' });
  }

  return {
    init, load, onResults, saveCardHTML, renderSaveCard, openSignIn, accountButton, wireAccountButton, Account, refreshProfile,
    saveNow, markDirty: () => { if (user) { dirty = true; renderSaveCard(); } else if (accountsOn) saveStash(store, ctx.S()); },
    user: () => user, profile: () => profile, backend: () => backend, isPro: () => !!profile?.is_pro,
    invited: () => !!session.get(FRIEND_KEY),
    onChange: (cb) => listeners.add(cb),
  };
}
