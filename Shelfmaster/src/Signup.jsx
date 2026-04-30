import React, { useState } from 'react';
import { localDb } from './localDbClient';
import { useNavigate, Link } from 'react-router-dom';
import myLogo from './assets/logo.png';
import Toast from './Toast';
import { useResponsive } from './useResponsive';

const LRN_PATTERN = /^\d{12}$/;

export default function Signup() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    lrn: '',
    grade_section: '',
    role: 'student'
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Smart back: prefer browser history; fall back to home if there's no history.
  const handleBack = (e) => {
    e.preventDefault();
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const sanitizeText = (str) => str.replace(/<[^>]*>/g, '').trim();

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);

    const cleanName = sanitizeText(formData.name);
    const cleanLrn = sanitizeText(formData.lrn);
    const cleanGradeSection = sanitizeText(formData.grade_section);
    const cleanEmail = sanitizeText(formData.email).toLowerCase();

    if (!cleanName || !cleanLrn || !cleanGradeSection || !cleanEmail || !formData.password) {
      showToast('All fields are required.', 'warning');
      setLoading(false);
      return;
    }

    if (!LRN_PATTERN.test(cleanLrn)) {
      showToast('LRN must be exactly 12 digits.', 'warning');
      setLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      showToast('Password must be at least 6 characters long.', 'warning');
      setLoading(false);
      return;
    }

    try {
      const signupResult = await localDb.auth.signUp({
        email: cleanEmail,
        password: formData.password,
      });

      if (signupResult.error) throw signupResult.error;
      const authUser = signupResult.data?.user;
      if (!authUser) throw new Error('Signup failed unexpectedly.');

      // Create the matching profile row. `lrn` doubles as student_id for
      // back-compat (the old student_id column still exists).
      const { error: profileError } = await localDb
        .from('users')
        .insert([{
          auth_id: authUser.id,
          name: cleanName,
          student_id: cleanLrn,
          lrn: cleanLrn,
          grade_section: cleanGradeSection,
          course_year: cleanGradeSection, // keep legacy column populated
          role: formData.role,
          status: 'active'
        }]);

      if (profileError) throw profileError;

      if (signupResult.verified) {
        // First account ever — auto-verified, head straight to login.
        showToast('Account created! You can sign in now.', 'success');
        setTimeout(() => navigate('/login'), 1200);
      } else {
        showToast('Account created — check your email to confirm before signing in.', 'success');
        // In console-mailer mode we surface the link so dev can finish locally.
        if (signupResult.verifyUrl) {
          console.log('[verify] Open this URL to confirm:', signupResult.verifyUrl);
        }
        setTimeout(() => navigate('/login'), 1800);
      }
    } catch (err) {
      showToast('Error: ' + (err.message || 'Could not create account.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div style={getWrapperStyle(isMobile)}>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />

      {/* LEFT PANEL - Hidden on Mobile */}
      {!isMobile && (
        <div style={leftPanelStyle}>
          <div style={overlayStyle}></div>
          <div style={leftContentStyle}>
            <img src={myLogo} alt="Logo" style={{ width: '70px', marginBottom: '20px' }} />
            <h1 style={{ color: 'white', fontSize: '3rem', fontWeight: '800', margin: 0 }}>Join ShelfMaster</h1>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '1.1rem', marginTop: '12px', lineHeight: '1.6' }}>
              Create your account and start exploring our library.
            </p>
            <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.95rem', color: 'rgba(255,255,255,0.8)' }}>
              <span>✅ Access thousands of titles</span>
              <span>✅ Real-time availability checks</span>
              <span>✅ Automated due-date reminders</span>
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
            <h1 style={{ fontSize: '1.8rem', fontWeight: '800', margin: 0, marginBottom: '8px' }}>Join ShelfMaster</h1>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', margin: 0 }}>Create your account now</p>
          </div>
        )}

        <div style={getFormCardStyle(isMobile)}>
          <a href="#" onClick={handleBack} style={homeLinkStyle}>← Back</a>

          {!isMobile && <img src={myLogo} alt="Logo" style={logoStyle} />}

          <h2 style={{ textAlign: 'center', color: 'var(--maroon)', marginBottom: '6px', fontSize: isMobile ? '1.25rem' : '1.5rem', fontWeight: '800' }}>
            Create Account
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '24px', fontSize: isMobile ? '0.85rem' : '0.9rem' }}>
            Fill in your details to register
          </p>

          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '12px' : '14px' }}>
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Full Name</label>
              <input type="text" name="name" placeholder="Juan Dela Cruz" style={inputStyle} value={formData.name} onChange={handleChange} required />
            </div>

            <div style={getTwoColumnStyle(isMobile)}>
              <div style={{ flex: 1, minWidth: 0, ...inputGroupStyle }}>
                <label style={labelStyle}>LRN (12 digits)</label>
                <input
                  type="text"
                  name="lrn"
                  placeholder="123456789012"
                  inputMode="numeric"
                  pattern="\d{12}"
                  maxLength={12}
                  title="LRN must be exactly 12 digits"
                  style={inputStyle}
                  value={formData.lrn}
                  onChange={handleChange}
                  required
                />
              </div>
              <div style={{ flex: 1, minWidth: 0, ...inputGroupStyle }}>
                <label style={labelStyle}>Grade & Section/Strand</label>
                <input
                  type="text"
                  name="grade_section"
                  placeholder="Grade 11 - STEM"
                  style={inputStyle}
                  value={formData.grade_section}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div style={inputGroupStyle}>
              <label style={labelStyle}>Email Address</label>
              <input type="email" name="email" placeholder="email@example.com" style={inputStyle} value={formData.email} onChange={handleChange} required />
            </div>

            <div style={inputGroupStyle}>
              <label style={labelStyle}>Password</label>
              <input type="password" name="password" placeholder="••••••••" style={inputStyle} value={formData.password} onChange={handleChange} required minLength={6} />
            </div>

            <button type="submit" disabled={loading} style={buttonStyle}>
              {loading ? 'Creating Account...' : 'Sign Up'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <p style={{ color: '#64748b', fontSize: isMobile ? '0.85rem' : '0.9rem' }}>
              Already have an account?{' '}
              <Link to="/login" style={{ color: 'var(--green)', fontWeight: '700', textDecoration: 'none' }}>
                Sign In
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
  maxWidth: isMobile ? '100%' : '450px',
  padding: isMobile ? '32px 20px' : '20px',
  background: isMobile ? 'transparent' : 'white',
  borderRadius: isMobile ? '0' : '20px',
  boxShadow: isMobile ? 'none' : '0 10px 40px rgba(0,0,0,0.08)',
  position: 'relative'
});

const getTwoColumnStyle = (isMobile) => ({
  display: 'flex',
  gap: isMobile ? '8px' : '12px',
  flexDirection: isMobile ? 'column' : 'row'
});

const homeLinkStyle = {
  display: 'inline-block',
  color: 'var(--maroon)',
  textDecoration: 'none',
  fontSize: '0.85rem',
  fontWeight: '600',
  marginBottom: '20px',
  opacity: 0.7,
  cursor: 'pointer'
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
