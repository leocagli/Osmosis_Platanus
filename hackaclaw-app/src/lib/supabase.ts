import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Client-side Supabase (anon key, safe for browser) */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Server-side Supabase (service role, bypasses RLS) */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
