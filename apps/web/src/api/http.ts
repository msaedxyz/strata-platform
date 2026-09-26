// A small JSON client with the bearer token. The modules use it for the endpoints that the generated
// client does not have yet (docs/api-contract.md, M4) and for the read endpoints, so that each call has one error shape.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type Query = Record<string, QueryValue>;

export interface Http {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
}

/** Repeated keys for lists (tier=0&tier=1), as FastAPI expects. Empty values are left out. */
export function toQueryString(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** The text of an error response. FastAPI gives {"detail": "..."} or {"detail": {...}}. */
function messageOf(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (status === 403) return "Your role cannot do this.";
  if (status === 401) return "Your session ended. Log in again.";
  return `The request failed (HTTP ${status}).`;
}

export function createHttp(getToken: () => string | null, baseUrl = ""): Http {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) throw new ApiError(res.status, messageOf(res.status, json), (json as { detail?: unknown } | null)?.detail);
    return json as T;
  };
  return {
    get: (path, query) => request("GET", `${path}${toQueryString(query)}`),
    post: (path, body) => request("POST", path, body),
  };
}
