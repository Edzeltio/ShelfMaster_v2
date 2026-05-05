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
    msg.includes('fines') ||
    msg.includes('fine_id') ||
    msg.includes('does not exist') ||
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
  const [archivedHistory, setArchivedHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [finePolicy, setFinePolicy] = useState({ fine_amount: 5, fine_increment_type: 'per_day' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  // fines is an array from the joined fines table (one-to-many, but logically one per return)
  const getFineAmount = (item) => {
    if (Array.isArray(item.fines) && item.fines.length > 0) {
      return Number(item.fines[0].amount) || 0;
    }
    // fallback to legacy snapshot column on the transaction row
    return item.fine_amount != null ? Number(item.fine_amount) : 0;
  };



  const computeFine = (dueDate) => {
    if (!dueDate) return 0;
    const ms = Date.now() - new Date(dueDate).getTime();
    if (ms <= 0) return 0;
    const units = finePolicy.fine_increment_type === 'per_hour'
      ? Math.ceil(ms / (60 * 60 * 1000))
      : Math.ceil(ms / (24 * 60 * 60 * 1000));
    return units * (finePolicy.fine_amount ?? 5);
  };



  useEffect(() => {
    fetchFinePolicy();
    fetchRecentGlobalHistory();
    fetchArchivedHistory();
    const onVisible = () => { if (!document.hidden) { fetchRecentGlobalHistory(); fetchArchivedHistory(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function fetchFinePolicy() {
    const { data } = await localDbAdmin
      .from('fine_policy')
      .select('fine_amount, fine_increment_type')
      .limit(1)
      .maybeSingle();
    if (data) {
      setFinePolicy({
        fine_amount: data.fine_amount ?? 5,
        fine_increment_type: data.fine_increment_type || 'per_day',
      });
    }
  }

  async function fetchRecentGlobalHistory() {
    setLoading(true);
    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id, status, borrow_date, due_date, return_date,
        users (name, student_id),
        books (title, accession_num),
        book_copies (accession_id, copy_number),
        fines (id, amount, status, overdue_days)
      `)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error && isMigrationError(error)) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, status, borrow_date, due_date, return_date, fine_amount, users (name, student_id), books (title, accession_num)')
        .neq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(50));
    }
    if (error) console.error(error);
    setRecentGlobalHistory(data || []);
    setLoading(false);
  }

  async function fetchArchivedHistory() {
    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id, status, borrow_date, due_date, return_date,
        users (name, student_id),
        books (title, accession_num),
        book_copies (accession_id, copy_number),
        fines (id, amount, status, overdue_days)
      `)
      .eq('status', 'archived')
      .order('created_at', { ascending: false });

    if (error && isMigrationError(error)) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, status, borrow_date, due_date, return_date, fine_amount, users (name, student_id), books (title, accession_num)')
        .eq('status', 'archived')
        .order('created_at', { ascending: false }));
    }
    if (error) console.error(error);
    setArchivedHistory(data || []);
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
      .select('id, name, student_id, course_year, role')
      .ilike('name', `%${searchQuery}%`)
      .in('role', ['student', 'teacher'])
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
        book_copies (accession_id, copy_number),
        fines (id, amount, status, overdue_days)
      `)
      .eq('user_id', student.id)
      .order('created_at', { ascending: false });

    if (error && isMigrationError(error)) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, status, borrow_date, due_date, return_date, fine_amount, books (title, accession_num)')
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

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (rows) => {
    if (rows.every(r => selectedIds.has(r.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map(r => r.id)));
    }
  };

  const handleArchiveSelected = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`Archive ${selectedIds.size} record(s)? They will be moved to the Archived tab.`);
    if (!confirmed) return;
    setActionLoading(true);
    let failed = 0;
    for (const id of selectedIds) {
      const { error } = await localDbAdmin.from('transactions').update({ status: 'archived' }).eq('id', id);
      if (error) failed++;
    }
    setSelectedIds(new Set());
    await fetchRecentGlobalHistory();
    await fetchArchivedHistory();
    setActionLoading(false);
    if (failed > 0) showToast(`${failed} record(s) failed to archive.`, 'error');
    else showToast(`${selectedIds.size || 'Selected'} record(s) archived successfully.`, 'success');
  };

  const handleUnarchiveSelected = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`Restore ${selectedIds.size} record(s) back to active history?`);
    if (!confirmed) return;
    setActionLoading(true);
    let failed = 0;
    for (const id of selectedIds) {
      const { error } = await localDbAdmin.from('transactions').update({ status: 'returned' }).eq('id', id);
      if (error) failed++;
    }
    setSelectedIds(new Set());
    await fetchRecentGlobalHistory();
    await fetchArchivedHistory();
    setActionLoading(false);
    if (failed > 0) showToast(`${failed} record(s) failed to restore.`, 'error');
    else showToast('Records restored successfully.', 'success');
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`Permanently delete ${selectedIds.size} record(s)? This cannot be undone.`);
    if (!confirmed) return;
    setActionLoading(true);
    let failed = 0;
    for (const id of selectedIds) {
      const { error } = await localDbAdmin.from('transactions').delete().eq('id', id);
      if (error) failed++;
    }
    setSelectedIds(new Set());
    await fetchArchivedHistory();
    setActionLoading(false);
    if (failed > 0) showToast(`${failed} record(s) failed to delete.`, 'error');
    else showToast('Records permanently deleted.', 'success');
  };

  const getDisplayData = () => {
    const base = selectedStudent ? history : recentGlobalHistory;
    if (activeFilter === 'all') return base;
    if (activeFilter === 'active') return base.filter(i => i.status === 'borrowed');
    if (activeFilter === 'returned') return base.filter(i => i.status === 'returned');
    if (activeFilter === 'overdue') return base.filter(i => isOverdue(i));
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

      const tableColumn = ['Student', 'Book', 'Copy / Accession ID', 'Status', 'Due Date', 'Overdue', 'Fine (₱)'];
      const tableRows = data.map(item => {
        const overdue = isOverdue(item);
        const fineAmt = getFineAmount(item);
        const estFine = overdue ? computeFine(item.due_date).toFixed(2) : '—';
        return [
          item.users?.name || selectedStudent?.name || 'Unknown',
          item.books?.title || 'Untitled',
          item.book_copies?.accession_id
            ? `${item.book_copies.accession_id} (Copy #${item.book_copies.copy_number})`
            : item.books?.accession_num || '—',
          item.status?.toUpperCase() || '-',
          item.due_date ? new Date(item.due_date).toLocaleDateString() : '—',
          overdue ? 'YES' : 'NO',
          fineAmt > 0 ? `₱${fineAmt.toFixed(2)}` : (overdue ? `~₱${estFine}` : '—'),
        ];
      });

      autoTable(doc, { startY: 35, head: [tableColumn], body: tableRows, theme: 'grid', headStyles: { fillColor: [30, 58, 138] } });
      doc.save(fileName);
      showToast('PDF exported successfully.', 'success');
    } catch (err) {
      console.error('PDF Export failed:', err);
      showToast('Failed to generate PDF. Please try again.', 'error');
    }
  };

  const downloadCSV = (data, fileName) => {
    try {
      const headers = ['Student', 'Student ID', 'Book Title', 'Accession ID', 'Copy #', 'Status', 'Borrow Date', 'Due Date', 'Return Date', 'Overdue', 'Fine (PHP)'];
      const escape = (val) => {
        const str = val == null ? '' : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      };
      const rows = data.map(item => {
        const overdue = isOverdue(item);
        const fineAmt = getFineAmount(item);
        const estFine = overdue && fineAmt === 0 ? computeFine(item.due_date).toFixed(2) : '';
        return [
          item.users?.name || selectedStudent?.name || '',
          item.users?.student_id || '',
          item.books?.title || '',
          item.book_copies?.accession_id || item.books?.accession_num || '',
          item.book_copies?.copy_number || '',
          item.status || '',
          item.borrow_date ? new Date(item.borrow_date).toLocaleDateString() : '',
          item.due_date ? new Date(item.due_date).toLocaleDateString() : '',
          item.return_date ? new Date(item.return_date).toLocaleDateString() : '',
          overdue ? 'YES' : 'NO',
          fineAmt > 0 ? fineAmt.toFixed(2) : (estFine || ''),
        ].map(escape).join(',');
      });
      const csv = [headers.map(escape).join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      showToast('CSV exported successfully.', 'success');
    } catch (err) {
      console.error('CSV Export failed:', err);
      showToast('Failed to export CSV. Please try again.', 'error');
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

      {/* SEARCH BAR — only on active tab */}
      {activeTab === 'active' && (
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Search student or teacher to view specific report..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1', boxSizing: 'border-box', outline: 'none' }}
          />
          {students.length > 0 && (
            <div style={{ position: 'absolute', width: '100%', background: 'white', border: '1px solid #ddd', zIndex: 100, borderRadius: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
              {students.map(s => (
                <div key={s.id} onClick={() => fetchHistory(s)} style={{ padding: '12px', cursor: 'pointer', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{s.name} {s.student_id ? `(${s.student_id})` : ''}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: s.role === 'teacher' ? '#FFF0F5' : '#F5FAE8', color: s.role === 'teacher' ? 'var(--maroon)' : 'var(--green)' }}>
                    {s.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TABS */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '24px', borderBottom: '2px solid #e2e8f0' }}>
        {[
          { key: 'active', label: '📋 Active History', count: recentGlobalHistory.length },
          { key: 'archived', label: '🗄️ Archived', count: archivedHistory.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setSelectedIds(new Set()); setActiveFilter('all'); }}
            style={{
              padding: '10px 28px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '0.95rem',
              color: activeTab === t.key ? 'var(--maroon)' : '#94a3b8',
              borderBottom: activeTab === t.key ? '3px solid var(--maroon)' : '3px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
            }}
          >
            {t.label}
            <span style={{ marginLeft: '6px', background: activeTab === t.key ? '#FFF0F0' : '#f1f5f9', color: activeTab === t.key ? 'var(--maroon)' : '#94a3b8', borderRadius: '10px', padding: '1px 8px', fontSize: '0.8rem' }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ACTIVE HISTORY TAB */}
      {activeTab === 'active' && (
        <>
          {/* FILTER TABS */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {[
              { key: 'all', label: 'All' },
              { key: 'active', label: '📖 Active Loans' },
              { key: 'returned', label: '✅ Returned' },
              { key: 'pending', label: '🕐 Pending' },
              { key: 'overdue', label: '⚠ Overdue' },
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>
                {selectedStudent ? `History for ${selectedStudent.name}` : 'Recent Library Activity'}
              </h2>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleArchiveSelected}
                    disabled={actionLoading}
                    style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                  >
                    🗄️ Archive {selectedIds.size} Selected
                  </button>
                )}
                {selectedStudent && (
                  <button
                    onClick={() => { setSelectedStudent(null); setActiveFilter('all'); setSelectedIds(new Set()); fetchRecentGlobalHistory(); }}
                    style={{ background: '#f1f5f9', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    ✕ Clear Filter
                  </button>
                )}
                <button
                  onClick={() => {
                    const name = selectedStudent ? selectedStudent.name : 'Library';
                    const fileName = selectedStudent ? `${name}_History.csv` : 'Library_Activity.csv';
                    downloadCSV(displayData, fileName);
                  }}
                  style={{ background: '#16a34a', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Export CSV
                </button>
                <button
                  onClick={() => {
                    if (selectedStudent) {
                      downloadPDF(displayData, `History: ${selectedStudent.name}`, `${selectedStudent.name}_History.pdf`);
                    } else {
                      downloadPDF(displayData, 'Library Activity Report', 'Library_Activity.pdf');
                    }
                  }}
                  style={{ background: 'var(--maroon)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
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
                    <th style={{ padding: '12px', width: '36px' }}>
                      <input
                        type="checkbox"
                        checked={displayData.length > 0 && displayData.every(r => selectedIds.has(r.id))}
                        onChange={() => toggleSelectAll(displayData)}
                        style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                      />
                    </th>
                    {!selectedStudent && <th style={{ padding: '12px' }}>Student</th>}
                    <th style={{ padding: '12px' }}>Book Title</th>
                    <th style={{ padding: '12px' }}>Copy / Accession ID</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px' }}>Borrow Date</th>
                    <th style={{ padding: '12px' }}>Due Date</th>
                    <th style={{ padding: '12px' }}>Returned</th>
                    <th style={{ padding: '12px' }}>Fine (₱)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayData.map(item => {
                    const overdue = isOverdue(item);
                    const selected = selectedIds.has(item.id);
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc', backgroundColor: selected ? '#eff6ff' : overdue ? '#fff1f2' : 'transparent' }}>
                        <td style={{ padding: '12px' }}>
                          <input type="checkbox" checked={selected} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                        </td>
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
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>Copy #{item.book_copies.copy_number}</div>
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
                        <td style={{ padding: '12px' }}>
                          {(() => {
                            const fineAmt = getFineAmount(item);
                            if (fineAmt > 0) return <span style={{ color: '#dc2626', fontWeight: 700 }}>₱{fineAmt.toFixed(2)}</span>;
                            if (overdue) return <span style={{ color: '#e11d48', fontSize: '0.78rem', fontStyle: 'italic' }}>~₱{computeFine(item.due_date).toFixed(2)}</span>;
                            return <span style={{ color: '#94a3b8' }}>—</span>;
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ARCHIVED TAB */}
      {activeTab === 'archived' && (
        <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ margin: 0 }}>Archived Records</h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>Restore records back to history, or permanently delete them.</p>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedIds.size > 0 && (
                <>
                  <button
                    onClick={handleUnarchiveSelected}
                    disabled={actionLoading}
                    style={{ background: '#dcfce7', color: '#059669', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                  >
                    ♻️ Restore {selectedIds.size} Selected
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    disabled={actionLoading}
                    style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                  >
                    🗑️ Delete {selectedIds.size} Selected
                  </button>
                </>
              )}
            </div>
          </div>

          {archivedHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🗄️</div>
              <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>No archived records</p>
              <p style={{ fontSize: '0.85rem' }}>Records you archive from the Active History tab will appear here.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9', color: '#64748b', background: '#fafafa' }}>
                  <th style={{ padding: '12px', width: '36px' }}>
                    <input
                      type="checkbox"
                      checked={archivedHistory.length > 0 && archivedHistory.every(r => selectedIds.has(r.id))}
                      onChange={() => toggleSelectAll(archivedHistory)}
                      style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                    />
                  </th>
                  <th style={{ padding: '12px' }}>Student</th>
                  <th style={{ padding: '12px' }}>Book Title</th>
                  <th style={{ padding: '12px' }}>Copy / Accession ID</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Borrow Date</th>
                  <th style={{ padding: '12px' }}>Returned</th>
                  <th style={{ padding: '12px' }}>Fine (₱)</th>
                </tr>
              </thead>
              <tbody>
                {archivedHistory.map(item => {
                  const selected = selectedIds.has(item.id);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc', backgroundColor: selected ? '#eff6ff' : 'transparent' }}>
                      <td style={{ padding: '12px' }}>
                        <input type="checkbox" checked={selected} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                      </td>
                      <td style={{ padding: '12px' }}>{item.users?.name || '—'}</td>
                      <td style={{ padding: '12px' }}>{item.books?.title || '—'}</td>
                      <td style={{ padding: '12px' }}>
                        {item.book_copies?.accession_id ? (
                          <div>
                            <code style={{ background: '#eef2ff', color: '#6366f1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                              {item.book_copies.accession_id}
                            </code>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>Copy #{item.book_copies.copy_number}</div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{item.books?.accession_num || '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', background: '#f1f5f9', color: '#64748b' }}>
                          ARCHIVED
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#475569' }}>
                        {item.borrow_date ? new Date(item.borrow_date).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '12px', color: '#475569' }}>
                        {item.return_date ? new Date(item.return_date).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {(() => {
                          const fineAmt = getFineAmount(item);
                          if (fineAmt > 0) return <span style={{ color: '#dc2626', fontWeight: 700 }}>₱{fineAmt.toFixed(2)}</span>;
                          return <span style={{ color: '#94a3b8' }}>—</span>;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}