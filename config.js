// Supabase project config. The anon key is public and RLS-protected —
// safe in the client bundle. The service_role key must NEVER appear here.
// Loaded by both the page (index.html) and the service worker (sw.js).
const POOL_SUPABASE = {
  url: 'https://yfyteznucyhmikxhnlkj.supabase.co',
  anonKey: 'REPLACE_WITH_ANON_KEY', // TODO(shea): paste the project anon key
};
