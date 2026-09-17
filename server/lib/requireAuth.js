const { supabaseAdmin } = require('./supabaseAdmin');

// Every /api/* route sits behind this: the client attaches the Supabase
// session's access token as a bearer token, and we ask Supabase to verify
// it rather than checking a JWT secret locally, so revoked/expired sessions
// are rejected immediately without us tracking session state ourselves.
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Server auth is not configured' });

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });

  req.user = data.user;
  next();
}

module.exports = { requireAuth };
