// Supabase project config. The anon key is public and RLS-protected —
// safe in the client bundle. The service_role key must NEVER appear here.
// Loaded by both the page (index.html) and the service worker (sw.js).
const POOL_SUPABASE = {
  url: 'https://yfyteznucyhmikxhnlkj.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXRlem51Y3lobWlreGhubGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDY5NTIsImV4cCI6MjA5ODUyMjk1Mn0.80Q4eHTxKOzkgFBv6lhT_yZf3r9kU-lzXuCv-WLMHGQ',
};
