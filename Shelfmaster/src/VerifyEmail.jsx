import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { localDb } from './localDbClient';
import myLogo from './assets/logo.png';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'pending', message: 'Confirming your email…' });

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState({ status: 'error', message: 'Missing verification token. Please use the link from your email.' });
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await localDb.auth.verifyEmail(token);
      if (cancelled) return;
      if (result?.error) {
        setState({ status: 'error', message: result.error.message || 'Could not verify your email.' });
      } else if (result?.alreadyVerified) {
        setState({ status: 'ok', message: 'Your email was already confirmed. You can sign in now.' });
      } else {
        setState({ status: 'ok', message: 'Your email is confirmed! Redirecting to login…' });
        setTimeout(() => navigate('/login'), 1800);
      }
    })();
    return () => { cancelled = true; };
  }, [params, navigate]);

  const palette = {
    pending: { bg: '#FAFFF0', accent: '#8C1010' },
    ok:      { bg: '#F0FFF4', accent: '#7DB356' },
    error:   { bg: '#FFF5F5', accent: '#8C1010' },
  }[state.status];

  return (
    <div style={{ minHeight: '100vh', background: palette.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', maxWidth: 460, width: '100%', borderRadius: 18, boxShadow: '0 10px 40px rgba(0,0,0,0.08)', padding: '36px 28px', textAlign: 'center' }}>
        <img src={myLogo} alt="Logo" style={{ width: 64, marginBottom: 16 }} />
        <h2 style={{ color: palette.accent, marginBottom: 12 }}>Email Verification</h2>
        <p style={{ color: '#475569', marginBottom: 24, fontSize: '1rem', lineHeight: 1.55 }}>
          {state.message}
        </p>
        <Link
          to="/login"
          style={{ display: 'inline-block', background: 'var(--maroon)', color: 'white', padding: '12px 24px', borderRadius: 10, fontWeight: 700, textDecoration: 'none' }}
        >
          Go to Sign In
        </Link>
      </div>
    </div>
  );
}
