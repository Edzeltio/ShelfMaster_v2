import React, { useState, useEffect } from 'react';
import StudentNavbar from './StudentNavbar';
import { localDb } from './localDbClient';
import Toast from './Toast';

export default function StudentProfile() {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', student_id: '', course_year: '' });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => { fetchUserProfile(); }, []);

  async function fetchUserProfile() {
    setLoading(true);
    const { data: { user } } = await localDb.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await localDb
      .from('users')
      .select('name, student_id, course_year, role, status')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Profile fetch error:', error);
    }

    if (data) {
      setUserData({ ...data, email: user.email });
    } else {
      setUserData({ name: user.email?.split('@')[0] || 'Student', email: user.email, student_id: '', course_year: '', role: 'student', status: 'active' });
    }
    setLoading(false);
  }

  function openEditModal() {
    setForm({ name: userData?.name || '', student_id: userData?.student_id || '', course_year: userData?.course_year || '' });
    setSaveMsg('');
    setShowModal(true);
  }

  const sanitizeText = (str) => str.replace(/<[^>]*>/g, '').trim();

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    const { data: { user } } = await localDb.auth.getUser();
    if (!user) { setSaving(false); return; }

    const cleanName = sanitizeText(form.name);
    const cleanStudentId = sanitizeText(form.student_id);
    const cleanCourseYear = sanitizeText(form.course_year);

    if (!cleanName) {
      setSaveMsg('Please enter a valid name without HTML tags.');
      setSaving(false);
      return;
    }

    const { data: saved, error } = await localDb
      .from('users')
      .update({ name: cleanName, student_id: cleanStudentId, course_year: cleanCourseYear })
      .eq('auth_id', user.id)
      .select('name, student_id, course_year')
      .maybeSingle();

    if (error) {
      console.error('Profile update error:', error);
      setSaveMsg('Error: ' + error.message);
    } else if (!saved) {
      console.warn('Profile update: no rows returned. Check that the users table row exists.');
      setSaveMsg('⚠️ Save failed: the database did not accept the change. Ask your admin to enable UPDATE access on the users table.');
    } else {
      setUserData(prev => ({ ...prev, name: cleanName, student_id: cleanStudentId, course_year: cleanCourseYear }));
      setSaveMsg('success');
      setTimeout(() => { setShowModal(false); setSaveMsg(''); }, 1000);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div style={{ background: 'var(--cream)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8' }}>Loading profile...</p>
      </div>
    );
  }

  const initials = (userData?.name || 'S').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const isActive = (userData?.status || 'active') === 'active';

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      <StudentNavbar />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>

        {/* ── Top Card ── */}
        <div style={topCardStyle}>
          {/* Banner */}
          <div style={bannerStyle} />

          {/* Avatar row */}
          <div style={avatarRowStyle}>
            <div style={avatarStyle}>{initials}</div>
            <button onClick={openEditModal} style={editBtnStyle}>✏️ Edit Profile</button>
          </div>

          {/* Name + meta */}
          <div style={{ padding: '0 32px 28px' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.6rem', color: '#1e293b' }}>
              {userData?.name || 'Student'}
            </h2>
            <p style={{ margin: '0 0 10px', color: '#64748b', fontSize: '0.92rem' }}>
              {userData?.email || '—'}
            </p>
            <span style={rolePillStyle}>{(userData?.role || 'student').toUpperCase()}</span>
          </div>
        </div>

        {/* ── Info Grid ── */}
        <div style={infoGridStyle}>
          <InfoCard icon="🪪" label="Student ID" value={userData?.student_id || '—'} />
          <InfoCard icon="🎓" label="Course & Year" value={userData?.course_year || '—'} />
          <InfoCard
            icon={isActive ? '✅' : '🚫'}
            label="Account Status"
            value={
              <span style={{ color: isActive ? 'var(--green)' : '#ef4444', fontWeight: 700, textTransform: 'capitalize' }}>
                {userData?.status || 'Active'}
              </span>
            }
          />
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {showModal && (
        <div style={overlayStyle} onClick={() => setShowModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h3 style={{ margin: '0 0 2px', color: 'var(--maroon)', fontSize: '1.15rem' }}>Edit Profile</h3>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.82rem' }}>Update your personal information</p>
              </div>
              <button onClick={() => setShowModal(false)} style={closeBtnStyle}>✕</button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Field label="Full Name" placeholder="Your full name" value={form.name}
                onChange={v => setForm(p => ({ ...p, name: v }))} required />
              <Field label="Student ID" placeholder="e.g. 2024-0001" value={form.student_id}
                onChange={v => setForm(p => ({ ...p, student_id: v }))} />
              <Field label="Course & Year" placeholder="e.g. BSCS-2" value={form.course_year}
                onChange={v => setForm(p => ({ ...p, course_year: v }))} />

              {saveMsg && saveMsg !== 'success' && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#ef4444', textAlign: 'center' }}>{saveMsg}</p>
              )}
              {saveMsg === 'success' && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--green)', textAlign: 'center', fontWeight: 600 }}>
                  ✅ Saved successfully!
                </p>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button type="button" onClick={() => setShowModal(false)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" disabled={saving} style={saveBtnStyle}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon, label, value }) {
  return (
    <div style={infoCardStyle}>
      <div style={{ fontSize: '1.6rem', marginBottom: '10px' }}>{icon}</div>
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', color: '#1e293b', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, required }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        style={{
          padding: '11px 14px',
          borderRadius: '9px',
          border: '1.5px solid #e2e8f0',
          fontSize: '0.95rem',
          background: 'var(--cream)',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
          transition: 'border-color 0.2s',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--maroon)')}
        onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
      />
    </div>
  );
}

/* ─── Styles ─── */
const topCardStyle = {
  background: 'white',
  borderRadius: '18px',
  overflow: 'hidden',
  boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
  marginBottom: '24px',
};

const bannerStyle = {
  height: '120px',
  background: 'linear-gradient(135deg, var(--maroon) 0%, #b91c1c 100%)',
};

const avatarRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  padding: '0 32px',
  marginTop: '-50px',
  marginBottom: '16px',
};

const avatarStyle = {
  width: '96px',
  height: '96px',
  borderRadius: '50%',
  background: 'var(--maroon)',
  color: 'white',
  fontSize: '2rem',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '4px solid white',
  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  flexShrink: 0,
};

const editBtnStyle = {
  background: 'var(--maroon)',
  color: 'white',
  border: 'none',
  padding: '9px 20px',
  borderRadius: '10px',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
  marginBottom: '4px',
};

const rolePillStyle = {
  display: 'inline-block',
  background: '#F5FAE8',
  color: 'var(--green)',
  fontSize: '0.72rem',
  fontWeight: 700,
  padding: '4px 14px',
  borderRadius: '20px',
  letterSpacing: '0.6px',
};

const infoGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '16px',
};

const infoCardStyle = {
  background: 'white',
  borderRadius: '14px',
  padding: '24px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '20px',
};

const modalStyle = {
  background: 'white',
  borderRadius: '18px',
  padding: '32px',
  width: '100%',
  maxWidth: '440px',
  boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
};

const closeBtnStyle = {
  background: '#f1f5f9',
  border: 'none',
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  fontSize: '0.95rem',
  cursor: 'pointer',
  color: '#64748b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const cancelBtnStyle = {
  flex: 1,
  padding: '11px',
  borderRadius: '9px',
  border: '1.5px solid #e2e8f0',
  background: 'white',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: '0.92rem',
  color: '#475569',
};

const saveBtnStyle = {
  flex: 2,
  padding: '11px',
  borderRadius: '9px',
  border: 'none',
  background: 'var(--maroon)',
  color: 'white',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '0.92rem',
};
