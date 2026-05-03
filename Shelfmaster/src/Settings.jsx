import React, { useState, useEffect, useRef } from 'react';
import { localDb } from './localDbClient';

export default function Settings() {
  const [formData, setFormData] = useState({
    hero_banner_url: '',
    tagline: '',
    about_text: '',
    mission: '',
    vision: '',
    contact_email: '',
    contact_phone: '',
    contact_location: '',
    footer_text: '',
    // Fine policy
    fine_per_day: 5,
    fine_amount: 5,
    fine_increment_value: 1,        // how many days/hours per increment
    fine_increment_type: 'per_day', // 'per_day' | 'per_hour'
    // Borrow duration — FALLBACK ONLY.
    // Used when a borrower does not pick their own return date at request time.
    // Once a transaction already has a due_date set, that value takes priority
    // and these settings have no further effect on that transaction.
    borrow_duration_value: 7,
    borrow_duration_unit: 'days',   // 'days' | 'hours'
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [heroInputMode, setHeroInputMode] = useState('url');
  const [uploadPreview, setUploadPreview] = useState('');
  const fileRef = useRef(null);

  useEffect(() => { fetchContent(); }, []);

  async function fetchContent() {
    setLoading(true);
    const { data, error } = await localDb.from('site_content').select('*').limit(1).single();
    if (data) {
      setFormData(prev => ({ ...prev, ...data }));
      if (data.hero_banner_url?.startsWith('data:')) {
        setUploadPreview(data.hero_banner_url);
        setHeroInputMode('upload');
      }
    } else if (error && error.code !== 'PGRST116') {
      console.error(error);
    }
    setLoading(false);
  }

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: '', type: '' });

    let error;
    if (formData.id) {
      const { error: updateError } = await localDb
        .from('site_content')
        .update(formData)
        .eq('id', formData.id);
      error = updateError;
    } else {
      const { error: insertError } = await localDb
        .from('site_content')
        .insert([{ ...formData, id: 1 }]);
      error = insertError;
    }

    if (error) {
      setMessage({ text: 'Error saving settings: ' + error.message, type: 'error' });
    } else {
      setMessage({ text: 'Settings saved successfully!', type: 'success' });
      fetchContent();
    }

    setSaving(false);
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ text: 'Please select a valid image file.', type: 'error' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ text: 'Image must be under 2 MB.', type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setUploadPreview(dataUrl);
      setFormData(prev => ({ ...prev, hero_banner_url: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  // ── Derived fine preview values ───────────────────────────────────────────
  const fineAmount     = Number(formData.fine_amount ?? formData.fine_per_day ?? 5);
  const incrValue      = Math.max(1, Number(formData.fine_increment_value ?? 1));
  const incrType       = formData.fine_increment_type || 'per_day';
  const incrUnitLabel  = incrType === 'per_hour' ? 'hour' : 'day';
  const incrUnitPlural = incrType === 'per_hour' ? 'hours' : 'days';

  // ── Styles ────────────────────────────────────────────────────────────────
  const cardStyle = {
    background: 'white', padding: '2rem', borderRadius: '12px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0', marginBottom: '2rem'
  };
  const labelStyle = { display: 'block', fontWeight: '600', marginBottom: '8px', color: 'var(--dark-blue)' };
  const inputStyle = { width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', marginBottom: '20px', fontFamily: 'inherit' };
  const textareaStyle = { ...inputStyle, minHeight: '120px', resize: 'vertical' };
  const toggleBtnStyle = (active) => ({
    padding: '6px 16px', borderRadius: '6px', border: '1.5px solid',
    borderColor: active ? 'var(--maroon)' : '#cbd5e1',
    background: active ? 'var(--maroon)' : 'white',
    color: active ? 'white' : '#475569',
    fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
  });

  if (loading) return <div style={{ padding: '2rem' }}>Loading settings...</div>;

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--dark-blue)', margin: 0 }}>Site Settings</h1>
          <p style={{ color: '#64748b', marginTop: '5px' }}>Manage the content displayed on the public Home page.</p>
        </div>
        {message.text && (
          <div style={{ padding: '10px 20px', borderRadius: '6px', backgroundColor: message.type === 'success' ? '#dcfce7' : '#fee2e2', color: message.type === 'success' ? '#166534' : '#991b1b', fontWeight: 'bold' }}>
            {message.text}
          </div>
        )}
      </div>

      <form onSubmit={handleSave}>

        {/* ── HERO SECTION ── */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>Hero Section</h2>

          <label style={labelStyle}>Main Tagline / Headline</label>
          <input style={inputStyle} type="text" name="tagline" value={formData.tagline || ''} onChange={handleChange} placeholder="e.g. Master Every Shelf" />

          <label style={labelStyle}>Hero Banner Image</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button type="button" style={toggleBtnStyle(heroInputMode === 'url')} onClick={() => setHeroInputMode('url')}>🔗 Use URL</button>
            <button type="button" style={toggleBtnStyle(heroInputMode === 'upload')} onClick={() => setHeroInputMode('upload')}>📁 Upload Image</button>
          </div>

          {heroInputMode === 'url' ? (
            <input style={inputStyle} type="text" name="hero_banner_url"
              value={formData.hero_banner_url?.startsWith('data:') ? '' : (formData.hero_banner_url || '')}
              onChange={handleChange} placeholder="https://example.com/banner.jpg" />
          ) : (
            <div style={{ marginBottom: '20px' }}>
              <div
                onClick={() => fileRef.current?.click()}
                style={{ border: '2px dashed #cbd5e1', borderRadius: '10px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc', transition: 'border-color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--maroon)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#cbd5e1')}
              >
                {uploadPreview
                  ? <img src={uploadPreview} alt="Preview" style={{ maxHeight: '160px', maxWidth: '100%', borderRadius: '8px', objectFit: 'cover' }} />
                  : <><div style={{ fontSize: '2rem', marginBottom: '8px' }}>🖼️</div><p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Click to select an image (max 2 MB)</p></>
                }
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
              {uploadPreview && (
                <button type="button"
                  onClick={() => { setUploadPreview(''); setFormData(prev => ({ ...prev, hero_banner_url: '' })); if (fileRef.current) fileRef.current.value = ''; }}
                  style={{ marginTop: '8px', background: 'none', border: '1px solid #fca5a5', color: '#ef4444', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Remove image
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── ABOUT US ── */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>About Us</h2>
          <label style={labelStyle}>About Us Text</label>
          <textarea style={textareaStyle} name="about_text" value={formData.about_text || ''} onChange={handleChange} placeholder="Describe the library..." />
          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Mission</label>
              <textarea style={{ ...textareaStyle, minHeight: '80px' }} name="mission" value={formData.mission || ''} onChange={handleChange} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Vision</label>
              <textarea style={{ ...textareaStyle, minHeight: '80px' }} name="vision" value={formData.vision || ''} onChange={handleChange} />
            </div>
          </div>
        </div>

        {/* ── CONTACT & FOOTER ── */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>Contact & Footer</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <label style={labelStyle}>Contact Email</label>
              <input style={inputStyle} type="email" name="contact_email" value={formData.contact_email || ''} onChange={handleChange} />
            </div>
            <div>
              <label style={labelStyle}>Phone Number</label>
              <input style={inputStyle} type="text" name="contact_phone" value={formData.contact_phone || ''} onChange={handleChange} />
            </div>
          </div>
          <label style={labelStyle}>Physical Location</label>
          <input style={inputStyle} type="text" name="contact_location" value={formData.contact_location || ''} onChange={handleChange} />
          <label style={labelStyle}>Footer Copyright Text</label>
          <input style={inputStyle} type="text" name="footer_text" value={formData.footer_text || ''} onChange={handleChange} />
        </div>

        {/* ── LIBRARY POLICY & FINES ── */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>Library Policy & Fines</h2>

          {/* BORROW DURATION */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 4px 0', color: '#334155', fontSize: '1rem' }}>📅 Default Borrow Duration</h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.83rem', color: '#64748b' }}>
              Fallback loan period used only when a borrower does not select their own return date at request time.
              If a transaction already has a <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: '3px', fontSize: '0.8rem' }}>due_date</code> set,
              that value takes priority and this setting has no effect on that transaction.
            </p>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 150px' }}>
                <label style={{ ...labelStyle, marginBottom: '6px', fontSize: '0.82rem' }}>Amount</label>
                <input
                  style={{ ...inputStyle, marginBottom: 0 }}
                  type="number" min="1" step="1" name="borrow_duration_value"
                  value={formData.borrow_duration_value ?? 7}
                  onChange={(e) => setFormData({ ...formData, borrow_duration_value: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="7"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, marginBottom: '6px', fontSize: '0.82rem' }}>Unit</label>
                <select style={{ ...inputStyle, marginBottom: 0, cursor: 'pointer' }} name="borrow_duration_unit" value={formData.borrow_duration_unit || 'days'} onChange={handleChange}>
                  <option value="days">Days</option>
                  <option value="hours">Hours</option>
                </select>
              </div>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '0.79rem', color: '#94a3b8' }}>
              Example: <strong>7 days</strong> → book is due 7 days after it is borrowed (if no due date was chosen). Fines start after this period.
            </p>
          </div>

          {/* OVERDUE FINE POLICY */}
          <div style={{ background: '#fff8f8', border: '1px solid #fecaca', borderRadius: '10px', padding: '18px 20px' }}>
            <h3 style={{ margin: '0 0 4px 0', color: '#991b1b', fontSize: '1rem' }}>💰 Overdue Fine Policy</h3>
            <p style={{ margin: '0 0 18px', fontSize: '0.83rem', color: '#64748b' }}>
              Set how much the fine is and how many days/hours must pass before each new charge is added.
            </p>

            {/* Visual rule builder */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
              background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: '10px',
              padding: '16px 18px', marginBottom: '16px',
            }}>
              <span style={{ fontWeight: 700, color: '#7f1d1d', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>Charge</span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#991b1b', fontWeight: 700 }}>₱</span>
                <input
                  type="number" min="0" step="0.01" name="fine_amount"
                  value={formData.fine_amount ?? formData.fine_per_day ?? 5}
                  onChange={(e) => setFormData({
                    ...formData,
                    fine_amount: e.target.value === '' ? '' : Number(e.target.value),
                    fine_per_day: e.target.value === '' ? '' : Number(e.target.value),
                  })}
                  placeholder="5"
                  style={{ width: '90px', padding: '8px 10px', border: '2px solid #fca5a5', borderRadius: '6px', fontWeight: 700, fontSize: '1rem', color: '#dc2626', textAlign: 'center', outline: 'none' }}
                />
              </div>

              <span style={{ fontWeight: 700, color: '#7f1d1d', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>once every</span>

              <input
                type="number" min="1" step="1" name="fine_increment_value"
                value={formData.fine_increment_value ?? 1}
                onChange={(e) => setFormData({ ...formData, fine_increment_value: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="1"
                style={{ width: '80px', padding: '8px 10px', border: '2px solid #fca5a5', borderRadius: '6px', fontWeight: 700, fontSize: '1rem', color: '#dc2626', textAlign: 'center', outline: 'none' }}
              />

              <select
                name="fine_increment_type"
                value={formData.fine_increment_type || 'per_day'}
                onChange={handleChange}
                style={{ padding: '8px 12px', border: '2px solid #fca5a5', borderRadius: '6px', fontWeight: 700, fontSize: '0.95rem', color: '#dc2626', cursor: 'pointer', outline: 'none', background: 'white' }}
              >
                <option value="per_day">day(s)</option>
                <option value="per_hour">hour(s)</option>
              </select>

              <span style={{ fontWeight: 700, color: '#7f1d1d', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>overdue</span>
            </div>
            
          </div>
        </div>

        {/* SAVE BUTTON */}
        <div style={{ textAlign: 'right', marginBottom: '4rem' }}>
          <button
            type="submit"
            disabled={saving}
            style={{ padding: '12px 30px', background: 'var(--maroon)', color: 'white', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '1.1rem', fontWeight: 'bold' }}
          >
            {saving ? 'Saving Changes...' : 'Save All Settings'}
          </button>
        </div>

      </form>
    </div>
  );
}