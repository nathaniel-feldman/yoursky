// Row Level Security and database functions, against the real migrations (see harness.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './harness.js';

const DENIED = /permission denied|row-level security|violates row-level/;
const sky = (over = {}) => ({ quiz_answers: { size: 40 }, profile_snapshot: { name: 'A', major: 'cs' }, results: [{ id: 166027, fit: 81 }], ...over });
const saveSky = (q, s = sky()) => q('insert into public.skies (quiz_answers, profile_snapshot, results) values ($1, $2, $3) returning id', [s.quiz_answers, s.profile_snapshot, s.results]);

let db, A, B, C;
beforeEach(async () => {
  db = await freshDb();
  A = await db.createUser('a@test.dev', { confirmed_13_plus: true, referral_code: 'creator_1' });
  B = await db.createUser('b@test.dev', { confirmed_13_plus: true });
  C = await db.createUser('c@test.dev');
  await loadCodes();
});
// Friend codes are read up front as admin: inside a student's transaction RLS (correctly) hides other profiles.
const codes = new Map();
const loadCodes = async () => (await db.admin('select id, friend_code from public.profiles')).rows.forEach((r) => codes.set(r.id, r.friend_code));
const codeOf = (id) => codes.get(id);

describe('profiles', () => {
  it('are created on sign-up with a friend code and the 13+ and referral metadata', async () => {
    const { rows } = await db.admin('select * from public.profiles order by created_at');
    expect(rows).toHaveLength(3);
    const a = rows.find((r) => r.id === A);
    expect(a.confirmed_13_plus).toBe(true);
    expect(a.referral_code).toBe('creator_1');
    expect(a.is_pro).toBe(false);
    expect(a.friend_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(rows.find((r) => r.id === C).confirmed_13_plus).toBe(false);
  });

  it('strip unsafe characters from a referral code in metadata', async () => {
    const id = await db.createUser('d@test.dev', { referral_code: "x'; drop table--<script>" });
    const { rows } = await db.admin('select referral_code from public.profiles where id = $1', [id]);
    expect(rows[0].referral_code).toBe('xdroptable--script');
  });

  it('are readable only by their owner', async () => {
    const rows = await db.user(A)((q) => q('select id from public.profiles'));
    expect(rows.rows.map((r) => r.id)).toEqual([A]);
    expect((await db.anon((q) => q('select id from public.profiles')).catch((e) => e)).message).toMatch(DENIED);
  });

  it('let owners edit their name and academics but never Pro, codes or the 13+ flag', async () => {
    await db.user(A)((q) => q("update public.profiles set display_name = 'Ava', gpa_unweighted = 3.8, income_bracket = 2 where id = $1", [A]));
    expect((await db.admin('select display_name from public.profiles where id = $1', [A])).rows[0].display_name).toBe('Ava');
    for (const col of ["is_pro = true", "pro_since = now()", "friend_code = 'AAAAAAAA'", "referral_code = 'me'", 'confirmed_13_plus = false']) {
      await expect(db.user(A)((q) => q(`update public.profiles set ${col} where id = $1`, [A]))).rejects.toThrow(DENIED);
    }
  });

  it("can't touch someone else's profile, insert a profile or delete one", async () => {
    const res = await db.user(A)((q) => q("update public.profiles set display_name = 'hacked' where id = $1", [B]));
    expect(res.affectedRows).toBe(0);
    await expect(db.user(A)((q) => q('insert into public.profiles (id) values ($1)', [A]))).rejects.toThrow(DENIED);
    await expect(db.user(A)((q) => q('delete from public.profiles where id = $1', [A]))).rejects.toThrow(DENIED);
  });

  it('confirm_13_plus and claim_referral only affect the caller, and the referral is first-touch', async () => {
    await db.user(C)((q) => q('select public.confirm_13_plus()'));
    await db.user(C)((q) => q("select public.claim_referral('first')"));
    await db.user(C)((q) => q("select public.claim_referral('second')"));
    await db.user(A)((q) => q("select public.claim_referral('override')"));
    const { rows } = await db.admin('select id, confirmed_13_plus, referral_code from public.profiles');
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[C]).toMatchObject({ confirmed_13_plus: true, referral_code: 'first' });
    expect(by[A].referral_code).toBe('creator_1');
  });
});

describe('skies', () => {
  it('save and list your own, newest first', async () => {
    await db.user(A)((q) => saveSky(q));
    await db.user(A)((q) => saveSky(q, sky({ results: [{ id: 1, fit: 2 }] })));
    const { rows } = await db.user(A)((q) => q('select user_id, results from public.skies order by created_at desc'));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === A)).toBe(true);
  });

  it("are invisible to other students and to anonymous visitors (two-account check)", async () => {
    await db.user(A)((q) => saveSky(q));
    expect((await db.user(B)((q) => q('select * from public.skies'))).rows).toHaveLength(0);
    expect((await db.user(B)((q) => q('select * from public.friend_sky($1)', [A]))).rows).toHaveLength(0);
    await expect(db.anon((q) => q('select * from public.skies'))).rejects.toThrow(DENIED);
  });

  it("can't be saved for someone else, or before confirming 13+", async () => {
    await expect(db.user(A)((q) => q('insert into public.skies (user_id, quiz_answers, results) values ($1, $2, $3)', [B, {}, []]))).rejects.toThrow(DENIED);
    await expect(db.user(C)((q) => saveSky(q))).rejects.toThrow(DENIED);
  });

  it('reject results with anything besides id and fit, and snapshots with grades or scores', async () => {
    await expect(db.user(A)((q) => saveSky(q, sky({ results: [{ id: 1, fit: 80, chance: 'reach' }] })))).rejects.toThrow(/check constraint/);
    await expect(db.user(A)((q) => saveSky(q, sky({ profile_snapshot: { name: 'A', gpa: 3.9 } })))).rejects.toThrow(/check constraint/);
    await expect(db.user(A)((q) => saveSky(q, sky({ profile_snapshot: { sat: 1500 } })))).rejects.toThrow(/check constraint/);
  });

  it("can be deleted by their owner only, and can't be edited", async () => {
    const id = (await db.user(A)((q) => saveSky(q))).rows[0].id;
    expect((await db.user(B)((q) => q('delete from public.skies where id = $1', [id]))).affectedRows).toBe(0);
    await expect(db.user(A)((q) => q("update public.skies set results = '[]' where id = $1", [id]))).rejects.toThrow(DENIED);
    expect((await db.user(A)((q) => q('delete from public.skies where id = $1', [id]))).affectedRows).toBe(1);
  });
});

describe('friendships', () => {
  it('need the other person to accept before skies are shared', async () => {
    await db.user(B)((q) => saveSky(q, sky({ profile_snapshot: { name: 'B' } })));
    const status = await db.user(A)(async (q) => (await q('select public.request_friend($1) as s', [await codeOf(B)])).rows[0].s);
    expect(status).toBe('pending');

    // Pending: no access yet.
    expect((await db.user(A)((q) => q('select * from public.friend_sky($1)', [B]))).rows).toHaveLength(0);
    const incoming = (await db.user(B)((q) => q('select * from public.list_friends()'))).rows;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({ friend_id: A, incoming: true, status: 'pending' });

    // The requester can't accept their own request.
    expect((await db.user(A)((q) => q('select public.respond_friend($1, true) as s', [incoming[0].friendship_id]))).rows[0].s).toBe('not_found');
    expect((await db.user(B)((q) => q('select public.respond_friend($1, true) as s', [incoming[0].friendship_id]))).rows[0].s).toBe('accepted');

    const seen = (await db.user(A)((q) => q('select * from public.friend_sky($1)', [B]))).rows;
    expect(seen).toHaveLength(1);
    expect(seen[0].profile_snapshot).toEqual({ name: 'B' });
    // A third person still sees nothing.
    expect((await db.user(C)((q) => q('select * from public.friend_sky($1)', [B]))).rows).toHaveLength(0);
    expect((await db.user(C)((q) => q('select * from public.skies'))).rows).toHaveLength(0);
  });

  it('show display names only to the people in the friendship', async () => {
    await db.user(B)((q) => q("update public.profiles set display_name = 'Bea' where id = $1", [B]));
    await db.user(A)(async (q) => q('select public.request_friend($1)', [await codeOf(B)]));
    expect((await db.user(A)((q) => q('select display_name from public.list_friends()'))).rows[0].display_name).toBe('Bea');
    expect((await db.user(C)((q) => q('select * from public.list_friends()'))).rows).toHaveLength(0);
  });

  it('accept automatically when both people request each other', async () => {
    await db.user(A)(async (q) => q('select public.request_friend($1)', [await codeOf(B)]));
    const s = await db.user(B)(async (q) => (await q('select public.request_friend($1) as s', [(await codeOf(A)).toLowerCase()])).rows[0].s);
    expect(s).toBe('accepted');
    expect((await db.admin('select count(*)::int as n from public.friendships')).rows[0].n).toBe(1);
  });

  it('end when either person unfriends, and access goes with them', async () => {
    await db.user(B)((q) => saveSky(q));
    await db.user(A)(async (q) => q('select public.request_friend($1)', [await codeOf(B)]));
    await db.user(B)(async (q) => q('select public.request_friend($1)', [await codeOf(A)]));
    expect((await db.user(A)((q) => q('select * from public.friend_sky($1)', [B]))).rows).toHaveLength(1);
    expect((await db.user(B)((q) => q('delete from public.friendships'))).affectedRows).toBe(1);
    expect((await db.user(A)((q) => q('select * from public.friend_sky($1)', [B]))).rows).toHaveLength(0);
  });

  it('handle your own code, unknown codes, unconfirmed users and direct writes', async () => {
    expect((await db.user(A)(async (q) => q('select public.request_friend($1) as s', [await codeOf(A)]))).rows[0].s).toBe('self');
    expect((await db.user(A)((q) => q("select public.request_friend('ZZZZZZZZ') as s"))).rows[0].s).toBe('not_found');
    await expect(db.user(C)(async (q) => q('select public.request_friend($1)', [await codeOf(A)]))).rejects.toThrow(/13\+/);
    await expect(db.user(A)((q) => q('insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, $3)', [A, B, 'accepted']))).rejects.toThrow(DENIED);
    await expect(db.user(A)((q) => q("update public.friendships set status = 'accepted'"))).rejects.toThrow(DENIED);
    await expect(db.anon((q) => q("select public.request_friend('ZZZZZZZZ')"))).rejects.toThrow(DENIED);
  });

  it('limit new requests to 30 a day', async () => {
    const ids = [];
    for (let i = 0; i < 31; i++) ids.push(await db.createUser(`p${i}@test.dev`, { confirmed_13_plus: true }));
    await loadCodes();
    for (let i = 0; i < 30; i++) await db.user(A)(async (q) => q('select public.request_friend($1)', [await codeOf(ids[i])]));
    await expect(db.user(A)(async (q) => q('select public.request_friend($1)', [await codeOf(ids[30])]))).rejects.toThrow(/too many/);
  });
});

describe('orders and Pro', () => {
  const apply = (args) => db.service((q) => q('select public.apply_lemon_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', args).then((r) => r.rows[0].r));
  const order = (over = {}) => ['order_created', 'ord_1', A, 'paid', 499, 'USD', true, 'CREATOR10', '77', { data: { id: 'ord_1' } }].map((v, i) => (i in over ? over[i] : v));
  const pro = async (id) => (await db.admin('select is_pro, pro_since from public.profiles where id = $1', [id])).rows[0];

  it('a paid order makes the buyer Pro and records attribution', async () => {
    expect(await apply(order())).toMatchObject({ inserted: true, user_found: true, is_pro: true });
    expect((await pro(A)).is_pro).toBe(true);
    const { rows } = await db.admin('select * from public.orders');
    expect(rows[0]).toMatchObject({ lemon_order_id: 'ord_1', referral_code: 'creator_1', discount_code: 'CREATOR10', affiliate_id: '77', amount: 499, test_mode: true });
  });

  it('a duplicate delivery never creates a second order', async () => {
    await apply(order());
    expect(await apply(order())).toMatchObject({ inserted: false, is_pro: true });
    expect((await db.admin('select count(*)::int as n from public.orders')).rows[0].n).toBe(1);
  });

  it('a full refund removes Pro; a partial refund keeps it', async () => {
    await apply(order());
    await apply(order({ 0: 'order_refunded', 3: 'partial_refund' }));
    expect((await pro(A)).is_pro).toBe(true);
    await apply(order({ 0: 'order_refunded', 3: 'refunded' }));
    expect(await pro(A)).toMatchObject({ is_pro: false, pro_since: null });
    // A late or replayed order_created can't undo the refund.
    await apply(order());
    expect((await pro(A)).is_pro).toBe(false);
    expect((await db.admin('select status, refunded_at from public.orders')).rows[0].status).toBe('refunded');
  });

  it('a refund on one order keeps Pro when another paid order exists', async () => {
    await apply(order());
    await apply(order({ 1: 'ord_2' }));
    await apply(order({ 0: 'order_refunded', 3: 'refunded' }));
    expect((await pro(A)).is_pro).toBe(true);
  });

  it('pending, failed and fraudulent orders never grant Pro', async () => {
    for (const [i, s] of ['pending', 'failed', 'fraudulent'].entries()) await apply(order({ 1: `o${i}`, 3: s }));
    expect((await pro(A)).is_pro).toBe(false);
  });

  it('an order for an unknown user is kept without a user and grants nothing', async () => {
    expect(await apply(order({ 2: '00000000-0000-4000-8000-000000000000' }))).toMatchObject({ user_found: false, is_pro: false });
    expect((await db.admin('select user_id from public.orders')).rows[0].user_id).toBeNull();
  });

  it('students and visitors can neither read orders nor call apply_lemon_order', async () => {
    await apply(order());
    for (const who of [db.user(A), db.anon]) {
      await expect(who((q) => q('select * from public.orders'))).rejects.toThrow(DENIED);
      await expect(who((q) => q('select * from public.school_pro'))).rejects.toThrow(DENIED);
      await expect(who((q) => q('select public.apply_lemon_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', order()))).rejects.toThrow(DENIED);
    }
  });
});

describe('schools', () => {
  it('only curated schools are visible to clients; the hidden pool is not', async () => {
    await db.admin(`insert into public.schools (unitid, curated, name, data) values (1, true, 'Public U', '{}'), (2, false, 'Hidden College', '{}')`);
    await db.admin(`insert into public.school_pro (unitid, median_earnings) values (1, 60000), (2, 70000)`);
    for (const who of [db.user(A), db.anon]) {
      expect((await who((q) => q('select name from public.schools'))).rows.map((r) => r.name)).toEqual(['Public U']);
      await expect(who((q) => q('insert into public.schools (unitid, name, data) values (3, $1, $2)', ['x', {}]))).rejects.toThrow(DENIED);
    }
    expect((await db.service((q) => q('select count(*)::int as n from public.schools'))).rows[0].n).toBe(2);
  });
});

describe('events', () => {
  it('anyone can log an allow-listed event, nobody can read them back', async () => {
    await db.anon((q) => q("insert into public.events (name, props) values ('quiz_started', '{}')"));
    await db.user(A)((q) => q("insert into public.events (name) values ('signed_up')"));
    await expect(db.anon((q) => q("insert into public.events (name) values ('anything_else')"))).rejects.toThrow(/check constraint/);
    await expect(db.anon((q) => q('select * from public.events'))).rejects.toThrow(DENIED);
    await expect(db.user(A)((q) => q('select * from public.events'))).rejects.toThrow(DENIED);
    expect((await db.admin('select count(*)::int as n from public.events')).rows[0].n).toBe(2);
  });
});

describe('account deletion', () => {
  it('removes the profile, skies and friendships, and keeps orders without the user', async () => {
    await db.user(A)((q) => saveSky(q));
    await db.user(A)(async (q) => q('select public.request_friend($1)', [await codeOf(B)]));
    await db.service((q) => q('select public.apply_lemon_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['order_created', 'ord_9', A, 'paid', 499, 'USD', true, null, null, {}]));
    await db.admin('delete from auth.users where id = $1', [A]);
    const n = async (t, where = '') => (await db.admin(`select count(*)::int as n from public.${t} ${where}`)).rows[0].n;
    expect(await n('profiles', `where id = '${A}'`)).toBe(0);
    expect(await n('skies')).toBe(0);
    expect(await n('friendships')).toBe(0);
    expect((await db.admin('select user_id, status from public.orders')).rows).toEqual([{ user_id: null, status: 'paid' }]);
  });
});
