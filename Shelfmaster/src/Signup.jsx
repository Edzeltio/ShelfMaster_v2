import React, { useState } from 'react';
import { localDb } from './localDbClient';
import { useNavigate, Link } from 'react-router-dom';
import myLogo from './assets/logo.png';
import Toast from './Toast';
import { useResponsive } from './useResponsive';

const LRN_PATTERN = /^\d{12}$/;

export default function Signup() {
  const [formData, setFormData] = useState({
    email: '', password: '', name: '', lrn: '', grade_section: '', role: 'student'
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const showToast = (message, type = 'success') => setToast({ message, type });

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
      showToast('All fields are required.', 'warning'); setLoading(false); return;
    }
    if (!LRN_PATTERN.test(cleanLrn)) {
      showToast('LRN must be exactly 12 digits.', 'warning'); setLoading(false); return;
    }
    if (formData.password.length < 6) {
      showToast('Password must be at least 6 characters long.', 'warning'); setLoading(false); return;
    }

    try {
      const signupResult = await localDb.auth.signUp({ email: cleanEmail, password: formData.password });
      if (signupResult.error) throw signupResult.error;
      const authUser = signupResult.data?.user;
      if (!authUser) throw new Error('Signup failed unexpectedly.');

      const { error: profileError } = await localDb.from('users').insert([{
        auth_id: authUser.id, name: cleanName,
        student_id: cleanLrn, lrn: cleanLrn,
        grade_section: cleanGradeSection, course_year: cleanGradeSection,
        role: formData.role, status: 'active'
      }]);
      if (profileError) throw profileError;

      if (signupResult.verified) {
        showToast('Account created! You can sign in now.', 'success');
        setTimeout(() => navigate('/login'), 1200);
      } else {
        showToast('Account created — check your email to confirm before signing in.', 'success');
        if (signupResult.verifyUrl) console.log('[verify] Open this URL to confirm:', signupResult.verifyUrl);
        setTimeout(() => navigate('/login'), 1800);
      }
    } catch (err) {
      showToast('Error: ' + (err.message || 'Could not create account.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  return (
    <div style={wrapperStyle(isMobile)}>
      <style>{STYLES}</style>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />

      {!isMobile && (
        <div style={leftPanelStyle}>
          <div style={patternOverlay} />
          <div style={leftContentStyle}>
            <img src={myLogo} alt="Logo" style={{ width: 64, marginBottom: 28, borderRadius: 16 }} />
            <h1 style={leftHeadingStyle}>Join ShelfMaster</h1>
            <p style={leftSubStyle}>Create your account and start exploring our library collection today.</p>
            <div style={featuresListStyle}>
              {['Access thousands of titles', 'Real-time availability checks', 'Automated due-date reminders'].map((f, i) => (
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
            <h1 style={{ fontFamily: 'var(--ff-display)', fontSize: '1.9rem', fontWeight: 700, margin: 0 }}>Join ShelfMaster</h1>
            <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '.9rem', margin: '6px 0 0' }}>Create your account now</p>
          </div>
        )}

        <div style={formCardStyle(isMobile)}>
          <a href="#" onClick={handleBack} style={backLinkStyle}>← Back</a>
          {!isMobile && <img src={myLogo} alt="Logo" style={{ width: 54, display: 'block', margin: '0 auto 20px', borderRadius: 12 }} />}

          <h2 style={formTitleStyle(isMobile)}>Create Account</h2>
          <p style={formSubStyle(isMobile)}>Fill in your details to register</p>

          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 13 }}>
            <div style={fieldGroup}>
              <label style={labelStyle}>Full Name</label>
              <input type="text" name="name" placeholder="Juan Dela Cruz"
                style={inputStyle} value={formData.name} onChange={handleChange} required className="sm-input" />
            </div>

            <div style={{ display: 'flex', gap: isMobile ? 8 : 12, flexDirection: isMobile ? 'column' : 'row' }}>
              <div style={{ flex: 1, ...fieldGroup }}>
                <label style={labelStyle}>LRN (12 digits)</label>
                <input type="text" name="lrn" placeholder="123456789012"
                  inputMode="numeric" pattern="\d{12}" maxLength={12}
                  title="LRN must be exactly 12 digits"
                  style={inputStyle} value={formData.lrn} onChange={handleChange} required className="sm-input" />
              </div>
              <div style={{ flex: 1, ...fieldGroup }}>
                <label style={labelStyle}>Grade & Section / Strand</label>
                <input type="text" name="grade_section" placeholder="Grade 11 - STEM"
                  style={inputStyle} value={formData.grade_section} onChange={handleChange} required className="sm-input" />
              </div>
            </div>

            <div style={fieldGroup}>
              <label style={labelStyle}>Email Address</label>
              <input type="email" name="email" placeholder="email@example.com"
                style={inputStyle} value={formData.email} onChange={handleChange} required className="sm-input" />
            </div>

            <div style={fieldGroup}>
              <label style={labelStyle}>Password</label>
              <input type="password" name="password" placeholder="••••••••"
                style={inputStyle} value={formData.password} onChange={handleChange} required minLength={6} className="sm-input" />
            </div>

            <button type="submit" disabled={loading} style={submitStyle}>
              {loading ? 'Creating Account…' : 'Sign Up'}
            </button>
          </form>

          <p style={switchStyle(isMobile)}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--green)', fontWeight: 700, textDecoration: 'none' }}>
              Sign In
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

const wrapperStyle = (isMobile) => ({ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100vh', width: '100vw', overflow: 'hidden' });
const leftPanelStyle = { flex: 1.2, background: 'linear-gradient(145deg, #7B1F1F 0%, #5A1515 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
const patternOverlay = { position: 'absolute', inset: 0, backgroundImage: `radial-gradient(circle at 20% 80%, rgba(255,255,255,.06) 0%, transparent 55%), radial-gradient(circle at 80% 20%, rgba(255,255,255,.04) 0%, transparent 50%)`, zIndex: 0 };
const leftContentStyle = { position: 'relative', zIndex: 1, padding: '60px', width: '100%' };
const leftHeadingStyle = { fontFamily: 'var(--ff-display)', color: 'white', fontSize: '3rem', fontWeight: 700, margin: '0 0 14px', letterSpacing: '-.02em', lineHeight: 1.1 };
const leftSubStyle = { color: 'rgba(255,255,255,.75)', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 40px', maxWidth: 340 };
const featuresListStyle = { display: 'flex', flexDirection: 'column', gap: 12 };
const featureItemStyle = { display: 'flex', alignItems: 'center', gap: 12, fontSize: '.95rem', color: 'rgba(255,255,255,.82)' };
const checkStyle = { width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#D4A843', fontSize: '.8rem', fontWeight: 700, flexShrink: 0 };
const mobileHeaderStyle = { background: 'linear-gradient(145deg, #7B1F1F 0%, #5A1515 100%)', padding: '44px 24px 36px', textAlign: 'center', color: 'white' };
const rightPanelStyle = (isMobile) => ({ flex: 1, background: 'var(--cream)', display: 'flex', flexDirection: 'column', justifyContent: isMobile ? 'flex-start' : 'center', alignItems: isMobile ? 'stretch' : 'center', overflowY: 'auto' });
const formCardStyle = (isMobile) => ({ width: '100%', maxWidth: isMobile ? '100%' : 460, padding: isMobile ? '32px 22px' : '36px 32px', background: isMobile ? 'transparent' : 'white', borderRadius: isMobile ? 0 : 20, boxShadow: isMobile ? 'none' : '0 8px 40px rgba(90,21,21,.1)' });
const backLinkStyle = { display: 'inline-block', color: 'var(--maroon)', textDecoration: 'none', fontSize: '.83rem', fontWeight: 600, marginBottom: 22, opacity: .7, cursor: 'pointer' };
const formTitleStyle = (isMobile) => ({ fontFamily: 'var(--ff-display)', textAlign: 'center', color: 'var(--maroon)', margin: '0 0 6px', fontSize: isMobile ? '1.45rem' : '1.7rem', fontWeight: 700, letterSpacing: '-.01em' });
const formSubStyle = (isMobile) => ({ textAlign: 'center', color: 'var(--text-muted)', margin: '0 0 22px', fontSize: isMobile ? '.84rem' : '.9rem' });
const fieldGroup = { display: 'flex', flexDirection: 'column', gap: 5 };
const labelStyle = { fontSize: '.82rem', fontWeight: 600, color: 'var(--text-muted)' };
const inputStyle = { padding: '12px 16px', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: '.95rem', background: 'var(--cream)', outline: 'none', transition: 'border-color .2s, background .2s, box-shadow .2s', color: 'var(--text-main)', width: '100%' };
const submitStyle = { background: 'var(--maroon)', color: 'white', padding: '14px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', marginTop: 6, transition: 'background .2s, transform .15s', letterSpacing: '.02em' };
const switchStyle = (isMobile) => ({ color: 'var(--text-muted)', fontSize: isMobile ? '.84rem' : '.9rem', textAlign: 'center', marginTop: 20 });
