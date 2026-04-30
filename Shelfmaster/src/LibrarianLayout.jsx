import React, { useState, useEffect, useRef } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { localDb } from './localDbClient';
import ServerBadge from './ServerBadge';

export default function LibrarianLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const prevCountRef = useRef(0);
  const notifPermission = useRef(Notification.permission);

  // Auto-close the mobile drawer whenever the route changes
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Guard: verify session and librarian role before rendering
  useEffect(() => {
    async function verifyLibrarian() {
      const { data: { user } } = await localDb.auth.getUser();
      if (!user) { navigate('/login', { replace: true }); return; }

      const { data } = await localDb
        .from('users')
        .select('role')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (!data || data.role !== 'librarian') {
        navigate('/login', { replace: true });
        return;
      }
      setAuthChecked(true);
    }
    verifyLibrarian();
  }, [navigate]);

  // Request browser notification permission on first load
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        notifPermission.current = p;
      });
    }
  }, []);

  // Fetch count + subscribe to real-time inserts on transactions
  useEffect(() => {
    fetchPendingCount();

    const channel = localDb
      .channel('pending-requests-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => fetchPendingCount()
      )
      .subscribe();

    return () => localDb.removeChannel(channel);
  }, []);

  async function fetchPendingCount() {
    const { count, error } = await localDb
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (!error) {
      const newCount = count || 0;

      // Fire browser notification only when count increases
      if (newCount > prevCountRef.current) {
        const added = newCount - prevCountRef.current;
        fireNotification(added);
      }

      prevCountRef.current = newCount;
      setPendingCount(newCount);
    }
  }

  function fireNotification(added) {
    if (notifPermission.current !== 'granted') return;
    new Notification('ShelfMaster — New Borrow Request', {
      body: `${added} new borrow request${added > 1 ? 's' : ''} waiting for your approval.`,
      icon: '/logo.png',
      badge: '/logo.png',
    });
  }

  const handleLogout = async () => {
    await localDb.auth.signOut();
    navigate('/login');
  };

  const isOnRequestsPage = location.pathname === '/librarian/requests';

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <p style={{ color: '#94a3b8' }}>Verifying session...</p>
      </div>
    );
  }

  return (
    <div className={`admin-layout${sidebarOpen ? ' sidebar-open' : ''}`}>

      {/* Mobile hamburger — only visible on small screens via CSS */}
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setSidebarOpen(o => !o)}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Dim overlay behind the open drawer */}
      <div
        className="sidebar-overlay"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/shelfmaster_logo.png" alt="ShelfMaster" />
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>ShelfMaster</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--light-blue)' }}>Librarian Portal</span>
        </div>

        <nav className="sidebar-nav">
          <Link to="/librarian/dashboard" className="sidebar-link">Dashboard</Link>
          <Link to="/librarian/inventory" className="sidebar-link">Inventory</Link>
          <Link to="/librarian/users" className="sidebar-link">User Management</Link>

          {/* Pending Requests with live badge */}
          <Link
            to="/librarian/requests"
            className="sidebar-link"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <span>Pending Requests</span>
            {pendingCount > 0 && (
              <span style={{
                background: isOnRequestsPage ? 'rgba(255,255,255,0.3)' : '#ef4444',
                color: 'white',
                fontSize: '0.7rem',
                fontWeight: 800,
                borderRadius: '999px',
                minWidth: '20px',
                height: '20px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 6px',
                marginLeft: '8px',
                lineHeight: 1,
                animation: isOnRequestsPage ? 'none' : 'pulse-badge 1.5s infinite',
              }}>
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </Link>

          <Link to="/librarian/walkin" className="sidebar-link">Walk-in Borrowing</Link>
          <Link to="/librarian/returns" className="sidebar-link">Process Returns</Link>
          <Link to="/librarian/history" className="sidebar-link">Borrowing History</Link>
          <Link to="/librarian/settings" className="sidebar-link">Settings</Link>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <ServerBadge />
          </div>
          <button onClick={handleLogout} className="btn-logout">Logout</button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="admin-content">
        <Outlet />
      </main>

      {/* Pulse animation for badge */}
      <style>{`
        @keyframes pulse-badge {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
