import React, { useEffect, useState } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';

export default function LateReturns() {
  const [lateBooks, setLateBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [finePolicy, setFinePolicy] = useState({ fine_amount: 5, fine_increment_type: 'per_day' });

  useEffect(() => {
    fetchFinePolicy();
    fetchLateBooks();
  }, []);

  async function fetchFinePolicy() {
    const { data } = await localDbAdmin
      .from('site_content')
      .select('fine_per_day, fine_amount, fine_increment_type')
      .limit(1)
      .maybeSingle();
    if (data) {
      setFinePolicy({
        fine_amount: data.fine_amount ?? data.fine_per_day ?? 5,
        fine_increment_type: data.fine_increment_type || 'per_day',
      });
    }
  }

  async function fetchLateBooks() {
    const now = new Date().toISOString();

    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id,
        due_date,
        borrow_date,
        user_id,
        users (name, student_id, email),
        books (title),
        book_copies (accession_id, copy_number)
      `)
      .eq('status', 'borrowed')
      .lt('due_date', now)
      .order('due_date', { ascending: true });

    if (error && (error.code === '42P01' || error.code === 'PGRST200' || (error.message || '').includes('book_copies'))) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, due_date, borrow_date, user_id, users (name, student_id, email), books (title)')
        .eq('status', 'borrowed')
        .lt('due_date', now)
        .order('due_date', { ascending: true }));
    }

    if (error) console.error(error);
    else setLateBooks(data || []);
    setLoading(false);
  }

  const computeOverdueUnits = (dueDate, policy) => {
    if (!dueDate) return 0;
    const ms = Date.now() - new Date(dueDate).getTime();
    if (ms <= 0) return 0;
    if (policy.fine_increment_type === 'per_hour') {
      return Math.ceil(ms / (60 * 60 * 1000));
    }
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  };

  const computeFine = (dueDate, policy) => {
    const units = computeOverdueUnits(dueDate, policy);
    return units * (policy.fine_amount ?? 5);
  };

  const fineLabel = finePolicy.fine_increment_type === 'per_hour' ? 'hour' : 'day';
  const totalFines = lateBooks.reduce((sum, item) => sum + computeFine(item.due_date, finePolicy), 0);

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ color: 'var(--dark-blue)', margin: 0 }}>⚠️ Overdue Books</h1>
        <p style={{ color: '#64748b', marginTop: '5px' }}>Students who have not returned books past their due date.</p>
      </div>

      {lateBooks.length > 0 && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '14px 20px', minWidth: '160px' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#dc2626' }}>{lateBooks.length}</div>
            <div style={{ fontSize: '0.78rem', color: '#7f1d1d', fontWeight: 600 }}>Overdue Books</div>
          </div>
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', padding: '14px 20px', minWidth: '160px' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#c2410c' }}>₱{totalFines.toFixed(2)}</div>
            <div style={{ fontSize: '0.78rem', color: '#7c2d12', fontWeight: 600 }}>Total Accrued Fines</div>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px 20px', flex: 1 }}>
            <div style={{ fontSize: '0.82rem', color: '#15803d', fontWeight: 600 }}>Fine Policy</div>
            <div style={{ fontSize: '0.9rem', color: '#166534', marginTop: '4px' }}>
              ₱{finePolicy.fine_amount} per {fineLabel}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading overdue books...</div>
      ) : lateBooks.length === 0 ? (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>✅</div>
          <p style={{ color: '#166534', fontWeight: 600, margin: 0 }}>No books are currently overdue.</p>
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', border: '1px solid #fecaca', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fee2e2', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Student</th>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Book Title</th>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Copy</th>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Due Date</th>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Overdue ({fineLabel}s)</th>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Accrued Fine (₱{finePolicy.fine_amount}/{fineLabel})</th>
                <th style={{ padding: '12px 16px', color: '#7f1d1d', fontWeight: 700 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {lateBooks.map((item) => {
                const units = computeOverdueUnits(item.due_date, finePolicy);
                const fine = computeFine(item.due_date, finePolicy);
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #fee2e2', background: '#fffbfb' }}>
                    <td style={{ padding: '13px 16px' }}>
                      <strong style={{ color: 'var(--dark-blue)', display: 'block' }}>
                        {item.users?.name || 'Unknown'}
                      </strong>
                      <small style={{ color: '#64748b' }}>
                        {item.users?.student_id || item.users?.email || ''}
                      </small>
                    </td>
                    <td style={{ padding: '13px 16px', fontWeight: 600, color: '#1e293b' }}>
                      {item.books?.title || '—'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      {item.book_copies?.accession_id ? (
                        <code style={{ background: '#eef2ff', color: '#6366f1', padding: '2px 7px', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                          {item.book_copies.accession_id}
                        </code>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '13px 16px', color: '#dc2626', fontWeight: 700 }}>
                      {item.due_date ? new Date(item.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{ background: '#fecaca', color: '#991b1b', padding: '3px 10px', borderRadius: '20px', fontWeight: 700, fontSize: '0.82rem' }}>
                        {units} {units === 1 ? fineLabel : fineLabel + 's'}
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', fontWeight: 800, color: '#dc2626', fontSize: '1rem' }}>
                      ₱{fine.toFixed(2)}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{ background: '#fecaca', color: '#991b1b', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                        OVERDUE
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
