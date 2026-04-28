import React, { useState, useEffect } from 'react';
import { localDb } from './localDbClient';
import StudentNavbar from './StudentNavbar';

export default function StudentEbooks() {
  const [ebooks, setEbooks] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEbooks();
  }, []);

  async function fetchEbooks() {
    setLoading(true);
    const { data, error } = await localDb
      .from('books')
      .select('*')
      .eq('book_type', 'eBook')
      .neq('status', 'archived');
    if (!error) setEbooks(data || []);
    setLoading(false);
  }

  const q = searchTerm.trim().toLowerCase();
  const filtered = q
    ? ebooks.filter(e =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.authors || '').toLowerCase().includes(q)
      )
    : ebooks;

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      <StudentNavbar />

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ color: 'var(--maroon)', margin: '0 0 6px 0' }}>📱 eBooks</h2>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
            Click any eBook to open the link in a new tab.
          </p>
        </div>

        <div style={{ marginBottom: '20px', position: 'relative', maxWidth: '480px' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            placeholder="Search eBooks by title or author..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '11px 14px 11px 42px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              fontSize: '0.95rem',
              background: 'white',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', marginTop: '50px', color: '#64748b' }}>Loading eBooks...</p>
        ) : filtered.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '12px', padding: '60px', textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📱</div>
            <p style={{ fontWeight: 'bold', marginBottom: '6px' }}>
              {ebooks.length === 0 ? 'No eBooks available yet' : `No eBooks match "${searchTerm}"`}
            </p>
            <p style={{ fontSize: '0.9rem' }}>
              {ebooks.length === 0 ? 'Check back later — new eBooks are added regularly.' : 'Try a different search term.'}
            </p>
          </div>
        ) : (
          <>
            <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '0.9rem' }}>
              Showing <strong>{filtered.length}</strong> {filtered.length === 1 ? 'eBook' : 'eBooks'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
              {filtered.map(ebook => {
                const url = ebook.source || '';
                return (
                  <a
                    key={ebook.id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: 'white',
                      borderRadius: '12px',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.05)'; }}
                  >
                    <div style={{
                      height: '160px',
                      background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '12px',
                      boxSizing: 'border-box',
                    }}>
                      <span style={{ fontSize: '2.6rem', marginBottom: '6px' }}>📱</span>
                      <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.9)', textAlign: 'center', fontWeight: 600, lineHeight: 1.3 }}>
                        eBook
                      </span>
                    </div>
                    <div style={{ padding: '14px 16px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <h3 style={{ fontSize: '1rem', color: '#1e293b', margin: '0 0 4px 0', fontWeight: 700, lineHeight: 1.3 }}>
                        {ebook.title}
                      </h3>
                      {ebook.authors && (
                        <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 14px 0' }}>
                          by {ebook.authors}
                        </p>
                      )}
                      <div style={{
                        marginTop: 'auto',
                        background: '#eef2ff',
                        color: '#6366f1',
                        textAlign: 'center',
                        padding: '8px 0',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                      }}>
                        Open Link ↗
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
