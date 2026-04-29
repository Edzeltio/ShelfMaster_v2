import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { localDb } from './localDbClient';
import myLogo from './assets/logo.png';
import ServerBadge from './ServerBadge';
import { useResponsive } from './useResponsive';

export default function StudentNavbar() {
  const navigate = useNavigate();
  const [userName, setUserName] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isMobile } = useResponsive();

  useEffect(() => {
    async function fetchUserName(userId) {
      if (!userId) { setUserName(''); return; }
      const { data } = await localDb
        .from('users')
        .select('name')
        .eq('auth_id', userId)
        .single();
      setUserName(data?.name || '');
    }

    // Fetch on mount
    localDb.auth.getUser().then(({ data: { user } }) => fetchUserName(user?.id));

    // Only clear the name if this tab signs out — ignore other tabs signing in
    const { data: { subscription } } = localDb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUserName('');
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await localDb.auth.signOut();
    navigate('/login');
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <nav style={getNavStyle(isMobile)}>
        <div style={logoSectionStyle}>
          <img src={myLogo} alt="ShelfMaster Logo" style={logoImgStyle} />
          {!isMobile && <span style={brandNameStyle}>ShelfMaster</span>}
        </div>

        {isMobile && (
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={hamburgerStyle}
            aria-label="Toggle menu"
          >
            <span style={{ display: 'block', width: '24px', height: '2px', background: 'var(--maroon)', margin: '5px 0' }}></span>
            <span style={{ display: 'block', width: '24px', height: '2px', background: 'var(--maroon)', margin: '5px 0' }}></span>
            <span style={{ display: 'block', width: '24px', height: '2px', background: 'var(--maroon)', margin: '5px 0' }}></span>
          </button>
        )}

        <div style={getLinksContainerStyle(isMobile, mobileMenuOpen)}>
          <Link to="/student/dashboard" style={linkStyle} onClick={closeMobileMenu}>Home</Link>
          <Link to="/student/catalog" style={linkStyle} onClick={closeMobileMenu}>Catalog</Link>
          <Link to="/student/ebooks" style={linkStyle} onClick={closeMobileMenu}>eBooks</Link>
          <Link to="/student/books" style={linkStyle} onClick={closeMobileMenu}>My Books</Link>
          <Link to="/student/profile" style={linkStyle} onClick={closeMobileMenu}>Profile</Link>
          
          <div style={getUserSectionStyle(isMobile)}>
            <ServerBadge />
            {userName && <span style={userNameStyle}>{userName}</span>}
            <button onClick={() => { handleLogout(); closeMobileMenu(); }} style={logoutButtonStyle}>Logout</button>
          </div>
        </div>
      </nav>
    </>
  );
}

const getNavStyle = (isMobile) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: isMobile ? '12px 16px' : '15px 40px',
  background: 'white',
  boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
  position: 'sticky',
  top: 0,
  zIndex: 1000
});

const logoSectionStyle = { display: 'flex', alignItems: 'center', gap: '12px' };
const logoImgStyle = { width: '40px', height: '40px', objectFit: 'contain' };

const brandNameStyle = {
  fontSize: '1.4rem',
  fontWeight: 'bold',
  color: 'var(--maroon)',
  letterSpacing: '-0.5px'
};

const hamburgerStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  padding: '8px'
};

const getLinksContainerStyle = (isMobile, mobileMenuOpen) => ({
  display: isMobile && !mobileMenuOpen ? 'none' : 'flex',
  ...(isMobile ? {
    flexDirection: 'column',
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: 'white',
    borderTop: '1px solid #e2e8f0',
    padding: '16px',
    gap: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
  } : {
    alignItems: 'center',
    gap: '25px'
  })
});

const linkStyle = {
  textDecoration: 'none',
  color: '#64748b',
  fontWeight: '500',
  fontSize: '0.95rem',
  transition: 'color 0.2s'
};

const getUserSectionStyle = (isMobile) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '15px',
  ...(isMobile ? {
    marginLeft: 0,
    paddingLeft: 0,
    borderLeft: 'none',
    flexDirection: 'column',
    paddingTop: '12px',
    borderTop: '1px solid #e2e8f0'
  } : {
    marginLeft: '10px',
    paddingLeft: '20px',
    borderLeft: '1px solid #e2e8f0'
  })
});

const userNameStyle = {
  color: 'var(--maroon)',
  fontWeight: '600',
  fontSize: '0.9rem'
};

const logoutButtonStyle = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid var(--maroon)',
  background: 'transparent',
  color: 'var(--maroon)',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '0.85rem',
  transition: 'all 0.2s'
};
