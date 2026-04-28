import React, { useState, useEffect, useRef } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import { getBaseURL } from './connectionManager';

function apiUrl(path) {
  const base = getBaseURL();
  return base ? base.replace(/\/$/, '') + path : path;
}
import BarcodeLabel, { generateBarcode, generateCopyAccessionId } from './BarcodeLabel';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import Toast from './Toast';

const MIGRATION_SQL =
`-- The Express server creates this table automatically when XAMPP MySQL is running.
-- If you prefer manual setup, import xampp_schema.sql in phpMyAdmin.

CREATE TABLE IF NOT EXISTS book_copies (
  id VARCHAR(36) PRIMARY KEY,
  book_id VARCHAR(36) NOT NULL,
  copy_number INT NOT NULL DEFAULT 1,
  accession_id VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'available',
  date_acquired DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (book_id),
  CONSTRAINT fk_book_copies_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);`;

const nullableNumberFields = ['pages', 'cost_price', 'quantity'];

function cleanBookPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (nullableNumberFields.includes(key)) {
        if (value === '' || value === null || value === undefined) {
          return [key, null];
        }
        const numberValue = Number(value);
        return [key, Number.isFinite(numberValue) ? numberValue : null];
      }
      return [key, typeof value === 'string' ? value.trim() : value];
    })
  );
}

export default function Inventory() {
  const [activeTab, setActiveTab] = useState('books');
  const [books, setBooks] = useState([]);
  const [ebooks, setEbooks] = useState([]);
  const [archivedBooks, setArchivedBooks] = useState([]);
  const [archivedSearch, setArchivedSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showEbookModal, setShowEbookModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentBookId, setCurrentBookId] = useState(null);
  const [ebookForm, setEbookForm] = useState({ title: '', url: '' });
  const [ebookImgValid, setEbookImgValid] = useState(false);
  const [editingEbook, setEditingEbook] = useState(null);
  const [expandedBookId, setExpandedBookId] = useState(null);
  const [copiesMap, setCopiesMap] = useState({});
  const [copiesLoading, setCopiesLoading] = useState(false);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [migrationChecked, setMigrationChecked] = useState(false);
  const [showMigration, setShowMigration] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const showToast = (message, type = 'success') => setToast({ message, type });

  const initialFormState = {
    accession_num: '',
    barcode: '',
    title: '',
    authors: '',
    quantity: 1,
    date_acquired: new Date().toISOString().split('T')[0],
    edition: '',
    pages: '',
    book_type: 'Hardbound',
    subject_class: '',
    cost_price: '',
    publisher: '',
    isbn: '',
    copyright: '',
    source: '',
    remark: '',
    status: 'active',
    cover_image: null,
  };

  const [formData, setFormData] = useState(initialFormState);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const [coverColAvailable, setCoverColAvailable] = useState(null);
  const coverInputRef = useRef(null);

  useEffect(() => {
    fetchInventory();
    checkCoverColumn();
    checkMigration();
  }, []);

  async function checkMigration() {
    const { error } = await localDbAdmin
      .from('book_copies')
      .select('id')
      .limit(1);
    const needed = error && (
      error.code === '42P01' ||
      error.code === 'PGRST200' ||
      (error.message || '').includes('book_copies') ||
      (error.message || '').includes('schema cache')
    );
    setMigrationNeeded(needed);
    setMigrationChecked(true);
  }

  async function checkCoverColumn() {
    const { error } = await localDbAdmin
      .from('books')
      .select('cover_image')
      .limit(1);
    setCoverColAvailable(!error || error.code !== '42703');
  }

  async function fetchInventory() {
    const { data, error } = await localDb
      .from('books')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false });

    if (error) { console.error('Fetch error:', error); return; }

    const all = data || [];
    setBooks(all.filter(b => b.book_type !== 'eBook'));
    setEbooks(all.filter(b => b.book_type === 'eBook'));

    const { data: archived, error: archErr } = await localDb
      .from('books')
      .select('*')
      .eq('status', 'archived')
      .order('created_at', { ascending: false });

    if (!archErr) setArchivedBooks(archived || []);
  }

  const handleDeleteForever = async (book) => {
    const confirmed = window.confirm(`Permanently delete "${book.title}"? This cannot be undone.`);
    if (!confirmed) return;

    const { data: sessionData } = await localDb.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      showToast('Delete failed: please sign in again.', 'error');
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/books/${book.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Delete failed.');

      fetchInventory();
      showToast(`"${book.title}" permanently deleted.`, 'success');
    } catch (error) {
      showToast('Delete failed: ' + error.message, 'error');
    }
  };

  const handleUnarchive = async (book) => {
    const confirmed = window.confirm(`Restore "${book.title}" to the active catalog?`);
    if (!confirmed) return;

    const { data: sessionData } = await localDb.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      showToast('Restore failed: please sign in again.', 'error');
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/books/${book.id}/unarchive`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Restore failed.');

      fetchInventory();
      showToast(`"${book.title}" restored successfully.`, 'success');
    } catch (error) {
      showToast('Restore failed: ' + error.message, 'error');
    }
  };

  async function getNextCopyNumber() {
    const { data, error } = await localDbAdmin
      .from('book_copies')
      .select('accession_id')
      .order('accession_id', { ascending: false })
      .limit(1);

    if (error) return 1; // table doesn't exist yet — start from 1
    if (!data || data.length === 0) return 1;
    const parts = data[0].accession_id.split('-');
    return parseInt(parts[parts.length - 1]) + 1;
  }

  async function generateCopiesForBook(bookId, count, dateAcquired, startCopyNum = 1) {
    const nextNum = await getNextCopyNumber();
    const year = new Date().getFullYear();
    const copies = Array.from({ length: count }, (_, i) => ({
      book_id: bookId,
      copy_number: startCopyNum + i,
      accession_id: generateCopyAccessionId(nextNum + i),
      status: 'available',
      date_acquired: dateAcquired || new Date().toISOString().split('T')[0],
    }));
    const { error } = await localDbAdmin.from('book_copies').insert(copies);
    if (error) throw error;
  }

  async function fetchCopiesForBook(bookId) {
    setCopiesLoading(true);
    const { data, error } = await localDbAdmin
      .from('book_copies')
      .select('*')
      .eq('book_id', bookId)
      .order('copy_number', { ascending: true });
    if (!error) {
      setCopiesMap(prev => ({ ...prev, [bookId]: data || [] }));
    }
    setCopiesLoading(false);
  }

  const toggleExpandCopies = (bookId) => {
    if (expandedBookId === bookId) {
      setExpandedBookId(null);
    } else {
      setExpandedBookId(bookId);
      fetchCopiesForBook(bookId);
    }
  };

  const openAddModal = async () => {
    setIsEditing(false);
    const { data } = await localDb
      .from('books')
      .select('accession_num')
      .order('accession_num', { ascending: false })
      .limit(1);
    const lastNum = data && data[0] ? parseInt(data[0].accession_num) : 0;
    const nextAcc = (lastNum + 1).toString().padStart(5, '0');
    const autoBarcode = generateBarcode(nextAcc);
    setFormData({ ...initialFormState, accession_num: nextAcc, barcode: autoBarcode });
    setCoverFile(null);
    setCoverPreview(null);
    setShowModal(true);
  };

  const openEditModal = (book) => {
    setIsEditing(true);
    setCurrentBookId(book.id);
    setFormData({ ...book });
    setCoverFile(null);
    setCoverPreview(book.cover_image || null);
    setShowModal(true);
  };

  const handleCoverChange = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file (JPG, PNG, WEBP, etc.).', 'warning');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be 5 MB or less.', 'warning');
      return;
    }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleArchive = async (book) => {
    const confirmed = window.confirm(`Archive "${book.title}"? It will be hidden from the catalog.`);
    if (confirmed) {
      const { data: sessionData } = await localDb.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        showToast('Archive failed: please sign in again.', 'error');
        return;
      }

      try {
        const response = await fetch(apiUrl(`/api/books/${book.id}/archive`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Archive failed.');
        }

        fetchInventory();
        showToast(`"${book.title}" archived successfully.`, 'success');
      } catch (error) {
        showToast('Archive failed: ' + error.message, 'error');
      }
    }
  };

  async function getSessionToken() {
    const { data: sessionData } = await localDb.auth.getSession();
    return sessionData?.session?.access_token;
  }

  async function requestJson(url, options = {}) {
    const token = await getSessionToken();
    if (!token) {
      throw new Error('Please sign in again.');
    }

    const response = await fetch(apiUrl(url), {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Request failed.');
    }

    return result;
  }

  const handleSaveBook = async (e) => {
    e.preventDefault();
    setLoading(true);

    let coverUrl = formData.cover_image || null;

    if (coverFile) {
      const ext = coverFile.name.split('.').pop().toLowerCase();
      const filename = `covers/${Date.now()}-${formData.accession_num}.${ext}`;
      await localDbAdmin.storage.createBucket('book-covers', { public: true }).catch(() => {});
      const { error: upErr } = await localDbAdmin.storage
        .from('book-covers')
        .upload(filename, coverFile, { upsert: true, contentType: coverFile.type });
      if (upErr) {
        showToast('Image upload failed: ' + upErr.message, 'error');
        setLoading(false);
        return;
      }
      const { data: urlData } = localDbAdmin.storage.from('book-covers').getPublicUrl(filename);
      coverUrl = urlData.publicUrl;
    }

    const { cover_image: _ignored, ...formWithoutCover } = formData;
    const bookPayload = cleanBookPayload(coverColAvailable
      ? { ...formWithoutCover, cover_image: coverUrl }
      : formWithoutCover);

    if (isEditing) {
      const { error } = await localDb.from('books').update(bookPayload).eq('id', currentBookId);
      if (error) { showToast(error.message, 'error'); setLoading(false); return; }

      if (!migrationNeeded) {
        const existing = copiesMap[currentBookId] || [];
        const currentCount = existing.length;
        const newCount = parseInt(formData.quantity) || 1;
        if (newCount > currentCount) {
          try {
            await generateCopiesForBook(
              currentBookId,
              newCount - currentCount,
              formData.date_acquired,
              currentCount + 1
            );
          } catch (err) {
            console.warn('Copy generation failed:', err.message);
          }
        }
      }
    } else {
      const { data: inserted, error } = await localDb.from('books').insert([bookPayload]).select();
      if (error) { showToast(error.message, 'error'); setLoading(false); return; }

      if (!migrationNeeded && inserted && inserted[0]) {
        const bookId = inserted[0].id;
        const count = parseInt(formData.quantity) || 1;
        try {
          await generateCopiesForBook(bookId, count, formData.date_acquired, 1);
        } catch (err) {
          const msg = err.message || '';
          const isMigErr = msg.includes('book_copies') || msg.includes('schema cache') || msg.includes('PGRST200');
          if (!isMigErr) {
            showToast('Book saved but copy generation failed: ' + err.message, 'warning');
          }
          // If migration not done yet, silently skip — the banner will guide the user
        }
      }
    }

    setShowModal(false);
    fetchInventory();
    if (expandedBookId) fetchCopiesForBook(expandedBookId);
    showToast(isEditing ? 'Book updated successfully.' : 'Book saved successfully.', 'success');
    setLoading(false);
  };

  const openEbookModal = (ebook = null) => {
    if (ebook) {
      setEditingEbook(ebook);
      setEbookForm({ title: ebook.title, url: ebook.source || '' });
      setEbookImgValid(false);
    } else {
      setEditingEbook(null);
      setEbookForm({ title: '', url: '' });
      setEbookImgValid(false);
    }
    setShowEbookModal(true);
  };

  const handleSaveEbook = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingEbook) {
        await requestJson(`/api/ebooks/${editingEbook.id}`, {
          method: 'PATCH',
          body: JSON.stringify(ebookForm),
        });
      } else {
        await requestJson('/api/ebooks', {
          method: 'POST',
          body: JSON.stringify(ebookForm),
        });
      }

      setShowEbookModal(false);
      fetchInventory();
      showToast(editingEbook ? 'eBook updated successfully.' : 'eBook saved successfully.', 'success');
    } catch (error) {
      showToast('Failed to save eBook: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyStatusChange = async (copyId, bookId, newStatus) => {
    const { error } = await localDbAdmin
      .from('book_copies')
      .update({ status: newStatus })
      .eq('id', copyId);
    if (error) { showToast('Failed to update copy status: ' + error.message, 'error'); return; }

    const copies = copiesMap[bookId] || [];
    const available = copies.filter(c => c.id !== copyId
      ? c.status === 'available'
      : newStatus === 'available'
    ).length;
    await localDb.from('books').update({ quantity: available }).eq('id', bookId);
    fetchCopiesForBook(bookId);
    fetchInventory();
    showToast('Copy status updated successfully.', 'success');
  };

  const exportAllCopiesPDF = async () => {
    if (migrationNeeded) {
      showToast('Please run the database setup first. Click "Database Setup" to view the SQL.', 'warning');
      return;
    }

    const { data: allCopies, error } = await localDbAdmin
      .from('book_copies')
      .select('*, books(title, accession_num)')
      .order('accession_id', { ascending: true });

    if (error || !allCopies || allCopies.length === 0) {
      showToast('No copies found. Add books first to generate copies.', 'warning');
      return;
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;
    const cols = 3;
    const rows = 8;
    const marginX = 8;
    const marginY = 10;
    const cellW = (pageW - marginX * 2) / cols;
    const cellH = (pageH - marginY * 2) / rows;
    const labelsPerPage = cols * rows;

    let labelIndex = 0;

    allCopies.forEach((copy, idx) => {
      if (idx > 0 && idx % labelsPerPage === 0) {
        pdf.addPage();
        labelIndex = 0;
      }

      const col = labelIndex % cols;
      const row = Math.floor(labelIndex / cols);
      const x = marginX + col * cellW;
      const y = marginY + row * cellH;

      const canvas = document.createElement('canvas');
      try {
        JsBarcode(canvas, copy.accession_id, {
          format: 'CODE128',
          width: 1.5,
          height: 36,
          fontSize: 9,
          margin: 4,
          displayValue: true,
        });
        const imgData = canvas.toDataURL('image/png');
        const imgW = cellW - 6;
        const imgH = (canvas.height / canvas.width) * imgW;
        const imgX = x + (cellW - imgW) / 2;
        const imgY = y + 2;
        pdf.addImage(imgData, 'PNG', imgX, imgY, imgW, imgH);

        const title = (copy.books?.title || '').length > 28
          ? (copy.books?.title || '').slice(0, 28) + '…'
          : (copy.books?.title || '');
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(30, 41, 59);
        pdf.text(title, x + cellW / 2, imgY + imgH + 3, { align: 'center', maxWidth: cellW - 4 });

        pdf.setFontSize(6.5);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Copy #${copy.copy_number}`, x + cellW / 2, imgY + imgH + 7, { align: 'center' });

        pdf.setDrawColor(220, 230, 240);
        pdf.setLineWidth(0.2);
        pdf.rect(x + 1, y + 1, cellW - 2, cellH - 2);
      } catch (err) {
        console.warn('Barcode render failed for:', copy.accession_id, err);
      }

      labelIndex++;
    });

    pdf.save(`ShelfMaster-CopyBarcodes-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const exportCopiesForBook = async (book) => {
    if (migrationNeeded) return;
    const copies = copiesMap[book.id] || [];
    if (copies.length === 0) { showToast('No copies found for this book.', 'warning'); return; }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;
    const cols = 3;
    const rows = 8;
    const marginX = 8;
    const marginY = 10;
    const cellW = (pageW - marginX * 2) / cols;
    const cellH = (pageH - marginY * 2) / rows;

    copies.forEach((copy, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = marginX + col * cellW;
      const y = marginY + row * cellH;

      const canvas = document.createElement('canvas');
      try {
        JsBarcode(canvas, copy.accession_id, { format: 'CODE128', width: 1.5, height: 36, fontSize: 9, margin: 4, displayValue: true });
        const imgData = canvas.toDataURL('image/png');
        const imgW = cellW - 6;
        const imgH = (canvas.height / canvas.width) * imgW;
        const imgX = x + (cellW - imgW) / 2;
        const imgY = y + 2;
        pdf.addImage(imgData, 'PNG', imgX, imgY, imgW, imgH);

        const title = book.title.length > 28 ? book.title.slice(0, 28) + '…' : book.title;
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(30, 41, 59);
        pdf.text(title, x + cellW / 2, imgY + imgH + 3, { align: 'center', maxWidth: cellW - 4 });

        pdf.setFontSize(6.5);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Copy #${copy.copy_number}`, x + cellW / 2, imgY + imgH + 7, { align: 'center' });

        pdf.setDrawColor(220, 230, 240);
        pdf.setLineWidth(0.2);
        pdf.rect(x + 1, y + 1, cellW - 2, cellH - 2);
      } catch (err) {
        console.warn('Barcode failed:', copy.accession_id, err);
      }
    });

    pdf.save(`${book.title.slice(0, 30)}-Copies.pdf`);
  };

  return (
    <div style={{ padding: '30px', background: 'var(--cream)', minHeight: '100vh' }}>
      <Toast {...toast} onClose={() => setToast({ message: '' })} />

      {/* MIGRATION BANNER */}
      {migrationChecked && migrationNeeded && (
        <div style={{ background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 'bold', color: '#92400e' }}>⚠️ One-time database setup required</p>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#78350f' }}>
                To enable per-copy barcode tracking, run the SQL below in your <strong>phpMyAdmin SQL tab</strong> once.
              </p>
            </div>
            <button
              onClick={() => setShowMigration(v => !v)}
              style={{ background: '#fcd34d', color: '#78350f', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '16px' }}
            >
              {showMigration ? 'Hide SQL' : 'Show Setup SQL'}
            </button>
          </div>
          {showMigration && (
            <div style={{ marginTop: '14px', position: 'relative' }}>
              <pre style={{ background: '#1e293b', color: '#86efac', padding: '14px 16px', borderRadius: '8px', fontSize: '0.78rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0 }}>
                {MIGRATION_SQL}
              </pre>
              <button
                onClick={() => { navigator.clipboard.writeText(MIGRATION_SQL); showToast('SQL copied to clipboard!', 'success'); }}
                style={{ position: 'absolute', top: '8px', right: '8px', background: '#334155', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '0.72rem', cursor: 'pointer' }}
              >
                Copy
              </button>
              <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: '#92400e' }}>
                After running the SQL, refresh this page. The warning will disappear automatically.
              </p>
            </div>
          )}
        </div>
      )}

      {/* HEADER */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ color: 'var(--maroon)', margin: 0 }}>Inventory</h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>Manage your physical books and digital eBooks separately.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {activeTab === 'ebooks' && (
            <button onClick={() => openEbookModal()} style={ebookBtnStyle}>
              + Add New eBook
            </button>
          )}
          {activeTab === 'books' && (
            <>
              <button onClick={exportAllCopiesPDF} style={exportBtnStyle}>
                📄 Export All Copy Barcodes
              </button>
              <button onClick={openAddModal} style={addBtnStyle}>
                + Add New Book
              </button>
            </>
          )}
        </div>
      </header>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '24px', borderBottom: '2px solid #e2e8f0' }}>
        <button
          onClick={() => setActiveTab('books')}
          style={{
            padding: '10px 28px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: 'bold', fontSize: '0.95rem',
            color: activeTab === 'books' ? 'var(--maroon)' : '#94a3b8',
            borderBottom: activeTab === 'books' ? '3px solid var(--maroon)' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.15s'
          }}
        >
          📚 Physical Books <span style={{ marginLeft: '6px', background: activeTab === 'books' ? '#FFF0F0' : '#f1f5f9', color: activeTab === 'books' ? 'var(--maroon)' : '#94a3b8', borderRadius: '10px', padding: '1px 8px', fontSize: '0.8rem' }}>{books.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('ebooks')}
          style={{
            padding: '10px 28px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: 'bold', fontSize: '0.95rem',
            color: activeTab === 'ebooks' ? '#6366f1' : '#94a3b8',
            borderBottom: activeTab === 'ebooks' ? '3px solid #6366f1' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.15s'
          }}
        >
          📱 eBooks <span style={{ marginLeft: '6px', background: activeTab === 'ebooks' ? '#eef2ff' : '#f1f5f9', color: activeTab === 'ebooks' ? '#6366f1' : '#94a3b8', borderRadius: '10px', padding: '1px 8px', fontSize: '0.8rem' }}>{ebooks.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('archived')}
          style={{
            padding: '10px 28px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: 'bold', fontSize: '0.95rem',
            color: activeTab === 'archived' ? '#e11d48' : '#94a3b8',
            borderBottom: activeTab === 'archived' ? '3px solid #e11d48' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.15s'
          }}
        >
          🗄️ Archived <span style={{ marginLeft: '6px', background: activeTab === 'archived' ? '#fff1f2' : '#f1f5f9', color: activeTab === 'archived' ? '#e11d48' : '#94a3b8', borderRadius: '10px', padding: '1px 8px', fontSize: '0.8rem' }}>{archivedBooks.length}</span>
        </button>
      </div>

      {/* PHYSICAL BOOKS TABLE */}
      {activeTab === 'books' && (
        <div style={tableCardStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: '#F5FAE8', color: '#475569' }}>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Author</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Physical Copies</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {books.length === 0 ? (
                <tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No physical books found. Add one using the button above.</td></tr>
              ) : (
                books.map(book => (
                  <React.Fragment key={book.id}>
                    <tr style={{ borderBottom: expandedBookId === book.id ? 'none' : '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>
                        <strong>{book.title}</strong>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Acc# {book.accession_num}</div>
                      </td>
                      <td style={tdStyle}>{book.authors}</td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 'bold', color: book.quantity > 0 ? 'var(--green)' : '#ef4444' }}>
                          {book.quantity}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}> avail.</span>
                      </td>
                      <td style={tdStyle}>
                        {migrationNeeded ? (
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Setup needed</span>
                        ) : (
                          <button
                            onClick={() => toggleExpandCopies(book.id)}
                            style={{
                              background: expandedBookId === book.id ? '#1e293b' : '#f1f5f9',
                              color: expandedBookId === book.id ? 'white' : '#334155',
                              border: 'none', padding: '5px 12px', borderRadius: '6px',
                              cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold',
                              display: 'flex', alignItems: 'center', gap: '5px'
                            }}
                          >
                            🏷️ {expandedBookId === book.id ? 'Hide Copies' : 'View Copies'}
                          </button>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => openEditModal(book)} style={editBtnSmallStyle}>Edit</button>
                          <button onClick={() => handleArchive(book)} style={archiveBtnStyle}>Archive</button>
                        </div>
                      </td>
                    </tr>

                    {/* EXPANDED COPIES PANEL */}
                    {expandedBookId === book.id && (
                      <tr>
                        <td colSpan="5" style={{ padding: 0, borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ background: '#f8fafc', padding: '16px 24px', borderTop: '1px dashed #e2e8f0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                              <p style={{ margin: 0, fontWeight: 'bold', color: '#1e293b', fontSize: '0.9rem' }}>
                                Physical Copies — <span style={{ color: 'var(--maroon)' }}>{book.title}</span>
                              </p>
                              <button
                                onClick={() => exportCopiesForBook(book)}
                                style={{ background: '#1e293b', color: 'white', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer' }}
                              >
                                📄 Export Barcodes
                              </button>
                            </div>

                            {copiesLoading ? (
                              <p style={{ color: '#94a3b8', margin: 0 }}>Loading copies...</p>
                            ) : (copiesMap[book.id] || []).length === 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.85rem' }}>No copies generated yet.</p>
                                <button
                                  onClick={async () => {
                                    try {
                                      await generateCopiesForBook(book.id, book.quantity || 1, book.date_acquired, 1);
                                      await fetchCopiesForBook(book.id);
                                      showToast('Copies generated successfully.', 'success');
                                    } catch (err) {
                                      showToast('Failed: ' + err.message, 'error');
                                    }
                                  }}
                                  style={{ background: 'var(--green)', color: 'white', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 'bold', cursor: 'pointer' }}
                                >
                                  ✨ Generate {book.quantity || 1} {book.quantity === 1 ? 'Copy' : 'Copies'}
                                </button>
                              </div>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                  <tr style={{ color: '#64748b' }}>
                                    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '600' }}>Copy #</th>
                                    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '600' }}>Accession ID (Barcode)</th>
                                    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '600' }}>Status</th>
                                    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '600' }}>Date Acquired</th>
                                    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '600' }}>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(copiesMap[book.id] || []).map(copy => (
                                    <tr key={copy.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                                      <td style={{ padding: '8px 12px', color: '#475569', fontWeight: 'bold' }}>
                                        Copy {copy.copy_number}
                                      </td>
                                      <td style={{ padding: '8px 12px' }}>
                                        <code style={{ background: '#eef2ff', color: '#6366f1', padding: '3px 8px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.82rem' }}>
                                          {copy.accession_id}
                                        </code>
                                      </td>
                                      <td style={{ padding: '8px 12px' }}>
                                        <span style={{
                                          padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 'bold',
                                          background: copy.status === 'available' ? '#dcfce7' : copy.status === 'borrowed' ? '#dbeafe' : '#fef3c7',
                                          color: copy.status === 'available' ? '#059669' : copy.status === 'borrowed' ? '#1d4ed8' : '#92400e',
                                        }}>
                                          {copy.status.charAt(0).toUpperCase() + copy.status.slice(1)}
                                        </span>
                                      </td>
                                      <td style={{ padding: '8px 12px', color: '#64748b' }}>
                                        {copy.date_acquired || '—'}
                                      </td>
                                      <td style={{ padding: '8px 12px' }}>
                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                          <select
                                            value={copy.status}
                                            onChange={e => handleCopyStatusChange(copy.id, book.id, e.target.value)}
                                            style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.8rem', cursor: 'pointer' }}
                                          >
                                            <option value="available">Available</option>
                                            <option value="borrowed">Borrowed</option>
                                            <option value="damaged">Damaged</option>
                                            <option value="lost">Lost</option>
                                          </select>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* EBOOKS GRID */}
      {activeTab === 'ebooks' && (
        <>
          {ebooks.length === 0 ? (
            <div style={{ background: 'white', borderRadius: '12px', padding: '60px', textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📱</div>
              <p style={{ fontWeight: 'bold', marginBottom: '6px' }}>No eBooks yet</p>
              <p style={{ fontSize: '0.9rem' }}>Click "+ Add New eBook" to get started.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
              {ebooks.map(ebook => (
                <EbookCard
                  key={ebook.id}
                  ebook={ebook}
                  onEdit={() => openEbookModal(ebook)}
                  onArchive={() => handleArchive(ebook)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ARCHIVED BOOKS TABLE */}
      {activeTab === 'archived' && (
        <div style={tableCardStyle}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#94a3b8', fontSize: '1rem' }}>🔍</span>
            <input
              type="text"
              value={archivedSearch}
              onChange={e => setArchivedSearch(e.target.value)}
              placeholder="Search archived books by title, author, or accession #"
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.9rem', outline: 'none' }}
            />
            {archivedSearch && (
              <button
                onClick={() => setArchivedSearch('')}
                style={{ background: '#f1f5f9', color: '#64748b', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold' }}
              >
                Clear
              </button>
            )}
          </div>
          {(() => {
            const q = archivedSearch.trim().toLowerCase();
            const filtered = q
              ? archivedBooks.filter(b =>
                  (b.title || '').toLowerCase().includes(q) ||
                  (b.authors || '').toLowerCase().includes(q) ||
                  String(b.accession_num || '').toLowerCase().includes(q)
                )
              : archivedBooks;
            return (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: '#fff1f2', color: '#475569' }}>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Author</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                  {archivedBooks.length === 0
                    ? 'No archived books. Books you archive will appear here.'
                    : `No archived books match "${archivedSearch}".`}
                </td></tr>
              ) : (
                filtered.map(book => (
                  <tr key={book.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={tdStyle}>
                      <strong>{book.title}</strong>
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Acc# {book.accession_num}</div>
                    </td>
                    <td style={tdStyle}>{book.authors}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {book.book_type === 'eBook' ? '📱 eBook' : '📚 Physical'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleUnarchive(book)}
                          style={{ background: '#dcfce7', color: '#059669', border: '1px solid #bbf7d0', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}
                        >
                          ♻️ Restore
                        </button>
                        <button
                          onClick={() => handleDeleteForever(book)}
                          style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
            );
          })()}
        </div>
      )}

      {/* EBOOK MODAL */}
      {showEbookModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalContentStyle, maxWidth: '480px' }}>
            <h3 style={{ color: 'var(--maroon)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📱 {editingEbook ? 'Edit eBook' : 'Add New eBook'}
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '20px' }}>Enter the eBook title and its URL link.</p>

            <form onSubmit={handleSaveEbook}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={inputGroup}>
                  <label style={labelStyle}>eBook Title</label>
                  <input type="text" required placeholder="e.g. Introduction to Python" style={inputStyle}
                    value={ebookForm.title} onChange={e => setEbookForm({ ...ebookForm, title: e.target.value })} />
                </div>
                <div style={inputGroup}>
                  <label style={labelStyle}>URL / Link</label>
                  <input type="url" required placeholder="https://example.com/book.pdf" style={inputStyle}
                    value={ebookForm.url} onChange={e => { setEbookForm({ ...ebookForm, url: e.target.value }); setEbookImgValid(false); }} />
                </div>
                {ebookForm.url && (
                  <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <img src={ebookForm.url} alt="eBook preview"
                      onLoad={() => setEbookImgValid(true)} onError={() => setEbookImgValid(false)}
                      style={{ display: ebookImgValid ? 'block' : 'none', width: '100%', maxHeight: '240px', objectFit: 'contain' }} />
                    {!ebookImgValid && (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '6px' }}>🔗</div>
                        URL entered — no image preview available
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={modalFooter}>
                <button type="button" onClick={() => setShowEbookModal(false)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" disabled={loading} style={{ ...saveBtnStyle, background: '#6366f1' }}>
                  {loading ? 'Saving...' : editingEbook ? 'Update eBook' : 'Save eBook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PHYSICAL BOOK MODAL */}
      {showModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <h3 style={{ color: 'var(--maroon)', marginBottom: '20px' }}>
              {isEditing ? 'Update Book Details' : 'Register New Book'}
            </h3>
            <form onSubmit={handleSaveBook}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* LEFT: form fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ ...inputGroup, background: '#F5FAE8', padding: '10px', borderRadius: '8px' }}>
                    <label style={labelStyle}>Accession # <span style={{ color: '#94a3b8', fontWeight: 'normal', textTransform: 'none' }}>(book-level)</span></label>
                    <input
                      type="text" required style={inputStyle}
                      value={formData.accession_num}
                      onChange={e => {
                        const acc = e.target.value;
                        setFormData({ ...formData, accession_num: acc, barcode: isEditing ? formData.barcode : generateBarcode(acc) });
                      }}
                    />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>ISBN</label>
                    <input type="text" style={inputStyle} value={formData.isbn || ''} onChange={e => setFormData({ ...formData, isbn: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Title</label>
                    <input type="text" required style={inputStyle} value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Authors</label>
                    <input type="text" required style={inputStyle} value={formData.authors} onChange={e => setFormData({ ...formData, authors: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={inputGroup}>
                      <label style={labelStyle}>
                        Number of Copies
                        {!migrationNeeded && <span style={{ color: 'var(--green)', marginLeft: '4px' }}>✓ auto-generates copy barcodes</span>}
                      </label>
                      <input type="number" min="1" style={inputStyle} value={formData.quantity}
                        onChange={e => setFormData({ ...formData, quantity: e.target.value })} />
                    </div>
                    <div style={inputGroup}>
                      <label style={labelStyle}>Subject Class</label>
                      <input type="text" style={inputStyle} value={formData.subject_class || ''} onChange={e => setFormData({ ...formData, subject_class: e.target.value })} />
                    </div>
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Publisher</label>
                    <input type="text" style={inputStyle} value={formData.publisher || ''} onChange={e => setFormData({ ...formData, publisher: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Date Acquired</label>
                    <input type="date" style={inputStyle} value={formData.date_acquired || ''} onChange={e => setFormData({ ...formData, date_acquired: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Edition</label>
                    <input type="text" style={inputStyle} value={formData.edition || ''} onChange={e => setFormData({ ...formData, edition: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Pages</label>
                    <input type="text" style={inputStyle} value={formData.pages || ''} onChange={e => setFormData({ ...formData, pages: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Copyright</label>
                    <input type="text" style={inputStyle} value={formData.copyright || ''} onChange={e => setFormData({ ...formData, copyright: e.target.value })} />
                  </div>
                  <div style={inputGroup}>
                    <label style={labelStyle}>Remark</label>
                    <input type="text" style={inputStyle} value={formData.remark || ''} onChange={e => setFormData({ ...formData, remark: e.target.value })} />
                  </div>
                </div>

                {/* RIGHT: cover upload + barcode preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

                  {/* Cover image uploader */}
                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cover Image <span style={{ color: '#94a3b8', fontWeight: 'normal', textTransform: 'none' }}>(max 5 MB)</span></p>

                    {coverColAvailable === false ? (
                      <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '14px' }}>
                        <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#92400e', fontWeight: 'bold' }}>⚠️ cover_image column missing</p>
                        <code style={{ display: 'block', background: '#1e293b', color: '#86efac', padding: '10px 12px', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'pre' }}>ALTER TABLE books{'\n'}ADD COLUMN IF NOT EXISTS{'\n'}cover_image TEXT;</code>
                      </div>
                    ) : (
                      <>
                        <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                          onChange={e => handleCoverChange(e.target.files[0])} />
                        {coverPreview ? (
                          <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                            <img src={coverPreview} alt="Cover preview"
                              style={{ display: 'block', width: '100%', maxHeight: '200px', objectFit: 'contain' }} />
                            <div style={{ display: 'flex', gap: '6px', padding: '8px', justifyContent: 'flex-end', background: 'rgba(255,255,255,0.9)' }}>
                              <button type="button" onClick={() => coverInputRef.current.click()}
                                style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', color: '#334155' }}>
                                Change
                              </button>
                              <button type="button" onClick={() => { setCoverFile(null); setCoverPreview(null); setFormData(f => ({ ...f, cover_image: null })); }}
                                style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fff1f2', cursor: 'pointer', color: '#dc2626' }}>
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => coverInputRef.current.click()}
                            onDragOver={e => { e.preventDefault(); setCoverDragOver(true); }}
                            onDragLeave={() => setCoverDragOver(false)}
                            onDrop={e => { e.preventDefault(); setCoverDragOver(false); handleCoverChange(e.dataTransfer.files[0]); }}
                            style={{ border: `2px dashed ${coverDragOver ? 'var(--maroon)' : '#cbd5e1'}`, borderRadius: '10px', padding: '24px 12px', textAlign: 'center', cursor: 'pointer', background: coverDragOver ? '#fff8f8' : '#f8fafc', transition: 'all 0.15s' }}
                          >
                            <div style={{ fontSize: '2rem', marginBottom: '6px' }}>🖼️</div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Click or drag & drop to upload cover</p>
                            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>JPG, PNG, WEBP — max 5 MB</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Copy barcode preview notice */}
                  {!migrationNeeded && !isEditing && (
                    <div style={{ background: '#F5FAE8', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>🏷️</div>
                      <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--green)' }}>
                        {formData.quantity || 1} unique copy {parseInt(formData.quantity) === 1 ? 'barcode' : 'barcodes'} will be generated
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#64748b' }}>
                        Each physical copy gets its own scannable accession ID (e.g. LIB-{new Date().getFullYear()}-000001)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div style={modalFooter}>
                <button type="button" onClick={() => setShowModal(false)} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" disabled={loading} style={saveBtnStyle}>
                  {loading ? 'Saving...' : isEditing ? 'Update Book' : `Add Book & Generate ${formData.quantity || 1} ${parseInt(formData.quantity) === 1 ? 'Copy' : 'Copies'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EbookCard({ ebook, onEdit, onArchive }) {
  const [imgValid, setImgValid] = useState(false);

  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '160px', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {ebook.source && (
          <img src={ebook.source} alt={ebook.title}
            onLoad={() => setImgValid(true)} onError={() => setImgValid(false)}
            style={{ display: imgValid ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!imgValid && (
          <div style={{ textAlign: 'center', color: '#6366f1' }}>
            <div style={{ fontSize: '3rem' }}>📱</div>
            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginTop: '4px', color: '#a5b4fc' }}>eBOOK</div>
          </div>
        )}
      </div>
      <div style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.9rem', color: '#1e293b', lineHeight: 1.3 }}>{ebook.title}</p>
          <code style={{ fontSize: '0.7rem', color: '#94a3b8', background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '4px' }}>{ebook.accession_num}</code>
        </div>
        {ebook.source && (
          <a href={ebook.source} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', background: '#eef2ff', color: '#6366f1', textAlign: 'center', padding: '7px', borderRadius: '7px', fontSize: '0.82rem', fontWeight: 'bold', textDecoration: 'none' }}>
            🔗 Open eBook
          </a>
        )}
        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
          <button onClick={onEdit} style={{ ...editBtnSmallStyle, flex: 1 }}>Edit</button>
          <button onClick={onArchive} style={{ ...archiveBtnStyle, flex: 1 }}>Archive</button>
        </div>
      </div>
    </div>
  );
}

const addBtnStyle = { background: 'var(--green)', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' };
const ebookBtnStyle = { background: '#6366f1', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' };
const exportBtnStyle = { background: '#1e293b', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' };
const tableCardStyle = { background: 'white', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', overflow: 'hidden' };
const thStyle = { padding: '15px' };
const tdStyle = { padding: '15px', fontSize: '0.9rem' };
const editBtnSmallStyle = { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' };
const archiveBtnStyle = { background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' };
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 };
const modalContentStyle = { background: 'white', padding: '30px', borderRadius: '15px', width: '90%', maxWidth: '860px', maxHeight: '90vh', overflowY: 'auto' };
const inputGroup = { display: 'flex', flexDirection: 'column', gap: '5px' };
const labelStyle = { fontSize: '0.7rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' };
const inputStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' };
const modalFooter = { display: 'flex', justifyContent: 'flex-end', gap: '15px', marginTop: '30px' };
const saveBtnStyle = { background: 'var(--green)', color: 'white', border: 'none', padding: '10px 25px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' };
const cancelBtnStyle = { background: 'transparent', color: '#64748b', border: 'none', fontWeight: '600', cursor: 'pointer' };
