import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Navbar from "./components/navbar";
import Hero from "./components/Hero";
import Features from "./components/Features";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ResearchPage from "./pages/ResearchPage";
import AccountPage from "./pages/AccountPage";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";

function Home() {
  return (
    <div className="app">
      <Navbar />

      <main>
        <Hero />
        <Features />
      </main>
      <footer className="home-footer" id="about">
        <span>© 2026 Reading Lizard</span>
        <span>Curiosity, with sources.</span>
      </footer>
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
  return (
    <AuthProvider>
      <Routes>
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
      </Routes>
    </AuthProvider>
  );
}

export default App;
