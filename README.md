# pool-tracker

Poolside chemistry tracker: offline-first PWA (GitHub Pages) + Supabase data
layer + server-side advisory agent.

- **PWA** — vanilla JS, no build step. Enter FC/CC/pH/TA/CH/CYA/salt/temp/ORP
  one-handed at the pool. Works offline, queues readings, syncs on reconnect.
- **Data** — Supabase (dedicated project). `pool_readings` + single-row
  `pool_config`, with analysis views that precompute FC min/target from CYA,
  adequacy/shock flags, approximate LSI, and weekly trend slopes.
- **MCP + scheduled task (preferred)** — `/mcp` server exposes read-only tools
  over the analysis views (service_role, server-side only). A scheduled Claude
  task reads them daily and drafts the advisory on your subscription — no
  Anthropic API credits. Same pattern as pepbros/liftlog.
- **Agent (optional alternative)** — `/agent` standalone Node module that calls
  the Anthropic API directly (requires API credits) and drafts via AgentMail.
  Kept for reference; the MCP route above is the intended path.

## Setup

1. Run `supabase_pool_migration.sql` in the Supabase SQL editor.
2. Edit the seeded `pool_config` row (volume, sanitation, surface, ranges).
3. Put the project URL + anon key in `config.js` (anon key is public,
   RLS-protected).
4. GitHub Pages: serve from `main`, root.
5. Agent: see `agent/README.md`. The service_role key lives only in the agent
   host env — never in this repo or the client.
