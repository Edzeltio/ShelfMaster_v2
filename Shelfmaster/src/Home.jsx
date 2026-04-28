import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';

export default function Home() {
  const navigate = useNavigate();
  const [content, setContent] = useState({});
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [booksLoading, setBooksLoading] = useState(true);
  const catalogRef = useRef(null);

  useEffect(() => {
    async function fetchSiteContent() {
      const { data, error } = await localDb
        .from('site_content')
        .select('*')
        .limit(1)
        .single();
      if (!error && data) setContent(data);
      setLoading(false);
    }
    fetchSiteContent();
    fetchBooks();
  }, []);

  async function fetchBooks() {
    setBooksLoading(true);
    const { data } = await localDbAdmin
      .from('books')
      .select('id, title, authors, cover_image, quantity, category, subject_class')
      .neq('status', 'archived')
      .order('title', { ascending: true });
    setBooks(data || []);
    setBooksLoading(false);
  }

  const filteredBooks = books.filter(book => {
    if (!searchTerm.trim()) return true;
    const s = searchTerm.toLowerCase();
    return (
      book.title?.toLowerCase().includes(s) ||
      book.authors?.toLowerCase().includes(s) ||
      (book.category || book.subject_class || '').toLowerCase().includes(s)
    );
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (catalogRef.current) {
      catalogRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (loading) return <div style={{ padding: '5rem', textAlign: 'center', fontSize: '1.2rem' }}>Loading ShelfMaster...</div>;

  return (
    <div className="home-container">

      {/* HERO SECTION */}
      <section className="hero-section" style={{
        backgroundImage: content.hero_banner_url ? `url(${content.hero_banner_url})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundBlendMode: content.hero_banner_url ? 'overlay' : 'normal',
        backgroundColor: content.hero_banner_url ? 'rgba(152, 4, 4, 0.85)' : 'var(--maroon)'
      }}>
        <div className="hero-content">
          <h1>{content.tagline || 'Master Every Shelf'}</h1>
          <Link to="/login" className="hero-btn">Try ShelfMaster →</Link>
        </div>

        <div style={{ width: '400px', height: '300px', background: 'rgba(255,255,255,0.1)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)' }}>
          [Hero Illustration]
        </div>

      </section>

      {/* SEARCH BAR SECTION */}
      <section className="search-section">
        <span className="search-section-label">Search the Collection</span>
        <form className="search-container" onSubmit={handleSearch}>
          <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search by title, author, or subject..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              if (catalogRef.current) {
                catalogRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            autoComplete="off"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
              aria-label="Clear search"
            >✕</button>
          )}
          <button className="search-btn" type="submit">Search</button>
        </form>
        <div className="search-chips">
          {['Mathematics', 'Science', 'Fiction', 'Programming', 'History', 'Philosophy'].map(tag => (
            <button
              key={tag}
              type="button"
              className="search-chip"
              onClick={() => {
                setSearchTerm(tag);
                if (catalogRef.current) catalogRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      {/* BOOK CATALOG */}
      <section ref={catalogRef} className="section-wrapper">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>
              {searchTerm ? `Results for "${searchTerm}"` : 'Browse Our Collection'}
            </h2>
            {!booksLoading && (
              <p style={{ color: '#64748b', margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'} found
                {searchTerm && ' — '}
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', color: 'var(--maroon)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                    Clear search
                  </button>
                )}
              </p>
            )}
          </div>
          <Link to="/login" style={{ background: 'var(--maroon)', color: 'white', padding: '9px 20px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem' }}>
            Sign in to Borrow →
          </Link>
        </div>

        {booksLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ height: '300px', background: '#e2e8f0', borderRadius: '14px' }} />
            ))}
          </div>
        ) : filteredBooks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📚</div>
            <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>No books matched "{searchTerm}"</p>
            <p style={{ fontSize: '0.9rem' }}>Try a different title, author name, or category.</p>
            <button onClick={() => setSearchTerm('')} style={{ marginTop: '12px', background: 'var(--maroon)', color: 'white', border: 'none', padding: '9px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              Show All Books
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
            {filteredBooks.map(book => {
              const isAvailable = (book.quantity ?? 0) > 0;
              const category = book.category || book.subject_class || 'General';
              return (
                <div
                  key={book.id}
                  style={{ background: 'white', borderRadius: '14px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'; }}
                  onClick={() => navigate('/login')}
                >
                  {/* Cover */}
                  <div style={{ position: 'relative', height: '180px', flexShrink: 0, overflow: 'hidden' }}>
                    {book.cover_image ? (
                      <img
                        src={book.cover_image}
                        alt={book.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                    ) : null}
                    <div style={{
                      width: '100%', height: '100%',
                      background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 40%, #1e3a5f 100%)',
                      display: book.cover_image ? 'none' : 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      padding: '12px', boxSizing: 'border-box'
                    }}>
                      <span style={{ fontSize: '2.5rem', marginBottom: '6px' }}>📖</span>
                      <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontWeight: 600, lineHeight: 1.3 }}>{book.title}</span>
                    </div>
                    {/* Availability badge */}
                    <div style={{
                      position: 'absolute', top: '8px', right: '8px',
                      background: isAvailable ? 'var(--green)' : '#ef4444',
                      color: 'white', fontSize: '0.65rem', fontWeight: 700,
                      padding: '3px 8px', borderRadius: '20px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
                    }}>
                      {isAvailable ? `${book.quantity} left` : 'Out of stock'}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.65rem', background: '#F5FAE8', color: 'var(--green)', padding: '2px 8px', borderRadius: '20px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', alignSelf: 'flex-start', marginBottom: '8px' }}>
                      {category}
                    </span>
                    <p style={{ margin: '0 0 4px 0', fontWeight: 700, fontSize: '0.9rem', color: '#1e293b', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {book.title}
                    </p>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.78rem', color: '#64748b', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {book.authors || 'Unknown Author'}
                    </p>
                    <Link
                      to="/login"
                      onClick={e => e.stopPropagation()}
                      style={{
                        marginTop: 'auto', textAlign: 'center', display: 'block',
                        padding: '7px 0',
                        background: isAvailable ? 'var(--green)' : '#e2e8f0',
                        color: isAvailable ? 'white' : '#94a3b8',
                        borderRadius: '8px', textDecoration: 'none',
                        fontWeight: 700, fontSize: '0.82rem',
                        pointerEvents: isAvailable ? 'auto' : 'none'
                      }}
                    >
                      {isAvailable ? 'Sign in to Borrow' : 'Unavailable'}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* FEATURED CATEGORIES */}
      <section className="section-wrapper">
        <h2 className="section-title">Featured Categories</h2>
        <div className="category-grid">
          {['General Reference', 'Academic & Textbooks', 'Thesis & Dissertations', 'Fiction & Literature', 'Special Collections'].map((cat, i) => (
            <div
              key={i}
              className="category-card"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setSearchTerm(cat);
                if (catalogRef.current) catalogRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📖</div>
              {cat}
              <div style={{ fontSize: '0.8rem', marginTop: '10px', fontWeight: 'normal' }}>Explore</div>
            </div>
          ))}
        </div>
      </section>

      {/* SYSTEM FEATURES & CONTACT */}
      <section className="section-wrapper" style={{ textAlign: 'center' }}>
        <h2 className="section-title">System Features</h2>
        <div className="features-grid">
          <div className="feature-card"><h3>Centralized Records</h3><p>All book details in one system.</p></div>
          <div className="feature-card"><h3>Faster Transactions</h3><p>Borrow and return instantly.</p></div>
          <div className="feature-card"><h3>Reports & Analytics</h3><p>Generate detailed PDF reports.</p></div>
          <div className="feature-card"><h3>Secure Access</h3><p>Role-based access control.</p></div>
        </div>

        <div className="contact-block">
          <div><strong>Email:</strong><br />{content.contact_email || 'ShelfMaster@wmsu.edu.ph'}</div>
          <div><strong>Phone:</strong><br />{content.contact_phone || '0912-345-6789'}</div>
          <div><strong>Location:</strong><br />{content.contact_location || 'Normal Road, Zamboanga City'}</div>
        </div>
      </section>

      {/* ABOUT US */}
      <section className="about-section">
        <div className="about-text">
          <h4 style={{ color: 'var(--green)', letterSpacing: '2px' }}>A BIT</h4>
          <h2 style={{ fontSize: '3rem', margin: '0 0 20px 0', color: 'var(--maroon)' }}>ABOUT US</h2>
          <p style={{ lineHeight: '1.8', color: '#555', marginBottom: '30px' }}>
            {content.about_text || 'ShelfMaster provides smart and reliable shelving solutions designed to help organize and maximize space efficiently. We focus on quality, functionality, and customer satisfaction.'}
          </p>
          {(content.mission || content.vision) && (
            <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
              {content.mission && (
                <div style={{ flex: 1, background: '#f8fafc', padding: '15px', borderRadius: '8px', borderLeft: '4px solid var(--green)' }}>
                  <strong style={{ color: 'var(--maroon)' }}>Mission:</strong>
                  <p style={{ fontSize: '0.9rem', margin: '5px 0 0 0', color: '#555' }}>{content.mission}</p>
                </div>
              )}
              {content.vision && (
                <div style={{ flex: 1, background: '#FFFDE7', padding: '15px', borderRadius: '8px', borderLeft: '4px solid var(--yellow)' }}>
                  <strong style={{ color: 'var(--maroon)' }}>Vision:</strong>
                  <p style={{ fontSize: '0.9rem', margin: '5px 0 0 0', color: '#555' }}>{content.vision}</p>
                </div>
              )}
            </div>
          )}
          <Link to="/login" className="btn-sign-in">EXPLORE MORE</Link>
        </div>
        <div className="about-images">
          <div style={{ height: '150px', background: '#ccc', borderRadius: '10px' }}></div>
          <div style={{ height: '150px', background: '#ccc', borderRadius: '10px' }}></div>
          <div style={{ height: '150px', background: '#ccc', borderRadius: '10px', gridColumn: 'span 2' }}></div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div>
          <h2 style={{ margin: '0 0 10px 0' }}>ShelfMaster Library</h2>
          <p style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
            {content.footer_text || '© 2026 ShelfMaster Library. All rights reserved.'}
          </p>
        </div>
        <div>
          <h4 style={{ color: 'var(--light-blue)' }}>Contact Information</h4>
          <p style={{ fontSize: '0.9rem' }}>{content.contact_email || 'ShelfMaster@wmsu.edu.ph'}</p>
          <p style={{ fontSize: '0.9rem' }}>{content.contact_phone || '0912-345-6789'}</p>
        </div>
        <div>
          <h4 style={{ color: 'var(--light-blue)' }}>Quick Links</h4>
          <Link to="/Signup" style={{ fontSize: '0.9rem', textDecoration: 'none', color: 'inherit' }}>Create Account</Link>
          <p style={{ fontSize: '0.9rem', cursor: 'pointer' }}>Borrow Book</p>
        </div>
        <div>
          <h4 style={{ color: 'var(--light-blue)' }}>Connect</h4>
        </div>
      </footer>
    </div>
  );
}
