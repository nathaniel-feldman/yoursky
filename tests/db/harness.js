// Runs the real migrations in an in-process Postgres (PGlite) with a stand-in for Supabase's auth schema and roles,
// so Row Level Security can be tested without Docker or a live project.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

// Mirrors what a Supabase project has before our migrations run, including the broad default grants Supabase gives
// anon/authenticated on new public tables (so a table that forgets to revoke them fails the tests).
const SUPABASE_SHIM = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function freshDb() {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }

  // Runs fn(query) as a role inside a transaction that is always rolled back unless keep is set.
  async function as(role, sub, fn, { keep = true } = {}) {
    await pg.exec('begin');
    try {
      await pg.exec(`set local role ${role}`);
      if (sub) await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
      const out = await fn((sql, params) => pg.query(sql, params));
      await pg.exec(keep ? 'commit' : 'rollback');
      return out;
    } catch (e) {
      await pg.exec('rollback');
      throw e;
    }
  }

  return {
    pg,
    async createUser(email, meta = {}) {
      const { rows } = await pg.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta]);
      return rows[0].id;
    },
    user: (id) => (fn) => as('authenticated', id, fn),
    anon: (fn) => as('anon', null, fn),
    service: (fn) => as('service_role', null, fn),
    admin: (sql, params) => pg.query(sql, params),
  };
}
