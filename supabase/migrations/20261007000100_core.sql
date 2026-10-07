-- Your Sky: profiles, saved skies, friendships, anonymous funnel events.
-- Row Level Security is on for every table. Supabase grants anon/authenticated broad default privileges on
-- new tables, so each table below revokes them and grants back only what the client may do.

-- ---------------------------------------------------------------------------------------------------------
-- Helpers

-- 8 characters from an alphabet without lookalikes (no 0/O, 1/I/L). ~8.5e11 combinations, and requests are
-- rate-limited, so codes can't be guessed. Uses the random bytes of a v4 UUID (skipping the version/variant bytes)
-- so it needs no extension.
create or replace function public.gen_friend_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b bytea := uuid_send(gen_random_uuid());
  idx int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  code text := '';
  i int;
begin
  foreach i in array idx loop
    code := code || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;

-- Saved results may hold only school ids and fit scores: friends can read skies, so no chances or costs.
create or replace function public.results_ok(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(r) = 'array'
    and jsonb_array_length(r) <= 80
    and not exists (
      select 1 from jsonb_array_elements(r) e
      where jsonb_typeof(e) <> 'object'
         or exists (select 1 from jsonb_object_keys(e) k where k not in ('id', 'fit'))
    );
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Profiles: one per auth user, created by trigger.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text check (char_length(display_name) <= 40),
  is_pro boolean not null default false,
  pro_since timestamptz,
  referral_code text check (char_length(referral_code) <= 64),
  friend_code text not null unique default public.gen_friend_code(),
  confirmed_13_plus boolean not null default false,
  -- Optional academic inputs, saved only when the student opts in (save_academics).
  save_academics boolean not null default false,
  gpa_unweighted numeric(3, 2) check (gpa_unweighted between 0 and 4),
  sat_total int check (sat_total between 400 and 1600),
  act_composite int check (act_composite between 1 and 36),
  -- Index into Scorecard's five net-price brackets: 0 = $0–30k, 1 = $30–48k, 2 = $48–75k, 3 = $75–110k, 4 = $110k+.
  income_bracket smallint check (income_bracket between 0 and 4)
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- is_pro, pro_since, friend_code, referral_code and confirmed_13_plus are never client-writable.
grant update (display_name, save_academics, gpa_unweighted, sat_total, act_composite, income_bracket) on public.profiles to authenticated;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- New auth user → profile. Email sign-up passes {confirmed_13_plus, referral_code} as user metadata;
-- Google sign-in can't, so the client confirms afterwards with confirm_13_plus().
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, confirmed_13_plus, referral_code)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'confirmed_13_plus')::boolean, false),
    nullif(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'referral_code', ''), '[^A-Za-z0-9_-]', '', 'g'), 64), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-way: a student can confirm they're 13+, never un-confirm (and nobody can confirm for someone else).
create or replace function public.confirm_13_plus()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set confirmed_13_plus = true where id = (select auth.uid());
$$;

-- First touch wins: sets the creator/referral code only if none is stored yet.
create or replace function public.claim_referral(code text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set referral_code = nullif(left(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9_-]', '', 'g'), 64), '')
  where id = (select auth.uid()) and referral_code is null;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Saved skies. Immutable snapshots: students can add and delete, not edit.

create table public.skies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  version int not null default 1,
  quiz_answers jsonb not null check (jsonb_typeof(quiz_answers) = 'object' and pg_column_size(quiz_answers) < 4000),
  -- Name, majors and home region only. Never grades, scores, budget or income.
  profile_snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(profile_snapshot) = 'object'
    and not (profile_snapshot ?| array['gpa', 'sat', 'act', 'budget', 'income', 'testMode', 'state'])
    and pg_column_size(profile_snapshot) < 1000
  ),
  results jsonb not null check (public.results_ok(results))
);

create index skies_user_created on public.skies (user_id, created_at desc);

alter table public.skies enable row level security;
revoke all on public.skies from anon, authenticated;
grant select, insert, delete on public.skies to authenticated;

create policy "read own skies" on public.skies
  for select to authenticated using (user_id = (select auth.uid()));
create policy "save own skies" on public.skies
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.confirmed_13_plus)
  );
create policy "delete own skies" on public.skies
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------
-- Friendships: requests by friend code only, the other person must accept. No search, no strangers.

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

create unique index friendships_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee on public.friendships (addressee_id);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
-- Rows are created and accepted only through the functions below; either side may delete (unfriend/decline/cancel).
grant select, delete on public.friendships to authenticated;

create policy "see own friendships" on public.friendships
  for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));
create policy "end own friendships" on public.friendships
  for delete to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

-- A friend may read your skies only once the friendship is accepted.
create policy "friends read skies" on public.skies
  for select to authenticated using (
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id = skies.user_id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = skies.user_id))
    )
  );

-- Opening someone's /f/CODE link while signed in. Returns 'pending', 'accepted', 'self' or 'not_found'.
-- If they already asked you, this accepts. At most 30 new requests per person per day.
create or replace function public.request_friend(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  them uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = me and confirmed_13_plus) then
    raise exception 'confirm 13+ first' using errcode = '42501';
  end if;
  select id into them from public.profiles where friend_code = upper(trim(code));
  if them is null then return 'not_found'; end if;
  if them = me then return 'self'; end if;

  select * into existing from public.friendships
  where least(requester_id, addressee_id) = least(me, them) and greatest(requester_id, addressee_id) = greatest(me, them);
  if found then
    if existing.status = 'pending' and existing.addressee_id = me then
      update public.friendships set status = 'accepted', responded_at = now() where id = existing.id;
      return 'accepted';
    end if;
    return existing.status;
  end if;

  if (select count(*) from public.friendships where requester_id = me and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many friend requests today' using errcode = '54000';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (me, them);
  return 'pending';
end;
$$;

-- The addressee accepts or declines a pending request.
create or replace function public.respond_friend(friendship uuid, accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if accept then
    update public.friendships set status = 'accepted', responded_at = now()
    where id = friendship and addressee_id = me and status = 'pending';
    return case when found then 'accepted' else 'not_found' end;
  end if;
  delete from public.friendships where id = friendship and addressee_id = me and status = 'pending';
  return case when found then 'declined' else 'not_found' end;
end;
$$;

-- Your friendships with the other person's display name. Profiles stay private otherwise.
create or replace function public.list_friends()
returns table (friendship_id uuid, friend_id uuid, display_name text, status text, incoming boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id,
         case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end,
         p.display_name,
         f.status,
         f.addressee_id = (select auth.uid()) and f.status = 'pending',
         f.created_at
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
  where (select auth.uid()) in (f.requester_id, f.addressee_id)
  order by f.status, f.created_at desc;
$$;

-- A friend's latest sky. Runs as the caller, so the "friends read skies" policy decides access.
create or replace function public.friend_sky(friend uuid)
returns setof public.skies
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.skies where user_id = friend order by created_at desc limit 1;
$$;

revoke execute on function public.request_friend(text), public.respond_friend(uuid, boolean), public.list_friends(),
  public.friend_sky(uuid), public.confirm_13_plus(), public.claim_referral(text) from public, anon;
grant execute on function public.request_friend(text), public.respond_friend(uuid, boolean), public.list_friends(),
  public.friend_sky(uuid), public.confirm_13_plus(), public.claim_referral(text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Anonymous funnel events: an allow-listed name and a tiny props object. No user id, no personal data.

create table public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (name in (
    'quiz_started', 'quiz_completed', 'save_prompt_shown', 'save_prompt_clicked', 'signed_up',
    'unlock_clicked', 'purchase_completed', 'friend_link_opened', 'share_clicked'
  )),
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) < 300)
);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant insert (name, props) on public.events to anon, authenticated;
create policy "anyone can log an event" on public.events for insert to anon, authenticated with check (true);
