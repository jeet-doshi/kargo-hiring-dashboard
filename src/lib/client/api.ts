/** Fetch wrapper for the dashboard's own API: throws an Error with the server's founder-safe message. */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Network error: check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status}). Please try again.`);
  }
  return body as T;
}

export function jsonInit(method: string, data?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  };
}
