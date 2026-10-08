// Dev-only fake backend (VITE_MOCK_BACKEND=1 with `npm run dev`), for trying sign-in, saving, Pro and friends without
// Supabase or Lemon Squeezy. Data lives in localStorage. The email code is always 000000. Never included in builds.
import data from './data.json';
import { computeSky, cleanInput } from '../../supabase/functions/_shared/sky.js';

const KEY = 'yoursky.mock', SESSION = 'yoursky.mock.session';
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const uid = () => crypto.randomUUID();
const code8 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[b % 31]).join('');

// A stand-in for the server-only expanded pool: real records under different ids.
const POOL = data.schools.slice(0, 30).map((s) => ({ ...s, id: s.id + 9_000_000, n: `${s.n} (pool)`, f: `${s.f} (hidden pool)` }));

function load() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (db) return db;
  // Two demo classmates: Maya accepts any request; Jordan has already sent you one.
  const maya = uid(), jordan = uid();
  const sky = (ids, name, major) => ({ id: uid(), user_id: null, created_at: new Date().toISOString(), quiz_answers: { setting: 'city', size: 55 }, profile_snapshot: { name, major }, results: ids.map((id, i) => ({ id, fit: 90 - i * 4 })) });
  db = {
    users: { 'maya@demo': maya, 'jordan@demo': jordan },
    profiles: {
      [maya]: { id: maya, display_name: 'Maya', friend_code: 'MAYA2345', confirmed_13_plus: true, is_pro: false },
      [jordan]: { id: jordan, display_name: 'Jordan', friend_code: 'JRDN6789', confirmed_13_plus: true, is_pro: false },
    },
    skies: [
      { ...sky(data.schools.slice(0, 6).map((s) => s.id), 'Maya', 'bio'), user_id: maya },
      { ...sky(data.schools.slice(20, 26).map((s) => s.id), 'Jordan', 'cs'), user_id: jordan },
    ],
    friendships: [],
    pendingIncoming: jordan,
  };
  save(db);
  return db;
}
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));

export async function createBackend() {
  let db = load();
  let current = null;
  const listeners = new Set();
  const sid = localStorage.getItem(SESSION);
  if (sid && db.profiles[sid]) current = { id: sid, email: Object.keys(db.users).find((e) => db.users[e] === sid) };
  const emit = () => listeners.forEach((cb) => cb(current));
  const me = () => db.profiles[current.id];
  const pendingCode = {};

  function signIn(email, meta = {}) {
    let id = db.users[email];
    if (!id) {
      id = uid();
      db.users[email] = id;
      db.profiles[id] = { id, created_at: new Date().toISOString(), display_name: null, is_pro: false, pro_since: null, friend_code: code8(), confirmed_13_plus: !!meta.confirmed13, referral_code: meta.referral || null, save_academics: false };
      if (db.pendingIncoming) db.friendships.push({ id: uid(), requester_id: db.pendingIncoming, addressee_id: id, status: 'pending', created_at: new Date().toISOString() });
      save(db);
    }
    current = { id, email };
    localStorage.setItem(SESSION, id);
    emit();
    return current;
  }
  const other = (f) => (f.requester_id === current.id ? f.addressee_id : f.requester_id);

  return {
    mock: true,
    async ready() {},
    user: () => current,
    onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async sendCode(email, meta) { await wait(); pendingCode[email] = meta; console.info('[mock] email code for', email, 'is 000000'); },
    async verifyCode(email, code) {
      await wait();
      if (code.trim() !== '000000') throw new Error('That code didn’t work. Check it or send a new one.');
      return signIn(email, pendingCode[email]);
    },
    async signInWithGoogle() { await wait(); signIn('google.student@demo', {}); },
    async signOut() { current = null; localStorage.removeItem(SESSION); emit(); },
    async profile() { await wait(80); return { ...me() }; },
    async updateProfile(patch) { Object.assign(me(), patch); save(db); },
    async confirm13() { me().confirmed_13_plus = true; save(db); },
    async claimReferral(code) { if (code && !me().referral_code) { me().referral_code = code; save(db); } },
    async saveSky(rec) {
      if (!me().confirmed_13_plus) throw new Error('Confirm you’re 13 or older first.');
      const row = { id: uid(), user_id: current.id, created_at: new Date().toISOString(), ...rec };
      db.skies.push(row); save(db); await wait(150);
      return row.id;
    },
    async listSkies() { return db.skies.filter((s) => s.user_id === current.id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async deleteSky(id) { db.skies = db.skies.filter((s) => !(s.id === id && s.user_id === current.id)); save(db); },
    async deleteAccount() {
      const id = current.id;
      delete db.profiles[id];
      for (const e of Object.keys(db.users)) if (db.users[e] === id) delete db.users[e];
      db.skies = db.skies.filter((s) => s.user_id !== id);
      db.friendships = db.friendships.filter((f) => f.requester_id !== id && f.addressee_id !== id);
      save(db);
      await this.signOut();
    },
    async skyData(body) {
      await wait(300);
      return computeSky({ curated: data.schools, pool: POOL, input: cleanInput(body), isPro: !!(current && me().is_pro), signedIn: !!current });
    },
    // Stands in for Lemon Squeezy's checkout plus the webhook.
    async mockPurchase() { await wait(1200); me().is_pro = true; me().pro_since = new Date().toISOString(); save(db); },
    async requestFriend(code) {
      const them = Object.values(db.profiles).find((p) => p.friend_code === String(code).toUpperCase().trim());
      if (!them) return 'not_found';
      if (them.id === current.id) return 'self';
      const f = db.friendships.find((x) => [x.requester_id, x.addressee_id].includes(them.id) && [x.requester_id, x.addressee_id].includes(current.id));
      if (f) { if (f.status === 'pending' && f.addressee_id === current.id) { f.status = 'accepted'; save(db); return 'accepted'; } return f.status; }
      // Maya accepts right away so the compare flow can be tried.
      db.friendships.push({ id: uid(), requester_id: current.id, addressee_id: them.id, status: them.display_name === 'Maya' ? 'accepted' : 'pending', created_at: new Date().toISOString() });
      save(db);
      return them.display_name === 'Maya' ? 'accepted' : 'pending';
    },
    async listFriends() {
      return db.friendships.filter((f) => [f.requester_id, f.addressee_id].includes(current.id)).map((f) => ({
        friendship_id: f.id, friend_id: other(f), display_name: db.profiles[other(f)]?.display_name ?? null, status: f.status,
        incoming: f.addressee_id === current.id && f.status === 'pending', created_at: f.created_at,
      }));
    },
    async respondFriend(id, accept) {
      const f = db.friendships.find((x) => x.id === id && x.addressee_id === current.id && x.status === 'pending');
      if (!f) return 'not_found';
      if (accept) f.status = 'accepted'; else db.friendships = db.friendships.filter((x) => x !== f);
      save(db);
      return accept ? 'accepted' : 'declined';
    },
    async unfriend(id) { db.friendships = db.friendships.filter((f) => !(f.id === id && [f.requester_id, f.addressee_id].includes(current.id))); save(db); },
    async friendSky(friendId) {
      const ok = db.friendships.some((f) => f.status === 'accepted' && [f.requester_id, f.addressee_id].includes(friendId) && [f.requester_id, f.addressee_id].includes(current.id));
      return ok ? db.skies.filter((s) => s.user_id === friendId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null : null;
    },
  };
}
