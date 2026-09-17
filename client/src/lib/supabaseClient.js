import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// createClient throws synchronously if either arg is missing, which would
// white-screen the whole app before it can show a helpful setup message —
// so stay null until client/.env is actually filled in.
export const supabase = supabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
