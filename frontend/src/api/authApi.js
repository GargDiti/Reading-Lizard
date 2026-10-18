import { API_BASE_URL } from "./config";

async function parseResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => "");

  if (!res.ok) {
    const message =
      (data && (data.message || data.error || data.msg)) ||
      (typeof data === "string" && data) ||
      `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  return data;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new Error("Could not reach the Reading Lizard backend. Check that it is running.");
  }
  return parseResponse(response);
}

// POST /api/auth/login  { email, password }
export async function loginRequest({ email, password }) {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

// POST /api/auth/register  { name, email, password }
export async function registerRequest({ name, email, password }) {
  return request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
}

// GET /api/auth/profile  (uses stored token)
export async function fetchProfile(token) {
  return request("/api/auth/profile", {
    headers: { Authorization: `Bearer ${token}` },
  });
}
