const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api";

export interface ApiError extends Error {
  status?: number;
}

export async function fetchWithAuth<T = unknown>(
  endpoint: string,
  token?: string | null,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // If not FormData, default to application/json
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson?.detail?.error?.message) {
        errorDetail = errJson.detail.error.message;
      } else if (errJson?.detail) {
        errorDetail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      // ignore
    }
    const err: ApiError = new Error(errorDetail);
    err.status = response.status;
    throw err;
  }

  // Handle blob or json
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }
  return response as unknown as T;
}
