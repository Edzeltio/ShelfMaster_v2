import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { localDb } from './localDbClient';
import myLogo from './assets/logo.png';
import Toast from './Toast';
import { useResponsive } from './useResponsive';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'error' });
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const navigate = useNavigate();
  const { isMobile } = useResponsive();

  const showToast = (message, type = 'error') => setToast({ message, type });
  const closeToast = () => setToast({ message: '' });

  const handleBack = (e) => {
    e.preventDefault();
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const handleResend = async () => {
    if (!email) { showToast('Enter your email above first.', 'warning'); return; }
    setResending(true);
    const result = await localDb.auth.resendVerification(email);
    setResending(false);
    if (result?.error) {
      showToast(result.error.message || 'Could not resend email.', 'error');
    } else if (result?.alreadyVerified) {
      showToast('That email is already verified — try signing in.', 'success');
      setNeedsVerification(false);
    } else {
      showToast('Verification email sent — please check your inbox.', 'success');
      if (result?.verifyUrl) console.log('[verify] Open this URL to confirm:', result.verifyUrl);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setNeedsVerification(false);

    const { data: authData, error: authError } = await localDb.auth.signInWithPassword({ email, password });

    if (authError) {
      const msg = authError.message;
      if (msg.toLowerCase().includes('verify') || msg.toLowerCase().includes('verification')) {
        setNeedsVerification(true);
        showToast(msg, 'warning');
      } else if (msg.includes('Invalid login credentials')) {
        showToast('Incorrect email or password. Please try again.', 'error');
      } else {
        showToast(msg, 'error');
      }
      setLoading(false);
      return;
    }

    const { data: userData, error: userError } = await localDb
      .from('users').select('role').eq('auth_id', authData.user.id).single();

    if (userError || !userData) {
      showToast('Account verified but no role found. Contact your administrator.', 'warning');
      setLoading(false);
      return;
    }

    if (userData.role === 'librarian') navigate('/librarian/dashboard');
    else if (userData.role === 'student') navigate('/student/dashboard');
    else showToast(`Unrecognized role "${userData.role}". Contact your administrator.`, 'warning');

    setLoading(false);
  };

  return (
    <div style={wrapperStyle(isMobile)}>
      <style>{STYLES}</style>
      <Toast {...toast} onClose={closeToast} />

      {!isMobile && (
        <div style={leftPanelStyle}>
          <div style={patternOverlay} />
          <div style={leftContentStyle}>
            <img src={myLogo} alt="Logo" style={{ width: 64, marginBottom: 28, borderRadius: 16 }} />
            <h1 style={leftHeadingStyle}>ShelfMaster</h1>
            <p style={leftSubStyle}>The heart of your library — organized, efficient, and always within reach.</p>
            <div style={featuresListStyle}>
              {['Access thousands of titles', 'Real-time availability checks', 'Track your borrowing history'].map((f, i) => (
                <div key={i} style={featureItemStyle}>
                  <span style={checkStyle}>✓</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={rightPanelStyle(isMobile)}>
        {isMobile && (
          <div style={mobileHeaderStyle}>
            <img src={myLogo} alt="Logo" style={{ width: 52, marginBottom: 14, borderRadius: 12 }} />
            <h1 style={{ fontFamily: 'var(--ff-display)', fontSize: '2rem', fontWeight: 700, margin: 0 }}>ShelfMaster</h1>
            <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '.92rem', margin: '6px 0 0' }}>Welcome back</p>
          </div>
        )}

        <div style={formCardStyle(isMobile)}>
          <a href="#" onClick={handleBack} style={backLinkStyle}>← Back</a>
          {!isMobile && <img src={myLogo} alt="Logo" style={{ width: 56, display: 'block', margin: '0 auto 22px', borderRadius: 12 }} />}

          <h2 style={formTitleStyle(isMobile)}>Welcome Back</h2>
          <p style={formSubStyle(isMobile)}>Sign in to your ShelfMaster account</p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 6 }}>
            <div style={fieldGroup}>
              <label style={labelStyle}>Email Address</label>
              <input
                type="email"
                placeholder="janedoe@gmail.com"
                style={inputStyle}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="sm-input"
              />
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                style={inputStyle}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="sm-input"
              />
            </div>
            <button type="submit" disabled={loading} style={submitStyle}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {needsVerification && (
            <div style={verifyBannerStyle}>
              <p style={{ margin: 0, color: '#7a4f00', fontSize: '.88rem' }}>
                Didn't get the confirmation email?
              </p>
              <button type="button" onClick={handleResend} disabled={resending} style={resendBtnStyle}>
                {resending ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
          )}

          <p style={switchStyle(isMobile)}>
            Don't have an account?{' '}
            <Link to="/signup" style={{ color: 'var(--green)', fontWeight: 700, textDecoration: 'none' }}>
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

const STYLES = `
  .sm-input:focus {
    border-color: var(--maroon) !important;
    background: white !important;
    box-shadow: 0 0 0 3px rgba(123,31,31,.08) !important;
    outline: none;
  }
`;

const wrapperStyle = (isMobile) => ({
  display: 'flex',
  flexDirection: isMobile ? 'column' : 'row',
  height: '100vh', width: '100vw', overflow: 'hidden',
});

const leftPanelStyle = {
  flex: 1.2,
  background: 'linear-gradient(145deg, #7B1F1F 0%, #5A1515 100%)',
  position: 'relative', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  overflow: 'hidden',
};

const patternOverlay = {
  position: 'absolute', inset: 0,
  backgroundImage: `radial-gradient(circle at 20% 80%, rgba(255,255,255,.06) 0%, transparent 55%),
                    radial-gradient(circle at 80% 20%, rgba(255,255,255,.04) 0%, transparent 50%),
                    radial-gradient(circle at 50% 50%, rgba(212,168,67,.05) 0%, transparent 70%)`,
  zIndex: 0,
};

const leftContentStyle = { position: 'relative', zIndex: 1, padding: '60px', width: '100%' };

const leftHeadingStyle = {
  fontFamily: 'var(--ff-display)', color: 'white',
  fontSize: '3.2rem', fontWeight: 700, margin: '0 0 14px',
  letterSpacing: '-.02em', lineHeight: 1.1,
};

const leftSubStyle = {
  color: 'rgba(255,255,255,.75)', fontSize: '1.05rem',
  lineHeight: 1.7, margin: '0 0 40px', maxWidth: 340,
};

const featuresListStyle = { display: 'flex', flexDirection: 'column', gap: 12 };

const featureItemStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  fontSize: '.95rem', color: 'rgba(255,255,255,.82)',
};

const checkStyle = {
  width: 24, height: 24, borderRadius: '50%',
  background: 'rgba(255,255,255,.15)', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  color: '#D4A843', fontSize: '.8rem', fontWeight: 700, flexShrink: 0,
};

const mobileHeaderStyle = {
  background: 'linear-gradient(145deg, #7B1F1F 0%, #5A1515 100%)',
  padding: '44px 24px 36px', textAlign: 'center', color: 'white',
};

const rightPanelStyle = (isMobile) => ({
  flex: 1, background: 'var(--cream)',
  display: 'flex', flexDirection: 'column',
  justifyContent: isMobile ? 'flex-start' : 'center',
  alignItems: isMobile ? 'stretch' : 'center',
  overflowY: 'auto',
});

const formCardStyle = (isMobile) => ({
  width: '100%', maxWidth: isMobile ? '100%' : 420,
  padding: isMobile ? '32px 22px' : '36px 32px',
  background: isMobile ? 'transparent' : 'white',
  borderRadius: isMobile ? 0 : 20,
  boxShadow: isMobile ? 'none' : '0 8px 40px rgba(90,21,21,.1)',
});

const backLinkStyle = {
  display: 'inline-block', color: 'var(--maroon)',
  textDecoration: 'none', fontSize: '.83rem', fontWeight: 600,
  marginBottom: 22, opacity: .7,
};

const formTitleStyle = (isMobile) => ({
  fontFamily: 'var(--ff-display)',
  textAlign: 'center', color: 'var(--maroon)',
  margin: '0 0 6px',
  fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: 700,
  letterSpacing: '-.01em',
});

const formSubStyle = (isMobile) => ({
  textAlign: 'center', color: 'var(--text-muted)',
  margin: '0 0 26px', fontSize: isMobile ? '.84rem' : '.9rem',
});

const fieldGroup = { display: 'flex', flexDirection: 'column', gap: 6 };

const labelStyle = {
  fontSize: '.82rem', fontWeight: 600, color: 'var(--text-muted)',
};

const inputStyle = {
  padding: '12px 16px',
  border: '1.5px solid var(--border)',
  borderRadius: 10, fontSize: '.97rem',
  background: 'var(--cream)', outline: 'none',
  transition: 'border-color .2s, background .2s, box-shadow .2s',
  color: 'var(--text-main)', width: '100%',
};

const submitStyle = {
  background: 'var(--maroon)', color: 'white', padding: '14px',
  borderRadius: 10, border: 'none', fontWeight: 700, fontSize: '1rem',
  cursor: 'pointer', marginTop: 6, transition: 'background .2s, transform .15s',
  letterSpacing: '.02em',
};

const verifyBannerStyle = {
  marginTop: 14, padding: '14px 16px',
  background: '#FEF7E6', border: '1px solid #F5C97A',
  borderRadius: 10,
};

const resendBtnStyle = {
  marginTop: 10, background: 'var(--green)', color: 'white',
  border: 'none', padding: '9px 16px', borderRadius: 8,
  fontWeight: 700, cursor: 'pointer', fontSize: '.87rem',
};

const switchStyle = (isMobile) => ({
  color: 'var(--text-muted)', fontSize: isMobile ? '.84rem' : '.9rem',
  textAlign: 'center', marginTop: 22,
});
