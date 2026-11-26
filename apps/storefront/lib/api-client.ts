import axios from "axios";

function getBaseUrl(): string {
  if (typeof window !== "undefined" && !window.location.hostname.includes("localhost")) {
    return "/api";
  }
  return process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
}

const apiClient = axios.create({
  baseURL: getBaseUrl(),
  withCredentials: true,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

/**
 * Phase 3 central Better Auth cutover.
 *
 * Auth is the BA session cookie now (httpOnly, set by the central service
 * via the same-origin `/api/better-auth/*` proxy, sent with
 * `withCredentials`). There is NO Bearer token anymore, and NO refresh
 * machinery: the BA session refreshes server-side (`updateAge`), so a
 * 401 means the session is gone. The interceptor dispatches `auth:logout`
 * (the AuthContext clears the user) and rejects — it never replays the
 * request.
 */
apiClient.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    if (config.headers) {
      delete config.headers["Content-Type"];
      delete config.headers["content-type"];
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth:logout"));
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
