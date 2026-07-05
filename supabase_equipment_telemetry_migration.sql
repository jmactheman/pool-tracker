-- ============================================================
-- pool-tracker: equipment telemetry from Home Assistant
-- Run by hand in the Supabase SQL editor (separate from the
-- original supabase_pool_migration.sql, which is already applied).
--
-- Shared data contract with the Home Assistant MacBook sender:
--   POST {SUPABASE_URL}/rest/v1/equipment_telemetry
--   auth: anon key, INSERT-only
--   columns: recorded_at (default now()), water_temp_f numeric,
--            pump_running boolean, pump_runtime_min numeric, source text
-- ============================================================

create table if not exists public.equipment_telemetry (
  id               bigint generated always as identity primary key,
  recorded_at      timestamptz not null default now(),
  water_temp_f     numeric,          -- pool water temperature, °F
  pump_running     boolean,          -- pump state at the time of the reading
  pump_runtime_min numeric,          -- minutes run so far today (resets at midnight)
  source           text not null default 'home_assistant'
);

create index if not exists equipment_telemetry_recorded_at_idx
  on public.equipment_telemetry (recorded_at);

comment on table public.equipment_telemetry is
  'Water temp + pump runtime pushed by Home Assistant every ~15 min. Insert-only for anon.';

-- ------------------------------------------------------------
-- RLS: anon may INSERT only (the sender key cannot read anything);
-- service_role (agent/MCP) reads.
-- ------------------------------------------------------------
alter table public.equipment_telemetry enable row level security;

revoke all on public.equipment_telemetry from anon, authenticated;
grant insert on public.equipment_telemetry to anon;

create policy anon_insert_telemetry on public.equipment_telemetry
  for insert to anon with check (true);

-- service_role bypasses RLS; explicit grant for clarity
grant select on public.equipment_telemetry to service_role;
