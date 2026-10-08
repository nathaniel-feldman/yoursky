-- School data imported from the College Scorecard (scripts/import_supabase.py), and Pro orders from Lemon Squeezy.

-- ---------------------------------------------------------------------------------------------------------
-- Schools. `data` holds the record in the app's compact format (see app/src/data.json) so the shared engine can
-- score it; the named columns are for querying and spot checks.
--   curated = true: the ~200 hand-curated schools everyone sees (also shipped in data.json).
--   curated = false: the expanded pool that only Pro reveals ("hidden planets"). Never readable by clients.

create table public.schools (
  unitid int primary key,
  curated boolean not null default false,
  name text not null,
  short_name text,
  city text,
  state text,
  size int,
  is_public boolean,
  admit_rate numeric,
  sat_25 int,
  sat_75 int,
  act_25 int,
  act_75 int,
  sticker_price int,
  avg_net_price int,
  data jsonb not null,
  data_year text,
  updated_at timestamptz not null default now()
);

alter table public.schools enable row level security;
revoke all on public.schools from anon, authenticated;
grant select on public.schools to anon, authenticated;
create policy "curated schools are public" on public.schools for select to anon, authenticated using (curated);

-- Pro-only fields: net price by family income and earnings. Read only by Edge Functions (service role).
create table public.school_pro (
  unitid int primary key references public.schools (unitid) on delete cascade,
  net_price_by_income int[] check (net_price_by_income is null or array_length(net_price_by_income, 1) = 5),
  median_earnings int,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.school_pro enable row level security;
revoke all on public.school_pro from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Orders. Written only by the lemon-webhook Edge Function through apply_lemon_order(). Never client-visible.
-- raw_event is stored with the buyer's name and email removed.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  lemon_order_id text not null unique,
  user_id uuid references public.profiles (id) on delete set null,
  status text not null,
  amount int,
  currency text,
  test_mode boolean not null default false,
  referral_code text,
  discount_code text,
  affiliate_id text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw_event jsonb
);

create index orders_user on public.orders (user_id);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

-- Applies one Lemon Squeezy order event. Idempotent: replaying an event leaves the same state, and the unique
-- lemon_order_id means a duplicate delivery never creates a second row.
--   status paid or partial_refund → buyer is Pro
--   status refunded (full refund)  → Pro removed unless they have another paid order
--   pending, failed, fraudulent    → recorded, no Pro
create or replace function public.apply_lemon_order(
  p_event text,
  p_order_id text,
  p_user uuid,
  p_status text,
  p_amount int,
  p_currency text,
  p_test_mode boolean,
  p_discount_code text,
  p_affiliate_id text,
  p_raw jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select id from public.profiles where id = p_user);
  inserted boolean;
  pro boolean;
begin
  insert into public.orders as o (lemon_order_id, user_id, status, amount, currency, test_mode, referral_code, discount_code, affiliate_id, refunded_at, raw_event)
  values (
    p_order_id, uid, p_status, p_amount, p_currency, coalesce(p_test_mode, false),
    (select referral_code from public.profiles where id = uid),
    nullif(p_discount_code, ''),
    nullif(p_affiliate_id, ''),
    case when p_status = 'refunded' then now() end,
    p_raw
  )
  on conflict (lemon_order_id) do update set
    -- A late order_created must not undo a refund that already arrived.
    status = case when o.status = 'refunded' then o.status else excluded.status end,
    refunded_at = coalesce(o.refunded_at, excluded.refunded_at),
    user_id = coalesce(o.user_id, excluded.user_id),
    affiliate_id = coalesce(excluded.affiliate_id, o.affiliate_id),
    raw_event = case when o.status = 'refunded' then o.raw_event else excluded.raw_event end,
    updated_at = now()
  returning (xmax = 0) into inserted;

  if uid is not null then
    update public.profiles p
    set is_pro = exists (select 1 from public.orders where user_id = uid and status in ('paid', 'partial_refund')),
        pro_since = case
          when exists (select 1 from public.orders where user_id = uid and status in ('paid', 'partial_refund')) then coalesce(p.pro_since, now())
          else null end
    where p.id = uid
    returning p.is_pro into pro;
  end if;

  return jsonb_build_object('inserted', inserted, 'user_found', uid is not null, 'is_pro', coalesce(pro, false));
end;
$$;

revoke execute on function public.apply_lemon_order(text, text, uuid, text, int, text, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_lemon_order(text, text, uuid, text, int, text, boolean, text, text, jsonb) to service_role;
