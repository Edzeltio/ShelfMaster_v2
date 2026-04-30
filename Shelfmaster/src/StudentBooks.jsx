import React, { useState, useEffect } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import StudentNavbar from './StudentNavbar';

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

export default function StudentBooks() {
  const [activeTab, setActiveTab] = useState('loans');
  const [loans, setLoans] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const onVisible = () => { if (!document.hidden) fetchData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data: { user } } = await localDb.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: userData, error: userError } = await localDb
      .from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (userError) console.error('User lookup error:', userError);
    const userId = userData?.id;
    if (!userId) { setLoading(false); return; }

    let [loansRes, requestsRes] = await Promise.all([
      localDb
        .from('transactions')
        .select('id, borrow_date, due_date, status, books(title, authors, accession_num), book_copies(accession_id, copy_number)')
        .eq('user_id', userId)
        .in('status', ['borrowed', 'approved', 'issued', 'active', 'loaned', 'checked_out']),
      localDb
        .from('transactions')
        .select('id, created_at, status, books(title, authors)')
        .eq('user_id', userId)
        .eq('status', 'pending'),
    ]);

    if (loansRes.error && isMigrationError(loansRes.error)) {
      loansRes = await localDb
        .from('transactions')
        .select('id, borrow_date, due_date, status, books(title, authors, accession_num)')
        .eq('user_id', userId)
        .in('status', ['borrowed', 'approved', 'issued', 'active', 'loaned', 'checked_out']);
    }

    if (loansRes.error) console.error('Loans fetch error:', loansRes.error);
    if (requestsRes.error) console.error('Requests fetch error:', requestsRes.error);
    if (!loansRes.error) setLoans(loansRes.data || []);
    if (!requestsRes.error) setRequests(requestsRes.data || []);
    setLoading(false);
  }

  const calculateDaysLeft = (dueDate) => {
    const today = new Date();
    const due = new Date(dueDate);
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: `${Math.abs(diffDays)} Days Overdue`, color: '#e11d48', weight: 'bold' };
    if (diffDays === 0) return { text: 'Due Today', color: '#f59e0b', weight: 'bold' };
    if (diffDays <= 2) return { text: `${diffDays} Days Left`, color: '#f59e0b', weight: 'bold' };
    return { text: `${diffDays} Days Left`, color: '#10b981', weight: '500' };
  };

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      <StudentNavbar />

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 20px' }}>
        <h2 style={{ color: 'var(--maroon)', margin: '0 0 6px 0' }}>My Books</h2>
        <p style={{ color: '#64748b', margin: '0 0 28px 0', fontSize: '0.9rem' }}>Track your active loans and borrowing requests</p>

        {/* Tabs */}
        <div style={tabBarStyle}>
          <button
            style={activeTab === 'loans' ? { ...tabStyle, ...activeTabStyle } : tabStyle}
            onClick={() => setActiveTab('loans')}
          >
            Active Loans
            {loans.length > 0 && <span style={badgeStyle}>{loans.length}</span>}
          </button>
          <button
            style={activeTab === 'requests' ? { ...tabStyle, ...activeTabStyle } : tabStyle}
            onClick={() => setActiveTab('requests')}
          >
            Pending Requests
            {requests.length > 0 && <span style={{ ...badgeStyle, background: 'var(--yellow)', color: 'var(--maroon)' }}>{requests.length}</span>}
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', marginTop: '40px', color: '#64748b' }}>Loading...</p>
        ) : (
          <div style={panelStyle}>
            {/* ACTIVE LOANS TAB */}
            {activeTab === 'loans' && (
              loans.length === 0 ? (
                <EmptyState icon="📚" message="You have no active loans." />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#F5FAE8', color: '#475569' }}>
                        <th style={thStyle}>Book Title</th>
                        <th style={thStyle}>Copy / Barcode</th>
                        <th style={thStyle}>Borrow Date</th>
                        <th style={thStyle}>Due Date</th>
                        <th style={thStyle}>Time Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loans.map(loan => {
                        const countdown = loan.due_date ? calculateDaysLeft(loan.due_date) : null;
                        return (
                          <tr key={loan.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={tdStyle}>
                              <strong>{loan.books?.title}</strong>
                              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>by {loan.books?.authors}</div>
                            </td>
                            <td style={tdStyle}>
                              {loan.book_copies?.accession_id ? (
                                <div>
                                  <code style={{ background: '#eef2ff', color: '#6366f1', padding: '3px 8px', borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                                    {loan.book_copies.accession_id}
                                  </code>
                                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>Copy #{loan.book_copies.copy_number}</div>
                                </div>
                              ) : (
                                <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{loan.books?.accession_num || '—'}</span>
                              )}
                            </td>
                            <td style={tdStyle}>{loan.borrow_date ? new Date(loan.borrow_date).toLocaleDateString() : '—'}</td>
                            <td style={tdStyle}>{loan.due_date ? new Date(loan.due_date).toLocaleDateString() : '—'}</td>
                            <td style={{ ...tdStyle, color: countdown?.color || '#94a3b8', fontWeight: countdown?.weight || 'normal' }}>
                              {loan.due_date ? countdown?.text : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* PENDING REQUESTS TAB */}
            {activeTab === 'requests' && (
              requests.length === 0 ? (
                <EmptyState icon="🕐" message="No pending requests at the moment." />
              ) : (
                <div>
                  {requests.map(req => (
                    <div key={req.id} style={requestRowStyle}>
                      <div>
                        <strong style={{ color: '#1e293b' }}>{req.books?.title}</strong>
                        <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '3px' }}>
                          by {req.books?.authors} &nbsp;·&nbsp; Requested on {new Date(req.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span style={pendingBadgeStyle}>PENDING APPROVAL</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, message }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>{icon}</div>
      <p style={{ fontSize: '1rem' }}>{message}</p>
    </div>
  );
}

const tabBarStyle = { display: 'flex', gap: '8px', marginBottom: '0', borderBottom: '2px solid #e2e8f0' };

const tabStyle = {
  padding: '10px 22px',
  border: 'none',
  background: 'transparent',
  fontSize: '0.95rem',
  fontWeight: '600',
  color: '#94a3b8',
  cursor: 'pointer',
  borderBottomWidth: '3px',
  borderBottomStyle: 'solid',
  borderBottomColor: 'transparent',
  marginBottom: '-2px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  transition: 'color 0.2s',
};

const activeTabStyle = { color: 'var(--maroon)', borderBottomColor: 'var(--maroon)' };

const badgeStyle = {
  background: 'var(--green)',
  color: 'white',
  fontSize: '0.72rem',
  fontWeight: 'bold',
  borderRadius: '20px',
  padding: '2px 8px',
};

const panelStyle = {
  background: 'white',
  borderRadius: '0 0 14px 14px',
  boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
  overflow: 'hidden',
};

const thStyle = { padding: '14px 16px', textAlign: 'left', fontWeight: '600', fontSize: '0.85rem', whiteSpace: 'nowrap' };
const tdStyle = { padding: '14px 16px', verticalAlign: 'middle' };

const requestRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid #f1f5f9',
};

const pendingBadgeStyle = {
  background: 'var(--yellow)',
  color: 'var(--maroon)',
  padding: '5px 14px',
  borderRadius: '20px',
  fontSize: '0.72rem',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
};
