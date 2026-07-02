// Pool advisory agent — runs daily on the Mac mini (cron: 0 8 * * *).
//
// Reads the precomputed analysis views from Supabase with the service_role
// key (server-side ONLY — never in the PWA), asks Claude for an advisory,
// and creates an AgentMail DRAFT. Draft-only by design: nothing is ever
// auto-sent; you approve from the AgentMail inbox.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  AGENTMAIL_API_KEY,
  AGENTMAIL_INBOX_ID,
  ADVISORY_TO,
  ANTHROPIC_MODEL = 'claude-opus-4-8',
} = process.env;

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AGENTMAIL_API_KEY', 'AGENTMAIL_INBOX_ID', 'ADVISORY_TO']) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

// ---- 1. Read the views (the DB already did the math) ------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const [{ data: latest, error: latestErr }, { data: history, error: histErr }] =
  await Promise.all([
    supabase.from('pool_latest_analysis').select('*').maybeSingle(),
    supabase
      .from('pool_reading_analysis')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(14),
  ]);

if (latestErr || histErr) {
  console.error('Supabase read failed:', latestErr ?? histErr);
  process.exit(1);
}
if (!latest) {
  console.log('No readings yet — nothing to advise on.');
  process.exit(0);
}

// ---- 2. Ask Claude for the advisory -----------------------------------------
const SYSTEM = `You are a pool chemistry advisor for a single residential pool.
The database has already computed all derived values (FC min/target from CYA,
adequacy flags, approximate LSI, weekly trend slopes) — do NOT recompute them;
interpret them.

Rules:
- Sanitizer first. Lead with fc_adequate and cc_shock. If FC < fc_min this is
  URGENT: give a specific liquid-chlorine dose for the pool's volume_gal,
  showing the math (12.5% liquid chlorine raises FC by 1 ppm per 10,000 gal
  with ~12.8 fl oz; scale to volume) and the expected resulting FC.
- Use the *_per_week slopes for trajectories (e.g. "pH rising 0.2/week —
  expect to dose acid by Friday").
- Every recommendation = exact amount for this volume + the math + the
  expected resulting value.
- Treat lsi_approx as directional only; recommend confirming with an exact CSI
  calculation before acting on scale/corrosion concerns.
- If sanitation is 'swg', dose via percent-output/runtime changes where
  sensible, with liquid chlorine only for boosts/SLAM.
- If sanitation is 'tabs' (trichlor): each 1 ppm FC from tabs adds ~0.6 ppm
  CYA and lowers pH/TA. Watch cya_per_week; when cya_eff approaches or
  exceeds cya_hi, recommend supplementing/replacing tabs with liquid chlorine
  and note the higher FC min/target that rising CYA imposes. Any urgent FC
  boost should still be dosed as liquid chlorine (tabs are too slow).

Output format (plain text email body):
1. One-line status.
2. URGENT ACTIONS (if any) — with doses and math.
3. WATCH ITEMS — trends worth tracking, with the slope numbers.
4. TEST NEXT — what to measure at the next poolside visit and why.`;

const userMessage = `Latest reading with precomputed analysis:
${JSON.stringify(latest, null, 2)}

Last ${history.length} readings (newest first, same precomputed columns):
${JSON.stringify(history, null, 2)}

Write today's advisory email body.`;

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY from env
const response = await anthropic.messages.create({
  model: ANTHROPIC_MODEL,
  max_tokens: 16000,
  thinking: { type: 'adaptive' },
  system: SYSTEM,
  messages: [{ role: 'user', content: userMessage }],
});

const advisory = response.content
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('\n')
  .trim();

if (!advisory) {
  console.error('Model returned no text (stop_reason:', response.stop_reason, ')');
  process.exit(1);
}

// ---- 3. DRAFT to AgentMail (never send) -------------------------------------
const today = new Date().toISOString().slice(0, 10);
const draftRes = await fetch(
  `https://api.agentmail.to/v0/inboxes/${AGENTMAIL_INBOX_ID}/drafts`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AGENTMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: [ADVISORY_TO],
      subject: `Pool advisory — ${today}`,
      text: advisory,
    }),
  }
);

if (!draftRes.ok) {
  console.error('AgentMail draft failed:', draftRes.status, await draftRes.text());
  process.exit(1);
}

const draft = await draftRes.json();
console.log(`Draft created (${draft.draft_id ?? draft.id ?? 'ok'}) — review & send from AgentMail.`);
