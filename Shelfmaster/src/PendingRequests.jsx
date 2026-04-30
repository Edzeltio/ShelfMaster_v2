import React, { useEffect, useState } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import { getBaseURL } from './connectionManager';
import Toast from './Toast';

const ACTIVE_STATUSES = ['borrowed', 'approved', 'issued', 'active', 'loaned', 'checked_out'];

// Fire-and-log helper so the librarian flow never blocks on email failures.
async function notifyUser({ user_id, type, title, body }) {
  if (!user_id) return;
  try {
    const base = getBaseURL();
    const session = JSON.parse(window.sessionStorage.getItem('shelfmaster-session') || 'null');
    await fetch((base || '').replace(/\/$/, '') + '/api/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ user_id, type, title, body }),
    });
  } catch (err) {
    console.warn('[notify] failed:', err.message);
  }
}

export default function PendingRequests() {
  const [activeTab, setActiveTab] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [activeLoans, setActiveLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [finePerDay, setFinePerDay] = useState(5);
  const showToast = (message, type = 'success') => setToast({ message, type });

  async function fetchFinePerDay() {
    const { data } = await localDbAdmin
      .from('site_content')
      .select('fine_per_day')
      .limit(1)
      .maybeSingle();
    if (data && data.fine_per_day != null) setFinePerDay(Number(data.fine_per_day));
  }

  useEffect(() => {
    // Clean up cache keys left over from the old status-probing logic.
    try {
      localStorage.removeItem('sm_approve_status');
      localStorage.removeItem('sm_decline_status');
    } catch {}
    fetchAll();
    const onVisible = () => { if (!document.hidden) fetchAll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchPendingRequests(), fetchActiveLoans(), fetchFinePerDay()]);
    setLoading(false);
  }

  async function fetchPendingRequests() {
    const { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id,
        created_at,
        status,
        user_id,
        book_id,
        due_date,
        users (name, student_id, lrn, grade_section, role),
        books (title, barcode, quantity)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      showToast('Failed to load pending requests.', 'error');
    } else {
      setRequests(data || []);
    }
  }

  async function fetchActiveLoans() {
    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id,
        status,
        borrow_date,
        due_date,
        user_id,
        book_id,
        users (name, student_id, role),
        books (title, accession_num),
        book_copies (accession_id, copy_number)
      `)
      .in('status', ACTIVE_STATUSES)
      .order('borrow_date', { ascending: true });

    if (error && (error.code === '42P01' || error.code === 'PGRST200' || error.message?.includes('book_copies'))) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select(`
          id,
          status,
          borrow_date,
          due_date,
          user_id,
          book_id,
          users (name, student_id, role),
          books (title, accession_num)
        `)
        .in('status', ACTIVE_STATUSES)
        .order('borrow_date', { ascending: true }));
    }

    if (error) {
      console.error(error);
    } else {
      setActiveLoans(data || []);
    }
  }

  const assignAvailableCopy = async (bookId) => {
    const { data: copy, error } = await localDbAdmin
      .from('book_copies')
      .select('id, accession_id, copy_number')
      .eq('book_id', bookId)
      .eq('status', 'available')
      .order('copy_number', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === '42P01') return null;
      throw new Error('Failed to find available copy: ' + error.message);
    }
    return copy || null;
  };

  const handleAction = async (req, isApprove) => {
    try {
      const transactionId = req.id;
      const bookId = req.book_id;
      const currentStock = req.books?.quantity ?? 0;
      const userRole = req.users?.role;
      const userId = req.user_id;
      const bookTitle = req.books?.title || 'your book';
      const isTeacher = userRole === 'teacher';

      if (isApprove) {
        if (currentStock <= 0) {
          showToast('No copies available to lend.', 'error');
          return;
        }

        // Honour the due date the student picked in the borrow modal; otherwise
        // fall back to the legacy 7-day default. Teachers stay open-ended.
        const dueDate = isTeacher
          ? null
          : (req.due_date
            ? new Date(req.due_date).toISOString()
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

        const copy = await assignAvailableCopy(bookId);

        if (copy) {
          const { error: copyUpdateError } = await localDbAdmin
            .from('book_copies')
            .update({ status: 'borrowed' })
            .eq('id', copy.id);
          if (copyUpdateError) throw copyUpdateError;
        }

        const { error: txError } = await localDbAdmin
          .from('transactions')
          .update({
            status: 'borrowed',
            borrow_date: new Date().toISOString(),
            due_date: dueDate,
            ...(copy ? { copy_id: copy.id } : {}),
          })
          .eq('id', transactionId);
        if (txError) throw txError;

        const { error: stockError } = await localDbAdmin
          .from('books')
          .update({ quantity: currentStock - 1 })
          .eq('id', bookId);
        if (stockError) throw stockError;

        const dueLabel = dueDate ? new Date(dueDate).toLocaleDateString() : 'no due date';
        showToast(
          copy
            ? `Copy ${copy.accession_id} approved (${dueLabel}).`
            : `Request approved (${dueLabel}).`,
          'success'
        );

        notifyUser({
          user_id: userId,
          type: 'borrow_approved',
          title: 'Your borrow request was approved',
          body: `"${bookTitle}" has been approved.\nReturn by: ${dueLabel}.`,
        });

      } else {
        const { error } = await localDbAdmin
          .from('transactions')
          .update({ status: 'declined' })
          .eq('id', transactionId);
        if (error) throw error;
        showToast('Request declined.', 'success');

        notifyUser({
          user_id: userId,
          type: 'borrow_declined',
          title: 'Your borrow request was declined',
          body: `Your request for "${bookTitle}" was declined by the librarian.`,
        });
      }

      fetchAll();
    } catch (error) {
      console.error('handleAction error:', error);
      showToast('Error: ' + error.message, 'error');
    }
  };

  const computeOverdueDays = (dueDate) => {
    if (!dueDate) return 0;
    const ms = Date.now() - new Date(dueDate).getTime();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  };

  const handleReturn = async (loan) => {
    try {
      const overdueDays = computeOverdueDays(loan.due_date);
      const suggested = (overdueDays * finePerDay).toFixed(2);
      let fineAmount = 0;

      if (overdueDays > 0) {
        const input = window.prompt(
          `This book is ${overdueDays} day(s) overdue.\n\nFine: ₱${finePerDay}/day → suggested ₱${suggested}\n\nEnter the fine amount to record (or 0 to waive):`,
          suggested
        );
        if (input === null) return; // cancelled
        const parsed = Number(input);
        if (!Number.isFinite(parsed) || parsed < 0) {
          showToast('Invalid fine amount.', 'error');
          return;
        }
        fineAmount = parsed;
      }

      const updates = {
        status: 'returned',
        return_date: new Date().toISOString(),
      };
      if (fineAmount > 0) updates.fine_amount = fineAmount;

      const { error: txError } = await localDbAdmin
        .from('transactions')
        .update(updates)
        .eq('id', loan.id);
      if (txError) throw txError;

      // Free the assigned copy if any.
      if (loan.book_copies?.accession_id) {
        await localDbAdmin
          .from('book_copies')
          .update({ status: 'available' })
          .eq('accession_id', loan.book_copies.accession_id);
      }

      // Restock.
      const { data: bookRow } = await localDbAdmin
        .from('books')
        .select('quantity')
        .eq('id', loan.book_id)
        .maybeSingle();
      if (bookRow) {
        await localDbAdmin
          .from('books')
          .update({ quantity: (bookRow.quantity ?? 0) + 1 })
          .eq('id', loan.book_id);
      }

      showToast(
        fineAmount > 0
          ? `Returned. Fine ₱${fineAmount.toFixed(2)} recorded.`
          : 'Book returned.',
        'success'
      );

      notifyUser({
        user_id: loan.user_id,
        type: fineAmount > 0 ? 'return_with_fine' : 'returned',
        title: fineAmount > 0 ? 'Book returned — fine due' : 'Book returned',
        body: fineAmount > 0
          ? `Your return of "${loan.books?.title}" was recorded. Overdue ${overdueDays} day(s). Fine due: ₱${fineAmount.toFixed(2)}.`
          : `Your return of "${loan.books?.title}" was recorded. Thank you!`,
      });

      fetchAll();
    } catch (e) {
      console.error('handleReturn error:', e);
      showToast('Error: ' + e.message, 'error');
    }
  };

  const isOverdue = (item) => {
    if (!item.due_date) return false;
    return new Date(item.due_date) < new Date();
  };

  const tabStyle = {
    padding: '10px 22px',
    borderRadius: '8px 8px 0 0',
    border: 'none',
    fontWeight: '600',
    fontSize: '0.9rem',
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
  const activeTabStyle = {
    background: 'var(--maroon)',
    color: 'white',
  };
  const inactiveTabStyle = {
    background: 'white',
    color: '#64748b',
    borderBottom: '2px solid #e2e8f0',
  };

  return (
    <div>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ color: 'var(--dark-blue)', margin: 0 }}>Book Requests & Active Loans</h1>
        <p style={{ color: '#64748b', marginTop: '5px' }}>
          Review pending requests and track all currently borrowed books.
        </p>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0' }}>
        <button
          style={{ ...tabStyle, ...(activeTab === 'pending' ? activeTabStyle : inactiveTabStyle) }}
          onClick={() => setActiveTab('pending')}
        >
          🕐 Pending Requests
          {requests.length > 0 && (
            <span style={{
              marginLeft: '8px',
              background: activeTab === 'pending' ? 'rgba(255,255,255,0.25)' : 'var(--maroon)',
              color: 'white',
              borderRadius: '12px',
              padding: '1px 8px',
              fontSize: '0.78rem',
            }}>
              {requests.length}
            </span>
          )}
        </button>
        <button
          style={{ ...tabStyle, ...(activeTab === 'active' ? activeTabStyle : inactiveTabStyle) }}
          onClick={() => setActiveTab('active')}
        >
          📖 Active Loans
          {activeLoans.length > 0 && (
            <span style={{
              marginLeft: '8px',
              background: activeTab === 'active' ? 'rgba(255,255,255,0.25)' : 'var(--green)',
              color: 'white',
              borderRadius: '12px',
              padding: '1px 8px',
              fontSize: '0.78rem',
            }}>
              {activeLoans.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB PANEL */}
      <div style={{ background: 'white', borderRadius: '0 12px 12px 12px', boxShadow: '0 4px 10px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : activeTab === 'pending' ? (
          requests.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>✅</div>
              <h3 style={{ margin: '0 0 6px' }}>All caught up!</h3>
              <p style={{ margin: 0 }}>There are no pending book requests at the moment.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#F5FAE8', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Date Requested</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Patron Details</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Book Details</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Role / Terms</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '15px 20px', color: '#64748b' }}>
                      {new Date(req.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={{ padding: '15px 20px' }}>
                      <strong style={{ color: 'var(--dark-blue)', display: 'block' }}>{req.users?.name}</strong>
                      <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block' }}>LRN: {req.users?.lrn || req.users?.student_id || 'N/A'}</span>
                      {req.users?.grade_section && (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{req.users.grade_section}</span>
                      )}
                    </td>
                    <td style={{ padding: '15px 20px' }}>
                      <strong style={{ display: 'block' }}>{req.books?.title}</strong>
                      <span style={{ fontSize: '0.8rem', color: req.books?.quantity > 0 ? 'var(--green)' : '#ef4444', fontWeight: '600' }}>
                        {req.books?.quantity ?? 0} {req.books?.quantity === 1 ? 'copy' : 'copies'} available
                      </span>
                    </td>
                    <td style={{ padding: '15px 20px' }}>
                      <span style={{
                        background: req.users?.role === 'teacher' ? '#FFF0F5' : '#F5FAE8',
                        color: req.users?.role === 'teacher' ? 'var(--maroon)' : 'var(--green)',
                        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase'
                      }}>
                        {req.users?.role}
                      </span>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                        {req.users?.role === 'teacher'
                          ? 'No due date'
                          : (req.due_date
                              ? `Wants by: ${new Date(req.due_date).toLocaleDateString()}`
                              : '7-day loan')}
                      </div>
                    </td>
                    <td style={{ padding: '15px 20px' }}>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => handleAction(req, true)}
                          disabled={req.books?.quantity <= 0}
                          style={{
                            padding: '8px 12px',
                            background: req.books?.quantity > 0 ? 'var(--green)' : '#9ca3af',
                            color: 'white', border: 'none', borderRadius: '4px',
                            cursor: req.books?.quantity > 0 ? 'pointer' : 'not-allowed',
                            fontSize: '0.85rem', fontWeight: 'bold'
                          }}
                        >
                          ✓ Approve & Assign Copy
                        </button>
                        <button
                          onClick={() => handleAction(req, false)}
                          style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}
                        >
                          Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          activeLoans.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📭</div>
              <h3 style={{ margin: '0 0 6px' }}>No active loans</h3>
              <p style={{ margin: 0 }}>No books are currently checked out.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#F5FAE8', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Patron</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Book</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Copy / Accession</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Borrow Date</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Due Date</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Status</th>
                  <th style={{ padding: '15px 20px', color: '#475569' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeLoans.map((loan) => {
                  const overdue = isOverdue(loan);
                  return (
                    <tr key={loan.id} style={{ borderBottom: '1px solid #f1f5f9', background: overdue ? '#fff1f2' : 'transparent' }}>
                      <td style={{ padding: '15px 20px' }}>
                        <strong style={{ color: 'var(--dark-blue)', display: 'block' }}>{loan.users?.name}</strong>
                        <span style={{ fontSize: '0.82rem', color: '#64748b' }}>ID: {loan.users?.student_id || 'N/A'}</span>
                      </td>
                      <td style={{ padding: '15px 20px' }}>
                        <strong>{loan.books?.title}</strong>
                        {overdue && <div style={{ color: '#e11d48', fontSize: '0.72rem', fontWeight: 'bold', marginTop: '2px' }}>⚠ OVERDUE</div>}
                      </td>
                      <td style={{ padding: '15px 20px' }}>
                        {loan.book_copies?.accession_id ? (
                          <div>
                            <code style={{ background: '#eef2ff', color: '#6366f1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                              {loan.book_copies.accession_id}
                            </code>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>Copy #{loan.book_copies.copy_number}</div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{loan.books?.accession_num || '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '15px 20px', color: '#475569' }}>
                        {loan.borrow_date ? new Date(loan.borrow_date).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '15px 20px', color: overdue ? '#e11d48' : '#475569', fontWeight: overdue ? 'bold' : 'normal' }}>
                        {loan.due_date ? new Date(loan.due_date).toLocaleDateString() : <span style={{ color: '#94a3b8' }}>No due date</span>}
                      </td>
                      <td style={{ padding: '15px 20px' }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold',
                          background: overdue ? '#fee2e2' : '#dbeafe',
                          color: overdue ? '#e11d48' : '#1d4ed8',
                        }}>
                          {overdue ? 'OVERDUE' : 'BORROWED'}
                        </span>
                      </td>
                      <td style={{ padding: '15px 20px' }}>
                        <button
                          onClick={() => handleReturn(loan)}
                          style={{
                            padding: '8px 14px',
                            background: overdue ? '#e11d48' : 'var(--green)',
                            color: 'white', border: 'none', borderRadius: '4px',
                            cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold'
                          }}
                        >
                          {overdue ? 'Return + Fine' : 'Return'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
