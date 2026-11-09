export type * from "./generated/index.js";

/** RFC 9457 problem surfaced as an error. */
export class ProblemError extends Error {
  constructor(readonly problem: { type: string; title: string; status: number; detail?: string; code?: string; correlation_id?: string }) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemError";
  }
}

export type ClientOptions = { baseUrl: string; token: () => string | Promise<string>; fetch?: typeof fetch };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Thin client: bearer auth, Idempotency-Key on every write, problem+json errors, cursor paging. */
export const createClient = ({ baseUrl, token, fetch: doFetch = fetch }: ClientOptions) => {
  const request = async <T>(method: Method, path: string, body?: unknown, idempotencyKey?: string): Promise<T> => {
    const headers: Record<string, string> = { authorization: `Bearer ${await token()}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["idempotency-key"] = idempotencyKey ?? crypto.randomUUID();
    const res = await doFetch(new URL(path, baseUrl), { method, headers, body: body === undefined ? null : JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const payload = await res.json();
    if (!res.ok) throw new ProblemError(payload);
    return payload as T;
  };

  async function* paginate<T>(path: string, limit = 50): AsyncGenerator<T> {
    let cursor: string | null = null;
    do {
      const url = new URL(path, baseUrl);
      url.searchParams.set("limit", String(limit));
      if (cursor) url.searchParams.set("cursor", cursor);
      const page: { items: T[]; page: { next_cursor: string | null } } = await request("GET", url.pathname + url.search);
      yield* page.items;
      cursor = page.page.next_cursor;
    } while (cursor);
  }

  return { request, paginate };
};
