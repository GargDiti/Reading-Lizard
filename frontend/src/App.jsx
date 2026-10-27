import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "./components/logo.png";
import Navbar from "./components/navbar";
import Hero from "./components/Hero";
import Features from "./components/Features";
import LandingSections, { HomeFooter } from "./components/LandingSections";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ResearchPage from "./pages/ResearchPage";
import AccountPage from "./pages/AccountPage";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";

function Home() {
  useEffect(() => {
    const sections = document.querySelectorAll("main > section:not(.hero), main > .recent-section");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-revealed"));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-revealed"); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    sections.forEach((section) => { section.classList.add("reveal-on-scroll"); observer.observe(section); });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="app">
      <Navbar />

      <main>
        <Hero />
        <Features />
        <LandingSections />
      </main>
      <HomeFooter />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, authReady } = useAuth();
  const location = useLocation();

  if (!authReady) return <div className="route-loading" role="status">Checking your account…</div>;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function App() {
  const location = useLocation();
  const [showSplash, setShowSplash] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  useEffect(() => {
    if (!showSplash) return undefined;
    const timer = window.setTimeout(() => setShowSplash(false), 1700);
    return () => window.clearTimeout(timer);
  }, [showSplash]);
  return (
    <AuthProvider>
      {showSplash && <div className="page-splash" aria-label="Loading Reading Lizard"><div className="splash-brand"><img src={logo} alt="" /><strong>Reading Lizard</strong></div><span className="splash-progress" /></div>}
      <div key={location.pathname} className="route-transition"><Routes location={location}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/register" element={<Signup />} />
        <Route
          path="/research"
          element={(
            <ProtectedRoute>
              <ResearchPage />
            </ProtectedRoute>
          )}
        />
        <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></div>
    </AuthProvider>
  );
}

export default App;
