import React, { useState, useEffect, useRef } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
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

export default function ProcessReturns() {
  const [barcode, setBarcode] = useState('');
  const [processing, setProcessing] = useState(false);
  const [recentReturns, setRecentReturns] = useState([]);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [finePolicy, setFinePolicy] = useState({ fine_amount: 5, fine_increment_value: 1, fine_increment_type: 'per_day' });

  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  async function fetchFinePolicy() {
    const { data } = await localDbAdmin
      .from('fine_policy')
      .select('fine_amount, fine_increment_value, fine_increment_type')
      .limit(1)
      .maybeSingle();
    if (data) {
      setFinePolicy({
        fine_amount: data.fine_amount ?? 5,
        fine_increment_value: Math.max(1, Number(data.fine_increment_value ?? 1)),
        fine_increment_type: data.fine_increment_type || 'per_day',
      });
    }
  }

  function computeOverdueUnits(dueDate, policy) {
    if (!dueDate) return 0;
    const ms = Date.now() - new Date(dueDate).getTime();
    if (ms <= 0) return 0;
    if (policy.fine_increment_type === 'per_hour') {
      return Math.ceil(ms / (60 * 60 * 1000));
    }
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  function computeFine(dueDate, policy) {
    const units = computeOverdueUnits(dueDate, policy);
    const incrValue = Math.max(1, policy.fine_increment_value || 1);
    const charges = Math.floor(units / incrValue);
    return charges * (policy.fine_amount ?? 5);
  }

  useEffect(() => {
    fetchFinePolicy();
    fetchRecentReturns();
    if (inputRef.current) inputRef.current.focus();
    const onVisible = () => { if (!document.hidden) fetchRecentReturns(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(debounceRef.current);
    };
  }, []);

  async function fetchRecentReturns() {
    let { data, error } = await localDbAdmin
      .from('transactions')
      .select(`
        id,
        return_date,
        users (name, student_id),
        books (title),
        book_copies (accession_id, copy_number)
      `)
      .eq('status', 'returned')
      .order('return_date', { ascending: false })
      .limit(10);

    if (error && isMigrationError(error)) {
      ({ data, error } = await localDbAdmin
        .from('transactions')
        .select('id, return_date, users (name, student_id), books (title)')
        .eq('status', 'returned')
        .order('return_date', { ascending: false })
        .limit(10));
    }
    if (data) setRecentReturns(data);
  }

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    const scanned = barcode.trim();
    if (!scanned) return;
    setProcessing(true);
    try {
      await processReturn(scanned);
    } finally {
      setProcessing(false);
      setBarcode('');
      if (inputRef.current) inputRef.current.focus();
    }
  };

  async function processReturn(scanned) {
    try {
      // Strategy 1: Look up by copy accession_id (new per-copy system)
      const { data: copy, error: copyError } = await localDbAdmin
        .from('book_copies')
        .select('id, book_id, accession_id, copy_number, status')
        .eq('accession_id', scanned)
        .maybeSingle();

      if (copyError && isMigrationError(copyError)) {
        // fall through to strategy 2
      } else if (copy) {
        if (copy.status !== 'borrowed') {
          throw new Error(`Copy ${copy.accession_id} is not currently marked as borrowed. Its status is: "${copy.status}".`);
        }

        const { data: transactions, error: transError } = await localDbAdmin
          .from('transactions')
          .select('id, user_id, due_date, users(name, email), books(title)')
          .eq('copy_id', copy.id)
          .eq('status', 'borrowed')
          .order('borrow_date', { ascending: true })
          .limit(1);

        if (transError) throw new Error(`Database error: ${transError.message}`);
        if (!transactions || transactions.length === 0) {
          throw new Error(`No active loan found linked to copy ${copy.accession_id}.`);
        }

        const transaction = transactions[0];
        const fineAmount = computeFine(transaction.due_date, finePolicy);
        const overdueUnits = computeOverdueUnits(transaction.due_date, finePolicy);
        const fineLabel = finePolicy.fine_increment_type === 'per_hour' ? 'hour' : 'day';

        let fineId = null;
        if (fineAmount > 0) {
          const { data: fineRow, error: fineErr } = await localDbAdmin
            .from('fines')
            .insert([{
              transaction_id: transaction.id,
              user_id: transaction.user_id,
              amount: fineAmount,
              overdue_days: overdueUnits,
              status: 'unpaid',
            }])
            .select('id')
            .single();
          if (fineErr) throw fineErr;
          fineId = fineRow.id;
        }

        const transUpdate = { status: 'returned', return_date: new Date().toISOString() };
        if (fineAmount > 0) {
          transUpdate.fine_amount = fineAmount;
          transUpdate.fine_id = fineId;
        }

        const { error: updateTransError } = await localDbAdmin
          .from('transactions')
          .update(transUpdate)
          .eq('id', transaction.id);
        if (updateTransError) throw updateTransError;

        const { error: updateCopyError } = await localDbAdmin
          .from('book_copies')
          .update({ status: 'available' })
          .eq('id', copy.id);
        if (updateCopyError) throw updateCopyError;

        const { data: bookData } = await localDbAdmin
          .from('books')
          .select('quantity')
          .eq('id', copy.book_id)
          .single();
        if (bookData) {
          await localDbAdmin
            .from('books')
            .update({ quantity: (bookData.quantity || 0) + 1 })
            .eq('id', copy.book_id);
        }

        showToast(
          fineAmount > 0
            ? `Copy ${copy.accession_id} returned by ${transaction.users?.name}. Overdue ${overdueUnits} ${fineLabel}(s). Fine: ₱${fineAmount.toFixed(2)}.`
            : `Copy ${copy.accession_id} returned by ${transaction.users?.name}. Marked available.`,
          'success'
        );

        if (transaction.user_id) {
          const notifRow = {
            user_id: transaction.user_id,
            type: fineAmount > 0 ? 'return_with_fine' : 'returned',
            title: fineAmount > 0 ? 'Book returned — fine due' : 'Book returned',
            body: fineAmount > 0
              ? `Your return of "${transaction.books?.title}" was recorded. Overdue ${overdueUnits} ${fineLabel}(s). Fine due: ₱${fineAmount.toFixed(2)}.`
              : `Your return of "${transaction.books?.title}" was recorded. Thank you!`,
            email_sent: false,
            read: false,
          };
          if (fineId) notifRow.fine_id = fineId;
          await localDbAdmin.from('notifications').insert([notifRow]);
        }

        fetchRecentReturns();
        return;
      }

      // Strategy 2: Fall back to legacy per-book barcode scan
      const { data: book, error: bookError } = await localDbAdmin
        .from('books')
        .select('id, title, quantity')
        .eq('barcode', scanned)
        .maybeSingle();

      if (bookError || !book) {
        throw new Error(`Barcode "${scanned}" not found. Make sure you are scanning a valid copy label (e.g. LIB-2026-000001).`);
      }

      const { data: transactions, error: transError } = await localDbAdmin
        .from('transactions')
        .select('id, user_id, due_date, users(name, email), books(title)')
        .eq('book_id', book.id)
        .eq('status', 'borrowed')
        .order('borrow_date', { ascending: true })
        .limit(1);

      if (transError) throw new Error(`Database error: ${transError.message}`);
      if (!transactions || transactions.length === 0) {
        throw new Error(`"${book.title}" is not currently marked as borrowed.`);
      }

      const transaction = transactions[0];
      const fineAmount = computeFine(transaction.due_date, finePolicy);
      const overdueUnits = computeOverdueUnits(transaction.due_date, finePolicy);
      const fineLabel = finePolicy.fine_increment_type === 'per_hour' ? 'hour' : 'day';

      let fineId = null;
      if (fineAmount > 0) {
        const { data: fineRow, error: fineErr } = await localDbAdmin
          .from('fines')
          .insert([{
            transaction_id: transaction.id,
            user_id: transaction.user_id,
            amount: fineAmount,
            overdue_days: overdueUnits,
            status: 'unpaid',
          }])
          .select('id')
          .single();
        if (fineErr) throw fineErr;
        fineId = fineRow.id;
      }

      const transUpdate = { status: 'returned', return_date: new Date().toISOString() };
      if (fineAmount > 0) {
        transUpdate.fine_amount = fineAmount;
        transUpdate.fine_id = fineId;
      }

      const { error: updateTransError } = await localDbAdmin
        .from('transactions')
        .update(transUpdate)
        .eq('id', transaction.id);
      if (updateTransError) throw updateTransError;

      const { error: updateBookError } = await localDbAdmin
        .from('books')
        .update({ quantity: book.quantity + 1 })
        .eq('id', book.id);
      if (updateBookError) throw updateBookError;

      showToast(
        fineAmount > 0
          ? `"${book.title}" returned by ${transaction.users?.name}. Overdue ${overdueUnits} ${fineLabel}(s). Fine: ₱${fineAmount.toFixed(2)}.`
          : `"${book.title}" returned by ${transaction.users?.name}. Stock updated.`,
        'success'
      );

      if (transaction.user_id) {
        const notifRow = {
          user_id: transaction.user_id,
          type: fineAmount > 0 ? 'return_with_fine' : 'returned',
          title: fineAmount > 0 ? 'Book returned — fine due' : 'Book returned',
          body: fineAmount > 0
            ? `Your return of "${book.title}" was recorded. Overdue ${overdueUnits} ${fineLabel}(s). Fine due: ₱${fineAmount.toFixed(2)}.`
            : `Your return of "${book.title}" was recorded. Thank you!`,
          email_sent: false,
          read: false,
        };
        if (fineId) notifRow.fine_id = fineId;
        await localDbAdmin.from('notifications').insert([notifRow]);
      }

      fetchRecentReturns();

    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />

      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--dark-blue)', margin: 0 }}>Process Returns</h1>
        <p style={{ color: '#64748b', marginTop: '5px' }}>
          Scan a book's individual copy barcode (e.g.{' '}
          <code style={{ background: '#eef2ff', color: '#6366f1', padding: '2px 6px', borderRadius: '4px' }}>
            LIB-2026-000001
          </code>
          ) to check it back in.
        </p>
      </div>

      {/* Scanner card */}
      <div style={{
        background: 'white', padding: '2rem 3rem 2.5rem', borderRadius: '12px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.05)', borderTop: '6px solid var(--green)',
        marginBottom: '2rem', textAlign: 'center', width: '100%', boxSizing: 'border-box'
      }}>
        <h2 style={{ color: '#334155', margin: '0 0 6px 0' }}>Ready to Scan</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 20px 0' }}>
          Use a USB barcode scanner or type the barcode label to check in a book.
        </p>

        <form onSubmit={handleScanSubmit} style={{ display: 'flex', gap: '10px', width: '100%', margin: '0 0 14px' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Scan or type barcode (e.g. LIB-2026-000001)"
            value={barcode}
            onChange={(e) => {
              const val = e.target.value;
              setBarcode(val);
              clearTimeout(debounceRef.current);
              if (val.trim()) {
                debounceRef.current = setTimeout(() => {
                  if (val.trim()) {
                    e.target.form.requestSubmit();
                  }
                }, 600);
              }
            }}
            disabled={processing}
            style={{
              flex: 1, padding: '18px 24px', fontSize: '1.4rem', borderRadius: '10px',
              border: `2px solid ${processing ? '#a3e635' : '#cbd5e1'}`,
              outline: 'none', fontFamily: 'monospace',
              transition: 'border-color 0.2s'
            }}
            autoFocus
          />
          <button
            type="submit"
            disabled={processing || !barcode}
            style={{
              padding: '0 28px', background: processing ? '#64748b' : 'var(--maroon)', color: 'white',
              border: 'none', borderRadius: '10px', fontSize: '1.1rem',
              fontWeight: 'bold', cursor: processing || !barcode ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap', transition: 'background 0.2s'
            }}
          >
            {processing ? 'Processing…' : 'Return'}
          </button>
        </form>
      </div>

      {/* Recent returns table */}
      <div style={{
        background: 'white', borderRadius: '12px',
        boxShadow: '0 4px 10px rgba(0,0,0,0.02)',
        border: '1px solid #e2e8f0', overflow: 'hidden'
      }}>
        <h3 style={{ margin: 0, padding: '20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
          Recently Returned
        </h3>
        {recentReturns.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No recent returns.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <tbody>
              {recentReturns.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '15px 20px' }}>
                    <strong style={{ display: 'block', color: 'var(--dark-blue)' }}>{item.books?.title}</strong>
                    <span style={{ fontSize: '0.82rem', color: '#6366f1', fontFamily: 'monospace', background: '#eef2ff', padding: '2px 6px', borderRadius: '4px' }}>
                      {item.book_copies?.accession_id
                        ? `${item.book_copies.accession_id} (Copy #${item.book_copies.copy_number})`
                        : 'Legacy return'}
                    </span>
                  </td>
                  <td style={{ padding: '15px 20px', color: '#475569' }}>
                    Returned by: <strong>{item.users?.name}</strong>
                  </td>
                  <td style={{ padding: '15px 20px', color: '#64748b', fontSize: '0.9rem', textAlign: 'right' }}>
                    {item.return_date
                      ? new Date(item.return_date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
