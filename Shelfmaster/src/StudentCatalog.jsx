import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { localDb } from './localDbClient';
import StudentNavbar from './StudentNavbar';
import Toast from './Toast';

export default function StudentCatalog() {
  const [searchParams] = useSearchParams();
  const [books, setBooks] = useState([]);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortBy, setSortBy] = useState('title-asc');
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState(null);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Borrow modal state
  const [borrowBook, setBorrowBook] = useState(null);
  const [borrowDueDate, setBorrowDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [activeLoansCount, setActiveLoansCount] = useState(0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const MAX_LOANS = 3;

  const openBorrowModal = async (book) => {
    setBorrowBook(book);
    const d = new Date(); d.setDate(d.getDate() + 7);
    setBorrowDueDate(d.toISOString().slice(0, 10));
    // Fetch current active loans count
    try {
      const { data: { user } } = await localDb.auth.getUser();
      if (user) {
        const { data: userData } = await localDb.from('users').select('id').eq('auth_id', user.id).single();
        if (userData) {
          const { count } = await localDb
            .from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userData.id)
            .in('status', ['borrowed', 'pending', 'approved', 'issued', 'active', 'loaned', 'checked_out']);
          setActiveLoansCount(count || 0);
        }
      }
    } catch {}
  };
  const closeBorrowModal = () => setBorrowBook(null);

  useEffect(() => {
    fetchBooks();
  }, []);

  async function fetchBooks() {
    setLoading(true);
    const { data, error } = await localDb.from('books').select('*').neq('status', 'archived');
    if (!error) setBooks((data || []).filter(b => b.book_type !== 'eBook'));
    setLoading(false);
  }

  const submitBorrow = async (e) => {
    e?.preventDefault?.();
    if (!borrowBook) return;
    const book = borrowBook;
    if (!borrowDueDate) { showToast('Please choose a return date.', 'warning'); return; }
    if (borrowDueDate < todayIso) { showToast('Return date cannot be in the past.', 'warning'); return; }
    if (activeLoansCount >= MAX_LOANS) {
      showToast(`You already have ${activeLoansCount} book(s) borrowed or pending. Maximum is ${MAX_LOANS}.`, 'warning');
      return;
    }

    setAddingId(book.id);
    try {
      const { data: { user } } = await localDb.auth.getUser();
      if (!user) { showToast('Please log in first.', 'warning'); return; }

      const { data: userData, error: userErr } = await localDb
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .single();
      if (userErr || !userData) {
        showToast('Could not identify your account. Try logging out and back in.', 'error');
        return;
      }

      // Re-check current loans count before inserting
      const { count: latestCount } = await localDb
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userData.id)
        .in('status', ['borrowed', 'pending', 'approved', 'issued', 'active', 'loaned', 'checked_out']);
      if ((latestCount || 0) >= MAX_LOANS) {
        showToast(`You already have ${latestCount} book(s) borrowed or pending. Maximum is ${MAX_LOANS}.`, 'warning');
        return;
      }

      // Block re-requesting if there's already a pending request for this book.
      const { data: existing } = await localDb
        .from('transactions')
        .select('id, status')
        .eq('user_id', userData.id)
        .eq('book_id', book.id)
        .in('status', ['pending'])
        .maybeSingle();
      if (existing) {
        showToast('You already have a pending request for this book — wait for the librarian.', 'warning');
        return;
      }

      const { error } = await localDb.from('transactions').insert([{
        user_id: userData.id,
        book_id: book.id,
        status: 'pending',
        due_date: borrowDueDate,
      }]);
      if (error) throw error;

      showToast(`"${book.title}" requested! Wait for librarian approval.`, 'success');
      closeBorrowModal();
    } catch (err) {
      showToast(err.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setAddingId(null);
    }
  };

  const getCategory = (book) => book.category || book.subject_class || 'General';

  const categories = ['All', ...new Set(books.map(getCategory))].sort();

  const filteredBooks = books
    .filter(book => {
      const s = searchTerm.toLowerCase();
      const cat = getCategory(book);
      const matchSearch =
        book.title?.toLowerCase().includes(s) ||
        book.authors?.toLowerCase().includes(s) ||
        cat.toLowerCase().includes(s);
      const matchCategory = categoryFilter === 'All' || cat === categoryFilter;
      return matchSearch && matchCategory;
    })
    .sort((a, b) => {
      if (sortBy === 'title-asc') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'title-desc') return (b.title || '').localeCompare(a.title || '');
      if (sortBy === 'available') return (b.quantity ?? 0) - (a.quantity ?? 0);
      return 0;
    });

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />
      <StudentNavbar />

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ color: 'var(--maroon)', margin: '0 0 6px 0' }}>Library Catalog</h2>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>Browse and request books from the collection</p>
        </div>

        {/* Filters Bar */}
        <div style={filtersBarStyle}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '2', minWidth: '220px' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              placeholder="Search title, author, or category..."
              style={searchInputStyle}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={selectStyle}
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={selectStyle}
          >
            <option value="title-asc">Title A → Z</option>
            <option value="title-desc">Title Z → A</option>
            <option value="available">Available First</option>
          </select>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', marginTop: '50px', color: '#64748b' }}>Loading books...</p>
        ) : (
          <>
            <p style={{ color: '#64748b', marginBottom: '20px', fontSize: '0.9rem' }}>
              Showing <strong>{filteredBooks.length}</strong> {filteredBooks.length === 1 ? 'book' : 'books'}
            </p>

            <div style={gridStyle}>
              {filteredBooks.length > 0 ? (
                filteredBooks.map(book => {
                  const qty = book.quantity ?? 0;
                  const isAvailable = qty > 0;
                  return (
                    <div key={book.id} style={cardStyle}>
                      {/* Cover image */}
                      <div style={coverWrapStyle}>
                        {book.cover_image ? (
                          <img
                            src={book.cover_image}
                            alt={book.title}
                            style={coverImgStyle}
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          />
                        ) : null}
                        <div style={{
                          ...coverPlaceholderStyle,
                          display: book.cover_image ? 'none' : 'flex'
                        }}>
                          <span style={{ fontSize: '2.8rem', marginBottom: '6px' }}>📖</span>
                          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)', textAlign: 'center', padding: '0 10px', fontWeight: 600, lineHeight: 1.3 }}>
                            {book.title}
                          </span>
                        </div>
                        {/* Availability ribbon */}
                        <div style={{
                          position: 'absolute', top: '10px', right: '10px',
                          background: isAvailable ? 'var(--green)' : '#ef4444',
                          color: 'white', fontSize: '0.7rem', fontWeight: 700,
                          padding: '3px 8px', borderRadius: '20px',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
                        }}>
                          {isAvailable ? `${qty} left` : 'Out of stock'}
                        </div>
                      </div>

                      <div style={{ padding: '14px 16px 16px' }}>
                        <div style={categoryBadgeStyle}>{getCategory(book)}</div>
                        <h3 style={bookTitleStyle}>{book.title}</h3>
                        <p style={authorStyle}>by {book.authors}</p>
                        <div style={footerStyle}>
                          <span style={{ fontSize: '0.82rem', fontWeight: '600', color: isAvailable ? 'var(--green)' : '#ef4444' }}>
                            {isAvailable ? `✅ ${qty} Available` : '❌ Out of Stock'}
                          </span>
                          <button
                            disabled={!isAvailable || addingId === book.id}
                            onClick={() => openBorrowModal(book)}
                            style={{ ...buttonStyle, opacity: !isAvailable ? 0.4 : 1, cursor: !isAvailable ? 'not-allowed' : 'pointer' }}
                          >
                            {addingId === book.id ? '...' : 'Borrow'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px' }}>
                  <p style={{ fontSize: '1.1rem', color: '#94a3b8' }}>No books found matching your filters.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Borrow Modal */}
      {borrowBook && (
        <div style={modalOverlayStyle} onClick={closeBorrowModal}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, color: 'var(--maroon)', fontSize: '1.15rem' }}>Borrow Book</h3>
              <button onClick={closeBorrowModal} style={modalCloseStyle}>✕</button>
            </div>

            <div style={{ background: 'var(--cream)', padding: '12px 14px', borderRadius: 10, marginBottom: 16 }}>
              <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#1e293b' }}>{borrowBook.title}</p>
              <p style={{ margin: '0 0 4px', color: '#64748b', fontSize: '0.85rem' }}>by {borrowBook.authors}</p>
              <p style={{ margin: '0 0 0', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 700 }}>
                {borrowBook.quantity ?? 0} available
              </p>
              {borrowBook.description && (
                <p style={{ margin: '8px 0 0', color: '#475569', fontSize: '0.82rem', lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                  {borrowBook.description}
                </p>
              )}
            </div>

            {/* 3-book limit warning */}
            <div style={{ background: activeLoansCount >= MAX_LOANS ? '#fee2e2' : '#f0fdf4', borderRadius: 8, padding: '8px 12px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.82rem', color: activeLoansCount >= MAX_LOANS ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                {activeLoansCount >= MAX_LOANS
                  ? `⛔ You've reached the ${MAX_LOANS}-book limit. Return a book first.`
                  : `📚 ${activeLoansCount} of ${MAX_LOANS} books currently borrowed/pending`}
              </span>
            </div>

            <form onSubmit={submitBorrow} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={modalLabelStyle}>Return on or before</label>
                <input
                  type="date"
                  min={todayIso}
                  value={borrowDueDate}
                  onChange={(e) => setBorrowDueDate(e.target.value)}
                  style={modalInputStyle}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="button" onClick={closeBorrowModal} style={modalCancelStyle}>Cancel</button>
                <button type="submit" disabled={addingId === borrowBook.id || activeLoansCount >= MAX_LOANS} style={{ ...modalSubmitStyle, opacity: activeLoansCount >= MAX_LOANS ? 0.5 : 1, cursor: activeLoansCount >= MAX_LOANS ? 'not-allowed' : 'pointer' }}>
                  {addingId === borrowBook.id ? 'Submitting…' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const modalOverlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
};
const modalCardStyle = {
  background: 'white', borderRadius: 16, padding: '24px 22px', width: '100%',
  maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
};
const modalCloseStyle = {
  background: '#f1f5f9', border: 'none', width: 30, height: 30,
  borderRadius: 8, fontSize: '0.9rem', cursor: 'pointer', color: '#64748b',
};
const modalLabelStyle = { display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#475569', marginBottom: 6 };
const modalInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '11px 14px',
  borderRadius: 9, border: '1.5px solid #e2e8f0', fontSize: '0.95rem', background: 'var(--cream)', outline: 'none',
};
const modalCancelStyle = {
  flex: 1, padding: 11, borderRadius: 9, border: '1.5px solid #e2e8f0',
  background: 'white', fontWeight: 600, cursor: 'pointer', color: '#475569',
};
const modalSubmitStyle = {
  flex: 2, padding: 11, borderRadius: 9, border: 'none',
  background: 'var(--maroon)', color: 'white', fontWeight: 700, cursor: 'pointer',
};

const filtersBarStyle = {
  display: 'flex',
  gap: '12px',
  marginBottom: '20px',
  flexWrap: 'wrap',
  alignItems: 'center',
};

const searchInputStyle = {
  width: '100%',
  padding: '11px 14px 11px 42px',
  borderRadius: '10px',
  border: '1px solid #e2e8f0',
  fontSize: '0.95rem',
  background: 'white',
  boxSizing: 'border-box',
  outline: 'none',
};

const selectStyle = {
  padding: '11px 14px',
  borderRadius: '10px',
  border: '1px solid #e2e8f0',
  fontSize: '0.9rem',
  background: 'white',
  cursor: 'pointer',
  outline: 'none',
  minWidth: '160px',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
  gap: '22px',
};

const cardStyle = {
  background: 'white',
  borderRadius: '14px',
  boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const coverWrapStyle = {
  position: 'relative',
  width: '100%',
  height: '180px',
  overflow: 'hidden',
  flexShrink: 0,
};

const coverImgStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const coverPlaceholderStyle = {
  width: '100%',
  height: '100%',
  background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 40%, #1e3a5f 100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

const categoryBadgeStyle = {
  fontSize: '0.68rem',
  background: '#F5FAE8',
  color: 'var(--green)',
  padding: '4px 10px',
  borderRadius: '20px',
  fontWeight: 'bold',
  alignSelf: 'flex-start',
  marginBottom: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const bookTitleStyle = { fontSize: '1.05rem', color: '#1e293b', margin: '0 0 4px 0', fontWeight: '700' };
const authorStyle = { color: '#64748b', fontSize: '0.88rem', marginBottom: '16px', flexGrow: 1 };
const footerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '14px' };

const buttonStyle = {
  background: 'var(--green)',
  color: 'white',
  border: 'none',
  padding: '7px 16px',
  borderRadius: '8px',
  fontWeight: 'bold',
  fontSize: '0.85rem',
  transition: 'opacity 0.2s',
};
