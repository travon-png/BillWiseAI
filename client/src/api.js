export const BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";

const TOKEN = "bw_token";
const USER = "bw_user";
export const SESSION_EXPIRED_EVENT = "billwise:session-expired";

export function getToken() {
  return localStorage.getItem(TOKEN) || "";
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER) || "null");
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  if (token) localStorage.setItem(TOKEN, token);
  if (user) localStorage.setItem(USER, JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(USER);
}

function expireSession(message = "Your session ended. Please sign in again.") {
  logout();
  window.dispatchEvent(
    new CustomEvent(SESSION_EXPIRED_EVENT, {
      detail: { message },
    })
  );
}

function isLoginRequest(path) {
  return path === "/api/auth/login" || path === "/api/auth/register";
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(BASE + path, { ...options, headers });
  } catch {
    throw new Error(
      `Cannot reach the BillWise backend at ${BASE}. Make sure npm run dev is running in BillWiseAI/server.`
    );
  }

  const type = response.headers.get("content-type") || "";

  if (!response.ok) {
    let message = "Request failed.";

    try {
      if (type.includes("json")) {
        const body = await response.json();
        message = body.error || body.message || message;
      } else {
        message = (await response.text()) || message;
      }
    } catch {
      // Keep the fallback message.
    }

    if (response.status === 401 && !isLoginRequest(path)) {
      expireSession(message);
      throw new Error("Your session ended. Please sign in again.");
    }

    throw new Error(message);
  }

  return type.includes("json") ? response.json() : response;
}
