const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.warn(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — copy server/.env.example to server/.env and fill them in. API requests will be rejected until then.'
  );
}

// service_role key, server-only: never send this to the client. Used only
// to verify bearer tokens the client attaches after Supabase Auth login.
const supabaseAdmin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

module.exports = { supabaseAdmin };
