// SMCOAA landing page; retains the original layout with the approved public-menu items.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [blink, setBlink] = useState(true);
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/maintenance', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((data) => { if (active) setMaintenance(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Trigger a super sharp WHITE flash
    setBlink(true);
    const timer = setTimeout(() => setBlink(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const containerStyle = {
    minHeight: '100vh',
    background: blink
      ? 'radial-gradient(circle at center, rgba(52,29,97,0.08) 0%, #ffffff 60%)'
      : 'linear-gradient(135deg, #ffffff 0%, #f7f5fa 50%, #ffffff 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Arial, sans-serif',
    position: 'relative',
    padding: '20px',
    transition: 'background 0.12s ease-out'
  };

  const logoStyle = {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '4px solid #341D61',
    boxShadow: '0 0 20px rgba(52, 29, 97, 0.16)',
    marginBottom: '20px'
  };

  const menuBtnStyle = {
    position: 'absolute',
    top: '15px',
    left: '15px',
    width: '42px',
    height: '42px',
    background: 'rgba(52, 29, 97, 0.08)',
    borderRadius: '50%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid #341D61',
    cursor: 'pointer',
    zIndex: 20,
    gap: '4px',
    padding: '10px',
    transition: 'background 0.3s ease'
  };

  const dotStyle = {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    background: '#341D61',
    display: 'block'
  };

  const menuDropdownStyle = {
    position: 'absolute',
    top: '65px',
    left: '15px',
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    zIndex: 30,
    minWidth: '220px',
    overflow: 'hidden'
  };

  const menuItemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 18px',
    color: '#21143D',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    borderBottom: '1px solid #f0f0f0',
    cursor: 'pointer',
    transition: 'background 0.2s'
  };

  const titleStyle = {
    fontWeight: 'bold',
    color: '#341D61',
    textAlign: 'center',
    marginBottom: '8px',
    textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
    letterSpacing: '1px',
    lineHeight: '1.2',
    fontSize: 'clamp(1.5rem, 6vw, 2.5rem)'
  };

  const titleLineStyle = {
    display: 'block'
  };

  const titleNoBreakStyle = {
    display: 'block',
    whiteSpace: 'nowrap'
  };

  const subtitleStyle = {
    fontSize: 'clamp(0.8rem, 3vw, 1rem)',
    color: '#5e566a',
    textAlign: 'center',
    marginBottom: '35px',
    opacity: 0.9,
    maxWidth: '320px',
    padding: '0 10px'
  };

  const buttonStyle = {
    padding: '14px 44px',
    fontSize: 'clamp(1rem, 4vw, 1.2rem)',
    fontWeight: 'bold',
    color: '#ffffff',
    background: 'linear-gradient(135deg, #341D61, #50347B)',
    border: 'none',
    borderRadius: '50px',
    cursor: 'pointer',
    textDecoration: 'none',
    boxShadow: '0 4px 15px rgba(52, 29, 97, 0.22)',
    transition: 'all 0.3s ease',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap'
  };

  const footerWrapperStyle = {
    position: 'absolute',
    bottom: '15px',
    left: 0,
    width: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap'
  };

  if (maintenance) return <main role="alert" style={{ minHeight: '100vh', background: '#fff', color: '#341D61', display: 'grid', placeContent: 'center', textAlign: 'center', padding: 24, fontFamily: 'Arial,sans-serif' }}><h1>Maintenance required</h1><p>This site is due for maintenance. To use the site, visit the hosting site and work with the development team to maintain and upgrade it.</p><p role="alert" style={{ color: '#a11', fontWeight: 700 }}>Error: SMCOAA Alumni Election Portal is temporarily unavailable.</p><small>SMCOAA Alumni Election Portal</small></main>;

  return (
    <div style={containerStyle}>
      {/* LED scrolling animation */}
      <style>{`
        @keyframes walkMarquee {
          0% {
            transform: translateX(100%);
          }
          100% {
            transform: translateX(-100%);
          }
        }
        .footer-walker {
          display: inline-block;
          padding: 0 40px;
          color: rgba(52,29,97,0.72);
          font-size: clamp(0.65rem, 2vw, 0.8rem);
          animation: walkMarquee 18s linear infinite;
        }
        .footer-walker:hover {
          animation-play-state: paused;
        }
      `}</style>

      {/* 3-dots menu */}
      <button
        type="button"
        aria-label={menuOpen ? 'Close site menu' : 'Open site menu'}
        aria-expanded={menuOpen}
        aria-controls="landing-site-menu"
        style={{ ...menuBtnStyle, padding: 0 }}
        onClick={() => setMenuOpen(!menuOpen)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(52, 29, 97, 0.16)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(52, 29, 97, 0.08)'; }}
        title="Menu"
      >
        <span style={dotStyle}></span>
        <span style={dotStyle}></span>
        <span style={dotStyle}></span>
      </button>

      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 25 }}
          />

          <nav id="landing-site-menu" aria-label="Site information" style={menuDropdownStyle}>
            <Link
              to="/support"
              onClick={() => setMenuOpen(false)}
              style={menuItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
            >
              Support
            </Link>
            <Link to="/rules" onClick={() => setMenuOpen(false)} style={menuItemStyle}>Rules</Link>
            <Link to="/privacy" onClick={() => setMenuOpen(false)} style={menuItemStyle}>Privacy</Link>
          </nav>
        </>
      )}

      <img
        src="/logo.png"
        alt="St. Michael’s College, Oleh Alumni Association crest"
        style={logoStyle}
        onError={(e) => { e.target.style.display = 'none'; }}
      />

      <h1 style={titleStyle}>
        <span style={titleLineStyle}>SMCOAA ALUMNI</span>
        <span style={titleNoBreakStyle}>ELECTION PORTAL</span>
      </h1>

      <p style={subtitleStyle}>
        St. Michael’s College, Oleh Alumni Association
      </p>

      <Link
        to="/student-login"
        style={buttonStyle}
        onMouseEnter={(e) => {
          e.target.style.transform = 'translateY(-2px)';
          e.target.style.boxShadow = '0 6px 20px rgba(52, 29, 97, 0.28)';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'translateY(0)';
          e.target.style.boxShadow = '0 4px 15px rgba(52, 29, 97, 0.22)';
        }}
      >
        Voters Access
      </Link>

      {/* Walking marquee footer retained from the original landing layout. */}
      <div style={footerWrapperStyle}>
        <span className="footer-walker" style={{ textAlign: 'center', lineHeight: 1.5 }}>
          <span style={{ display: 'block' }}>SMCOAA Alumni Election Portal</span>
          <span style={{ display: 'block' }}>© {new Date().getFullYear()} · All rights reserved · Powered by zhennexcorp</span>
        </span>
      </div>

    </div>
  );
}