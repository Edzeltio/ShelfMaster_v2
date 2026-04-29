import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import StudentNavbar from './StudentNavbar';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import { useResponsive } from './useResponsive';

export default function StudentHome() {
  const navigate = useNavigate();
  const { isMobile, isTablet } = useResponsive();
  const [userName, setUserName] = useState('');
  const [stats, setStats] = useState({ loans: 0, pending: 0 });
  const [popularBooks, setPopularBooks] = useState([]);
  const [popularLoading, setPopularLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await localDb.auth.getUser();
      if (!user) return;

      const [nameRes] = await Promise.all([
        localDb.from('users').select('id, name').eq('auth_id', user.id).single(),
      ]);
      if (nameRes.data?.name) setUserName(nameRes.data.name);
      const usersId = nameRes.data?.id;
      if (!usersId) return;

      const [loansRes, pendingRes] = await Promise.all([
        localDb.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', usersId).eq('status', 'borrowed'),
        localDb.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', usersId).eq('status', 'pending'),
      ]);

      setStats({
        loans: loansRes.count ?? 0,
        pending: pendingRes.count ?? 0,
      });
    }
    loadData();
    fetchPopularBooks();
  }, []);

  async function fetchPopularBooks() {
    setPopularLoading(true);
    // Pull all borrow/return transactions and count per book_id
    const { data: txns } = await localDbAdmin
      .from('transactions')
      .select('book_id')
      .in('status', ['borrowed', 'returned']);

    if (!txns || txns.length === 0) {
      // Fallback: show recently added books
      const { data: recent } = await localDbAdmin
        .from('books')
        .select('id, title, authors, cover_image, quantity, category, subject_class, book_type')
        .neq('status', 'archived')
        .neq('book_type', 'eBook')
        .order('created_at', { ascending: false })
        .limit(8);
      setPopularBooks((recent || []).map(b => ({ ...b, borrow_count: 0 })));
      setPopularLoading(false);
      return;
    }

    // Count borrows per book
    const countMap = {};
    for (const { book_id } of txns) {
      if (book_id) countMap[book_id] = (countMap[book_id] || 0) + 1;
    }

    // Sort by count, take top 8 IDs
    const topIds = Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    const { data: books } = await localDbAdmin
      .from('books')
      .select('id, title, authors, cover_image, quantity, category, subject_class, book_type')
      .in('id', topIds)
      .neq('status', 'archived')
      .neq('book_type', 'eBook');

    // Re-sort to match popularity order and attach count
    const sorted = topIds
      .map(id => {
        const book = (books || []).find(b => b.id === id);
        return book ? { ...book, borrow_count: countMap[id] } : null;
      })
      .filter(Boolean);

    setPopularBooks(sorted);
    setPopularLoading(false);
  }

  const handleBorrow = (book) => {
    navigate(`/student/catalog?search=${encodeURIComponent(book.title)}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      <StudentNavbar />

      {/* Hero */}
      <div style={{ background: 'var(--maroon)', padding: isMobile ? '40px 16px' : isTablet ? '50px 24px' : '60px 20px', textAlign: 'center', color: 'white' }}>
        <h1 style={{ fontSize: isMobile ? '1.75rem' : isTablet ? '2rem' : '2.5rem', marginBottom: '10px' }}>
          Welcome back{userName ? `, ${userName}` : ''}!
        </h1>
        <p style={{ opacity: 0.9, marginBottom: '25px', fontSize: isMobile ? '0.95rem' : '1rem' }}>What would you like to read today?</p>
        <button
          onClick={() => navigate('/student/catalog')}
          style={{ background: 'var(--yellow)', color: 'var(--maroon)', border: 'none', padding: isMobile ? '10px 20px' : '12px 26px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: isMobile ? '0.9rem' : '1rem' }}
        >
          Open Catalog →
        </button>
      </div>

      {/* Stat Cards */}
      <div style={{ maxWidth: '1200px', margin: isMobile ? '-30px auto 0' : '-40px auto 0', padding: isMobile ? '0 16px 24px' : '0 20px 48px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '16px' }}>
          <StatCard
            title="Active Loans"
            value={stats.loans}
            linkText="View Due Dates"
            color="var(--green)"
            onClick={() => navigate('/student/books')}
            isMobile={isMobile}
          />
          <StatCard
            title="Pending Requests"
            value={stats.pending}
            linkText="Check Status"
            color="var(--yellow)"
            textColor="var(--maroon)"
            onClick={() => navigate('/student/books')}
            isMobile={isMobile}
          />
          <StatCard
            title="Account"
            value="Profile Verified ✅"
            linkText="Update My Info"
            color="var(--maroon)"
            onClick={() => navigate('/student/profile')}
            isMobile={isMobile}
          />
        </div>
      </div>

      {/* Most Popular Books */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '0 16px 40px' : isTablet ? '0 24px 50px' : '0 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '16px', flexDirection: isMobile ? 'column' : 'row' }}>
          <div>
            <h2 style={{ color: 'var(--maroon)', margin: '0 0 4px 0', fontSize: isMobile ? '1.2rem' : isTablet ? '1.35rem' : '1.5rem' }}>🔥 Most Popular Books</h2>
            <p style={{ color: '#64748b', margin: 0, fontSize: isMobile ? '0.8rem' : '0.88rem' }}>Top titles borrowed by students</p>
          </div>
          <button
            onClick={() => navigate('/student/catalog')}
            style={{ background: 'none', border: '2px solid var(--maroon)', color: 'var(--maroon)', padding: '8px 18px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: isMobile ? '0.8rem' : '0.88rem', whiteSpace: 'nowrap' }}
          >
            View All →
          </button>
        </div>

        {popularLoading ? (
          <div style={{ display: 'flex', gap: '18px', overflow: 'hidden' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ minWidth: '180px', height: '280px', background: '#e2e8f0', borderRadius: '12px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : popularBooks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', background: 'white', borderRadius: '12px' }}>
            No borrowing history yet. Be the first to request a book!
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : isTablet ? 'repeat(3, 1fr)' : 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: isMobile ? '12px' : '18px',
          }}>
            {popularBooks.map((book, index) => {
              const isAvailable = (book.quantity ?? 0) > 0;
              const category = book.category || book.subject_class || 'General';
              return (
                <div key={book.id} style={{
                  background: 'white', borderRadius: '12px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  cursor: 'pointer',
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'; }}
                  onClick={() => handleBorrow(book)}
                >
                  {/* Cover */}
                  <div style={{ position: 'relative', height: '160px', background: '#f1f5f9', flexShrink: 0 }}>
                    {/* Rank badge */}
                    <div style={{
                      position: 'absolute', top: '8px', left: '8px', zIndex: 2,
                      background: index === 0 ? '#f59e0b' : index === 1 ? '#94a3b8' : index === 2 ? '#b45309' : 'rgba(0,0,0,0.45)',
                      color: 'white', fontWeight: 800, fontSize: '0.72rem',
                      padding: '3px 8px', borderRadius: '20px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
                    }}>
                      #{index + 1}
                    </div>

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
                      <span style={{ fontSize: '2rem', marginBottom: '4px' }}>📖</span>
                      <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontWeight: 600, lineHeight: 1.3 }}>
                        {book.title}
                      </span>
                    </div>

                    {/* Availability dot */}
                    <div style={{
                      position: 'absolute', bottom: '8px', right: '8px',
                      background: isAvailable ? 'var(--green)' : '#ef4444',
                      color: 'white', fontSize: '0.65rem', fontWeight: 700,
                      padding: '2px 7px', borderRadius: '20px'
                    }}>
                      {isAvailable ? 'Available' : 'Out of stock'}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '12px 12px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <p style={{ margin: '0 0 3px 0', fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.3,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {book.title}
                    </p>
                    <p style={{ margin: '0 0 10px 0', fontSize: '0.75rem', color: '#64748b',
                      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {book.authors || 'Unknown'}
                    </p>
                    <div style={{ marginTop: 'auto' }}>
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
                        📚 {book.borrow_count} {book.borrow_count === 1 ? 'borrow' : 'borrows'}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleBorrow(book); }}
                        disabled={!isAvailable}
                        style={{
                          width: '100%', padding: '7px 0',
                          background: isAvailable ? 'var(--green)' : '#e2e8f0',
                          color: isAvailable ? 'white' : '#94a3b8',
                          border: 'none', borderRadius: '7px',
                          fontWeight: 700, fontSize: '0.8rem',
                          cursor: isAvailable ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {isAvailable ? 'Borrow →' : 'Unavailable'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, linkText, color, textColor, onClick, isMobile }) {
  return (
    <div style={{ background: 'white', padding: isMobile ? '20px' : '25px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', borderLeft: `5px solid ${color}` }}>
      <h4 style={{ color: '#64748b', textTransform: 'uppercase', fontSize: isMobile ? '0.75rem' : '0.8rem', margin: '0 0 10px 0' }}>{title}</h4>
      <p style={{ fontSize: isMobile ? '1.25rem' : '1.5rem', fontWeight: 'bold', margin: '0 0 15px 0', color: '#1e293b' }}>{value}</p>
      <button
        onClick={onClick}
        style={{ background: 'none', border: 'none', padding: 0, color: textColor || color, textDecoration: 'none', fontSize: isMobile ? '0.85rem' : '0.9rem', fontWeight: '600', cursor: 'pointer' }}
      >
        {linkText} →
      </button>
    </div>
  );
}
