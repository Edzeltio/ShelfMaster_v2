import React, { useEffect, useState } from 'react';
import { localDb } from './localDbClient';

export default function LateReturns() {
  const [lateBooks, setLateBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLateBooks();
  }, []);

  async function fetchLateBooks() {
    const now = new Date().toISOString();

    const { data, error } = await localDb
      .from('transactions')
      .select(`
        id,
        due_date,
        user_id,
        users (full_name, email),
        books (title)
      `)
      .eq('transaction_type', 'borrow') // Still borrowed
      .lt('due_date', now); // Due date is LESS THAN (before) now

    if (error) console.error(error);
    else setLateBooks(data || []);
    setLoading(false);
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ color: '#dc2626' }}>⚠️ Late Returns / Overdue Books</h2>
      <p>List of students who have not returned books by their due date.</p>

      {lateBooks.length === 0 ? (
        <p>Great news! No books are currently overdue.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
          <thead>
            <tr style={{ textAlign: 'left', background: '#fee2e2' }}>
              <th style={{ padding: '10px' }}>Student</th>
              <th style={{ padding: '10px' }}>Book Title</th>
              <th style={{ padding: '10px' }}>Due Date</th>
              <th style={{ padding: '10px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {lateBooks.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '10px' }}>
                  <strong>{item.users?.full_name}</strong><br/>
                  <small>{item.users?.email}</small>
                </td>
                <td style={{ padding: '10px' }}>{item.books?.title}</td>
                <td style={{ padding: '10px', color: '#dc2626', fontWeight: 'bold' }}>
                  {new Date(item.due_date).toLocaleDateString()}
                </td>
                <td style={{ padding: '10px' }}>
                  <span style={{ background: '#fecaca', color: '#991b1b', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
                    OVERDUE
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}