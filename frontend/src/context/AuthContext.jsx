import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchProfile, loginRequest, registerRequest } from "../api/authApi";
import { SESSION_EXPIRED_EVENT } from "../api/session";

const AuthContext = createContext(null);
const TOKEN_KEY = "rl_token";
const USER_KEY = "rl_user";

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(readStoredUser);
  const [validatedToken, setValidatedToken] = useState(null);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setValidatedToken(null);
  }, []);

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }, [user]);

  useEffect(() => {
    if (!token) {
      setValidatedToken(null);
      return undefined;
    }

    let active = true;
    fetchProfile(token)
      .then((data) => {
        if (!active) return;
        setUser(data?.user || data?.profile || null);
        setValidatedToken(token);
      })
      .catch((error) => {
        if (!active) return;
        if (error.status === 401 || error.status === 404) clearSession();
        else setValidatedToken(token);
      });
    return () => { active = false; };
  }, [token, clearSession]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, clearSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, clearSession);
  }, [clearSession]);

  const applyAuthResponse = (data) => {
    const nextToken = data?.token || data?.accessToken || data?.jwt || null;
    const nextUser = data?.user || data?.profile || null;
    if (!nextToken) throw new Error("The server did not return a valid sign-in session.");
    setToken(nextToken);
    setValidatedToken(null);
    setUser(nextUser);
    return { token: nextToken, user: nextUser };
  };

  const login = async ({ email, password }) => {
    const data = await loginRequest({ email, password });
    return applyAuthResponse(data);
  };

  const register = async ({ name, email, password }) => {
    await registerRequest({ name, email, password });
    const session = await loginRequest({ email, password });
    return applyAuthResponse(session);
  };

  const value = {
    token,
    user,
    isAuthenticated: Boolean(token),
    authReady: !token || validatedToken === token,
    login,
    register,
    logout: clearSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
