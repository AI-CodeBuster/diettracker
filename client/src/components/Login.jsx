import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Supabase deliberately returns a generic "Invalid login credentials" for
// both a wrong password AND an email that was never signed up, so it can't
// be told apart client-side — reworded here to stop it reading like a
// system error. "Email not confirmed" is the one case that *is* specific
// (GoTrue returns that exact string), and is the actual cause of the
// "can't log in after signing up" complaint: signup requires clicking the
// emailed confirmation link before a password will work at all.
function friendlyAuthError(err) {
  const msg = err?.message || String(err);
  if (/email not confirmed/i.test(msg)) {
    return { text: "This email hasn't been confirmed yet — check your inbox (and spam folder) for the confirmation link.", canResend: true };
  }
  if (/invalid login credentials/i.test(msg)) {
    return { text: 'Incorrect email or password, or this email was never confirmed after signup.', canResend: true };
  }
  if (/user already registered/i.test(msg)) {
    return { text: 'An account with this email already exists — log in instead.', canResend: false };
  }
  return { text: msg, canResend: false };
}

function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [offerResend, setOfferResend] = useState(false);
  const [resending, setResending] = useState(false);

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setError(null);
    setInfo(null);
    setOfferResend(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    setOfferResend(false);
    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setInfo('Account created. Check your email (including spam) for a confirmation link, then log in.');
          setMode('login');
        }
      }
    } catch (err) {
      const { text, canResend } = friendlyAuthError(err);
      setError(text);
      setOfferResend(canResend);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError('Enter your email above first, then resend the confirmation link.');
      return;
    }
    setResending(true);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
      if (resendError) throw resendError;
      setInfo('Confirmation email sent — check your inbox (and spam folder).');
      setOfferResend(false);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Dietitian Department Tracker</h1>
        <p className="auth-subtitle">{mode === 'login' ? 'Employee log in' : 'Create an employee account'}</p>

        {mode === 'signup' && (
          <label className="auth-field">
            Full name
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </label>
        )}

        <label className="auth-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="auth-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>

        {error && <p className="auth-error">{error}</p>}
        {offerResend && (
          <button type="button" className="auth-switch" onClick={handleResend} disabled={resending}>
            {resending ? 'Sending…' : 'Resend confirmation email'}
          </button>
        )}
        {info && <p className="auth-info">{info}</p>}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>

        <button type="button" className="auth-switch" onClick={switchMode}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
        </button>
      </form>
    </div>
  );
}

export default Login;
