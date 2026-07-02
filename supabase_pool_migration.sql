-- ============================================================
-- pool-tracker: Supabase migration
-- Run by hand in the Supabase SQL editor, then edit the seeded
-- pool_config row to match your pool.
-- ============================================================

-- ------------------------------------------------------------
-- pool_config: single row of pool parameters + target ranges
-- ------------------------------------------------------------
create table if not exists public.pool_config (
  id              int primary key default 1 check (id = 1), -- enforce single row
  volume_gal      numeric not null default 15000,
  surface_area_sqft numeric,
  sanitation      text not null default 'liquid' check (sanitation in ('liquid','swg')),
  surface         text not null default 'plaster' check (surface in ('plaster','vinyl','fiberglass')),
  -- FC minimum / target as a percent of CYA (TFP-style).
  -- Liquid chlorine: min 7.5% of CYA, target ~11.5%.
  -- SWG variant: min 5%, target ~7%.
  fc_min_pct      numeric not null default 7.5,
  fc_target_pct   numeric not null default 11.5,
  cya_lo          numeric not null default 30,
  cya_hi          numeric not null default 50,
  ph_lo           numeric not null default 7.2,
  ph_hi           numeric not null default 8.0,
  ta_lo           numeric not null default 50,
  ta_hi           numeric not null default 90,
  ch_lo           numeric not null default 250,
  ch_hi           numeric not null default 650,
  salt_lo         numeric,          -- set for SWG (e.g. 2700)
  salt_hi         numeric,          -- set for SWG (e.g. 3400)
  updated_at      timestamptz not null default now()
);

comment on table public.pool_config is
  'Single-row pool parameters. FC min/target are percentages of CYA.';

-- ------------------------------------------------------------
-- pool_readings: raw test entries. Everything nullable except source —
-- blanks are fine, enter only what you tested.
-- ------------------------------------------------------------
create table if not exists public.pool_readings (
  id          bigint generated always as identity primary key,
  source      text not null default 'manual',
  fc          numeric,   -- free chlorine, ppm
  cc          numeric,   -- combined chlorine, ppm
  ph          numeric,
  ta          numeric,   -- total alkalinity, ppm
  ch          numeric,   -- calcium hardness, ppm
  cya         numeric,   -- cyanuric acid, ppm
  salt        numeric,   -- ppm
  temp_f      numeric,
  orp_mv      numeric,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists pool_readings_created_at_idx
  on public.pool_readings (created_at);

-- ------------------------------------------------------------
-- pool_reading_analysis: per-row derived math.
--  * carries forward last-known cya/ph/ta/ch/temp/salt so sparse tests
--    still get FC targets + LSI
--  * fc_min/fc_target from CYA percent rules in pool_config
--  * lsi_approx is DIRECTIONAL ONLY (approximate temp factor, carbonate
--    alkalinity ~ TA - CYA/3); confirm with an exact CSI before acting
--  * *_per_week: least-squares slope over the trailing 14 days
-- ------------------------------------------------------------
create or replace view public.pool_reading_analysis
with (security_invoker = off)  -- owner (postgres) reads tables; access controlled by grants below
as
with cfg as (
  select * from public.pool_config where id = 1
),
grp as (
  -- "last non-null carried forward" via count-over-window partition trick
  select r.*,
    count(r.cya)    over w as g_cya,
    count(r.ph)     over w as g_ph,
    count(r.ta)     over w as g_ta,
    count(r.ch)     over w as g_ch,
    count(r.temp_f) over w as g_temp,
    count(r.salt)   over w as g_salt
  from public.pool_readings r
  window w as (order by r.created_at, r.id)
),
filled as (
  select g.*,
    max(g.cya)    over (partition by g.g_cya)  as cya_eff,
    max(g.ph)     over (partition by g.g_ph)   as ph_eff,
    max(g.ta)     over (partition by g.g_ta)   as ta_eff,
    max(g.ch)     over (partition by g.g_ch)   as ch_eff,
    max(g.temp_f) over (partition by g.g_temp) as temp_eff,
    max(g.salt)   over (partition by g.g_salt) as salt_eff
  from grp g
),
calc as (
  select f.id, f.source, f.fc, f.cc, f.ph, f.ta, f.ch, f.cya, f.salt,
         f.temp_f, f.orp_mv, f.note, f.created_at,
         f.cya_eff, f.ph_eff, f.ta_eff, f.ch_eff, f.temp_eff, f.salt_eff,
         round(f.cya_eff * cfg.fc_min_pct    / 100.0, 1) as fc_min,
         round(f.cya_eff * cfg.fc_target_pct / 100.0, 1) as fc_target,
         cfg.volume_gal, cfg.sanitation, cfg.surface,
         cfg.cya_lo, cfg.cya_hi, cfg.ph_lo, cfg.ph_hi,
         cfg.ta_lo, cfg.ta_hi, cfg.ch_lo, cfg.ch_hi,
         cfg.salt_lo, cfg.salt_hi,
         -- LSI ~ pH + TF + CF + AF - const
         -- TF: standard Langelier temperature-factor table (deg F)
         case
           when f.temp_eff is null then null
           when f.temp_eff <  37 then 0.0
           when f.temp_eff <  46 then 0.1
           when f.temp_eff <  53 then 0.2
           when f.temp_eff <  60 then 0.3
           when f.temp_eff <  66 then 0.4
           when f.temp_eff <  76 then 0.5
           when f.temp_eff <  84 then 0.6
           when f.temp_eff <  94 then 0.7
           when f.temp_eff < 105 then 0.8
           else 0.9
         end as lsi_tf
  from filled f
  cross join cfg
)
select
  c.id, c.source, c.fc, c.cc, c.ph, c.ta, c.ch, c.cya, c.salt,
  c.temp_f, c.orp_mv, c.note, c.created_at,
  c.cya_eff, c.ph_eff, c.ta_eff, c.ch_eff, c.temp_eff, c.salt_eff,
  c.fc_min, c.fc_target,
  c.volume_gal, c.sanitation, c.surface,
  -- sanitizer flags
  case when c.fc is not null and c.fc_min is not null
       then c.fc >= c.fc_min end                              as fc_adequate,
  case when c.cc is not null then c.cc > 0.5 end              as cc_shock,
  -- out-of-range flags (against config ranges, on effective values)
  case when c.ph_eff  is not null then c.ph_eff  < c.ph_lo or c.ph_eff  > c.ph_hi end as ph_out,
  case when c.ta_eff  is not null then c.ta_eff  < c.ta_lo or c.ta_eff  > c.ta_hi end as ta_out,
  case when c.ch_eff  is not null then c.ch_eff  < c.ch_lo or c.ch_eff  > c.ch_hi end as ch_out,
  case when c.cya_eff is not null then c.cya_eff < c.cya_lo or c.cya_eff > c.cya_hi end as cya_out,
  case when c.salt_eff is not null and c.salt_lo is not null
       then c.salt_eff < c.salt_lo or c.salt_eff > c.salt_hi end as salt_out,
  -- approximate LSI: pH + TF + log10(CH) - 0.4 + log10(TA - CYA/3) - 12.1
  -- (12.2 constant when salt suggests TDS > 1000). DIRECTIONAL ONLY.
  case
    when c.ph_eff is null or c.ch_eff is null or c.ta_eff is null
         or c.lsi_tf is null or c.ch_eff <= 0
         or (c.ta_eff - coalesce(c.cya_eff, 0) / 3.0) <= 0
    then null
    else round(
      ( c.ph_eff
        + c.lsi_tf
        + log(10, c.ch_eff::numeric) - 0.4
        + log(10, greatest(c.ta_eff - coalesce(c.cya_eff, 0) / 3.0, 1)::numeric)
        - case when coalesce(c.salt_eff, 0) > 1000 then 12.2 else 12.1 end
      )::numeric, 2)
  end as lsi_approx,
  -- trailing-14-day least-squares slopes, in units per week
  regr_slope(c.fc,  extract(epoch from c.created_at) / 604800.0) over w14 as fc_per_week,
  regr_slope(c.ph,  extract(epoch from c.created_at) / 604800.0) over w14 as ph_per_week,
  regr_slope(c.ta,  extract(epoch from c.created_at) / 604800.0) over w14 as ta_per_week,
  regr_slope(c.ch,  extract(epoch from c.created_at) / 604800.0) over w14 as ch_per_week,
  regr_slope(c.cya, extract(epoch from c.created_at) / 604800.0) over w14 as cya_per_week,
  regr_slope(c.salt, extract(epoch from c.created_at) / 604800.0) over w14 as salt_per_week
from calc c
window w14 as (
  order by c.created_at
  range between interval '14 days' preceding and current row
);

-- ------------------------------------------------------------
-- pool_latest_analysis: newest row, math precomputed
-- ------------------------------------------------------------
create or replace view public.pool_latest_analysis
with (security_invoker = off)
as
select * from public.pool_reading_analysis
order by created_at desc, id desc
limit 1;

-- ------------------------------------------------------------
-- RLS + grants
--   anon:          INSERT pool_readings, SELECT pool_config — nothing else
--   service_role:  SELECT the analysis views (used by the /agent module)
-- ------------------------------------------------------------
alter table public.pool_config   enable row level security;
alter table public.pool_readings enable row level security;

-- strip Supabase's default table privileges, then grant back the minimum
revoke all on public.pool_config   from anon, authenticated;
revoke all on public.pool_readings from anon, authenticated;

grant select on public.pool_config   to anon;
grant insert on public.pool_readings to anon;

create policy anon_read_config on public.pool_config
  for select to anon using (true);

create policy anon_insert_readings on public.pool_readings
  for insert to anon with check (true);

-- The PWA must NOT read readings back (by design). If you ever want it to,
-- uncomment:
-- grant select on public.pool_readings to anon;
-- create policy anon_read_readings on public.pool_readings
--   for select to anon using (true);

-- Views: owner-executed (security_invoker = off); lock them to service_role.
revoke all on public.pool_reading_analysis from anon, authenticated;
revoke all on public.pool_latest_analysis  from anon, authenticated;
grant select on public.pool_reading_analysis to service_role;
grant select on public.pool_latest_analysis  to service_role;

-- ------------------------------------------------------------
-- Seed: liquid-chlorine defaults. Edit this row after running.
--
-- SWG variant — after seeding, run:
--   update pool_config set sanitation = 'swg',
--     fc_min_pct = 5, fc_target_pct = 7,
--     cya_lo = 70, cya_hi = 80,
--     salt_lo = 2700, salt_hi = 3400
--   where id = 1;
-- ------------------------------------------------------------
insert into public.pool_config (id, volume_gal, sanitation, surface)
values (1, 15000, 'liquid', 'plaster')
on conflict (id) do nothing;
