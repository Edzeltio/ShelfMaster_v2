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
      .from('users')
      .select('role')
      .eq('auth_id', authData.user.id)
      .single();

    if (userError || !userData) {
      showToast('Account verified but no role found. Contact your administrator.', 'warning');
      setLoading(false);
      return;
    }

    if (userData.role === 'librarian') {
      navigate('/librarian/dashboard');
    } else if (userData.role === 'student') {
      navigate('/student/dashboard');
    } else {
      showToast(`Unrecognized role "${userData.role}". Contact your administrator.`, 'warning');
    }

    setLoading(false);
  };

  return (
    <div style={getWrapperStyle(isMobile)}>
      <Toast {...toast} onClose={closeToast} />

      {/* LEFT PANEL - Hidden on Mobile */}
      {!isMobile && (
        <div style={leftPanelStyle}>
          <div style={overlayStyle}></div>
          <div style={leftContentStyle}>
            <img src={myLogo} alt="Logo" style={{ width: '70px', marginBottom: '20px' }} />
            <h1 style={{ color: 'white', fontSize: '3rem', fontWeight: '800', margin: 0 }}>ShelfMaster</h1>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '1.1rem', marginTop: '12px', lineHeight: '1.6' }}>
              The heart of your library.
            </p>
            <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.95rem', color: 'rgba(255,255,255,0.8)' }}>
              <span>✅ Access thousands of titles</span>
              <span>✅ Real-time availability checks</span>
              <span>✅ Track your borrowing history</span>
            </div>
          </div>
        </div>
      )}

      {/* RIGHT PANEL */}
      <div style={getRightPanelStyle(isMobile)}>
        {/* Mobile Header */}
        {isMobile && (
          <div style={{ background: 'linear-gradient(135deg, var(--maroon) 0%, #6B0D0D 100%)', padding: '40px 20px', textAlign: 'center', color: 'white' }}>
            <img src={myLogo} alt="Logo" style={{ width: '60px', marginBottom: '16px' }} />
            <h1 style={{ fontSize: '2rem', fontWeight: '800', margin: 0, marginBottom: '8px' }}>ShelfMaster</h1>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', margin: 0 }}>The heart of your library.</p>
          </div>
        )}
        
        <div style={getFormCardStyle(isMobile)}>
          <a href="#" onClick={handleBack} style={homeLinkStyle}>← Back</a>
          {!isMobile && <img src={myLogo} alt="Logo" style={logoStyle} />}

          <h2 style={{ textAlign: 'center', color: 'var(--maroon)', marginBottom: '6px', fontSize: isMobile ? '1.35rem' : '1.6rem', fontWeight: '800' }}>
            Welcome Back
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '28px', fontSize: isMobile ? '0.85rem' : '0.9rem' }}>
            Sign in to your ShelfMaster account
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Email Address</label>
              <input
                type="email"
                placeholder="janedoe@gmail.com"
                style={inputStyle}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                style={inputStyle}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={loading} style={buttonStyle}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {needsVerification && (
            <div style={{ marginTop: '14px', padding: '12px 14px', background: '#FEF7E6', border: '1px solid #F5C97A', borderRadius: '10px' }}>
              <p style={{ margin: 0, color: '#7a4f00', fontSize: '0.9rem' }}>
                Didn’t get the confirmation email?
              </p>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                style={{ marginTop: '8px', background: 'var(--green)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              >
                {resending ? 'Sending...' : 'Resend verification email'}
              </button>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <p style={{ color: '#64748b', fontSize: isMobile ? '0.85rem' : '0.9rem' }}>
              Don't have an account?{' '}
              <Link to="/signup" style={{ color: 'var(--green)', fontWeight: '700', textDecoration: 'none' }}>
                Sign Up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const getWrapperStyle = (isMobile) => ({
  display: 'flex',
  flexDirection: isMobile ? 'column' : 'row',
  height: '100vh',
  width: '100vw',
  overflow: 'hidden'
});

const leftPanelStyle = { 
  flex: '1.2', 
  background: 'linear-gradient(135deg, var(--maroon) 0%, #6B0D0D 100%)', 
  position: 'relative', 
  display: 'flex', 
  alignItems: 'center', 
  justifyContent: 'center' 
};

const overlayStyle = { 
  position: 'absolute', 
  top: 0, 
  left: 0, 
  width: '100%', 
  height: '100%', 
  backgroundImage: "url('/library.png')", 
  backgroundSize: 'cover', 
  backgroundPosition: 'center', 
  opacity: 0.08, 
  zIndex: 1 
};

const leftContentStyle = { 
  position: 'relative', 
  zIndex: 2, 
  padding: '60px', 
  width: '100%' 
};

const getRightPanelStyle = (isMobile) => ({
  flex: '1',
  background: 'var(--cream)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: isMobile ? 'flex-start' : 'center',
  alignItems: isMobile ? 'stretch' : 'center',
  overflowY: 'auto'
});

const getFormCardStyle = (isMobile) => ({
  width: '100%',
  maxWidth: isMobile ? '100%' : '400px',
  padding: isMobile ? '32px 20px' : '20px',
  background: isMobile ? 'transparent' : 'white',
  borderRadius: isMobile ? '0' : '20px',
  boxShadow: isMobile ? 'none' : '0 10px 40px rgba(0,0,0,0.08)',
  position: 'relative'
});

const homeLinkStyle = { 
  display: 'inline-block', 
  color: 'var(--maroon)', 
  textDecoration: 'none', 
  fontSize: '0.85rem', 
  fontWeight: '600', 
  marginBottom: '20px', 
  opacity: 0.7 
};

const logoStyle = { 
  width: '64px', 
  margin: '0 auto 20px', 
  display: 'block' 
};

const inputGroupStyle = { 
  display: 'flex', 
  flexDirection: 'column', 
  gap: '6px' 
};

const labelStyle = { 
  fontSize: '0.85rem', 
  fontWeight: '600', 
  color: '#475569' 
};

const inputStyle = { 
  padding: '12px 16px', 
  borderRadius: '10px', 
  border: '1px solid #e2e8f0', 
  fontSize: '1rem', 
  background: 'white', 
  outline: 'none', 
  transition: 'border-color 0.2s' 
};

const buttonStyle = { 
  background: 'var(--maroon)', 
  color: 'white', 
  padding: '14px', 
  borderRadius: '10px', 
  border: 'none', 
  fontWeight: 'bold', 
  fontSize: '1rem', 
  cursor: 'pointer', 
  marginTop: '6px', 
  transition: 'background 0.2s' 
};
