import React, { useState, useEffect } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Toast from './Toast';

function isMigrationError(error) {
  if (!error) return false;
  const msg = error.message || '';
  return (
    msg.includes('book_copies') ||
    msg.includes('copy_id') ||
    msg.includes('schema cache') ||
    error.code === '42P01' ||
    error.code === 'PGRST200'
  );
}

export default function BorrowingHistory() {
  const [searchQuery, setSearchQuery] = useState('');
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [history, setHistory] = useState([]);
  const [recentGlobalHistory, setRecentGlobalHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    fetchRecentGlobalHistory();
    const onVisible = () => { if (!document.hidden) fetchRecentGlobalHistory(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function fetchRecentGlobalHistory() {
    setLoading(true);
    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id, status, borrow_date, due_date, return_date,
        users (name, student_id),
        books (title, accession_num),
        book_copies (accession_id, copy_number)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error && isMigrationError(error)) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, status, borrow_date, due_date, return_date, users (name, student_id), books (title, accession_num)')
        .order('created_at', { ascending: false })
        .limit(50));
    }
    if (error) console.error(error);
    setRecentGlobalHistory(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (searchQuery.length > 1) {
      searchStudents();
    } else {
      setStudents([]);
    }
  }, [searchQuery]);

  async function searchStudents() {
    const { data } = await localDb
      .from('users')
      .select('id, name, student_id, course_year')
      .ilike('name', `%${searchQuery}%`)
      .eq('role', 'student')
      .limit(5);
    setStudents(data || []);
  }

  async function fetchHistory(student) {
    setLoading(true);
    setSelectedStudent(student);
    setSearchQuery('');
    setStudents([]);

    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id, status, borrow_date, due_date, return_date,
        books (title, accession_num),
        book_copies (accession_id, copy_number)
      `)
      .eq('user_id', student.id)
      .order('created_at', { ascending: false });

    if (error && isMigrationError(error)) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, status, borrow_date, due_date, return_date, books (title, accession_num)')
        .eq('user_id', student.id)
        .order('created_at', { ascending: false }));
    }
    if (error) console.error(error);
    setHistory(data || []);
    setLoading(false);
  }

  const isOverdue = (item) => {
    if (item.status !== 'borrowed' || !item.due_date) return false;
    return new Date(item.due_date) < new Date();
  };

  const getDisplayData = () => {
    const base = selectedStudent ? history : recentGlobalHistory;
    if (activeFilter === 'all') return base;
    if (activeFilter === 'active') return base.filter(i => i.status === 'borrowed');
    if (activeFilter === 'returned') return base.filter(i => i.status === 'returned');
    if (activeFilter === 'pending') return base.filter(i => i.status === 'pending');
    return base;
  };

  const displayData = getDisplayData();
  const activeLoansCount = (selectedStudent ? history : recentGlobalHistory).filter(i => i.status === 'borrowed').length;

  const downloadPDF = (data, title, fileName) => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.setTextColor(30, 58, 138);
      doc.text(title, 14, 20);
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

      const tableColumn = ['Student', 'Book', 'Copy / Accession ID', 'Status', 'Due Date', 'Overdue'];
      const tableRows = data.map(item => [
        item.users?.name || selectedStudent?.name || 'Unknown',
        item.books?.title || 'Untitled',
        item.book_copies?.accession_id
          ? `${item.book_copies.accession_id} (Copy #${item.book_copies.copy_number})`
          : item.books?.accession_num || '—',
        item.status?.toUpperCase() || '-',
        item.due_date ? new Date(item.due_date).toLocaleDateString() : '—',
        isOverdue(item) ? 'YES' : 'NO'
      ]);

      autoTable(doc, { startY: 35, head: [tableColumn], body: tableRows, theme: 'grid', headStyles: { fillColor: [30, 58, 138] } });
      doc.save(fileName);
      showToast('PDF exported successfully.', 'success');
    } catch (err) {
      console.error('PDF Export failed:', err);
      showToast('Failed to generate PDF. Please try again.', 'error');
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ color: 'var(--dark-blue)', margin: 0 }}>Borrowing History</h1>
          <p style={{ color: '#64748b', margin: '4px 0 0' }}>View and export all borrowing activity.</p>
        </div>
        {activeLoansCount > 0 && (
          <div style={{ background: '#F5FAE8', border: '1px solid var(--green)', padding: '10px 18px', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'var(--green)' }}>{activeLoansCount}</div>
            <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '600' }}>Active Loans</div>
          </div>
        )}
      </div>

      {/* SEARCH BAR */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search student to view specific report..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1', boxSizing: 'border-box', outline: 'none' }}
        />
        {students.length > 0 && (
          <div style={{ position: 'absolute', width: '100%', background: 'white', border: '1px solid #ddd', zIndex: 100, borderRadius: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            {students.map(s => (
              <div key={s.id} onClick={() => fetchHistory(s)} style={{ padding: '12px', cursor: 'pointer', borderBottom: '1px solid #eee' }}>
                {s.name} ({s.student_id})
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FILTER TABS */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[
          { key: 'all', label: 'All' },
          { key: 'active', label: '📖 Active Loans' },
          { key: 'returned', label: '✅ Returned' },
          { key: 'pending', label: '🕐 Pending' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            style={{
              padding: '7px 16px', borderRadius: '8px', border: '1.5px solid',
              borderColor: activeFilter === f.key ? 'var(--maroon)' : '#e2e8f0',
              background: activeFilter === f.key ? 'var(--maroon)' : 'white',
              color: activeFilter === f.key ? 'white' : '#475569',
              fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer'
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', position: 'relative', zIndex: 50 }}>
          <h2 style={{ margin: 0 }}>
            {selectedStudent ? `History for ${selectedStudent.name}` : 'Recent Library Activity'}
          </h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {selectedStudent && (
              <button
                onClick={() => { setSelectedStudent(null); setActiveFilter('all'); fetchRecentGlobalHistory(); }}
                style={{ background: '#f1f5f9', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                ✕ Clear Filter
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (selectedStudent) {
                  downloadPDF(displayData, `History: ${selectedStudent.name}`, `${selectedStudent.name}_History.pdf`);
                } else {
                  downloadPDF(displayData, 'Library Activity Report', 'Library_Activity.pdf');
                }
              }}
              style={{ background: 'var(--maroon)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', pointerEvents: 'auto' }}
            >
              Export PDF
            </button>
          </div>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px' }}>Loading...</p>
        ) : displayData.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No records found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9', color: '#64748b' }}>
                {!selectedStudent && <th style={{ padding: '12px' }}>Student</th>}
                <th style={{ padding: '12px' }}>Book Title</th>
                <th style={{ padding: '12px' }}>Copy / Accession ID</th>
                <th style={{ padding: '12px' }}>Status</th>
                <th style={{ padding: '12px' }}>Borrow Date</th>
                <th style={{ padding: '12px' }}>Due Date</th>
                <th style={{ padding: '12px' }}>Returned</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map(item => {
                const overdue = isOverdue(item);
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc', backgroundColor: overdue ? '#fff1f2' : 'transparent' }}>
                    {!selectedStudent && <td style={{ padding: '12px' }}>{item.users?.name}</td>}
                    <td style={{ padding: '12px', fontWeight: overdue ? 'bold' : 'normal' }}>
                      {item.books?.title}
                      {overdue && <div style={{ color: '#e11d48', fontSize: '0.7rem' }}>⚠ OVERDUE</div>}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {item.book_copies?.accession_id ? (
                        <div>
                          <code style={{ background: '#eef2ff', color: '#6366f1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                            {item.book_copies.accession_id}
                          </code>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                            Copy #{item.book_copies.copy_number}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{item.books?.accession_num || '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{
                        padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold',
                        background: overdue ? '#e11d48' : item.status === 'returned' ? '#dcfce7' : item.status === 'borrowed' ? '#dbeafe' : '#F5FAE8',
                        color: overdue ? 'white' : item.status === 'returned' ? '#059669' : item.status === 'borrowed' ? '#1d4ed8' : 'var(--green)'
                      }}>
                        {overdue ? 'OVERDUE' : item.status?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px', color: '#475569' }}>
                      {item.borrow_date ? new Date(item.borrow_date).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '12px', color: overdue ? '#e11d48' : '#475569' }}>
                      {item.due_date ? new Date(item.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {item.return_date ? new Date(item.return_date).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
