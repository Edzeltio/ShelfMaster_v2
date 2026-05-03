import React, { useState, useEffect } from 'react';
import StudentNavbar from './StudentNavbar';
import { localDb } from './localDbClient';
import Toast from './Toast';

const LRN_PATTERN = /^\d{12}$/;
const GRADE_OPTIONS = [
  'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
];

function parseGradeSection(combined) {
  if (!combined) return { grade: '', section: '' };
  const sep = ' - ';
  const idx = combined.indexOf(sep);
  if (idx === -1) {
    // try to detect if it starts with Grade N
    const m = combined.match(/^(Grade\s+\d+)\s*(.*)?$/i);
    if (m) return { grade: m[1].trim(), section: m[2]?.trim() || '' };
    return { grade: '', section: combined.trim() };
  }
  return { grade: combined.slice(0, idx).trim(), section: combined.slice(idx + sep.length).trim() };
}

export default function StudentProfile() {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', lrn: '', grade: '', section: '' });
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
      .select('name, student_id, lrn, grade_section, course_year, role, status')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (error) console.error('Profile fetch error:', error);

    if (data) {
      setUserData({ ...data, email: user.email });
    } else {
      setUserData({ name: user.email?.split('@')[0] || 'Student', email: user.email, lrn: '', grade_section: '', role: 'student', status: 'active' });
    }
    setLoading(false);
  }

  function openEditModal() {
    const gs = userData?.grade_section || userData?.course_year || '';
    const { grade, section } = parseGradeSection(gs);
    setForm({
      name: userData?.name || '',
      lrn: userData?.lrn || userData?.student_id || '',
      grade,
      section,
    });
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
    const cleanLrn = sanitizeText(form.lrn);
    const cleanGrade = sanitizeText(form.grade);
    const cleanSection = sanitizeText(form.section);

    if (!cleanName || cleanName.length < 3) {
      setSaveMsg('Full name must be at least 3 characters.'); setSaving(false); return;
    }
    if (!cleanLrn) { setSaveMsg('LRN is required.'); setSaving(false); return; }
    if (!LRN_PATTERN.test(cleanLrn)) { setSaveMsg('LRN must be exactly 12 digits.'); setSaving(false); return; }
    if (!cleanGrade) { setSaveMsg('Please select a grade level.'); setSaving(false); return; }
    if (!cleanSection) { setSaveMsg('Section / Strand is required.'); setSaving(false); return; }

    const combined = `${cleanGrade} - ${cleanSection}`;

    const { data: saved, error } = await localDb
      .from('users')
      .update({
        name: cleanName,
        lrn: cleanLrn,
        student_id: cleanLrn,
        grade_section: combined,
        course_year: combined,
      })
      .eq('auth_id', user.id)
      .select('name, lrn, grade_section')
      .maybeSingle();

    if (error) {
      console.error('Profile update error:', error);
      setSaveMsg('Error: ' + error.message);
    } else if (!saved) {
      setSaveMsg('⚠️ Save failed: the database did not accept the change. Ask your admin to enable UPDATE access on the users table.');
    } else {
      setUserData(prev => ({
        ...prev,
        name: cleanName,
        lrn: cleanLrn,
        student_id: cleanLrn,
        grade_section: combined,
        course_year: combined,
      }));
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
      <Toast {...toast} onClose={() => setToast({ message: '' })} />
      <StudentNavbar />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>

        {/* ── Top Card ── */}
        <div style={topCardStyle}>
          <div style={bannerStyle} />
          <div style={avatarRowStyle}>
            <div style={avatarStyle}>{initials}</div>
            <button onClick={openEditModal} style={editBtnStyle}>✏️ Edit Profile</button>
          </div>
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
          <InfoCard icon="🪪" label="LRN" value={userData?.lrn || userData?.student_id || '—'} />
          <InfoCard icon="🎓" label="Grade Level" value={parseGradeSection(userData?.grade_section || userData?.course_year).grade || '—'} />
          <InfoCard icon="🏫" label="Section / Strand" value={parseGradeSection(userData?.grade_section || userData?.course_year).section || '—'} />
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
                onChange={v => setForm(p => ({ ...p, name: v }))} minLength={3} maxLength={80} required />

              <Field label="LRN (12 digits)" placeholder="123456789012" value={form.lrn}
                onChange={v => setForm(p => ({ ...p, lrn: v.replace(/\D/g, '').slice(0, 12) }))}
                inputMode="numeric" maxLength={12} required />

              {/* Grade + Section separated */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Grade Level</label>
                  <select
                    value={form.grade}
                    onChange={e => setForm(p => ({ ...p, grade: e.target.value }))}
                    required
                    style={selectFieldStyle}
                    onFocus={e => (e.target.style.borderColor = 'var(--maroon)')}
                    onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
                  >
                    <option value="">Select Grade</option>
                    {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Section / Strand</label>
                  <input
                    type="text"
                    placeholder="e.g. STEM or Rizal"
                    value={form.section}
                    onChange={e => setForm(p => ({ ...p, section: e.target.value }))}
                    required maxLength={50}
                    style={fieldInputStyle}
                    onFocus={e => (e.target.style.borderColor = 'var(--maroon)')}
                    onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
                  />
                </div>
              </div>

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

function Field({ label, placeholder, value, onChange, required, inputMode, maxLength, minLength }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>{label}</label>
      <input
        type="text" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        required={required} inputMode={inputMode} maxLength={maxLength} minLength={minLength}
        style={fieldInputStyle}
        onFocus={e => (e.target.style.borderColor = 'var(--maroon)')}
        onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
      />
    </div>
  );
}

/* ─── Styles ─── */
const topCardStyle = { background: 'white', borderRadius: '18px', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', marginBottom: '24px' };
const bannerStyle = { height: '120px', background: 'linear-gradient(135deg, var(--maroon) 0%, #b91c1c 100%)' };
const avatarRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '0 32px', marginTop: '-50px', marginBottom: '16px' };
const avatarStyle = { width: '96px', height: '96px', borderRadius: '50%', background: 'var(--maroon)', color: 'white', fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '4px solid white', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', flexShrink: 0 };
const editBtnStyle = { background: 'var(--maroon)', color: 'white', border: 'none', padding: '9px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', marginBottom: '4px' };
const rolePillStyle = { display: 'inline-block', background: '#F5FAE8', color: 'var(--green)', fontSize: '0.72rem', fontWeight: 700, padding: '4px 14px', borderRadius: '20px', letterSpacing: '0.6px' };
const infoGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' };
const infoCardStyle = { background: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' };
const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const modalStyle = { background: 'white', borderRadius: '18px', padding: '32px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' };
const closeBtnStyle = { background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: '#94a3b8', padding: '4px 8px' };
const cancelBtnStyle = { flex: 1, padding: '11px', borderRadius: '10px', border: '1.5px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' };
const saveBtnStyle = { flex: 2, padding: '11px', borderRadius: '10px', border: 'none', background: 'var(--maroon)', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' };
const fieldInputStyle = { padding: '11px 14px', borderRadius: '9px', border: '1.5px solid #e2e8f0', fontSize: '0.95rem', background: 'var(--cream)', outline: 'none', width: '100%', boxSizing: 'border-box', transition: 'border-color 0.2s' };
const selectFieldStyle = { ...fieldInputStyle, cursor: 'pointer' };
