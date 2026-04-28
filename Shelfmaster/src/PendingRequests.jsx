import React, { useEffect, useState } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import Toast from './Toast';

const ACTIVE_STATUSES = ['borrowed', 'approved', 'issued', 'active', 'loaned', 'checked_out'];

export default function PendingRequests() {
  const [activeTab, setActiveTab] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [activeLoans, setActiveLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    fetchAll();
    const onVisible = () => { if (!document.hidden) fetchAll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchPendingRequests(), fetchActiveLoans()]);
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
        users (name, student_id, role),
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

  const APPROVE_CANDIDATES = ['borrowed', 'approved', 'issued', 'active', 'loaned', 'checked_out', 'released'];
  const DECLINE_CANDIDATES = ['declined', 'rejected', 'cancelled', 'denied', 'archived'];

  const resolveStatus = async (transactionId, isApprove, isTeacher) => {
    const storageKey = isApprove ? 'sm_approve_status' : 'sm_decline_status';
    const cached = localStorage.getItem(storageKey);
    if (cached) {
      const dueDate = isApprove && !isTeacher
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const { data, error } = await localDbAdmin
        .from('transactions')
        .update({
          status: cached,
          borrow_date: isApprove ? new Date().toISOString() : null,
          due_date: isApprove ? dueDate : null,
        })
        .eq('id', transactionId)
        .select();

      if (!error && data && data.length > 0) {
        return cached;
      }

      localStorage.removeItem(storageKey);
      if (error && error.code !== '23514') throw error;
    }

    const candidates = isApprove ? APPROVE_CANDIDATES : DECLINE_CANDIDATES;
    const dueDate = isApprove && !isTeacher
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    for (const candidate of candidates) {
      const { data, error } = await localDbAdmin
        .from('transactions')
        .update({
          status: candidate,
          borrow_date: isApprove ? new Date().toISOString() : null,
          due_date: isApprove ? dueDate : null,
        })
        .eq('id', transactionId)
        .select();

      if (error?.code === '23514') {
        console.log(`Status "${candidate}" rejected by constraint, trying next...`);
        continue;
      }
      if (error) throw error;
      if (data && data.length > 0) {
        console.log(`Discovered working status: "${candidate}"`);
        localStorage.setItem(storageKey, candidate);
        return candidate;
      }
    }
    throw new Error(
      'Could not find an accepted status value. Please check your transactions table status constraint.'
    );
  };

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

  const handleAction = async (transactionId, isApprove, bookId, currentStock, userRole) => {
    try {
      const isTeacher = userRole === 'teacher';

      if (isApprove) {
        if (currentStock <= 0) {
          showToast('No copies available to lend.', 'error');
          return;
        }

        const copy = await assignAvailableCopy(bookId);
        const dueDate = !isTeacher
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          : null;
        const resolvedStatus = await resolveStatus(transactionId, true, isTeacher);

        if (copy) {
          const { error: copyUpdateError } = await localDbAdmin
            .from('book_copies')
            .update({ status: 'borrowed' })
            .eq('id', copy.id);
          if (copyUpdateError) throw copyUpdateError;

          await localDbAdmin
            .from('transactions')
            .update({
              status: resolvedStatus,
              borrow_date: new Date().toISOString(),
              due_date: dueDate,
              copy_id: copy.id,
            })
            .eq('id', transactionId);

          showToast(
            `Copy ${copy.accession_id} assigned to ${isTeacher ? 'teacher (no due date)' : 'student (7-day loan)'}.`,
            'success'
          );
        } else {
          await localDbAdmin
            .from('transactions')
            .update({
              status: resolvedStatus,
              borrow_date: new Date().toISOString(),
              due_date: dueDate,
            })
            .eq('id', transactionId);

          showToast(
            `Book approved for ${isTeacher ? 'teacher (no due date)' : 'student (7-day loan)'}.`,
            'success'
          );
        }

        const { error: stockError } = await localDbAdmin
          .from('books')
          .update({ quantity: currentStock - 1 })
          .eq('id', bookId);
        if (stockError) throw stockError;

      } else {
        await resolveStatus(transactionId, false, false);
        showToast('Request declined.', 'success');
      }

      fetchAll();

    } catch (error) {
      console.error('handleAction error:', error);
      showToast('Error: ' + error.message, 'error');
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
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>ID: {req.users?.student_id || 'N/A'}</span>
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
                        {req.users?.role === 'teacher' ? 'No due date' : '7-day loan'}
                      </div>
                    </td>
                    <td style={{ padding: '15px 20px' }}>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => handleAction(req.id, true, req.book_id, req.books?.quantity, req.users?.role)}
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
                          onClick={() => handleAction(req.id, false, req.book_id, req.books?.quantity, req.users?.role)}
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
