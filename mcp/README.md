# Pool MCP server

Read-only MCP tools over the Supabase analysis views — same pattern as the
pepbros/liftlog `mcp/server.js`. Runs on the Mac mini with the service_role
key; a scheduled Claude task uses these tools to write the daily advisory on
your **subscription** (no Anthropic API credits).

## Tools

| Tool | Returns |
|---|---|
| `get_latest_analysis` | Newest reading + all precomputed math (fc_min/fc_target, fc_adequate, cc_shock, range flags, lsi_approx, weekly slopes) |
| `get_recent_readings` | Last N readings (default 14) with the same columns — for trends |
| `get_pool_config` | Volume, sanitation (liquid/swg/tabs), surface, target ranges |

## Setup (Mac mini)

```sh
cd mcp
npm install
cp .env.example .env    # paste the service_role key
node server.js          # should start silently (stdio server); Ctrl-C to stop
```

Register with Claude (same as liftlog/pepbros):

```sh
claude mcp add pool --scope user -- node /path/to/pool-tracker/mcp/server.js
```

(or add to your MCP config file with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
in the server's `env` block if you don't use a `.env` file).

## Daily advisory (scheduled task)

Create a scheduled task (daily, 8am) with instructions along these lines:

> Using the pool MCP tools, fetch get_pool_config, get_latest_analysis, and
> get_recent_readings. The DB already computed fc_min/fc_target, adequacy and
> shock flags, lsi_approx, and weekly slopes — interpret them, don't recompute.
> Sanitizer first: lead with fc_adequate and cc_shock; if FC < fc_min it's
> urgent — give a specific liquid-chlorine dose for volume_gal with the math
> (12.5% liquid chlorine: ~12.8 fl oz raises FC 1 ppm per 10,000 gal) and the
> expected resulting FC. Sanitation is 'tabs': each 1 ppm FC from trichlor adds
> ~0.6 ppm CYA — watch cya_per_week and flag when CYA approaches cya_hi.
> Treat lsi_approx as directional only. Output: 1-line status, urgent actions
> with doses, watch items with trends, what to test next. Create a DRAFT email
> (never send) with subject "Pool advisory — <date>".
