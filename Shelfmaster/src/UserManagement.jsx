import React, { useState, useEffect } from 'react';
import { localDbAdmin } from './localDbAdmin';
import { getBaseURL } from './connectionManager';
import Toast from './Toast';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [selectedUser, setSelectedUser] = useState(null);
  const [userLoans, setUserLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await localDbAdmin
      .from('users')
      .select('*, transactions (id, status)')
      .eq('role', 'student')
      .order('name', { ascending: true });

    if (error) console.error('Error fetching students:', error);
    else setUsers(data || []);
    setLoading(false);
  }

  function getAuthHeaders() {
    let token = '';
    try {
      const raw = sessionStorage.getItem('shelfmaster-session');
      if (raw) token = JSON.parse(raw)?.access_token || '';
    } catch {}
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function handleArchive(user) {
    if (!window.confirm(`Archive ${user.name}? They will no longer appear in the active list and cannot log in.`)) return;
    try {
      const base = getBaseURL();
      if (base) {
        const res = await fetch(`${base}/api/users/${user.id}/archive`, {
          method: 'POST',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Archive failed');
      } else {
        // Fallback: update directly via admin DB
        const { error } = await localDbAdmin
          .from('users')
          .update({ archived_at: new Date().toISOString(), status: 'inactive' })
          .eq('id', user.id);
        if (error) throw new Error(error.message);
      }
      showToast(`${user.name} archived.`);
      fetchUsers();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  }

  async function handleUnarchive(user) {
    try {
      const base = getBaseURL();
      if (base) {
        const res = await fetch(`${base}/api/users/${user.id}/unarchive`, {
          method: 'POST',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Restore failed');
      } else {
        const { error } = await localDbAdmin
          .from('users')
          .update({ archived_at: null, status: 'active' })
          .eq('id', user.id);
        if (error) throw new Error(error.message);
      }
      showToast(`${user.name} restored.`);
      fetchUsers();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  }

  async function handleDelete(user) {
    if (!window.confirm(
      `PERMANENTLY DELETE ${user.name}?\n\nThis removes their account and all associated history. ` +
      `This cannot be undone. Type OK in the next prompt to confirm.`
    )) return;
    const typed = window.prompt(`Type DELETE to confirm permanent deletion of ${user.name}:`);
    if (typed !== 'DELETE') {
      showToast('Deletion cancelled.', 'error');
      return;
    }
    try {
      const base = getBaseURL();
      if (base) {
        const res = await fetch(`${base}/api/users/${user.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      } else {
        // Fallback: delete directly via admin DB
        const { error } = await localDbAdmin
          .from('users')
          .delete()
          .eq('id', user.id);
        if (error) throw new Error(error.message);
      }
      showToast(`${user.name} deleted.`);
      if (selectedUser?.id === user.id) setSelectedUser(null);
      fetchUsers();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  }

  async function toggleLoans(user) {
    if (selectedUser?.id === user.id) {
      setSelectedUser(null);
      setUserLoans([]);
      return;
    }

    setSelectedUser(user);
    setLoansLoading(true);
    setUserLoans([]);

    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id, status, borrow_date, due_date,
        books (title, accession_num, authors),
        book_copies (accession_id, copy_number)
      `)
      .eq('user_id', user.id)
      .eq('status', 'borrowed')
      .order('borrow_date', { ascending: false });

    if (error && (error.code === 'PGRST200' || (error.message || '').includes('book_copies') || (error.message || '').includes('schema cache'))) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, status, borrow_date, due_date, books (title, accession_num, authors)')
        .eq('user_id', user.id)
        .eq('status', 'borrowed')
        .order('borrow_date', { ascending: false }));
    }

    if (!error) setUserLoans(data || []);
    setLoansLoading(false);
  }

  const filteredUsers = users
    .filter(user => showArchived ? !!user.archived_at : !user.archived_at)
    .filter(user => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      return (
        user.name?.toLowerCase().includes(q) ||
        user.student_id?.toLowerCase().includes(q) ||
        user.lrn?.toLowerCase().includes(q) ||
        user.grade_section?.toLowerCase().includes(q) ||
        user.course_year?.toLowerCase().includes(q)
      );
    });

  const isOverdue = (dueDate) => dueDate && new Date(dueDate) < new Date();

  return (
    <div style={{ maxWidth: '1200px' }}>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ color: 'var(--dark-blue)', margin: 0 }}>Student Management</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '5px' }}>
            Search, archive, restore or permanently delete student accounts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setShowArchived(s => !s)}
            style={{
              padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1',
              background: showArchived ? '#fee2e2' : 'white',
              color: showArchived ? '#991b1b' : '#475569',
              cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
            }}
          >
            {showArchived ? 'Showing: Archived' : 'Show Archived'}
          </button>
          <input
            type="text"
            placeholder="Search by name, LRN, grade & section..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '320px', padding: '12px 20px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {loading ? (
        <p>Loading student directory...</p>
      ) : (
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ background: '#F5FAE8', borderBottom: '2px solid #e2e8f0' }}>
              <tr>
                <th style={thStyle}>Student Name</th>
                <th style={thStyle}>LRN / Student ID</th>
                <th style={thStyle}>Grade & Section / Strand</th>
                <th style={thStyle}>Books Held</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>
                    {showArchived ? 'No archived students.' : 'No students found.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => {
                  const activeLoans = user.transactions?.filter(t => t.status === 'borrowed').length || 0;
                  const isOpen = selectedUser?.id === user.id;
                  const archived = !!user.archived_at;

                  return (
                    <React.Fragment key={user.id}>
                      {/* Student row */}
                      <tr style={{ borderBottom: isOpen ? 'none' : '1px solid #f1f5f9', background: isOpen ? '#f0fdf4' : (archived ? '#fafafa' : 'white'), opacity: archived ? 0.78 : 1 }}>
                        <td style={{ padding: '15px 20px' }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--dark-blue)' }}>{user.name}</div>
                          {archived && (
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '2px' }}>
                              Archived {new Date(user.archived_at).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '15px 20px', color: '#475569' }}>
                          {user.lrn || user.student_id || <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td style={{ padding: '15px 20px', color: '#475569' }}>
                          {user.grade_section || user.course_year || <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td style={{ padding: '15px 20px' }}>
                          <button
                            onClick={() => toggleLoans(user)}
                            disabled={activeLoans === 0}
                            title={activeLoans > 0 ? `View ${activeLoans} borrowed book${activeLoans > 1 ? 's' : ''}` : 'No active loans'}
                            style={{
                              background: activeLoans > 0 ? (isOpen ? '#16a34a' : '#dcfce7') : '#f8fafc',
                              color: activeLoans > 0 ? (isOpen ? 'white' : '#16a34a') : '#94a3b8',
                              padding: '5px 12px', borderRadius: '6px', fontSize: '0.85rem',
                              fontWeight: 700, border: 'none',
                              cursor: activeLoans > 0 ? 'pointer' : 'default',
                              transition: 'all 0.15s',
                              display: 'inline-flex', alignItems: 'center', gap: '6px'
                            }}
                          >
                            {activeLoans > 0 ? '📚' : '—'} {activeLoans} {activeLoans === 1 ? 'Book' : 'Books'}
                            {activeLoans > 0 && (
                              <span style={{ fontSize: '0.65rem', marginLeft: '2px' }}>{isOpen ? '▲' : '▼'}</span>
                            )}
                          </button>
                        </td>
                        <td style={{ padding: '15px 20px' }}>
                          <span style={{
                            color: archived ? '#94a3b8' : (user.status === 'active' ? '#10b981' : '#ef4444'),
                            fontSize: '0.85rem', fontWeight: 'bold', textTransform: 'capitalize'
                          }}>
                            ● {archived ? 'archived' : (user.status || 'active')}
                          </span>
                        </td>
                        <td style={{ padding: '15px 20px' }}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {archived ? (
                              <button onClick={() => handleUnarchive(user)} style={actionBtn('#10b981')}>
                                Restore
                              </button>
                            ) : (
                              <button onClick={() => handleArchive(user)} style={actionBtn('#f59e0b')}>
                                Archive
                              </button>
                            )}
                            <button onClick={() => handleDelete(user)} style={actionBtn('#ef4444')}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Dropdown row — expands inline */}
                      {isOpen && (
                        <tr style={{ borderBottom: '2px solid #bbf7d0' }}>
                          <td colSpan="6" style={{ padding: 0, background: '#f8fffe' }}>
                            {/* Inner header */}
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '10px 20px', background: '#dcfce7', borderTop: '1px solid #bbf7d0', borderBottom: '1px solid #bbf7d0'
                            }}>
                              <span style={{ fontWeight: 700, color: '#15803d', fontSize: '0.88rem' }}>
                                📖 Currently borrowed by {user.name}
                              </span>
                              <button
                                onClick={() => toggleLoans(user)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803d', fontWeight: 700, fontSize: '0.8rem', padding: '2px 8px' }}
                              >
                                ▲ Collapse
                              </button>
                            </div>

                            {loansLoading ? (
                              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                                Loading loans…
                              </div>
                            ) : userLoans.length === 0 ? (
                              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
                                No active loans found.
                              </div>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ background: '#f0fdf4' }}>
                                    <th style={subThStyle}>#</th>
                                    <th style={subThStyle}>Book Title</th>
                                    <th style={subThStyle}>Accession / Copy</th>
                                    <th style={subThStyle}>Borrowed On</th>
                                    <th style={subThStyle}>Due Date</th>
                                    <th style={subThStyle}>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {userLoans.map((loan, idx) => {
                                    const overdue = isOverdue(loan.due_date);
                                    return (
                                      <tr key={loan.id} style={{ borderTop: '1px solid #e2e8f0', background: overdue ? '#fff7f7' : 'transparent' }}>
                                        <td style={{ padding: '12px 20px', color: '#94a3b8', fontSize: '0.82rem', width: '40px' }}>
                                          {idx + 1}
                                        </td>
                                        <td style={{ padding: '12px 20px' }}>
                                          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{loan.books?.title}</div>
                                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{loan.books?.authors}</div>
                                        </td>
                                        <td style={{ padding: '12px 20px' }}>
                                          {loan.book_copies?.accession_id ? (
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: '#eef2ff', color: '#6366f1', padding: '2px 8px', borderRadius: '4px' }}>
                                              {loan.book_copies.accession_id}
                                              <span style={{ color: '#94a3b8', marginLeft: '4px' }}>#{loan.book_copies.copy_number}</span>
                                            </span>
                                          ) : (
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#94a3b8' }}>
                                              {loan.books?.accession_num || '—'}
                                            </span>
                                          )}
                                        </td>
                                        <td style={{ padding: '12px 20px', color: '#475569', fontSize: '0.84rem' }}>
                                          {loan.borrow_date ? new Date(loan.borrow_date).toLocaleDateString([], { dateStyle: 'medium' }) : '—'}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '0.84rem' }}>
                                          {loan.due_date ? (
                                            <span style={{ color: overdue ? '#ef4444' : '#475569', fontWeight: overdue ? 700 : 400 }}>
                                              {overdue ? '⚠ ' : ''}{new Date(loan.due_date).toLocaleDateString([], { dateStyle: 'medium' })}
                                            </span>
                                          ) : '—'}
                                        </td>
                                        <td style={{ padding: '12px 20px' }}>
                                          <span style={{
                                            background: overdue ? '#fee2e2' : '#dcfce7',
                                            color: overdue ? '#dc2626' : '#16a34a',
                                            padding: '3px 10px', borderRadius: '20px',
                                            fontSize: '0.74rem', fontWeight: 700
                                          }}>
                                            {overdue ? 'Overdue' : 'On Loan'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '15px 20px',
  color: 'var(--text-muted)',
  fontSize: '0.85rem',
  textTransform: 'uppercase',
  fontWeight: 600,
};

const actionBtn = (color) => ({
  background: 'transparent',
  border: `1px solid ${color}`,
  color: color,
  padding: '5px 10px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 700,
});

const subThStyle = {
  padding: '8px 20px',
  color: '#64748b',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  fontWeight: 600,
  letterSpacing: '0.5px',
};
