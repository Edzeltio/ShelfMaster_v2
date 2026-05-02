import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { localDb } from './localDbClient';
import myLogo from './assets/logo.png';
import ServerBadge from './ServerBadge';
import { useResponsive } from './useResponsive';

const NAV_LINKS = [
  { to: '/student/dashboard', label: 'Home' },
  { to: '/student/catalog', label: 'Catalog' },
  { to: '/student/ebooks', label: 'eBooks' },
  { to: '/student/books', label: 'My Books' },
  { to: '/student/profile', label: 'Profile' },
];

export default function StudentNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [userName, setUserName] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isMobile } = useResponsive();

  useEffect(() => {
    async function fetchUserName(userId) {
      if (!userId) { setUserName(''); return; }
      const { data } = await localDb.from('users').select('name').eq('auth_id', userId).single();
      setUserName(data?.name || '');
    }

    localDb.auth.getUser().then(({ data: { user } }) => fetchUserName(user?.id));

    const { data: { subscription } } = localDb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUserName('');
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await localDb.auth.signOut(); navigate('/'); };
  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <style>{NAV_STYLES}</style>
      <nav style={navStyle(isMobile)}>
        <div style={logoSection}>
          <img src={myLogo} alt="ShelfMaster Logo" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 8 }} />
          <span style={{ fontFamily: 'var(--ff-display)', fontSize: isMobile ? '1.6rem' : '1.5rem', fontWeight: 700, color: 'var(--maroon)', letterSpacing: '-.02em' }}>
            ShelfMaster
          </span>
        </div>

        {isMobile && (
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={hamburgerStyle} aria-label="Toggle menu">
            <span style={barStyle} />
            <span style={{ ...barStyle, width: mobileMenuOpen ? 18 : 24 }} />
            <span style={barStyle} />
          </button>
        )}

        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {NAV_LINKS.map(link => {
              const isActive = location.pathname === link.to;
              return (
                <Link key={link.to} to={link.to} style={linkStyle(isActive)} className="sn-link">
                  {link.label}
                </Link>
              );
            })}
          </div>
        )}

        {!isMobile && (
          <div style={userSection}>
            <ServerBadge />
            {userName && (
              <span style={{ color: 'var(--maroon)', fontWeight: 600, fontSize: '.88rem' }}>
                {userName}
              </span>
            )}
            <button onClick={handleLogout} style={logoutBtn} className="sn-logout">
              Logout
            </button>
          </div>
        )}
      </nav>

      {isMobile && mobileMenuOpen && (
        <div style={mobileMenuStyle}>
          {NAV_LINKS.map(link => {
            const isActive = location.pathname === link.to;
            return (
              <Link key={link.to} to={link.to} onClick={closeMobileMenu} style={mobileLinkStyle(isActive)}>
                {link.label}
              </Link>
            );
          })}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ServerBadge />
                {userName && <span style={{ color: 'var(--maroon)', fontWeight: 600, fontSize: '.88rem' }}>{userName}</span>}
              </div>
              <button onClick={() => { handleLogout(); closeMobileMenu(); }} style={logoutBtn} className="sn-logout">
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const NAV_STYLES = `
  .sn-link:hover { color: var(--maroon) !important; background: var(--maroon-tint) !important; }
  .sn-logout:hover { background: var(--maroon) !important; color: white !important; }
`;

const navStyle = (isMobile) => ({
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: isMobile ? '12px 16px' : '13px 36px',
  background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 1px 0 var(--border)',
  position: 'sticky', top: 0, zIndex: 1000,
});

const logoSection = { display: 'flex', alignItems: 'center', gap: 10 };

const hamburgerStyle = {
  background: 'none', border: 'none', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', padding: 8, gap: 5,
};

const barStyle = {
  display: 'block', width: 24, height: 2,
  background: 'var(--maroon)', borderRadius: 2, transition: 'width .2s',
};

const linkStyle = (isActive) => ({
  textDecoration: 'none',
  color: isActive ? 'var(--maroon)' : 'var(--text-muted)',
  fontWeight: isActive ? 600 : 500,
  fontSize: '.9rem',
  padding: '7px 14px',
  borderRadius: 8,
  transition: 'all .2s',
  background: isActive ? 'var(--maroon-tint)' : 'transparent',
  letterSpacing: '.01em',
});

const userSection = {
  display: 'flex', alignItems: 'center', gap: 14,
  paddingLeft: 18, borderLeft: '1px solid var(--border)',
};

const logoutBtn = {
  padding: '7px 16px', borderRadius: 8,
  border: '1.5px solid var(--maroon)',
  background: 'transparent', color: 'var(--maroon)',
  fontWeight: 600, cursor: 'pointer', fontSize: '.85rem',
  transition: 'all .2s',
};

const mobileMenuStyle = {
  background: 'white', borderBottom: '1px solid var(--border)',
  padding: '12px 16px 16px',
  display: 'flex', flexDirection: 'column', gap: 4,
  boxShadow: '0 4px 16px rgba(90,21,21,.08)',
  position: 'sticky', top: 61, zIndex: 999,
};

const mobileLinkStyle = (isActive) => ({
  textDecoration: 'none', color: isActive ? 'var(--maroon)' : 'var(--text-muted)',
  fontWeight: isActive ? 600 : 500, fontSize: '.9rem',
  padding: '10px 14px', borderRadius: 8,
  background: isActive ? 'var(--maroon-tint)' : 'transparent',
  display: 'block',
});