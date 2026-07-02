# Pool advisory agent

Daily server-side module. Reads the Supabase analysis views with the
service_role key, asks Claude for an advisory (doses with math, trends,
what to test next), and creates a **draft** in AgentMail. It never sends —
you approve from the inbox.

## Setup (Mac mini)

```sh
cd agent
npm install
cp .env.example .env   # fill in keys — see below
node index.js          # run once to verify
```

`.env` needs:
- `SUPABASE_SERVICE_ROLE_KEY` — create in the Supabase dashboard (Settings →
  API). Server-side only; never goes in the repo or the PWA.
- `ANTHROPIC_API_KEY`
- `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `ADVISORY_TO`

## Cron (daily 8am)

```cron
0 8 * * * cd /path/to/pool-tracker/agent && /usr/local/bin/node index.js >> agent.log 2>&1
```

## Notes

- The DB views precompute FC min/target, adequacy/shock flags, lsi_approx,
  and weekly slopes — the agent formats them for the LLM, it does not
  recompute chemistry.
- `pool_latest_analysis` supplies the current state; the last ~14 rows of
  `pool_reading_analysis` supply trends.
