#!/usr/bin/env node
// Pool MCP server — same pattern as pepbros/liftlog mcp/server.js.
//
// Exposes read-only tools over the Supabase analysis views using the
// service_role key (server-side only — lives in mcp/.env on the Mac mini,
// never in the repo or the PWA). A scheduled Claude task reads these tools
// and drafts the daily advisory — no direct Anthropic API usage needed.
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const asResult = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({ name: 'pool', version: '0.1.0' });

server.tool(
  'get_latest_analysis',
  'Latest pool reading with all chemistry math precomputed by the database: ' +
    'fc_min/fc_target (from CYA), fc_adequate, cc_shock, out-of-range flags, ' +
    'lsi_approx (directional only), and trailing-14-day *_per_week trend slopes. ' +
    'Interpret these values — do not recompute them.',
  {},
  async () => asResult(await rest('pool_latest_analysis?select=*')),
);

server.tool(
  'get_recent_readings',
  'Recent pool readings (newest first) from pool_reading_analysis, each row ' +
    'carrying the same precomputed columns as get_latest_analysis. Use for trends.',
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(14)
      .describe('How many readings to return (default 14)'),
  },
  async ({ limit }) =>
    asResult(
      await rest(`pool_reading_analysis?select=*&order=created_at.desc&limit=${limit}`),
    ),
);

server.tool(
  'get_equipment_telemetry',
  'Recent water-temperature and pump telemetry pushed by Home Assistant ' +
    '(newest first, ~15-minute cadence): water_temp_f, pump_running, ' +
    'pump_runtime_min (minutes run so far that day — resets at midnight), ' +
    'recorded_at. Use the latest water_temp_f for exact CSI/LSI math, and ' +
    'pump runtime to judge whether overnight FC loss happened while water ' +
    'was actually circulating. Default limit 96 ≈ last 24 hours.',
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(96)
      .describe('How many telemetry rows to return, newest first (default 96 ≈ 24h)'),
  },
  async ({ limit }) =>
    asResult(
      await rest(`equipment_telemetry?select=*&order=recorded_at.desc&limit=${limit}`),
    ),
);

server.tool(
  'get_pool_config',
  'The pool configuration row: volume_gal, sanitation (liquid/swg/tabs), surface, ' +
    'FC min/target percentages, and target ranges for CYA/pH/TA/CH/salt.',
  {},
  async () => asResult(await rest('pool_config?select=*&id=eq.1')),
);

await server.connect(new StdioServerTransport());
