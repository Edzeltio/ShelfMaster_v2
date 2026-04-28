import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [detectedCode, setDetectedCode] = useState('');

  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const lastScannedRef = useRef('');
  const processingRef = useRef(false);
  const debounceRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1480;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    } catch (_) {}
  }

  function triggerScanFeedback(code) {
    playBeep();
    setDetectedCode(code);
    setScanFlash(true);
    setTimeout(() => setScanFlash(false), 600);
    setTimeout(() => setDetectedCode(''), 2500);
  }

  useEffect(() => {
    fetchRecentReturns();
    if (inputRef.current) inputRef.current.focus();
    const onVisible = () => { if (!document.hidden) fetchRecentReturns(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Stop camera and clear debounce on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      clearTimeout(debounceRef.current);
    };
  }, []);

  // Start scanning only AFTER the video element is in the DOM (cameraOpen → render → effect runs)
  useEffect(() => {
    if (cameraOpen && selectedCamera) {
      // Small delay ensures React has flushed the DOM and the <video> ref is attached
      const t = setTimeout(() => {
        if (videoRef.current) startScanning(selectedCamera);
      }, 100);
      return () => clearTimeout(t);
    }
  }, [cameraOpen, selectedCamera]);

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

  async function openCamera() {
    setCameraError('');
    try {
      const deviceList = await BrowserMultiFormatReader.listVideoInputDevices();
      if (!deviceList || deviceList.length === 0) {
        setCameraError('No camera found on this device.');
        return;
      }
      setCameras(deviceList);
      // Prefer back camera on mobile
      const back = deviceList.find(d => /back|rear|environment/i.test(d.label));
      const chosen = back?.deviceId || deviceList[deviceList.length - 1].deviceId;
      setSelectedCamera(chosen);
      // setCameraOpen AFTER selectedCamera is set so the useEffect picks up both together
      setCameraOpen(true);
    } catch (err) {
      setCameraError('Camera access denied. Please allow camera permission and try again.');
    }
  }

  function stopCamera() {
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch (_) {}
      readerRef.current = null;
    }
    setScanning(false);
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
    setCameraError('');
    if (inputRef.current) inputRef.current.focus();
  }

  async function startScanning(deviceId) {
    setScanning(true);
    const codeReader = new BrowserMultiFormatReader();
    readerRef.current = codeReader;
    lastScannedRef.current = '';

    try {
      await codeReader.decodeFromVideoDevice(
        deviceId || selectedCamera,
        videoRef.current,
        (result, err) => {
          if (result) {
            const text = result.getText();
            // Debounce: ignore same code within 2 seconds
            if (text === lastScannedRef.current) return;
            if (processingRef.current) return;
            lastScannedRef.current = text;
            setTimeout(() => { lastScannedRef.current = ''; }, 2000);
            handleBarcodeDetected(text);
          }
        }
      );
    } catch (err) {
      // NotFoundException fires normally when no barcode is in frame — ignore it
      if (err?.name !== 'NotFoundException') {
        setCameraError('Camera error: ' + (err.message || 'Could not start scanner.'));
        setCameraOpen(false);
        setScanning(false);
      }
    }
  }

  async function switchCamera(deviceId) {
    stopCamera();
    setSelectedCamera(deviceId);
    // useEffect will re-trigger startScanning when selectedCamera changes
  }

  const handleBarcodeDetected = useCallback(async (scanned) => {
    if (!scanned) return;
    processingRef.current = true;
    setProcessing(true);
    setBarcode(scanned);
    triggerScanFeedback(scanned);

    try {
      await processReturn(scanned);
    } finally {
      processingRef.current = false;
      setProcessing(false);
      setBarcode('');
    }
  }, []);

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
          .select('id, user_id, users(name), books(title)')
          .eq('copy_id', copy.id)
          .eq('status', 'borrowed')
          .order('borrow_date', { ascending: true })
          .limit(1);

        if (transError) throw new Error(`Database error: ${transError.message}`);
        if (!transactions || transactions.length === 0) {
          throw new Error(`No active loan found linked to copy ${copy.accession_id}.`);
        }

        const transaction = transactions[0];

        const { error: updateTransError } = await localDbAdmin
          .from('transactions')
          .update({ status: 'returned', return_date: new Date().toISOString() })
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

        showToast(`Copy ${copy.accession_id} returned by ${transaction.users?.name}. Marked available.`, 'success');
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
        .select('id, user_id, users(name)')
        .eq('book_id', book.id)
        .eq('status', 'borrowed')
        .order('borrow_date', { ascending: true })
        .limit(1);

      if (transError) throw new Error(`Database error: ${transError.message}`);
      if (!transactions || transactions.length === 0) {
        throw new Error(`"${book.title}" is not currently marked as borrowed.`);
      }

      const transaction = transactions[0];

      const { error: updateTransError } = await localDbAdmin
        .from('transactions')
        .update({ status: 'returned', return_date: new Date().toISOString() })
        .eq('id', transaction.id);
      if (updateTransError) throw updateTransError;

      const { error: updateBookError } = await localDbAdmin
        .from('books')
        .update({ quantity: book.quantity + 1 })
        .eq('id', book.id);
      if (updateBookError) throw updateBookError;

      showToast(`"${book.title}" returned by ${transaction.users?.name}. Stock updated.`, 'success');
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
        <h2 style={{ color: '#334155', margin: '0 0 6px 0' }}>
          {cameraOpen ? 'Camera Scanner' : 'Ready to Scan'}
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 20px 0' }}>
          {cameraOpen
            ? 'Point the camera at the barcode on the book spine.'
            : 'Use a USB scanner or your device camera to read the barcode label.'}
        </p>

        {/* Camera viewfinder */}
        {cameraOpen && (
          <div style={{ marginBottom: '18px' }}>
            <div style={{
              position: 'relative', display: 'block',
              borderRadius: '12px', overflow: 'hidden',
              boxShadow: scanFlash
                ? '0 0 0 4px #22c55e, 0 0 28px 8px rgba(34,197,94,0.45)'
                : '0 0 0 3px #94a3b8',
              transition: 'box-shadow 0.1s ease',
              background: '#000', width: '360px', maxWidth: '100%', margin: '0 auto'
            }}>
              <video
                ref={videoRef}
                style={{ display: 'block', width: '100%', borderRadius: '10px' }}
                muted
                playsInline
              />
              {/* Green flash overlay on successful scan */}
              {scanFlash && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(34,197,94,0.22)',
                  borderRadius: '10px', pointerEvents: 'none'
                }} />
              )}
            </div>

            {/* Status line below viewfinder */}
            <div style={{ minHeight: '36px', marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
              {detectedCode ? (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                  background: '#f0fdf4', border: '1.5px solid #86efac',
                  borderRadius: '8px', padding: '6px 16px'
                }}>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#15803d', fontSize: '0.95rem' }}>
                    {detectedCode}
                  </span>
                  {processing && (
                    <span style={{ color: '#64748b', fontSize: '0.82rem', marginLeft: '4px' }}>processing…</span>
                  )}
                </div>
              ) : scanning ? (
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0, alignSelf: 'center' }}>
                  Scanning — hold barcode steady inside the frame
                </p>
              ) : null}
            </div>

            {/* Camera selector (only show if multiple cameras) */}
            {cameras.length > 1 && (
              <div style={{ marginTop: '10px' }}>
                <select
                  value={selectedCamera}
                  onChange={(e) => switchCamera(e.target.value)}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1',
                    fontSize: '0.85rem', color: '#475569', cursor: 'pointer'
                  }}
                >
                  {cameras.map(cam => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {cameraError && (
          <p style={{ color: 'var(--maroon)', fontSize: '0.85rem', marginBottom: '12px' }}>
            {cameraError}
          </p>
        )}

        {/* Text input row */}
        {!cameraOpen && (
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
                    if (!processingRef.current && val.trim()) {
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
        )}

        {/* Camera toggle button */}
        <button
          onClick={cameraOpen ? closeCamera : openCamera}
          disabled={processing}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '9px 20px', borderRadius: '8px', cursor: processing ? 'not-allowed' : 'pointer',
            border: cameraOpen ? '2px solid var(--maroon)' : '2px solid var(--green)',
            background: cameraOpen ? '#fff1f2' : '#f0fdf4',
            color: cameraOpen ? 'var(--maroon)' : '#166534',
            fontWeight: 600, fontSize: '0.9rem', transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>{cameraOpen ? '✕' : '📷'}</span>
          {cameraOpen ? 'Close Camera' : 'Use Camera Scanner'}
        </button>
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
