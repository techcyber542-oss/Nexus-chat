import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseConfig = Boolean(url && key && !url.includes('YOUR_PROJECT_ID') && !key.includes('YOUR_SUPABASE'));
export const supabase = createClient(
  url || 'https://example.supabase.co',
  key || 'placeholder-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
