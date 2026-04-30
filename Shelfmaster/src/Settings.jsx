import React, { useState, useEffect } from 'react';
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
    fine_per_day: 5
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    fetchContent();
  }, []);

  async function fetchContent() {
    setLoading(true);
    // Fetch the first row of settings
    const { data, error } = await localDb.from('site_content').select('*').limit(1).single();
    
    if (data) {
      setFormData(data);
    } else if (error && error.code !== 'PGRST116') {
      // Ignore the "no rows" error, but log others
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
      // Update existing row
      const { error: updateError } = await localDb
        .from('site_content')
        .update(formData)
        .eq('id', formData.id);
      error = updateError;
    } else {
      // Insert new row if table was empty
      const { error: insertError } = await localDb
        .from('site_content')
        .insert([{ ...formData, id: 1 }]);
      error = insertError;
    }

    if (error) {
      setMessage({ text: 'Error saving settings: ' + error.message, type: 'error' });
    } else {
      setMessage({ text: 'Website content updated successfully!', type: 'success' });
      fetchContent(); // Refresh to get the ID if it was an insert
    }
    
    setSaving(false);
    
    // Clear success message after 3 seconds
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // --- UI STYLES ---
  const cardStyle = {
    background: 'white', padding: '2rem', borderRadius: '12px', 
    boxShadow: '0 4px 10px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0', marginBottom: '2rem'
  };
  const labelStyle = { display: 'block', fontWeight: '600', marginBottom: '8px', color: 'var(--dark-blue)' };
  const inputStyle = { width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', marginBottom: '20px', fontFamily: 'inherit' };
  const textareaStyle = { ...inputStyle, minHeight: '120px', resize: 'vertical' };

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
        
        {/* HERO SECTION */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>Hero Section</h2>
          
          <label style={labelStyle}>Main Tagline / Headline</label>
          <input style={inputStyle} type="text" name="tagline" value={formData.tagline || ''} onChange={handleChange} placeholder="e.g. Master Every Shelf" />
          
          <label style={labelStyle}>Hero Banner Image URL</label>
          <input style={inputStyle} type="text" name="hero_banner_url" value={formData.hero_banner_url || ''} onChange={handleChange} placeholder="https://example.com/banner.jpg" />
        </div>

        {/* ABOUT US */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>About Us</h2>
          
          <label style={labelStyle}>About Us Text</label>
          <textarea style={textareaStyle} name="about_text" value={formData.about_text || ''} onChange={handleChange} placeholder="Describe the library..." />
          
          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Mission</label>
              <textarea style={{...textareaStyle, minHeight: '80px'}} name="mission" value={formData.mission || ''} onChange={handleChange} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Vision</label>
              <textarea style={{...textareaStyle, minHeight: '80px'}} name="vision" value={formData.vision || ''} onChange={handleChange} />
            </div>
          </div>
        </div>

        {/* CONTACT & FOOTER */}
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

        {/* LIBRARY POLICY */}
        <div style={cardStyle}>
          <h2 style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '10px', marginTop: 0, color: '#334155' }}>Library Policy</h2>

          <label style={labelStyle}>Overdue Fine Per Day (₱)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            step="0.01"
            name="fine_per_day"
            value={formData.fine_per_day ?? 5}
            onChange={(e) => setFormData({ ...formData, fine_per_day: e.target.value === '' ? '' : Number(e.target.value) })}
            placeholder="5"
          />
          <p style={{ marginTop: '-10px', marginBottom: '0', fontSize: '0.85rem', color: '#64748b' }}>
            Used by the librarian to compute fines on overdue returns.
          </p>
        </div>

        {/* SAVE BUTTON */}
        <div style={{ textAlign: 'right', marginBottom: '4rem' }}>
          <button 
            type="submit" 
            disabled={saving}
            style={{ 
              padding: '12px 30px', background: 'var(--maroon)', color: 'white', border: 'none', 
              borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '1.1rem', fontWeight: 'bold' 
            }}
          >
            {saving ? 'Saving Changes...' : 'Save All Settings'}
          </button>
        </div>

      </form>
    </div>
  );
}