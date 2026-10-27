import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "./logo.png";
import { useAuth } from "../context/AuthContext";

function getInitials(name, email) {
  const label = (name || email || "Reader").trim();
  const parts = label.includes("@") ? [label.split("@")[0]] : label.split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

function Navbar() {
  const { isAuthenticated, authReady, user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate("/");
  };
  const displayName = user?.name || user?.email || "Reader";

  return (
    <nav className={`navbar${mobileOpen ? " mobile-open" : ""}${scrolled ? " is-scrolled" : ""}`} aria-label="Main navigation">
      <Link to="/" className="logo-section"><img className="logo-icon" src={logo} alt="Reading Lizard" /></Link>
      <button className="nav-toggle" type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="primary-nav-links" onClick={() => setMobileOpen((open) => !open)}><span /><span /><span /></button>
      <div className="nav-links" id="primary-nav-links">
        <Link to="/#features" onClick={() => setMobileOpen(false)}>Features</Link>
        <Link to="/#how-it-works" onClick={() => setMobileOpen(false)}>How it works</Link>
        <Link to="/#faq" onClick={() => setMobileOpen(false)}>FAQs</Link>
      </div>
      <div className="nav-buttons">
        {!authReady && isAuthenticated ? <span className="nav-auth-pending" role="status">Checking session…</span> : isAuthenticated ? (
          <>
          <Link className="signup-btn nav-primary-cta" to="/research">My research <span aria-hidden="true">→</span></Link>
          <div className="profile-menu" ref={menuRef}>
            <button className="profile-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="profile-menu-items" onClick={() => setMenuOpen((open) => !open)}>
              <span className="profile-avatar" aria-hidden="true">{getInitials(user?.name, user?.email)}</span>
              <span className="profile-trigger-name">{displayName}</span>
              <span className="profile-chevron" aria-hidden="true">⌄</span>
            </button>
            {menuOpen && <div className="profile-menu-panel" id="profile-menu-items" role="menu">
              <div className="profile-menu-identity"><strong>{displayName}</strong><span>{user?.email || "Signed in"}</span></div>
              <Link role="menuitem" to="/account" onClick={() => setMenuOpen(false)}>Account profile</Link>
              <Link role="menuitem" to="/research" onClick={() => setMenuOpen(false)}>My Research</Link>
              <button role="menuitem" type="button" onClick={handleLogout}>Log out</button>
            </div>}
          </div>
          </>
        ) : (
          <>
            <button className="login-btn" onClick={() => { setMobileOpen(false); navigate("/login"); }}>Sign in</button>
            <button className="signup-btn" onClick={() => { setMobileOpen(false); navigate("/signup"); }}>Get started <span aria-hidden="true">→</span></button>
          </>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
